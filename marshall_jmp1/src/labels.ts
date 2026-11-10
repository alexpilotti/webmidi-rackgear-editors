// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Editor-only patch labels.
//
// The JMP-1 has no patch names (4-digit LED display, 10 bytes per patch, none
// for text), so labels exist only in this editor. To let them travel with a
// saved .syx file they are written as a second SysEx message after the dump,
// using the "non-commercial / educational" manufacturer ID 7D so no real
// device claims it:
//
//   F0 7D 'J' 'M' 'P' '1' 'L' 01  label0 00  label1 00 … label99 00  F7
//
// Labels are printable ASCII (0x20-0x7E), at most LABEL_MAX characters. The
// editor never sends this message to the JMP-1; it only lives in files.

import { PATCH_COUNT } from './model.ts';

export const LABEL_MAX = 20;
const MAGIC = [0xf0, 0x7d, 0x4a, 0x4d, 0x50, 0x31, 0x4c]; // F0 7D "JMP1L"
const VERSION = 0x01;

export function cleanLabel(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '').slice(0, LABEL_MAX);
}

export function encodeLabels(labels: string[]): Uint8Array {
  const out: number[] = [...MAGIC, VERSION];
  for (let i = 0; i < PATCH_COUNT; i++) {
    for (const ch of cleanLabel(labels[i] ?? '')) out.push(ch.charCodeAt(0));
    out.push(0x00);
  }
  out.push(0xf7);
  return Uint8Array.from(out);
}

export function isLabelMessage(m: Uint8Array): boolean {
  return m.length > MAGIC.length + 1 && MAGIC.every((b, i) => m[i] === b);
}

/** Returns 100 labels, or null when `m` is not a label message this version understands. */
export function decodeLabels(m: Uint8Array): string[] | null {
  if (!isLabelMessage(m) || m[MAGIC.length] !== VERSION) return null;
  const labels: string[] = [];
  let cur = '';
  for (let i = MAGIC.length + 1; i < m.length && m[i] !== 0xf7; i++) {
    if (m[i] === 0x00) {
      labels.push(cur);
      cur = '';
    } else if (m[i] >= 0x20 && m[i] <= 0x7e) cur += String.fromCharCode(m[i]);
  }
  while (labels.length < PATCH_COUNT) labels.push('');
  return labels.slice(0, PATCH_COUNT).map(cleanLabel);
}
