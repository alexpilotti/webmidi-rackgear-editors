// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// G-Force User bank model. Layout recovered from real dumps; see
// docs/SYSEX_FORMAT.md. Every guess is listed in the README under
// "Assumptions to verify on hardware".
//
// Stream (the decoded data blocks, joined):
//   0x00  DD EE AA BB                 magic
//   0x04  100 bytes                   1 = User slot n stored, 0 = empty
//   0x68  614-byte record per slot    slots 1 … last stored slot, empty = zeros
//   …     padding to a multiple of 64 (zeros on the samples)
//
// Record:
//   0     2 bytes   preset number, 224 + slot (00 E1 = User 1)   [guess]
//   2     20 bytes  name, ASCII, padded with spaces
//   22    …         parameters (mostly not decoded yet)

import { BLOCK_DATA } from './codec.ts';

export const SLOTS = 100;
export const MAGIC = [0xdd, 0xee, 0xaa, 0xbb] as const;
export const FLAGS_AT = 4;
export const HEADER_SIZE = FLAGS_AT + SLOTS; // 0x68
export const RECORD_SIZE = 614;
export const NAME_AT = 2;
export const NAME_LEN = 20;
export const PARAMS_AT = NAME_AT + NAME_LEN;
/** Preset numbers count the 225 ROM presets first (User 1 = 225 = 0x00E1). */
export const USER_NUMBER_BASE = 224;

export interface ParamDef {
  id: string;
  /** Front-panel block key it belongs to. */
  block: BlockId;
  label: string;
  /** Byte offset inside the 614-byte record. */
  offset: number;
  min: number;
  max: number;
  format: (v: number) => string;
  /** How the offset and encoding were found. */
  source: string;
}

export type BlockId = 'gate' | 'compress' | 'filters' | 'pantrem' | 'pitch' | 'delay' | 'drive' | 'chorus' | 'reverb';

export const BLOCKS: { id: BlockId; label: string }[] = [
  { id: 'gate', label: 'GATE' },
  { id: 'compress', label: 'COMPRESS' },
  { id: 'filters', label: 'FILTERS' },
  { id: 'pantrem', label: 'PAN+TREM' },
  { id: 'pitch', label: 'PITCH' },
  { id: 'delay', label: 'DELAY' },
  { id: 'drive', label: 'DRIVE' },
  { id: 'chorus', label: 'CHORUS' },
  { id: 'reverb', label: 'REVERB' },
];

/** Decoded parameters. Each needs a dump pair that differs by one known change. */
export const PARAMS: ParamDef[] = [
  {
    id: 'reverbDecay',
    block: 'reverb',
    label: 'Decay Time',
    offset: 0x253,
    min: 1,
    max: 200,
    format: (v) => `${(v / 10).toFixed(1)} s`,
    source: 'samples B→C: 2.4 s → 2.5 s changed this byte 0x18 → 0x19 (Mono Reverb)',
  },
];

// ---------------------------------------------------------------------------
// Routing grid and sub-algorithms, found by comparing ROM 1–50
// (samples/gforce-rom-50.syx) with the manual's preset list. Read-only: no
// single-change dump confirms them yet (see README, assumptions).

/** Routing grid: 8 columns × 4 rows of block codes, column by column. */
export const ROUTING_AT = 0x28;
export const ROUTING_COLS = 8;
export const ROUTING_ROWS = 4;
/** Grid code of the pipeline icon (the signal passes through the cell). */
export const PIPE = 1;

export interface RoutedBlock {
  /** Code stored in a grid cell. */
  code: number;
  block: BlockId;
  /** Short name drawn in a grid cell. */
  short: string;
  /** Offset of the sub-algorithm byte, when the block has sub-algorithms. */
  subAt?: number;
  /** Sub-algorithm names by value ('' = unknown). Names not in `seen` are guesses. */
  subs?: string[];
  /** Values whose name was read off the unit's LCD (photos). */
  seen?: number[];
}

