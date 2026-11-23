// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal test runner: node --experimental-strip-types tests/run.ts
// The samples in docs/samples/ are User bank dumps from a real G-Force.
import { readFileSync } from 'node:fs';
import { BLOCK_LEN, codecFromInstance, joinMessages, splitSysex } from '../src/codec.ts';
import { ROM_BLOCKS, ROM_NAMES } from '../src/rom.ts';
import { ClockMeter } from '../src/clock.ts';
import { GCARD_BLOCKS, GCARD_NAMES } from '../src/gcard.ts';
import { Bank, BLOCK_AT, bankProgram, recallBankProgram, romIndex, cardIndex, HEADER_SIZE, ROUTED, routedBlock, ROUTING_COLS, ROUTING_ROWS, userIndex, NAME_LEN, PARAMS, Preset, RECORD_SIZE, SLOTS } from '../src/model.ts';

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
const same = (a: Uint8Array, b: Uint8Array, msg = '') => {
  if (a.length !== b.length) throw new Error(`${msg} length ${a.length} vs ${b.length}`);
  const i = a.findIndex((v, k) => v !== b[k]);
  if (i >= 0) throw new Error(`${msg} differs at byte ${i}: ${a[i]} vs ${b[i]}`);
};

const wasm = readFileSync(new URL('../public/gforcecodec.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const codec = codecFromInstance(instance);

const sample = (x: string) => new Uint8Array(readFileSync(new URL(`../docs/samples/gforce-user-bank-${x}.syx`, import.meta.url)));
const bankOf = (x: string) => new Bank(codec.decodeDump(splitSysex(sample(x))).stream);
const decay = PARAMS.find((p) => p.id === 'reverbDecay')!;

console.log('codec');

test('header gives the block count', () => {
  eq(codec.headerCount(Uint8Array.of(0xf0, 0x00, 0x20, 0x1f, 0x00, 0x10, 0x00, 0x0c, 0xf7)), 12);
  eq(codec.headerCount(Uint8Array.of(0xf0, 0x00, 0x20, 0x1f, 0x00, 0x10, 0x00, 0x32, 0xf7)), 50);
});

test('every block of every sample passes its checksum', () => {
  for (const x of 'abcd') {
    const msgs = splitSysex(sample(x));
    for (const m of msgs.slice(1)) {
      eq(m.length, BLOCK_LEN);
      codec.decodeBlock(m);
    }
  }
});

test('re-encoding each sample gives the same bytes', () => {
  for (const x of 'abcd') {
    const raw = sample(x);
    const dump = codec.decodeDump(splitSysex(raw));
    same(joinMessages(codec.encodeDump(dump.stream, dump.id)), raw, `sample ${x}`);
  }
});

test('a corrupted block is rejected', () => {
  const msgs = splitSysex(sample('c'));
  const bad = msgs[3].slice();
  bad[40] ^= 0x01;
  throws(() => codec.decodeBlock(bad), /checksum/);
  bad[40] = 0x10;
  throws(() => codec.decodeBlock(bad), /nibble/);
});

test('missing or reordered blocks are rejected', () => {
  const msgs = splitSysex(sample('c'));
  throws(() => codec.decodeDump(msgs.slice(0, 6)), /incomplete: 5 of 12/);
  const swapped = [msgs[0], msgs[2], msgs[1], ...msgs.slice(3)];
  throws(() => codec.decodeDump(swapped), /out of order/);
  throws(() => codec.decodeDump(msgs.slice(1)), /header/);
});

test('block index wraps at 128 and the count uses two 7-bit bytes', () => {
  const stream = new Uint8Array(130 * 64);
  stream[0] = 0xdd;
  const msgs = codec.encodeDump(stream, 5);
  eq([...msgs[0]], [0xf0, 0x00, 0x20, 0x1f, 5, 0x10, 1, 2, 0xf7]);
  eq(msgs[129][6], 128 & 0x7f);
  same(codec.decodeDump(msgs).stream, stream);
});

console.log('bank');

test('sample A: User 1 is "Mono Reverb", decay 2.4 s', () => {
  const b = bankOf('a');
  eq(b.usedCount, 1);
  eq(b.preset(0).name, 'Mono Reverb');
  eq(b.preset(0).number, 225);
  eq(decay.format(b.preset(0).get(decay)), '2.4 s');
});

test('samples B and C: renamed, then decay 2.5 s', () => {
  eq(bankOf('b').preset(0).name, 'TEST ABC');
  eq(decay.format(bankOf('b').preset(0).get(decay)), '2.4 s');
  eq(decay.format(bankOf('c').preset(0).get(decay)), '2.5 s');
});

test('sample D: Users 1, 2 and 5 are stored, 3 and 4 are empty', () => {
  const b = bankOf('d');
  eq([...Array(SLOTS).keys()].filter((i) => b.used(i)), [0, 1, 4]);
  eq([0, 1, 4].map((i) => b.preset(i).name), ['Mono Reverb', 'Tremendous Delay', 'Rhythmic']);
  eq([0, 1, 4].map((i) => b.preset(i).number), [225, 226, 229]);
  eq(b.lastSlot(), 5);
});

test('unedited banks rebuild byte-identical', () => {
  for (const x of 'abcd') {
    const stream = codec.decodeDump(splitSysex(sample(x))).stream;
    same(new Bank(stream).stream(), stream, `sample ${x}`);
  }
});

test('renaming changes only the name bytes', () => {
  const a = bankOf('a');
  const p = a.preset(0);
  p.name = 'TEST ABC';
  a.store(0, p);
  same(a.stream(), bankOf('b').stream());
});

test('changing decay reproduces sample C from sample B', () => {
  const b = bankOf('b');
  const p = b.preset(0);
  p.set(decay, p.get(decay) + 1);
  b.store(0, p);
  same(b.stream(), bankOf('c').stream());
});

test('storing into User 2 renumbers the copy and grows the dump', () => {
  const b = bankOf('a');
  b.store(1, b.preset(0));
  eq(b.preset(1).number, 226);
  eq(b.used(1), true);
  const s = b.stream();
  eq(s.length, Math.ceil((HEADER_SIZE + 2 * RECORD_SIZE) / 64) * 64);
  eq(s.length % 64, 0);
});

test('clearing the last stored slot shrinks the dump', () => {
  const b = bankOf('d');
  b.clear(4);
  eq(b.lastSlot(), 2);
  eq(b.stream().length, Math.ceil((HEADER_SIZE + 2 * RECORD_SIZE) / 64) * 64);
  b.clear(1);
  b.clear(0);
  eq(b.stream().length, 128);
});

test('names are cut to 20 printable characters', () => {
  const p = new Preset();
  p.name = 'A very long preset name indeed';
  eq(p.name, 'A very long preset n');
  p.name = 'Tab\there';
  eq(p.name, 'Tabhere');
  eq(p.data.subarray(2, 2 + NAME_LEN).length, NAME_LEN);
});

test('parameter values are clamped and raw bytes stay in the parameter area', () => {
  const p = new Preset();
  p.set(decay, 999);
  eq(p.get(decay), decay.max);
  throws(() => p.setByte(5, 1), /outside the parameter area/);
  p.setByte(100, 300);
  eq(p.byte(100), 255);
});

test('a stream without the magic is rejected', () => {
  throws(() => new Bank(new Uint8Array(128)), /magic/);
});

console.log('recall');

test('Bank size 100 gives the manual table: USER = bank 3, card 1 = bank 4', () => {
  eq(bankProgram(userIndex(0), 100), { bank: 3, program: 0 });
  eq(bankProgram(userIndex(99), 100), { bank: 3, program: 99 });
  eq(bankProgram(cardIndex(1, 0), 100), { bank: 4, program: 0 });
  eq(bankProgram(cardIndex(6, 98), 100), { bank: 9, program: 98 });
});

test('any Bank size: bank × size + program gives the table position', () => {
  for (const size of [1, 7, 64, 100, 127, 128]) {
    for (const idx of [romIndex(0), romIndex(224), userIndex(0), userIndex(99), cardIndex(1, 0), cardIndex(6, 98)]) {
      const r = recallBankProgram(idx, size);
      if (!r) continue;
      eq(r.bank * size + r.program, idx, `size ${size} position ${idx}`);
      if (r.program >= size || r.bank > 127) throw new Error(`out of range at size ${size}`);
    }
  }
  eq(recallBankProgram(userIndex(0), 128), { bank: 2, program: 44 });
  eq(recallBankProgram(userIndex(0), 100), { bank: 3, program: 0 });
});

test('small Bank sizes cannot reach the high banks', () => {
  eq(recallBankProgram(userIndex(0), 1), null);
  eq(recallBankProgram(userIndex(0), 3), { bank: 100, program: 0 });
  eq(recallBankProgram(cardIndex(6, 98), 7), null);
});

test('ROM names: 225 from the manual, ROM 5 is Mono Doubler', () => {
  eq(ROM_NAMES.length, 225);
  eq(ROM_NAMES[4], 'Mono Doubler');
  eq(ROM_NAMES[224], 'Empty Routing');
});

const romDump = (f: string) => new Bank(codec.decodeDump(splitSysex(new Uint8Array(readFileSync(new URL(`../docs/samples/${f}`, import.meta.url))))).stream);
const romBank = romDump('gforce-rom-001-100.syx');
const romBank2 = romDump('gforce-rom-101-200.syx');
const romBank3 = romDump('gforce-rom-201-225.syx');
/** The record of ROM n (1–225), from the three ROM dumps. */
const romPreset = (n: number) => (n <= 100 ? romBank.preset(n - 1) : n <= 200 ? romBank2.preset(n - 101) : romBank3.preset(n - 201));

test('ROM names 1–225 match the unit (ROM copied to the User bank)', () => {
  for (let i = 0; i < 100; i++) {
    eq(romBank.used(i), true);
    eq(romBank2.used(i), true);
    eq(romBank3.used(i), i < 25);
  }
  for (let n = 1; n <= 225; n++) eq(romPreset(n).name.trimEnd(), ROM_NAMES[n - 1], `ROM ${n}`);
  eq(ROM_NAMES[195], 'Delay Tap Tempo'); // "Straight Delay" in the manual
  eq(ROM_NAMES.slice(222, 224), ['Slow Noise Gate', 'Fast Noise Gate']); // both "Noise Gate Slow" in the manual
});

/** Routing of ROM n as columns of row codes ('-' empty), e.g. '4 | 11/7/8'. */
const routing = (n: number) => {
  const p = romBank.preset(n - 1);
  const cols: string[] = [];
  for (let c = 0; c < ROUTING_COLS; c++) {
    const rows = Array.from({ length: ROUTING_ROWS }, (_, r) => p.cell(c, r));
    const last = rows.map((v) => v !== 0).lastIndexOf(true);
    if (last >= 0) cols.push(rows.slice(0, last + 1).map((v) => (v ? String(v) : '-')).join('/'));
  }
  return cols.join(' | ');
};
const sub = (n: number, block: string) => romBank.preset(n - 1).subAlgo(ROUTED.find((b) => b.block === block)!);

test('routing grid of ROM presets matches the unit (photos of ROM 1–7, 9)', () => {
  const names = (n: number) => routing(n).replace(/\d+/g, (d) => routedBlock(+d)?.short ?? d);
  eq(names(7), 'PIT | CPR | FIL | REV');
  eq(names(6), 'PAN | REV');
  eq(routing(1), '4 | 11'); // Mono Reverb: Compressor → Reverb
  eq(routing(4), '4 | 11/7/8'); // Mono Harmony: Compressor → Reverb ∥ Pitch ∥ Delay
  eq(routing(6), '6 | 11'); // photo: PAN → REV
  eq(routing(7), '7 | 4 | 5 | 11'); // photo: PIT → CPR → FIL → REV
  eq(routing(9), '4 | 9 | 11'); // photo: CPR → DRV → REV
  eq(routing(11), '4 | 7/1 | 1 | 11/10'); // Mono Pedal Pitch: a pipeline beside the Pitch
  eq(routing(31), '11/10/8/7'); // 3-Way: all in parallel
  eq(routing(38), '-/4 | -/5'); // Go Direct: "EQ & Compression"
});

test('sub-algorithms of ROM presets: names seen on the unit, guesses marked', () => {
  eq(sub(1, 'reverb'), 'ADVANCED'); // photo: REVERB - ADVANCED
  eq(sub(7, 'filters'), 'WAH-WAH'); // photo: FILTER - WAH-WAH
  eq(sub(3, 'delay'), 'ONE-TAP'); // photo: DELAY - ONE-TAP
  eq(sub(5, 'pitch'), 'DETUNE?'); // Mono Doubler
  eq(sub(4, 'pitch'), 'INTELLIGENT?'); // Mono Harmony
  eq(sub(15, 'pantrem'), 'SURROUND PANNER?'); // pans beyond a normal stereo image
  eq(sub(8, 'filters'), 'PHASER?');
  eq(sub(38, 'filters'), 'PARAMETRIC EQ?');
  eq(sub(44, 'chorus'), 'ADVANCED FLANGER?'); // Power Chord, "some flanging"
  eq(sub(9, 'drive'), ''); // no sub-algorithms
});

test('ROM_BLOCKS matches the ROM dumps; ROM 7 as on the unit\'s Recall page', () => {
  eq(ROM_BLOCKS.length, 225);
  for (let n = 1; n <= 225; n++) eq(ROM_BLOCKS[n - 1], romPreset(n).blockMask(), `ROM ${n}`);
  // Photo of Recall, preset 7 Mono Touchwah: SELECT shows CPR FIL / PIT / REV.
  eq(ROUTED.filter((_, k) => ROM_BLOCKS[6] & (1 << k)).map((r) => r.short).join(' '), 'CPR FIL PIT REV');
});

test('modifier links: 20 × 10 bytes at 0x76, pedal presets have an Ext 1 link', () => {
  // Presets with "X" (pedal) in the manual's preset list, ROM 1–100.
  const pedal = [10, 11, 24, 25, 36, 37, 40, 48, 69, 72, 73, 75, 76, 77, 79, 80, 83, 84, 89,
    106, 109, 111, 113, 116, 117, 119, 122, 123, 133, 135, 141, 144, 148, 150, 151, 154, 155, 157, 160,
    173, 174, 175, 176, 177, 179, 205, 206, 207, 208, 212, 213, 217, 218];
  const links = (n: number) => Array.from({ length: 20 }, (_, k) => {
    const p = romPreset(n), at = 0x76 + 10 * k;
    return { src: p.byte(at + 5), block: p.byte(at + 6), id: (p.byte(at + 8) << 8) | p.byte(at + 9) };
  });
  // The exceptions: 84 Crunch Phasecomp (ENV and an LFO only) and 111 Wes M Jazz Lead (no targets).
  for (const n of pedal) eq(links(n).some((l) => l.src === 1 && l.id !== 0), n !== 84 && n !== 111, `ROM ${n}`);
  // A parameter ID's thousands are the block: 1000 × (grid code − 3).
  for (let n = 1; n <= 225; n++) {
    for (const l of links(n)) if (l.id) eq(Math.floor(l.id / 1000), l.block - 3, `ROM ${n}`);
  }
  // 174 Jam with Loop: "Ext. 1 controls the looping, Ext. 2 controls the adding" → sources 1 and 2.
  eq(links(174).some((l) => l.src === 2 && l.id), true);
  // 121 Verb Morphed to Dly: "Envelope controlled crossfade between Reverb and Delay" → ENV on both Mixes.
  eq(links(121).filter((l) => l.src === 10).map((l) => l.id), [5000, 8000]);
  // Mono Dyn Delay: the envelope ducks the Delay Out Level (manual p.19's example).
  eq(links(3)[0], { src: 10, block: 8, id: 5002 });
});

test('single-block ROM presets 180–200 name their sub-algorithm', () => {
  const s = (n: number, block: string) => romPreset(n).subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(s(197, 'delay'), 'DUAL?'); // Two Delays, L 500 / R 400 ms
  eq(s(200, 'delay'), 'QUAD-TAP?'); // 4 Tap Delay
  eq(s(198, 'delay'), 'ONE-TAP'); // Tape Delay
  eq(s(194, 'pantrem'), 'PANNER?'); // Stereo Pan
  eq(s(195, 'pantrem'), 'SURROUND PANNER?');
  eq(s(188, 'chorus'), 'ADVANCED FLANGER?'); // Flanger Straight
  eq(s(140, 'filters'), 'FORMANT?'); // "Stepped Formant Filter"
  eq(s(173, 'filters'), 'RESONANCE?'); // "Resonance Filter"
});

test('single-block ROM pairs: Compressor knee, Noise Gate release and bypass', () => {
  const p = romPreset;
  // 202 Soft Compressor vs 203 Hard Compressor and 204 Limiter: Knee mode Soft 0 / Hard 1.
  eq([p(202).byte(0x175), p(203).byte(0x175), p(204).byte(0x175)], [0, 1, 1]);
  // 223 Slow vs 224 Fast Noise Gate: release 15 vs 100.
  eq([p(223).byte(0x4b), p(224).byte(0x4b)], [15, 100]);
  // 0x16 is 1 in both Noise Gate presets, 3 in 225 Empty Routing.
  eq([p(223).byte(0x16), p(224).byte(0x16), p(225).byte(0x16)], [1, 1, 3]);
});

test('Compressor parameters read as on the unit (photo of ROM 203 Hard Compressor)', () => {
  const q = (id: string) => PARAMS.find((p) => p.id === id)!;
  const show = (n: number, id: string) => q(id).format(romPreset(n).get(q(id)));
  eq(romPreset(203).subAlgo(ROUTED[0]), 'ADVANCED'); // the photo shows COMPRESS - ADVANCED
  eq(show(203, 'compThreshold'), '-17 dB');
  eq(show(203, 'compRatio'), '16:1');
  eq(show(203, 'compKnee'), 'Hard');
  eq(show(203, 'compRelease'), '18 dB/s');
  eq(show(203, 'compInLevel'), '0 dB');
  eq(show(203, 'compOutLevel'), '-5 dB');
  eq(show(202, 'compKnee'), 'Soft'); // Soft Compressor
  eq(show(204, 'compRatio'), 'Inf:1?'); // Limiter: the top step, a guess
  // A signed write round-trips and stores two's complement.
  const p = romPreset(203).clone();
  p.set(q('compThreshold'), -40);
  eq(p.get(q('compThreshold')), -40);
  eq(p.byte(0x172), 0xd8);
  p.set(q('compThreshold'), 5);
  eq(p.get(q('compThreshold')), 0);
});

test('GLOBAL parameters: Mix, In/Out Level and Mute Mode after each sub-algorithm byte', () => {
  const q = (id: string) => PARAMS.find((p) => p.id === id)!;
  // One parameter per byte.
  eq(new Set(PARAMS.map((p) => p.offset)).size, PARAMS.length);
  // Photo of ROM 7 (FILTER - WAH-WAH): MIX LEVEL 35 %, IN LEVEL 0 dB.
  eq(q('filtersMix').format(romPreset(7).get(q('filtersMix'))), '35 %');
  eq(q('filtersInLevel').format(romPreset(7).get(q('filtersInLevel'))), '0 dB');
  // Photo of ROM 1 (REVERB - ADVANCED): MIX LEVEL 28 %, IN and OUT LEVEL 0 dB, MUTE MODE FX IN.
  const r1 = ['reverbMix', 'reverbInLevel', 'reverbOutLevel', 'reverbMute'].map((id) => q(id).format(romPreset(1).get(q(id))));
  eq(r1, ['28 %', '0 dB', '0 dB', 'FX In']);
  // Every block has a Mute Mode; FX In and Input (3, 4) only in Delay, Pitch and Reverb.
  for (const b of ROUTED) eq(q(`${b.block}Mute`).offset, BLOCK_AT[b.block] + 4);
  eq(['delay', 'pitch', 'reverb', 'filters', 'chorus'].map((b) => q(`${b}Mute`).max), [4, 4, 4, 2, 2]);
  // No Mix on the Compressor page; no Out Level in Pan+Trem and Chorus.
  eq([PARAMS.some((p) => p.id === 'compressMix'), PARAMS.some((p) => p.id === 'pantremOutLevel'), PARAMS.some((p) => p.id === 'chorusOutLevel')], [false, false, false]);
  // Every ROM preset's value is in range for each block it routes.
  for (let n = 1; n <= 225; n++) {
    const pr = romPreset(n);
    for (const b of ROUTED) {
      if (!(pr.blockMask() & (1 << (b.code - ROUTED[0].code)))) continue;
      for (const p of PARAMS.filter((x) => x.block === b.block)) {
        const v = pr.get(p);
        eq(v >= p.min && v <= p.max, true, `ROM ${n} ${p.id} = ${v}`);
      }
    }
  }
});

test('values seen on the unit (photos) sit in their block', () => {
  const r7 = romBank.preset(6), r3 = romBank.preset(2);
  eq(r7.byte(0x17b), 35); // FILTER - WAH-WAH: MIX LEVEL 35 %
  eq(r7.byte(0x187), 45); // FREQ 0.45
  eq(r3.byte(0x1e3) | (r3.byte(0x1e4) << 8), 310); // DELAY - ONE-TAP: TIME 310 ms
  eq(r3.byte(0x1ee), 24); // FEEDBACK 24 %
});

test('G-Card names: banks of 100, 100 and 45 from its manual', () => {
  eq(GCARD_NAMES.map((b) => b.length), [100, 100, 45]);
  eq([GCARD_NAMES[0][0], GCARD_NAMES[0][1], GCARD_NAMES[1][99], GCARD_NAMES[2][44]], ['Run Like Hell', 'Tremendous Delay', 'Simple Blues Delay', 'Panned Pitch']);
  for (const b of GCARD_NAMES) for (const n of b) if (!/^[\x20-\x7e]+$/.test(n)) throw new Error(`odd name ${n}`);
});

const card1 = romDump('gforce-g-card-1.syx');

test('G-Card bank 1 dump: names as the unit stores them, blocks for the Recall grid', () => {
  for (let i = 0; i < 100; i++) {
    eq(card1.used(i), true);
    eq(card1.preset(i).name.trimEnd(), GCARD_NAMES[0][i], `card 1-${i + 1}`);
    eq(GCARD_BLOCKS[0][i], card1.preset(i).blockMask(), `card 1-${i + 1}`);
  }
  eq(GCARD_NAMES[0][4], 'Rhythmic'); // "Rhyhmic" in the card manual
  eq(GCARD_NAMES[0][14], 'Subtle Jazz RevDelay'); // "Subtle Jazz Reverb Delay": over 20 characters
});

test('G-Card bank 1 links match the card manual\'s descriptions', () => {
  const ids = (n: number, src: number) => Array.from({ length: 20 }, (_, k) => {
    const p = card1.preset(n - 1), at = 0x76 + 10 * k;
    return p.byte(at + 5) === src ? (p.byte(at + 8) << 8) | p.byte(at + 9) : 0;
  }).filter((x) => x);
  eq(ids(43, 1), [5000]); // "Ext1 > Delay Mix"
  eq(ids(6, 1), [4000]); // "Ext 1 controls Mix level of Pitch"
  for (const n of [79, 80, 84]) eq(ids(n, 1), [5001], `card 1-${n}`); // "Ext1 > Delay In level"
  eq(ids(96, 1), [1001]); // "Ext1 > Cpr Adv. In level": 1xxx is the Compressor
  eq(ids(75, 1), [5408, 915]); // "Ext1 > In level, Dly Feedback1": 0xxx is the In section
  eq(ids(5, 11), [4158]); // "ASDR1 assigned to control Pitch": source 11 is ADSR 1
  eq(ids(7, 1), [4150, 4151]); // "Ext1 > Pitch Voice1 & Voice2"
  // Every preset marked X (pedal) in the card manual has an Ext 1 link with a target.
  const pedal = [3, 4, 6, 7, 14, 20, 23, 24, 25, 26, 28, 32, 33, 35, 39, 40, 41, 42, 43, 45, 46, 48, 49, 55, 56, 58, 59,
    60, 61, 62, 63, 64, 65, 70, 71, 75, 79, 80, 84, 96];
  for (const n of pedal) eq(ids(n, 1).length > 0, true, `card 1-${n}`);
  // Sub-algorithms named in the descriptions.
  const sub = (n: number, block: string) => card1.preset(n - 1).subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(sub(59, 'delay'), 'QUAD-TAP?'); // "Quad Tap Delay"
  eq(sub(18, 'delay'), 'DUAL?'); // "Tempo controls Dual Delay"
  eq(sub(28, 'filters'), 'WAH-WAH'); // "Distorted Wah Wah"
  eq(sub(36, 'pitch'), 'INTELLIGENT?'); // "E Dorian"
});

test('G-Card bank 1: every value in range for the blocks each preset routes', () => {
  for (let i = 0; i < 100; i++) {
    const pr = card1.preset(i);
    for (const b of ROUTED) {
      if (!(pr.blockMask() & (1 << (b.code - ROUTED[0].code)))) continue;
      for (const p of PARAMS.filter((x) => x.block === b.block)) {
        const v = pr.get(p);
        eq(v >= p.min && v <= p.max, true, `card 1-${i + 1} ${p.id} = ${v}`);
      }
    }
  }
});

console.log('clock');

const feed = (m: ClockMeter, bpm: number, ticks: number, start = 0) => {
  const dt = 60000 / bpm / 24;
  let r: number | null = null;
  for (let i = 0; i < ticks; i++) r = m.tick(start + i * dt);
  return r;
};

test('no tempo before one beat of clock', () => {
  const m = new ClockMeter();
  eq(feed(m, 120, 24), null);
  eq(Math.round(feed(m, 120, 25)! * 10) / 10, 120);
});

test('clock tempo is measured over two beats, with jitter', () => {
  for (const bpm of [20, 87.5, 120, 174, 300]) {
    const m = new ClockMeter();
    const dt = 60000 / bpm / 24;
    let r: number | null = null;
    for (let i = 0; i < 60; i++) r = m.tick(i * dt + (i % 2 ? 0.8 : -0.8));
    if (Math.abs(r! - bpm) > 0.2) throw new Error(`${bpm}: got ${r}`);
  }
});

test('a gap in the clock starts the measurement again', () => {
  const m = new ClockMeter();
  feed(m, 120, 40);
  eq(m.tick(100000), null);
  eq(feed(m, 90, 25, 100000) !== null, true);
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
