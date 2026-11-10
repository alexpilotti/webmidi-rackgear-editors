// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// JMP-1 memory model: 100 patches + MIDI mapping, held as the 1280-byte data
// stream carried by the SysEx dump (docs/SYSEX_FORMAT.md). Bytes the editor
// does not understand are never touched.

import { STREAM_LEN } from './codec.ts';

export const PATCH_COUNT = 100;
export const PATCH_STRIDE = 10;
export const MAP_SIZE = 128;
const MAP_PATCH_OFFSET = 1024; // block 9: incoming program -> internal patch
const MAP_OUT_OFFSET = 1152; // block 10: entry -> outgoing program

/** Tones (-6..+6) are stored as value + 7 (1..13); confirmed with a real dump. */
export const TONE_OFFSET = 7;

export type Channel = 'OD1' | 'OD2' | 'CL1' | 'CL2';
export const CHANNELS: { id: Channel; label: string; name: string }[] = [
  { id: 'OD1', label: 'OD1', name: 'Overdrive 1' },
  { id: 'OD2', label: 'OD2', name: 'Overdrive 2' },
  { id: 'CL1', label: 'Clean 1', name: 'Clean 1' },
  { id: 'CL2', label: 'Clean 2', name: 'Clean 2' },
];

// Mode byte = relay bits (docs/SYSEX_FORMAT.md):
//   bit0 CLEAN      clean channels (0 = overdrive)
//   bit1 BS_OFF     Bass Shift off (active low)
//   bit2 SEL_CL2    Clean 2 instead of Clean 1 (ignored on overdrive)
//   bit3 SEL_OD1    OD1 instead of OD2 (ignored on clean)
//   bit4            always set by the unit; other bits are preserved
const CLEAN = 0x01;
const BASS_SHIFT_OFF = 0x02;
const SEL_CL2 = 0x04;
const SEL_OD1 = 0x08;
const UNIT_BIT = 0x10;
/** A blank patch as the JMP-1 stores it: tones centred, volume/gain 0, Clean 1, Bass Shift off. */
const BLANK = [0x00, 0x07, 0x07, 0x07, 0x07, 0x00, 0x00, 0x13];

export type ParamId = 'volume' | 'gain' | 'bass' | 'middle' | 'treble' | 'presence' | 'effect';

export interface ParamDef {
  id: ParamId;
  label: string;
  offset: number; // within the 10-byte patch
  min: number; // displayed range
  max: number;
  tone: boolean;
}

export const PARAMS: ParamDef[] = [
  { id: 'volume', label: 'Volume', offset: 6, min: 0, max: 20, tone: false },
  { id: 'gain', label: 'Gain', offset: 5, min: 0, max: 20, tone: false },
  { id: 'bass', label: 'Bass', offset: 4, min: -6, max: 6, tone: true },
  { id: 'middle', label: 'Middle', offset: 3, min: -6, max: 6, tone: true },
  { id: 'treble', label: 'Treble', offset: 2, min: -6, max: 6, tone: true },
  { id: 'presence', label: 'Presence', offset: 1, min: -6, max: 6, tone: true },
  { id: 'effect', label: 'Effect', offset: 0, min: 0, max: 12, tone: false },
];
export const PARAM_BY_ID = Object.fromEntries(PARAMS.map((p) => [p.id, p])) as Record<ParamId, ParamDef>;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** One patch: a copy of its 10 bytes. */
export class Patch {
  readonly data: Uint8Array;

  constructor(data?: Uint8Array) {
    this.data = new Uint8Array(PATCH_STRIDE);
    if (data) this.data.set(data.subarray(0, PATCH_STRIDE));
  }

  static blank(): Patch {
    const p = new Patch();
    p.data.set(BLANK);
    return p;
  }

  static from(v: { channel: Channel; bassShift: boolean } & Record<ParamId, number>): Patch {
    const p = Patch.blank();
    p.channel = v.channel;
    p.bassShift = v.bassShift;
    for (const d of PARAMS) p.set(d.id, v[d.id]);
    return p;
  }

  clone(): Patch {
    return new Patch(this.data);
  }

  equals(o: Patch): boolean {
    return this.data.every((b, i) => b === o.data[i]);
  }

  /** Displayed value of a parameter. */
  get(id: ParamId): number {
    const d = PARAM_BY_ID[id];
    const raw = this.data[d.offset];
    return d.tone ? raw - TONE_OFFSET : raw;
  }

  set(id: ParamId, value: number): void {
    const d = PARAM_BY_ID[id];
    const v = clamp(Math.round(value), d.min, d.max);
    this.data[d.offset] = d.tone ? v + TONE_OFFSET : v;
  }

  get mode(): number {
    return this.data[7];
  }

  /** Every mode byte decodes to a channel (relay bits); null is kept for API compatibility. */
  get channel(): Channel | null {
    const m = this.data[7];
    if (m & CLEAN) return m & SEL_CL2 ? 'CL2' : 'CL1';
    return m & SEL_OD1 ? 'OD1' : 'OD2';
  }
  set channel(c: Channel | null) {
    if (!c) return;
    let m = this.data[7] | UNIT_BIT;
    switch (c) {
      case 'OD1': m = (m & ~CLEAN) | SEL_OD1; break;
      case 'OD2': m = m & ~CLEAN & ~SEL_OD1; break;
      case 'CL1': m = (m | CLEAN) & ~SEL_CL2; break;
      case 'CL2': m = m | CLEAN | SEL_CL2; break;
    }
    this.data[7] = m;
  }

