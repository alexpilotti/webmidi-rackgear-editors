// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal test runner (no framework): node --experimental-strip-types tests/run.ts
import { readFileSync } from 'node:fs';
import { codecFromInstance } from '../src/codec.ts';
import {
  buildAllDump, buildProgramDump, buildRequest, buildWriteRequest, decodeAllDump,
  decodeProgramDump, parseMessage, splitSysex, Fn,
} from '../src/sysex.ts';
import { Program } from '../src/program.ts';
import { CHAINS, GROUPS, chainBlocks, formatValue, indexToRaw, rawToIndex, stepRaw } from '../src/effects.ts';

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

const wasm = readFileSync(new URL('../public/a2codec.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const codec = codecFromInstance(instance);

const rand = (n: number, seed = 1) => {
  const a = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24; }
  return a;
};

test('packed lengths match the manual (64->74, 8192->9363, 6400->7315)', () => {
  eq(codec.packedLength(64), 74);
  eq(codec.packedLength(8192), 9363);
  eq(codec.packedLength(6400), 7315);
  eq(codec.unpackedLength(74), 64);
  eq(codec.unpackedLength(9363), 8192);
});

test('7-in-8 bit layout: bit j of the header byte is bit 7 of byte j', () => {
  const packed = codec.pack(Uint8Array.from([0x80, 0x01, 0xff, 0x00, 0x00, 0x00, 0x81]));
  eq(Array.from(packed), [0b1000101, 0x00, 0x01, 0x7f, 0, 0, 0, 0x01]);
});

test('pack/unpack round trip and 7-bit clean output', () => {
  for (const n of [0, 1, 6, 7, 8, 64, 6400, 8192]) {
    const d = rand(n, n + 3);
    const p = codec.pack(d);
    if (p.some((b) => b > 0x7f)) throw new Error('packed data not 7-bit clean');
    eq(Array.from(codec.unpack(p)), Array.from(d), `n=${n}`);
  }
});

test('request / write messages', () => {
  eq(Array.from(buildRequest(2, Fn.PROGRAM_DUMP_REQUEST)), [0xf0, 0x42, 0x32, 0x2d, 0x10, 0xf7]);
  eq(Array.from(buildRequest(0, Fn.ALL_DUMP_REQUEST)), [0xf0, 0x42, 0x30, 0x2d, 0x1c, 0xf7]);
  eq(Array.from(buildWriteRequest(0, 0, 42)), [0xf0, 0x42, 0x30, 0x2d, 0x11, 0x00, 42, 0xf7]);
});

test('program dump round trip', () => {
  const p = Program.init('CLEAN 1', 7);
  p.setParam(3, 2, 0x9c);
  const msg = buildProgramDump(codec, 5, p.data);
  eq(msg.length, 5 + 74 + 1);
  const m = parseMessage(msg)!;
  eq([m.channel, m.fn], [5, 0x40]);
  const back = new Program(decodeProgramDump(codec, m.body));
  eq(back.name, 'CLEAN 1');
  eq(back.chain, 7);
  eq(back.param(3, 2), 0x9c);
});

test('all dump round trip (with and without the f byte)', () => {
  const chainData = rand(8192, 9);
  const programs = Array.from({ length: 100 }, (_, i) => rand(64, i + 100));
  const msg = buildAllDump(codec, 0, { chainData, programs });
  eq(msg.length, 5 + 9363 + 7315 + 1);
  const m = parseMessage(msg)!;
  const d = decodeAllDump(codec, m.body);
  eq(Array.from(d.chainData), Array.from(chainData));
  eq(Array.from(d.programs[57]), Array.from(programs[57]));
  const withF = Uint8Array.from([0, ...m.body]);
  eq(Array.from(decodeAllDump(codec, withF).programs[99]), Array.from(programs[99]));
});

test('splitSysex finds messages in a byte stream', () => {
  const a = buildRequest(0, 0x10), b = buildRequest(1, 0x1c);
  eq(splitSysex(Uint8Array.from([0xfe, ...a, 0x90, ...b])).length, 2);
});

test('program fields: name, variations, off flag', () => {
  const p = Program.init('ABCDEFGHIJ');
  eq(p.name, 'ABCDEFG');
  p.setVariation(0, 3); p.setVariation(1, 5); p.setOff(1, true);
  eq(p.data[5], 0x03 | (0x0d << 4));
  eq([p.variation(0), p.variation(1), p.isOff(0), p.isOff(1)], [3, 5, false, true]);
});

test('chain table covers 97 chains, every block resolves', () => {
  eq(CHAINS.length, 97);
  for (let c = 1; c <= 97; c++) {
    const b = chainBlocks(c);
    if (b.length < 3 || b.length > 6 || b.some((g) => !g)) throw new Error(`chain ${c}`);
  }
  eq(chainBlocks(1).map((g) => g.variations[0][0]), ['COMP', 'DST1', 'XCIT', 'DLY1', 'CHO1', 'RM 1']);
});

test('signed and unsigned parameter encodings', () => {
  const gain = GROUPS.REV.params[3]!; // -12..12 dB
  eq(formatValue(gain, 0), '0');
  eq(formatValue(gain, 0xf4), '-12');
  eq(indexToRaw(gain, 0), 0xf4);
  eq(rawToIndex(gain, 13), -1);
  const time = GROUPS.DLY.params[0]!; // 0..800 ms / 10
  eq(formatValue(time, 80), '800');
  eq(stepRaw(time, 80, 1), 80);
  eq(formatValue(GROUPS.MIX.params[1]!, 0xce), 'L50');
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