export const ROUTED: RoutedBlock[] = [
  { code: 4, block: 'compress', short: 'CPR', subAt: 0x166, subs: ['SIMPLE', 'ADVANCED'] },
  // ROM 7 Touchwah (2) shows FILTER - WAH-WAH: not the manual's order. 0 and 4 fit EQ and Phaser presets.
  { code: 5, block: 'filters', short: 'FIL', subAt: 0x17a, subs: ['PARAMETRIC EQ', '', 'WAH-WAH', '', 'PHASER'], seen: [2] },
  { code: 6, block: 'pantrem', short: 'PAN', subAt: 0x19c, subs: ['TREMOLO', 'TREMOLO ADV', 'PANNER', 'SURROUND PANNER'] },
  { code: 7, block: 'pitch', short: 'PIT', subAt: 0x1b2, subs: ['INTELLIGENT', 'FIXED VOICES', '2 VOICE 2 OCT', 'DETUNE'] },
  // ROM 3 Mono Dyn Delay (4) shows DELAY - ONE-TAP. 2 fits 29 Slap+Slow Dly (two taps).
  { code: 8, block: 'delay', short: 'DLY', subAt: 0x1d6, subs: ['STEREO', 'DUAL', 'DUAL TWO-TAP', 'QUAD-TAP', 'ONE-TAP'], seen: [4] },
  { code: 9, block: 'drive', short: 'DRV' },
  { code: 10, block: 'chorus', short: 'CHO', subAt: 0x22e, subs: ['CLASSIC CHORUS', 'ADVANCED CHORUS', 'CLASSIC FLANGER', 'ADVANCED FLANGER'] },
  // ROM 1 Mono Reverb (1) shows REVERB - ADVANCED.
  { code: 11, block: 'reverb', short: 'REV', subAt: 0x246, subs: ['SIMPLE', 'ADVANCED'], seen: [1] },
];

export const routedBlock = (code: number): RoutedBlock | undefined => ROUTED.find((r) => r.code === code);

export function paramAt(offset: number): ParamDef | undefined {
  return PARAMS.find((p) => p.offset === offset);
}

export function cleanName(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN);
}

// ---------------------------------------------------------------------------

export class Preset {
  readonly data: Uint8Array;

  constructor(data: Uint8Array = new Uint8Array(RECORD_SIZE)) {
    if (data.length !== RECORD_SIZE) throw new Error(`preset record must be ${RECORD_SIZE} bytes`);
    this.data = data;
  }

  clone(): Preset {
    return new Preset(this.data.slice());
  }

  get number(): number {
    return (this.data[0] << 8) | this.data[1];
  }
  set number(n: number) {
    this.data[0] = (n >> 8) & 0xff;
    this.data[1] = n & 0xff;
  }

  get name(): string {
    return String.fromCharCode(...this.data.subarray(NAME_AT, NAME_AT + NAME_LEN)).replace(/\s+$/, '');
  }
  set name(s: string) {
    const n = cleanName(s).padEnd(NAME_LEN, ' ');
    for (let i = 0; i < NAME_LEN; i++) this.data[NAME_AT + i] = n.charCodeAt(i);
  }

  byte(offset: number): number {
    return this.data[offset];
  }
  setByte(offset: number, v: number): void {
    if (offset < PARAMS_AT || offset >= RECORD_SIZE) throw new Error(`offset ${offset} is outside the parameter area`);
    this.data[offset] = Math.max(0, Math.min(255, Math.round(v)));
  }

  get(p: ParamDef): number {
    return this.data[p.offset];
  }
  set(p: ParamDef, v: number): void {
    this.data[p.offset] = Math.max(p.min, Math.min(p.max, Math.round(v)));
  }

  /** Grid code at column c (0–7), row r (0–3): 0 empty, PIPE, or a block code. */
  cell(c: number, r: number): number {
    return this.data[ROUTING_AT + c * ROUTING_ROWS + r];
  }

  /** Blocks in the routing grid: bit k = block with grid code 4 + k (as in ROM_BLOCKS). */
  blockMask(): number {
    let m = 0;
    for (let i = 0; i < ROUTING_COLS * ROUTING_ROWS; i++) {
      const v = this.data[ROUTING_AT + i];
      if (routedBlock(v)) m |= 1 << (v - ROUTED[0].code);
    }
    return m;
  }

  /**
   * Sub-algorithm name of a block: as on the unit's LCD when seen there, with
   * a trailing '?' when it is a guess, `SUB n` when unknown, '' when the block
   * has no sub-algorithms.
   */
  subAlgo(b: RoutedBlock): string {
    if (b.subAt === undefined || !b.subs) return '';
    const v = this.data[b.subAt];
    const name = b.subs[v];
    if (!name) return `SUB ${v}`;
    return b.seen?.includes(v) ? name : `${name}?`;
  }

  equals(o: Preset): boolean {
    return this.data.every((b, i) => b === o.data[i]);
  }
}

// ---------------------------------------------------------------------------

export class Bank {
  /** Magic bytes as received (kept even if they ever differ). */
  readonly magic: Uint8Array;
  /** Per-slot stored flag byte as received (0 = empty). */
  readonly flags: Uint8Array;
  private records: Uint8Array[];
  /** Bytes after the last record (padding), kept while the last slot is unchanged. */
  private trailer: Uint8Array;
  private trailerLast: number;