  get bassShift(): boolean {
    return (this.data[7] & BASS_SHIFT_OFF) === 0;
  }
  set bassShift(on: boolean) {
    this.data[7] = on ? this.data[7] & ~BASS_SHIFT_OFF : this.data[7] | BASS_SHIFT_OFF;
  }

  /** Blank (never programmed) patch: the unit's empty pattern, or all zeros. */
  get isBlank(): boolean {
    const d = this.data;
    return BLANK.every((b, i) => d[i] === b) || d.slice(0, 8).every((b) => b === 0);
  }
}

/** The JMP-1 memory: 100 patches and the MIDI mapping table. */
export class Bank {
  readonly stream: Uint8Array;

  constructor(stream?: Uint8Array) {
    this.stream = new Uint8Array(STREAM_LEN);
    if (stream) this.stream.set(stream.subarray(0, STREAM_LEN));
    else {
      for (let i = 0; i < PATCH_COUNT; i++) this.setPatch(i, Patch.blank());
      this.resetMapping();
    }
  }

  clone(): Bank {
    return new Bank(this.stream);
  }

  /** Identity mapping: program n -> patch n (n < 100), outgoing n. */
  resetMapping(): void {
    for (let i = 0; i < MAP_SIZE; i++) {
      this.stream[MAP_PATCH_OFFSET + i] = i % PATCH_COUNT;
      this.stream[MAP_OUT_OFFSET + i] = i;
    }
  }

  patch(i: number): Patch {
    return new Patch(this.stream.subarray(i * PATCH_STRIDE, (i + 1) * PATCH_STRIDE));
  }

  setPatch(i: number, p: Patch): void {
    this.stream.set(p.data, i * PATCH_STRIDE);
  }

  patchEquals(i: number, other: Bank): boolean {
    const a = i * PATCH_STRIDE;
    for (let k = a; k < a + PATCH_STRIDE; k++) if (this.stream[k] !== other.stream[k]) return false;
    return true;
  }

  /** Internal patch called up by incoming program change n (0-127). */
  mapPatch(n: number): number {
    return this.stream[MAP_PATCH_OFFSET + n];
  }
  setMapPatch(n: number, patch: number): void {
    this.stream[MAP_PATCH_OFFSET + n] = clamp(patch, 0, PATCH_COUNT - 1);
  }

  /** Outgoing program change for mapping entry n (0-127). */
  mapOut(n: number): number {
    return this.stream[MAP_OUT_OFFSET + n];
  }
  setMapOut(n: number, program: number): void {
    this.stream[MAP_OUT_OFFSET + n] = clamp(program, 0, 127);
  }

  mappingEquals(other: Bank): boolean {
    for (let k = MAP_PATCH_OFFSET; k < STREAM_LEN; k++) if (this.stream[k] !== other.stream[k]) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Factory sounds 00-25 (handbook p.6, "Pre set sounds").

type Row = [string, Channel, boolean, number, number, number, number, number, number];
const FACTORY_ROWS: Row[] = [
  ['Smoke-em', 'OD2', false, 18, 20, 3, -3, 3, 1],
  ['Chunkus', 'OD1', false, 17, 20, 1, -3, 3, 4],
  ['Sticky', 'OD1', true, 15, 13, 1, 2, 6, 3],
  ['Cleeeeen', 'CL2', false, 20, 9, 3, -1, 4, 6],
  ['British Steel', 'OD2', true, 17, 16, 4, 0, 4, 1],
  ['Nasal Tone', 'OD2', true, 16, 20, 0, 1, 6, 6],
  ['Quo !!!', 'OD2', true, 17, 10, 2, -2, 6, 3],
  ['Angus-Ho', 'OD2', true, 17, 14, 0, -1, 3, 2],
  ['Filth', 'OD2', true, 17, 20, 2, -6, 6, 6],
  ['Bloooz-O', 'OD2', true, 17, 11, 2, -2, 3, 2],
  ['Bloooz-O+', 'OD2', true, 17, 19, 2, -2, 3, 2],
  ["Tej'as", 'OD1', true, 16, 14, 1, -1, 4, 1],
  ['Modster', 'OD1', true, 14, 20, 2, 1, 5, 5],
  ['Biffa', 'OD1', false, 15, 20, 2, 0, 3, 3],
  ['More Gary', 'OD2', true, 17, 4, 3, 0, 3, 3],
  ['Mid-lands', 'OD1', true, 14, 17, 2, 6, 3, 3],
  ['Sunshine', 'OD2', true, 15, 10, 1, 6, -6, 3],
  ['Britaevious', 'CL2', true, 17, 17, 4, -2, 6, 6],
  ['Trash', 'OD1', true, 17, 9, 4, -1, 2, 3],
  ["800's", 'OD1', false, 16, 15, 6, 0, 3, 3],
  ['LA Crunch', 'OD1', true, 16, 17, 6, 1, 3, 2],
  ['Crusher', 'OD1', true, 18, 12, 5, -4, 5, 4],
  ['Grit Clean', 'CL2', false, 16, 19, 3, -1, 4, 6],
  ['Shred Spread', 'OD1', true, 17, 20, 5, 0, 6, 6],
  ['Warm Grit', 'CL1', true, 16, 20, -1, 3, 6, 6],
  ['Mellow', 'CL1', false, 20, 14, 2, -2, 1, 1],
];

/** Factory patches 00-25. The handbook gives no Effect values; 0 (dry) is used. */
export const FACTORY: { name: string; patch: Patch }[] = FACTORY_ROWS.map(
  ([name, channel, bassShift, volume, gain, bass, middle, treble, presence]) => ({
    name,
    patch: Patch.from({ channel, bassShift, volume, gain, bass, middle, treble, presence, effect: 0 }),
  }),
);
