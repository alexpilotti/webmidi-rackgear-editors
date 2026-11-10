// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Marshall JMP-1 SysEx dump codec, compiled to WebAssembly with AssemblyScript.
// Format: see docs/SYSEX_FORMAT.md
//
//   F0 00 20 16 01  [01 nn d0..d127 cs] x 10  F7      (1316 bytes)
//
// decode(): IN = whole SysEx message  -> OUT = 1280-byte data stream
// encode(): IN = 1280-byte data stream -> OUT = whole SysEx message

const CAP: i32 = 4096;
const IN: usize = memory.data(CAP);
const OUT: usize = memory.data(CAP);

export const HEADER_LEN: i32 = 5;
export const BLOCKS: i32 = 10;
export const BLOCK_DATA: i32 = 128;
export const BLOCK_LEN: i32 = BLOCK_DATA + 3; // marker + number + data + checksum
export const STREAM_LEN: i32 = BLOCKS * BLOCK_DATA; // 1280
export const MESSAGE_LEN: i32 = HEADER_LEN + BLOCKS * BLOCK_LEN + 1; // 1316

// Error codes returned by decode() (negative).
export const ERR_LENGTH: i32 = -1;
export const ERR_HEADER: i32 = -2;
export const ERR_MARKER: i32 = -3;
export const ERR_BLOCK_NUMBER: i32 = -4;
export const ERR_CHECKSUM: i32 = -5;
export const ERR_DATA: i32 = -6;
export const ERR_EOX: i32 = -7;

let errorBlock: i32 = 0;

export function inPtr(): usize {
  return IN;
}
export function outPtr(): usize {
  return OUT;
}
export function capacity(): i32 {
  return CAP;
}
/** 1-based block number the last decode() error refers to (0 = none). */
export function lastErrorBlock(): i32 {
  return errorBlock;
}

function hdr(i: i32): u8 {
  // F0 00 20 16 01
  if (i == 0) return 0xf0;
  if (i == 1) return 0x00;
  if (i == 2) return 0x20;
  if (i == 3) return 0x16;
  return 0x01;
}

/** (sum of `len` bytes at ptr) & 0x7F */
export function checksum(ptr: usize, len: i32): i32 {
  let s: i32 = 0;
  for (let i: i32 = 0; i < len; i++) s += <i32>load<u8>(ptr + <usize>i);
  return s & 0x7f;
}

/** True when the first 5 bytes of IN are the JMP-1 header. */
export function isJmp1(len: i32): i32 {
  if (len < HEADER_LEN) return 0;
  for (let i: i32 = 0; i < HEADER_LEN; i++) {
    if (load<u8>(IN + <usize>i) != hdr(i)) return 0;
  }
  return 1;
}

export function decode(len: i32): i32 {
  errorBlock = 0;
  if (len != MESSAGE_LEN) return ERR_LENGTH;
  if (!isJmp1(len)) return ERR_HEADER;
  if (load<u8>(IN + <usize>(len - 1)) != 0xf7) return ERR_EOX;
  for (let b: i32 = 0; b < BLOCKS; b++) {
    const base = IN + <usize>(HEADER_LEN + b * BLOCK_LEN);
    errorBlock = b + 1;
    if (load<u8>(base) != 0x01) return ERR_MARKER;
    if (<i32>load<u8>(base + 1) != b + 1) return ERR_BLOCK_NUMBER;
    const data = base + 2;
    for (let i: i32 = 0; i < BLOCK_DATA; i++) {
      const v = load<u8>(data + <usize>i);
      if (v & 0x80) return ERR_DATA;
      store<u8>(OUT + <usize>(b * BLOCK_DATA + i), v);
    }
    if (<i32>load<u8>(data + <usize>BLOCK_DATA) != checksum(data, BLOCK_DATA)) return ERR_CHECKSUM;
  }
  errorBlock = 0;
  return STREAM_LEN;
}

export function encode(): i32 {
  for (let i: i32 = 0; i < HEADER_LEN; i++) store<u8>(OUT + <usize>i, hdr(i));
  for (let b: i32 = 0; b < BLOCKS; b++) {
    const base = OUT + <usize>(HEADER_LEN + b * BLOCK_LEN);
    store<u8>(base, 0x01);
    store<u8>(base + 1, <u8>(b + 1));
    const data = base + 2;
    for (let i: i32 = 0; i < BLOCK_DATA; i++) {
      store<u8>(data + <usize>i, load<u8>(IN + <usize>(b * BLOCK_DATA + i)) & 0x7f);
    }
    store<u8>(data + <usize>BLOCK_DATA, <u8>checksum(data, BLOCK_DATA));
  }
  store<u8>(OUT + <usize>(MESSAGE_LEN - 1), 0xf7);
  return MESSAGE_LEN;
}
