// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Korg A2 SysEx codec, compiled to WebAssembly with AssemblyScript.
//
// The A2 transmits 8-bit data over MIDI using Korg's "7-in-8" scheme
// (owner's manual p.34, "Dump Data Format"):
//
//   DATA      (1 set = 8 bit x 7 byte):  d0 d1 d2 d3 d4 d5 d6
//   MIDI DATA (1 set = 7 bit x 8 byte):  m  d0' d1' d2' d3' d4' d5' d6'
//
// where m holds the stripped top bits: bit j of m = bit 7 of d[j], and
// d[j]' = d[j] & 0x7F.  A trailing partial set of k bytes becomes k+1 bytes
// (64 bytes -> 74, 8192 -> 9363, 6400 -> 7315).
//
// The JS side copies input into IN, calls pack()/unpack(), and reads OUT.

const CAP: i32 = 65536;
const IN: usize = memory.data(CAP);
const OUT: usize = memory.data(CAP);

export function inPtr(): usize {
  return IN;
}

export function outPtr(): usize {
  return OUT;
}

export function capacity(): i32 {
  return CAP;
}

/** Length of the 7-bit stream produced from `len` 8-bit bytes. */
export function packedLength(len: i32): i32 {
  const rem = len % 7;
  return (len / 7) * 8 + (rem != 0 ? rem + 1 : 0);
}

/** Length of the 8-bit data recovered from `len` 7-bit MIDI bytes. */
export function unpackedLength(len: i32): i32 {
  const rem = len % 8;
  return (len / 8) * 7 + (rem > 1 ? rem - 1 : 0);
}

/** 8-bit IN[0..len) -> 7-bit OUT. Returns the number of bytes written. */
export function pack(len: i32): i32 {
  if (len < 0 || packedLength(len) > CAP) return -1;
  let o: i32 = 0;
  for (let i: i32 = 0; i < len; i += 7) {
    const n = min<i32>(7, len - i);
    let msb: i32 = 0;
    for (let j: i32 = 0; j < n; j++) {
      const b = <i32>load<u8>(IN + <usize>(i + j));
      msb |= ((b >> 7) & 1) << j;
      store<u8>(OUT + <usize>(o + 1 + j), <u8>(b & 0x7f));
    }
    store<u8>(OUT + <usize>o, <u8>msb);
    o += n + 1;
  }
  return o;
}

/** 7-bit IN[0..len) -> 8-bit OUT. Returns the number of bytes written. */
export function unpack(len: i32): i32 {
  if (len < 0 || len > CAP) return -1;
  let o: i32 = 0;
  let i: i32 = 0;
  while (i < len) {
    const msb = <i32>load<u8>(IN + <usize>i);
    const n = min<i32>(7, len - i - 1);
    for (let j: i32 = 0; j < n; j++) {
      const b = <i32>load<u8>(IN + <usize>(i + 1 + j));
      store<u8>(OUT + <usize>(o + j), <u8>((b & 0x7f) | (((msb >> j) & 1) << 7)));
    }
    o += max<i32>(n, 0);
    i += n + 1;
  }
  return o;
}

/** Returns 1 when every byte of IN[0..len) is a valid MIDI data byte (< 0x80). */
export function isSevenBitClean(len: i32): i32 {
  for (let i: i32 = 0; i < len; i++) {
    if (load<u8>(IN + <usize>i) & 0x80) return 0;
  }
  return 1;
}
