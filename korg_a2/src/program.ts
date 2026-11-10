// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// A2 program (64 bytes) — owner's manual p.34, TABLE 1 "Program Parameters".
//
//  offs   parameter                      data
//  00     Chain Number                   internal 0x01-0x63, external (card) 0x80-0x89
//  01     (no use)
//  02     Master Volume                  0x00-0x0A
//  03     Threshold                      0x00-0x0A
//  04     (no use)
//  05-08  Variation No. for FX 1..8      low nibble = odd FX, high nibble = even FX (0-7)
//  09-15  Program Name                   7 ASCII characters, space padded
//  16-63  FX 1..8 parameters             6 bytes each
//
// Unused bytes are preserved verbatim so that a round trip never changes data
// the editor does not understand.

import { PROGRAM_SIZE } from './sysex.ts';

export const NAME_LENGTH = 7;
export const FX_SLOTS = 8;
export const PARAMS_PER_FX = 6;
const OFF_CHAIN = 0;
const OFF_VOLUME = 2;
const OFF_THRESHOLD = 3;
const OFF_VARIATION = 5;
const OFF_NAME = 9;
const OFF_PARAMS = 16;

/** Bit 3 of a variation nibble is unused by the 0-7 range; we treat it as "effect OFF". */
export const FX_OFF_BIT = 0x08;

export class Program {
  readonly data: Uint8Array;

  constructor(data?: Uint8Array) {
    this.data = new Uint8Array(PROGRAM_SIZE);
    if (data) this.data.set(data.subarray(0, PROGRAM_SIZE));
  }

  static init(name = 'INIT', chain = 1): Program {
    const p = new Program();
    p.chain = chain;
    p.volume = 10;
    p.threshold = 0;
    p.name = name;
    return p;
  }

  clone(): Program {
    return new Program(this.data);
  }

  equals(other: Program): boolean {
    for (let i = 0; i < PROGRAM_SIZE; i++) if (this.data[i] !== other.data[i]) return false;
    return true;
  }

  get chain(): number {
    return this.data[OFF_CHAIN];
  }
  set chain(v: number) {
    this.data[OFF_CHAIN] = v & 0xff;
  }

  /** True for a chain stored on a memory card (0x80-0x89). */
  get isCardChain(): boolean {
    return (this.chain & 0x80) !== 0;
  }

  get volume(): number {
    return this.data[OFF_VOLUME];
  }
  set volume(v: number) {
    this.data[OFF_VOLUME] = Math.max(0, Math.min(10, v));
  }

  get threshold(): number {
    return this.data[OFF_THRESHOLD];
  }
  set threshold(v: number) {
    this.data[OFF_THRESHOLD] = Math.max(0, Math.min(10, v));
  }

  get name(): string {
    let s = '';
    for (let i = 0; i < NAME_LENGTH; i++) {
      const c = this.data[OFF_NAME + i];
      s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
    }
    return s;
  }
  set name(v: string) {
    for (let i = 0; i < NAME_LENGTH; i++) {
      const c = i < v.length ? v.charCodeAt(i) : 0x20;
      this.data[OFF_NAME + i] = c >= 0x20 && c < 0x7f ? c : 0x20;
    }
  }

  private nibble(slot: number): number {
    const b = this.data[OFF_VARIATION + (slot >> 1)];
    return slot & 1 ? b >> 4 : b & 0x0f;
  }
  private setNibble(slot: number, v: number): void {
    const i = OFF_VARIATION + (slot >> 1);
    const b = this.data[i];
    this.data[i] = slot & 1 ? (b & 0x0f) | ((v & 0x0f) << 4) : (b & 0xf0) | (v & 0x0f);
  }

  variation(slot: number): number {
    return this.nibble(slot) & 0x07;
  }
  setVariation(slot: number, v: number): void {
    this.setNibble(slot, (this.nibble(slot) & FX_OFF_BIT) | (v & 0x07));
  }

  isOff(slot: number): boolean {
    return (this.nibble(slot) & FX_OFF_BIT) !== 0;
  }
  setOff(slot: number, off: boolean): void {
    this.setNibble(slot, (this.nibble(slot) & 0x07) | (off ? FX_OFF_BIT : 0));
  }

  param(slot: number, index: number): number {
    return this.data[OFF_PARAMS + slot * PARAMS_PER_FX + index];
  }
  setParam(slot: number, index: number, raw: number): void {
    this.data[OFF_PARAMS + slot * PARAMS_PER_FX + index] = raw & 0xff;
  }
}