  constructor(stream?: Uint8Array) {
    this.magic = Uint8Array.from(MAGIC);
    this.flags = new Uint8Array(SLOTS);
    this.records = Array.from({ length: SLOTS }, () => new Uint8Array(RECORD_SIZE));
    this.trailer = new Uint8Array(0);
    this.trailerLast = 0;
    if (!stream) return;
    if (stream.length < HEADER_SIZE) throw new Error(`G-Force bank too short (${stream.length} bytes)`);
    if (!MAGIC.every((b, i) => stream[i] === b)) {
      throw new Error('Not a G-Force User bank (magic DD EE AA BB missing)');
    }
    this.flags.set(stream.subarray(FLAGS_AT, HEADER_SIZE));
    const recs = Math.min(SLOTS, Math.floor((stream.length - HEADER_SIZE) / RECORD_SIZE));
    for (let i = 0; i < recs; i++) {
      this.records[i].set(stream.subarray(HEADER_SIZE + i * RECORD_SIZE, HEADER_SIZE + (i + 1) * RECORD_SIZE));
    }
    const last = this.lastSlot();
    if (HEADER_SIZE + last * RECORD_SIZE > stream.length) {
      throw new Error(`G-Force bank truncated: slot ${last} is marked as stored but the dump ends before it`);
    }
    this.trailer = stream.slice(HEADER_SIZE + last * RECORD_SIZE);
    this.trailerLast = last;
  }

  clone(): Bank {
    return new Bank(this.stream());
  }

  /** 0-based slot index of a 1-based User preset number and back. */
  used(i: number): boolean {
    return this.flags[i] !== 0;
  }

  get usedCount(): number {
    return this.flags.reduce((n, f) => n + (f ? 1 : 0), 0);
  }

  preset(i: number): Preset {
    return new Preset(this.records[i].slice());
  }

  /** Store a preset in slot i (0-based); its number becomes User i+1. */
  store(i: number, p: Preset): void {
    const rec = p.data.slice();
    const pr = new Preset(rec);
    pr.number = USER_NUMBER_BASE + i + 1;
    this.records[i] = rec;
    if (!this.flags[i]) this.flags[i] = 1;
  }

  /** Empty slot i: zero record and flag, as the G-Force sends empty slots. */
  clear(i: number): void {
    this.records[i] = new Uint8Array(RECORD_SIZE);
    this.flags[i] = 0;
  }

  presetEquals(i: number, other: Bank): boolean {
    return this.flags[i] === other.flags[i] && this.records[i].every((b, k) => b === other.records[i][k]);
  }

  /** Number of slots the dump must carry (1-based last stored or non-zero slot). */
  lastSlot(): number {
    for (let i = SLOTS - 1; i >= 0; i--) {
      if (this.flags[i] || this.records[i].some((b) => b)) return i + 1;
    }
    return 0;
  }

  /** The bank as a stream of 64-byte blocks. Unedited banks come back byte-identical. */
  stream(): Uint8Array {
    const last = this.lastSlot();
    const body = HEADER_SIZE + last * RECORD_SIZE;
    const tail = last === this.trailerLast ? this.trailer : new Uint8Array((BLOCK_DATA - (body % BLOCK_DATA)) % BLOCK_DATA);
    const out = new Uint8Array(body + tail.length);
    out.set(this.magic, 0);
    out.set(this.flags, FLAGS_AT);
    for (let i = 0; i < last; i++) out.set(this.records[i], HEADER_SIZE + i * RECORD_SIZE);
    out.set(tail, body);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Preset recall with bank select (owner's manual, I/O Setup → MIDI, p.22).
//
// With Mapping mode External the G-Force reaches every bank. Its table, for
// Bank size 100: bank 0–2 = ROM 1–100 / 101–200 / 201–225, bank 3 = USER
// 1–100, banks 4–9 = card banks 1–6 (confirmed on a real unit for ROM and
// USER, Coarse and Fine, size 100). Read as one list of positions (bank × 100 +
// program), ROM n is position n − 1, USER n is 299 + n, and card bank c preset
// p is 399 + 100 × (c − 1) + p.
// For other Bank sizes the unit is assumed to compute the same position as
// bank × size + program, so the editor sends floor(position / size) and
// position mod size.                                                  [guess]
// With any other Mapping mode, every program change lands in that one bank
// (seen with "into ROM bank": bank 2 + program 44 at size 128 gave ROM 225).

export const CARD_BANKS = 6;
/** Highest bank number a 7-bit bank select message can carry. */
export const MAX_BANK = 127;

/** Position of ROM preset n (0-based). */
export const romIndex = (n: number) => n;
/** Position of User slot i (0-based). */
export const userIndex = (i: number) => 300 + i;
/** Position of preset p (0-based) in card bank c (1–6). */
export const cardIndex = (c: number, p: number) => 400 + (c - 1) * 100 + p;

export function bankProgram(index: number, bankSize: number): { bank: number; program: number } {
  return { bank: Math.floor(index / bankSize), program: index % bankSize };
}

/** Bank and program for a position, or null when the bank would exceed 127. */
export function recallBankProgram(index: number, bankSize: number): { bank: number; program: number } | null {
  const r = bankProgram(index, bankSize);
  return r.bank > MAX_BANK ? null : r;
}
