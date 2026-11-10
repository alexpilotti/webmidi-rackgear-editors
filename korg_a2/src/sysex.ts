// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Korg A2 System Exclusive messages (owner's manual pp.33-34, "MIDI IMPLEMENTATION").
//
// Every message starts with the exclusive header  F0 42 3n 2D  (n = global MIDI
// channel 0-15) followed by a function byte, optional data and F7.

import type { Codec } from './codec.ts';

export const KORG_ID = 0x42;
export const A2_MODEL_ID = 0x2d;

export const PROGRAM_SIZE = 64;
export const PROGRAM_COUNT = 100;
export const CHAIN_DATA_SIZE = 8192;
export const ALL_PARAM_SIZE = PROGRAM_SIZE * PROGRAM_COUNT; // 6400

export const Fn = {
  /** R: request the current program (A2 answers 40 or 24). */
  PROGRAM_DUMP_REQUEST: 0x10,
  /** R: request all 100 internal programs (A2 answers 4C or 24). */
  ALL_DUMP_REQUEST: 0x1c,
  /** R: write the edit buffer into bank/program (A2 answers 21 or 22). */
  PROGRAM_WRITE_REQUEST: 0x11,
  /** R/T: one program (64 bytes) — the edit buffer. */
  PROGRAM_DUMP: 0x40,
  /** R/T: chain data (8192 bytes) + 100 programs (6400 bytes). */
  ALL_DUMP: 0x4c,
  WRITE_COMPLETED: 0x21,
  WRITE_ERROR: 0x22,
  DATA_LOAD_COMPLETED: 0x23,
  DATA_LOAD_ERROR: 0x24,
  FORMAT_ERROR: 0x26,
} as const;

export const FN_NAMES: Record<number, string> = {
  0x10: 'PROGRAM DUMP REQUEST',
  0x1c: 'ALL PROGRAM DUMP REQUEST',
  0x11: 'PROGRAM WRITE REQUEST',
  0x40: 'PROGRAM PARAMETER DUMP',
  0x4c: 'ALL PROGRAM PARAMETER DUMP',
  0x21: 'WRITE COMPLETED',
  0x22: 'WRITE ERROR',
  0x23: 'DATA LOAD COMPLETED',
  0x24: 'DATA LOAD ERROR',
  0x26: 'MIDI IN DATA FORMAT ERROR',
};

export interface A2Message {
  channel: number;
  fn: number;
  /** Raw (still 7-bit) bytes between the function byte and F7. */
  body: Uint8Array;
}

export interface AllDump {
  chainData: Uint8Array; // 8192 bytes, opaque
  programs: Uint8Array[]; // 100 x 64 bytes
}

const header = (ch: number) => [0xf0, KORG_ID, 0x30 | (ch & 0x0f), A2_MODEL_ID];

export function buildRequest(ch: number, fn: number): Uint8Array {
  return Uint8Array.from([...header(ch), fn, 0xf7]);
}

/** bank: 0 = internal, 1 = card. program: 0-99. */
export function buildWriteRequest(ch: number, bank: number, program: number): Uint8Array {
  return Uint8Array.from([
    ...header(ch),
    Fn.PROGRAM_WRITE_REQUEST,
    bank & 0x01,
    Math.max(0, Math.min(99, program)) & 0x7f,
    0xf7,
  ]);
}

export function buildProgramDump(codec: Codec, ch: number, program: Uint8Array): Uint8Array {
  if (program.length !== PROGRAM_SIZE) throw new Error('program must be 64 bytes');
  return Uint8Array.from([...header(ch), Fn.PROGRAM_DUMP, ...codec.pack(program), 0xf7]);
}

export function buildAllDump(codec: Codec, ch: number, dump: AllDump): Uint8Array {
  if (dump.chainData.length !== CHAIN_DATA_SIZE) throw new Error('chain data must be 8192 bytes');
  const params = new Uint8Array(ALL_PARAM_SIZE);
  dump.programs.forEach((p, i) => params.set(p, i * PROGRAM_SIZE));
  return Uint8Array.from([
    ...header(ch),
    Fn.ALL_DUMP,
    ...codec.pack(dump.chainData),
    ...codec.pack(params),
    0xf7,
  ]);
}

/** Parse one complete SysEx message. Returns null when it is not from an A2. */
export function parseMessage(msg: Uint8Array): A2Message | null {
  if (msg.length < 6) return null;
  if (msg[0] !== 0xf0 || msg[1] !== KORG_ID || (msg[2] & 0xf0) !== 0x30 || msg[3] !== A2_MODEL_ID) {
    return null;
  }
  const end = msg[msg.length - 1] === 0xf7 ? msg.length - 1 : msg.length;
  return { channel: msg[2] & 0x0f, fn: msg[4], body: msg.subarray(5, end) };
}

export function decodeProgramDump(codec: Codec, body: Uint8Array): Uint8Array {
  const data = codec.unpack(body);
  if (data.length < PROGRAM_SIZE) {
    throw new Error(`Program dump too short: ${data.length} bytes (expected 64)`);
  }
  return data.slice(0, PROGRAM_SIZE);
}

export function decodeAllDump(codec: Codec, body: Uint8Array): AllDump {
  const chainLen = codec.packedLength(CHAIN_DATA_SIZE); // 9363
  const paramLen = codec.packedLength(ALL_PARAM_SIZE); // 7315
  // NOTE 6 mentions an "f" (0 = internal) selector. The message table shows the
  // data starting right after the function byte; accept both layouts.
  let offset = 0;
  if (body.length === chainLen + paramLen + 1) offset = 1;
  else if (body.length < chainLen + paramLen) {
    throw new Error(`All-program dump too short: ${body.length} bytes (expected ${chainLen + paramLen})`);
  }
  const chainData = codec.unpack(body.subarray(offset, offset + chainLen));
  const params = codec.unpack(body.subarray(offset + chainLen, offset + chainLen + paramLen));
  const programs: Uint8Array[] = [];
  for (let i = 0; i < PROGRAM_COUNT; i++) {
    programs.push(params.slice(i * PROGRAM_SIZE, (i + 1) * PROGRAM_SIZE));
  }
  return { chainData, programs };
}

/** Split a byte stream (e.g. a .syx file) into individual F0..F7 messages. */
export function splitSysex(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0xf0) start = i;
    else if (bytes[i] === 0xf7 && start >= 0) {
      out.push(bytes.slice(start, i + 1));
      start = -1;
    }
  }
  return out;
}

export const hex = (bytes: ArrayLike<number>, max = 24): string => {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, max); i++) parts.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
  return parts.join(' ') + (bytes.length > max ? ` … (${bytes.length} bytes)` : '');
};
