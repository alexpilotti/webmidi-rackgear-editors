// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// TC Electronic G-Force User bank dump codec, compiled to WebAssembly with
// AssemblyScript. Format: see docs/SYSEX_FORMAT.md
//
// A dump is a header message followed by `count` data blocks:
//
//   F0 00 20 1F id 10 nh nl F7                       header (9 bytes)
//   F0 00 20 1F id 11 ix n0 … n127 ck F7             data block (137 bytes)
//
// Each block carries 64 bytes as 128 nibbles, high nibble first.
// ck = (-sum of the 64 bytes) & 0x7F.
//
// decodeBlock(): IN = one 137-byte block message -> OUT = 64 data bytes
// encodeBlock(): IN = 64 data bytes              -> OUT = one 137-byte block message

const CAP: i32 = 1024;
const IN: usize = memory.data(CAP);
const OUT: usize = memory.data(CAP);

export const HEADER_LEN: i32 = 9;
export const BLOCK_DATA: i32 = 64;
export const BLOCK_LEN: i32 = 7 + BLOCK_DATA * 2 + 2; // 137

export const TYPE_HEADER: i32 = 0x10;
export const TYPE_BLOCK: i32 = 0x11;

// Error codes (negative).
export const ERR_LENGTH: i32 = -1;
export const ERR_HEADER: i32 = -2;
export const ERR_TYPE: i32 = -3;
export const ERR_NIBBLE: i32 = -4;
export const ERR_CHECKSUM: i32 = -5;
export const ERR_EOX: i32 = -6;

export function inPtr(): usize {
  return IN;
}
export function outPtr(): usize {
  return OUT;
}
export function capacity(): i32 {
  return CAP;
}

/** True when IN starts with F0 00 20 1F (TC Electronic). */
export function isTc(len: i32): i32 {
  if (len < 6) return 0;
  return load<u8>(IN) == 0xf0 && load<u8>(IN + 1) == 0x00 && load<u8>(IN + 2) == 0x20 && load<u8>(IN + 3) == 0x1f ? 1 : 0;
}

/** (-sum of `len` bytes at ptr) & 0x7F */
export function checksum(ptr: usize, len: i32): i32 {
  let s: i32 = 0;
  for (let i: i32 = 0; i < len; i++) s += <i32>load<u8>(ptr + <usize>i);
  return -s & 0x7f;
}

/** Block count announced by a header message, or a negative error. */
export function headerCount(len: i32): i32 {
  if (len != HEADER_LEN) return ERR_LENGTH;
  if (!isTc(len)) return ERR_HEADER;
  if (<i32>load<u8>(IN + 5) != TYPE_HEADER) return ERR_TYPE;
  if (load<u8>(IN + 8) != 0xf7) return ERR_EOX;
  return (<i32>(load<u8>(IN + 6) & 0x7f) << 7) | <i32>(load<u8>(IN + 7) & 0x7f);
}

export function decodeBlock(len: i32): i32 {
  if (len != BLOCK_LEN) return ERR_LENGTH;
  if (!isTc(len)) return ERR_HEADER;
  if (<i32>load<u8>(IN + 5) != TYPE_BLOCK) return ERR_TYPE;
  if (load<u8>(IN + <usize>(len - 1)) != 0xf7) return ERR_EOX;
  for (let i: i32 = 0; i < BLOCK_DATA; i++) {
    const hi = load<u8>(IN + <usize>(7 + i * 2));
    const lo = load<u8>(IN + <usize>(8 + i * 2));
    if ((hi | lo) & 0xf0) return ERR_NIBBLE;
    store<u8>(OUT + <usize>i, (hi << 4) | lo);
  }
  if (<i32>load<u8>(IN + <usize>(len - 2)) != checksum(OUT, BLOCK_DATA)) return ERR_CHECKSUM;
  return BLOCK_DATA;
}

export function encodeBlock(id: i32, index: i32): i32 {
  store<u8>(OUT, 0xf0);
  store<u8>(OUT + 1, 0x00);
  store<u8>(OUT + 2, 0x20);
  store<u8>(OUT + 3, 0x1f);
  store<u8>(OUT + 4, <u8>(id & 0x7f));
  store<u8>(OUT + 5, <u8>TYPE_BLOCK);
  store<u8>(OUT + 6, <u8>(index & 0x7f));
  for (let i: i32 = 0; i < BLOCK_DATA; i++) {
    const v = load<u8>(IN + <usize>i);
    store<u8>(OUT + <usize>(7 + i * 2), v >> 4);
    store<u8>(OUT + <usize>(8 + i * 2), v & 0x0f);
  }
  store<u8>(OUT + <usize>(BLOCK_LEN - 2), <u8>checksum(IN, BLOCK_DATA));
  store<u8>(OUT + <usize>(BLOCK_LEN - 1), 0xf7);
  return BLOCK_LEN;
}
