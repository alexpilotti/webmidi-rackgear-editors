// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal test runner: node --experimental-strip-types tests/run.ts
import { readFileSync } from 'node:fs';
import { codecFromInstance, MESSAGE_LEN, splitSysex, STREAM_LEN } from '../src/codec.ts';
import { Bank, FACTORY, Patch, PATCH_COUNT } from '../src/model.ts';
import { decodeLabels, encodeLabels, isLabelMessage } from '../src/labels.ts';

let failures = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
};
const eq = (a: unknown, b: unknown, msg = '') => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} expected ${sb}, got ${sa}`);
};
const throws = (fn: () => void, re: RegExp) => {
  try { fn(); } catch (e) {
    if (re.test((e as Error).message)) return;
    throw new Error(`wrong error: ${(e as Error).message}`);
  }
  throw new Error('expected an error');
};

const wasm = readFileSync(new URL('../public/jmp1codec.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const codec = codecFromInstance(instance);

const stream = () => {
  const s = new Uint8Array(STREAM_LEN);
  for (let i = 0; i < s.length; i++) s[i] = (i * 37 + 11) & 0x7f;
  return s;
};

test('message layout: header, 10 blocks of 131 bytes, F7 (1316 bytes)', () => {
  const m = codec.encode(stream());
  eq(m.length, MESSAGE_LEN);
  eq(Array.from(m.subarray(0, 7)), [0xf0, 0x00, 0x20, 0x16, 0x01, 0x01, 0x01]);
  eq([m[136], m[137]], [0x01, 0x02], 'block 2 marker/number at 0x88');
  eq([m[0x41d], m[0x41e]], [0x01, 0x09], 'block 9 at 0x41D');
  eq([m[0x4a0], m[0x4a1]], [0x01, 0x0a], 'block 10 at 0x4A0');
  eq(m[0x523], 0xf7);
});

test('checksum = sum of 128 data bytes & 0x7F', () => {
  const s = stream();
  const m = codec.encode(s);
  let sum = 0;
  for (let i = 0; i < 128; i++) sum += s[i];
  eq(m[0x87], sum & 0x7f);
});

test('encode/decode round trip', () => {
  const s = stream();
  eq(Array.from(codec.decode(codec.encode(s))), Array.from(s));
});

test('decode rejects bad checksum, header and length', () => {
  const m = codec.encode(stream());
  const bad = m.slice(); bad[0x88 + 2 + 5] ^= 1;
  throws(() => codec.decode(bad), /checksum error in block 1/);
  const hdr = m.slice(); hdr[3] = 0x15;
  throws(() => codec.decode(hdr), /not a JMP-1 dump/);
  throws(() => codec.decode(m.subarray(0, 1000)), /wrong length/);
});

test('splitSysex + isJmp1', () => {
  const m = codec.encode(stream());
  const parts = splitSysex(Uint8Array.from([0xf0, 0x7e, 0x00, 0xf7, ...m]));
  eq(parts.length, 2);
  eq([codec.isJmp1(parts[0]), codec.isJmp1(parts[1])], [false, true]);
});

test('mode byte decodes as relay bits (values seen on a real unit and in JMP-Editor)', () => {
  const cases: [number, string, boolean][] = [
    // real JMP-1 dump
    [0x18, 'OD1', true], [0x1c, 'OD1', true], [0x1a, 'OD1', false], [0x10, 'OD2', true], [0x16, 'OD2', false],
    [0x19, 'CL1', true], [0x1b, 'CL1', false], [0x1d, 'CL2', true], [0x1f, 'CL2', false], [0x13, 'CL1', false],
    // JMP-Editor 0.9.03 encoding
    [0x08, 'OD1', true], [0x0a, 'OD1', false], [0x04, 'OD2', true], [0x06, 'OD2', false],
    [0x09, 'CL1', true], [0x0b, 'CL1', false], [0x05, 'CL2', true], [0x07, 'CL2', false],
  ];
  for (const [byte, ch, bs] of cases) {
    const q = new Patch(); q.data[7] = byte;
    eq([q.channel, q.bassShift], [ch, bs], `0x${byte.toString(16)}`);
  }
});

test('setting channel / bass shift round-trips and keeps the unit bit', () => {
  const p = Patch.blank();
  for (const ch of ['OD1', 'OD2', 'CL1', 'CL2'] as const) for (const bs of [true, false]) {
    p.channel = ch; p.bassShift = bs;
    eq([p.channel, p.bassShift, (p.mode & 0x10) !== 0], [ch, bs, true]);
  }
});

test('patch byte order: effect, presence, treble, middle, bass, gain, volume, mode', () => {
  const p = Patch.from({ channel: 'OD2', bassShift: false, volume: 18, gain: 20, bass: 3, middle: -3, treble: 3, presence: 1, effect: 5 });
  eq(Array.from(p.data.subarray(0, 7)), [5, 8, 10, 4, 10, 20, 18]);
  eq([p.channel, p.bassShift, p.get('middle')], ['OD2', false, -3]);
});

test('real JMP-1 dump (docs/samples/marshall-jmp1.syx) decodes to the factory sounds', () => {
  const file = readFileSync(new URL('../docs/samples/marshall-jmp1.syx', import.meta.url));
  const bank = new Bank(codec.decode(new Uint8Array(file)));
  // Patches that match the handbook table exactly on this unit
  for (const i of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25]) {
    const got = bank.patch(i), want = FACTORY[i].patch;
    const v = (p: Patch) => [p.channel, p.bassShift, p.get('bass'), p.get('middle'), p.get('treble'), p.get('presence')];
    eq(v(got), v(want), `patch ${i} ${FACTORY[i].name}`);
  }
  eq([bank.patch(0).get('volume'), bank.patch(0).get('gain')], [18, 20]);
  eq(bank.patch(99).isBlank, true);
  eq(Array.from(codec.encode(bank.stream)), Array.from(file), 're-encoding is byte-identical');
});

test('patches are 10 bytes apart and cross block boundaries; padding is kept', () => {
  const b = new Bank(stream());
  const before = b.stream.slice();
  const p = b.patch(12);
  p.set('volume', 20);
  b.setPatch(12, p);
  eq(b.stream[126], 20, 'patch 12 volume at stream 126');
  eq([b.stream[128], b.stream[129]], [before[128], before[129]], 'patch 12 padding (block 2) untouched');
  const m = codec.encode(b.stream);
  eq(m[7 + 126], 20);
  eq(Array.from(new Bank(codec.decode(m)).patch(13).data), Array.from(new Bank(before).patch(13).data));
});

test('mapping tables live in blocks 9 and 10', () => {
  const b = new Bank();
  eq(b.patch(50).isBlank, true);
  eq([b.mapPatch(124), b.mapOut(124)], [24, 124]);
  b.setMapPatch(124, 36);
  b.setMapOut(5, 99);
  const m = codec.encode(b.stream);
  eq(m[0x41f + 124], 36);
  eq(m[0x4a2 + 5], 99);
});

test('factory table: 26 patches, values from the handbook', () => {
  eq(FACTORY.length, 26);
  const smoke = FACTORY[0].patch;
  eq([FACTORY[0].name, smoke.channel, smoke.bassShift, smoke.get('volume'), smoke.get('gain'), smoke.get('middle')], ['Smoke-em', 'OD2', false, 18, 20, -3]);
  eq([FACTORY[24].patch.channel, FACTORY[24].patch.bassShift, FACTORY[24].patch.get('bass')], ['CL1', true, -1]);
  eq(PATCH_COUNT, 100);
});

test('editor-only labels: own SysEx message, round trip, ignored as a JMP-1 dump', () => {
  const labels = Array.from({ length: PATCH_COUNT }, (_, i) => (i % 3 ? '' : `Patch ${i}`));
  labels[5] = 'Ünicode → stripped, and far too long for a label';
  const m = encodeLabels(labels);
  eq(Array.from(m.subarray(0, 8)), [0xf0, 0x7d, 0x4a, 0x4d, 0x50, 0x31, 0x4c, 0x01]);
  eq(m[m.length - 1], 0xf7);
  eq(m.every((b, i) => i === 0 || i === m.length - 1 || b < 0x80), true, '7-bit clean');
  eq([isLabelMessage(m), codec.isJmp1(m)], [true, false]);
  const back = decodeLabels(m)!;
  eq([back[0], back[1], back[3], back[5]], ['Patch 0', '', 'Patch 3', 'nicode  stripped, an']);
  // A saved file = dump + labels; both are found again
  const file = Uint8Array.from([...codec.encode(new Bank().stream), ...m]);
  const parts = splitSysex(file);
  eq([parts.length, codec.isJmp1(parts[0]), decodeLabels(parts[1])?.[99]], [2, true, 'Patch 99']);
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
