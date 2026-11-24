// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal test runner: node --experimental-strip-types tests/run.ts
// The samples in docs/samples/ are User bank dumps from a real G-Force.
import { readFileSync } from 'node:fs';
import { BLOCK_LEN, codecFromInstance, joinMessages, splitSysex } from '../src/codec.ts';
import { ROM_BLOCKS, ROM_NAMES } from '../src/rom.ts';
import { ClockMeter } from '../src/clock.ts';
import { GCARD_BLOCKS, GCARD_NAMES } from '../src/gcard.ts';
import { Bank, BLOCK_AT, BLOCKS, bankProgram, paramApplies, paramAt, paramsFor, recallBankProgram, romIndex, cardIndex, HEADER_SIZE, ROUTED, routedBlock, ROUTING_COLS, ROUTING_ROWS, userIndex, NAME_LEN, PARAMS, PARAMS_AT, Preset, RECORD_SIZE, SLOTS } from '../src/model.ts';

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
  eq(sub(5, 'pitch'), 'DUAL DETUNE'); // Mono Doubler
  eq(sub(4, 'pitch'), 'INTELLIGENT 2 VOICE'); // Mono Harmony
  eq(sub(15, 'pantrem'), 'SURROUND PAN.'); // pans beyond a normal stereo image
  eq(sub(8, 'filters'), 'PHASER');
  eq(sub(38, 'filters'), 'PARAMETRIC');
  eq(sub(44, 'chorus'), 'ADVANCED FLANGER'); // Power Chord, "some flanging"
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
  eq(s(197, 'delay'), 'DUAL'); // Two Delays, L 500 / R 400 ms
  eq(s(200, 'delay'), 'QUAD-TAP'); // 4 Tap Delay
  eq(s(198, 'delay'), 'ONE-TAP'); // Tape Delay
  eq(s(194, 'pantrem'), 'SIMPLE PANNER'); // Stereo Pan
  eq(s(195, 'pantrem'), 'SURROUND PAN.');
  eq(s(188, 'chorus'), 'ADVANCED FLANGER'); // Flanger Straight
  eq(s(140, 'filters'), 'FORMANT'); // "Stepped Formant Filter"
  eq(s(173, 'filters'), 'RESONANCE'); // "Resonance Filter"
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
  eq(show(204, 'compRatio'), 'Infinite:1'); // Limiter: the top step (card 2-1 photo)
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
  // One parameter per byte within each block and sub-algorithm (sub-algorithms share bytes).
  for (const b of BLOCKS) for (let sub = 0; sub < 8; sub++) {
    const ps = PARAMS.filter((p) => p.block === b.id && (!p.subs || p.subs.includes(sub)));
    eq(new Set(ps.map((p) => p.offset)).size, ps.length, `${b.id} sub ${sub}`);
  }
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
      for (const p of paramsFor(pr, b.block)) {
        const v = pr.get(p);
        eq(v >= p.min && v <= p.max, true, `ROM ${n} ${p.id} = ${v}`);
      }
    }
  }
});

test('edit-parameters-1: ROM 1–3 with every parameter one step off read as the photos show', () => {
  const ed = romDump('gforce-edit-parameters-1.syx');
  const show = (n: number, id: string) => {
    const q = PARAMS.find((p) => p.id === id)!;
    return q.format(ed.preset(n - 1).get(q));
  };
  const photos: [number, Record<string, string>][] = [
    [1, {
      gateMode: 'Hard', gateThreshold: '-29 dB', gateDamping: '32 dB', gateRelease: '101 dB/s', gateLevel: '-5 dB',
      compThreshold: '-5 dB', compRatio: '5.6:1', compInLevel: '-1 dB', compOutLevel: '-1 dB',
      reverbRoomType: 'Curved', reverbRoomSize: 'Large', reverbDecay: '2.5 s', reverbLevel: '1', reverbHighColor: 'Crisp',
      reverbHighFactor: '1', reverbLowColor: 'Light', reverbLowFactor: '1', reverbRoomLevel: '1', reverbColor: 'Wool',
      reverbColFactor: '1', reverbPreDelay: '25', reverbDecayLevel: '1', reverbDecayStart: '1', reverbDiffuse: '1',
      reverbMix: '29 %', reverbInLevel: '-1 dB', reverbOutLevel: '-1 dB', reverbMute: 'Input',
    }],
    [2, {
      chorusSpeed: '0.188 Hz', chorusTempo: '1', chorusDepth: '52 %', chorusDelay: '11.4 ms', chorusGolden: 'Off', chorusPhaseRev: 'On', chorusCurve: 'Triangle', chorusPhase: '90',
      chorusMix: '99 %', chorusInLevel: '-7 dB', chorusMute: 'Mix 0%',
    }],
    [3, {
      delayTime: '311 ms', delayTempo: '1', delayFeedback: '25 %', delayPan: 'R1', delayLoCut: '10.8 Hz', delayHiCut: '14.9 kHz',
      delayMix: '99 %', delayInLevel: '-1 dB', delayOutLevel: '-23 dB', delayMute: 'Output',
    }],
  ];
  for (const [n, want] of photos) for (const [id, v] of Object.entries(want)) eq(show(n, id), v, `patch ${n} ${id}`);
  // Every changed byte is accounted for: a decoded parameter, or one still to place (the
  // Chorus Speed: a step table).
  const pending: number[] = [];
  for (let n = 1; n <= 3; n++) {
    const a = romPreset(n), b = ed.preset(n - 1);
    for (let off = PARAMS_AT; off < RECORD_SIZE; off++) {
      if (a.byte(off) === b.byte(off)) continue;
      const known = PARAMS.some((p) => paramApplies(p, b) && (p.offset === off || (p.width === 2 && p.offset + 1 === off)));
      eq(known || pending.includes(off), true, `patch ${n} byte 0x${off.toString(16)}`);
    }
  }
});

test('edit-parameters-2: the Advanced Reverb with distinct values reads as the photos show', () => {
  const ed = romDump('gforce-edit-parameters-2.syx');
  const want: Record<string, string> = {
    reverbRoomType: 'Square', reverbRoomSize: 'Box', reverbDecay: '2.5 s', reverbLevel: '2', reverbHighColor: 'Crisp',
    reverbHighFactor: '3', reverbLowColor: 'NoBass', reverbLowFactor: '4', reverbRoomLevel: '5', reverbColor: 'Warm',
    reverbColFactor: '6', reverbPreDelay: '25', reverbDecayLevel: '7', reverbDecayStart: '8', reverbDiffuse: '9',
  };
  for (const [id, v] of Object.entries(want)) {
    const q = PARAMS.find((p) => p.id === id)!;
    eq(q.format(ed.preset(0).get(q)), v, id);
  }
  // The Advanced Reverb's GENERAL page is complete: 0x253–0x261 are all decoded.
  for (let off = 0x253; off <= 0x261; off++) eq(!!paramAt(off, ed.preset(0)), true, `0x${off.toString(16)}`);
});

test('ROM 11 photos: Classic Chorus, Simple Compressor, Fixed 1 Voice, Reverb names', () => {
  const p = romPreset(11);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return paramApplies(q, p) ? q.format(p.get(q)) : '(absent)'; };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq([sub('chorus'), sub('compress'), sub('pitch'), sub('reverb')], ['CLASSIC CHORUS', 'SIMPLE', 'FIXED 1 VOICE', 'ADVANCED']);
  eq([show('chorusTempo'), show('chorusDepth'), show('chorusMix')], ['Ignored', '46 %', '100 %']);
  // COMPRESS - SIMPLE shows Threshold and Ratio only: Knee Mode and Release are Advanced's.
  eq([show('compThreshold'), show('compRatio'), show('compKnee'), show('compRelease'), show('compInLevel'), show('compOutLevel')],
    ['-7 dB', '4.0:1', '(absent)', '(absent)', '0 dB', '0 dB']);
  eq(show('pitchPitch'), '-1200 cent'); // FB 50, high byte first
  eq([show('reverbRoomType'), show('reverbRoomSize'), show('reverbDecay'), show('reverbLevel'), show('reverbHighColor')],
    ['Round', 'Medium', '2.4 s', '0', 'Bright']);
});

test('ROM 75 photos: Delay filters, Reverb room settings', () => {
  const p = romPreset(75);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show), ['10.0 Hz', '14.9 kHz', '22 %', '0 dB']);
  eq(['reverbLowFactor', 'reverbRoomLevel', 'reverbColor', 'reverbColFactor', 'reverbPreDelay'].map(show), ['10', '10', 'Glass', '50', '11']);
});

test('ROM 92 photos: Advanced Compressor, Reverb colors', () => {
  const p = romPreset(92);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map(show), ['-8 dB', '3.2:1', 'Soft', '61 dB/s']);
  eq(['reverbLevel', 'reverbHighColor', 'reverbHighFactor', 'reverbLowColor', 'reverbLowFactor'].map(show), ['-3', 'Clear', '50', 'Thick', '28']);
});

test('ROM 101 photo: Simple Compressor, Ratio 1.80:1', () => {
  const p = romPreset(101);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['compThreshold', 'compRatio', 'compInLevel', 'compOutLevel'].map(show), ['-13 dB', '1.80:1', '0 dB', '0 dB']);
});

test('ROM 139 photos: Ratio 1.40:1, Reverb colors and a 0.1 s decay', () => {
  const p = romPreset(139);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['compThreshold', 'compRatio'].map(show), ['-8 dB', '1.40:1']);
  eq(['reverbDecay', 'reverbLevel', 'reverbHighColor', 'reverbHighFactor', 'reverbLowColor', 'reverbLowFactor'].map(show),
    ['0.1 s', '5', 'Warm', '13', 'Thick', '11']);
  eq(['reverbRoomLevel', 'reverbColor', 'reverbColFactor'].map(show), ['10', 'Real', '7']);
  eq(['reverbRoomType', 'reverbRoomSize'].map(show), ['Round', 'Tiny']);
});

test('ROM 141 photos: Ratio 1.60:1, Delay filters on the fitted table', () => {
  const p = romPreset(141);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map(show), ['-16 dB', '1.60:1', 'Soft', '55 dB/s']);
  eq(['delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show), ['114 Hz', '4.56 kHz', '32 %', '0 dB']);
  // Every step photographed so far, through the same table.
  const cut = PARAMS.find((x) => x.id === 'delayLoCut')!;
  eq([0, 1, 33, 83, 99].map((v) => cut.format(v)), ['10.0 Hz', '10.8 Hz', '114 Hz', '4.56 kHz', '14.9 kHz']);
});

test('ROM 146 photos: Simple Panner, Reverb Color Crisp', () => {
  const p = romPreset(146);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(p.subAlgo(ROUTED.find((b) => b.block === 'pantrem')!), 'SIMPLE PANNER');
  eq(['pantremMix', 'pantremInLevel'].map(show), ['63 %', '0 dB']);
  eq(['reverbLowFactor', 'reverbRoomLevel', 'reverbColor', 'reverbColFactor', 'reverbPreDelay'].map(show), ['0', '11', 'Crisp', '-36', '20']);
});

test('ROM 187 photo: Advanced Chorus speed 0.960 Hz; LFO speeds seen elsewhere', () => {
  const p = romPreset(187);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden'].map(show), ['0.960 Hz', 'Ignored', '6 %', '11.3 ms', 'Off']);
  const one = (n: number, id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(romPreset(n).get(q)); };
  eq([one(11, 'chorusSpeed'), one(146, 'pantremSpeed'), one(146, 'pantremTempo')], ['0.178 Hz', '0.640 Hz', 'Ignored']);
  // Other steps are the curve's estimate, marked.
  eq([0, 30, 77, 103].map((v) => PARAMS.find((x) => x.id === 'chorusSpeed')!.format(v)), ['0.050 Hz', '0.284 Hz', '4.29 Hz', '19.2 Hz']);
});

test('ROM 114 photo: Simple Compressor, Ratio 1.12:1', () => {
  const p = romPreset(114);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['compThreshold', 'compRatio', 'compInLevel', 'compOutLevel'].map(show), ['0 dB', '1.12:1', '0 dB', '0 dB']);
});

test('values seen on the unit (photos) sit in their block', () => {
  const r7 = romBank.preset(6), r3 = romBank.preset(2);
  eq(r7.byte(0x17b), 35); // FILTER - WAH-WAH: MIX LEVEL 35 %
  eq(r7.byte(0x187), 45); // FREQ 0.45
  eq((r3.byte(0x1e2) << 8) | r3.byte(0x1e3), 310); // DELAY - ONE-TAP: TIME 310 ms, high byte first
  eq(r3.byte(0x1ee), 24); // FEEDBACK 24 %
});

test('G-Card names: banks of 100, 100 and 45 from its manual', () => {
  eq(GCARD_NAMES.map((b) => b.length), [100, 100, 45]);
  eq([GCARD_NAMES[0][0], GCARD_NAMES[0][1], GCARD_NAMES[1][99], GCARD_NAMES[2][44]], ['Run Like Hell', 'Tremendous Delay', 'Simple Blues Delay', 'Panned Pitch']);
  for (const b of GCARD_NAMES) for (const n of b) if (!/^[\x20-\x7e]+$/.test(n)) throw new Error(`odd name ${n}`);
});

const cards = [romDump('gforce-g-card-1.syx'), romDump('gforce-g-card-2.syx'), romDump('gforce-g-card-3.syx')];
const card1 = cards[0];
/** The record of G-Card bank b preset n. */
const cardPreset = (b: number, n: number) => cards[b - 1].preset(n - 1);

test('G-Card dumps: names as the unit stores them, blocks for the Recall grid', () => {
  cards.forEach((bank, b) => {
    const count = GCARD_NAMES[b].length;
    for (let i = 0; i < 100; i++) eq(bank.used(i), i < count, `card ${b + 1}-${i + 1}`);
    for (let i = 0; i < count; i++) {
      eq(bank.preset(i).name.trimEnd(), GCARD_NAMES[b][i], `card ${b + 1}-${i + 1}`);
      eq(GCARD_BLOCKS[b][i], bank.preset(i).blockMask(), `card ${b + 1}-${i + 1}`);
    }
  });
  eq(GCARD_NAMES[0][4], 'Rhythmic'); // "Rhyhmic" in the card manual
  eq(GCARD_NAMES[0][14], 'Subtle Jazz RevDelay'); // "Subtle Jazz Reverb Delay": over 20 characters
  eq(GCARD_NAMES[1][33], 'Corinnes Shimmer'); // "Corrines Shimmer" in the card manual
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
  eq(sub(59, 'delay'), 'QUAD-TAP'); // "Quad Tap Delay"
  eq(sub(18, 'delay'), 'DUAL'); // "Tempo controls Dual Delay"
  eq(sub(28, 'filters'), 'WAH-WAH'); // "Distorted Wah Wah"
  eq(sub(36, 'pitch'), 'INTELLIGENT 2 VOICE'); // "E Dorian"
});

test('G-Card banks 2 and 3: links named in the card manual\'s descriptions', () => {
  const ids = (b: number, n: number, src: number) => Array.from({ length: 20 }, (_, k) => {
    const p = cardPreset(b, n), at = 0x76 + 10 * k;
    return p.byte(at + 5) === src ? (p.byte(at + 8) << 8) | p.byte(at + 9) : 0;
  }).filter((x) => x);
  const ENV = 10, EXT1 = 1, LFO1 = 13;
  for (const n of [6, 10]) eq(ids(3, n, ENV), [2300], `card 3-${n}`); // "Env > Wah Wah Filter Freq"
  eq(ids(3, 11, EXT1), [2500]); // "Pedal > Filter Phaser Speed"
  eq(ids(3, 13, EXT1), [2000]); // "Pedal > Fil Phaser Mix"
  eq(ids(2, 18, EXT1), [2203]); // "Ext 1 > Fil Res hi cut freq"
  eq(ids(3, 18, ENV), [5002]); // "Env > Stereo Delay Out Level"
  eq(ids(3, 12, LFO1).includes(5416), true); // "LFO1 > Delay 1 Pan"
  eq(ids(3, 16, LFO1), [2414]); // "LFO1 assigned to Formant Sweep"
  eq(ids(2, 10, EXT1), [5001, 4154]); // "Ext 1 > Pit 2Voice Lvl 1, Dly One in Level"
  eq(ids(3, 32, EXT1), [4000]); // "Ext 1 > Pit 2Voice Mix Level"
  eq(ids(2, 82, EXT1), [8001]); // "Ext 1 > Rev Adv In Level"
  // Presets marked X with an Ext 1 link; the exceptions are 2-98, 2-99, 3-8 and 3-10.
  const pedal: [number, number[]][] = [
    [2, [8, 9, 10, 11, 12, 13, 15, 16, 18, 24, 35, 40, 50, 51, 52, 53, 57, 64, 66, 67, 82, 85, 89, 90, 93]],
    [3, [11]],
  ];
  for (const [b, ns] of pedal) for (const n of ns) eq(ids(b, n, EXT1).length > 0, true, `card ${b}-${n}`);
  for (const [b, n] of [[2, 98], [2, 99], [3, 8], [3, 10]]) eq(ids(b, n, EXT1).length, 0, `card ${b}-${n}`);
});

test('card 1-43 photos: every block of Tele Something Good', () => {
  const p = cardPreset(1, 43);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(['filters', 'pantrem', 'pitch', 'delay', 'chorus', 'compress', 'reverb'].map(sub),
    ['PARAMETRIC', 'SIMPLE TREMOLO', 'DUAL DETUNE', 'DUAL', 'ADVANCED CHORUS', 'SIMPLE', 'ADVANCED']);
  eq(['compThreshold', 'compRatio', 'compInLevel', 'compOutLevel'].map(show), ['-13 dB', '8.0:1', '0 dB', '-4 dB']);
  eq(['pantremSpeed', 'pantremTempo', 'pantremDepth', 'pantremMix'].map(show), ['4.80 Hz', '1/8', '70 %', '100 %']);
  eq(['pitchDetuneDelay1', 'pitchDetuneDelay2'].map(show), ['0 ms', '6 ms']);
  eq(['delayDualTime1', 'delayDualTime2', 'delayDualTempo1', 'delayDualTempo2'].map(show), ['0 ms', '0 ms', '1/16', '1/8']);
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden', 'chorusPhaseRev', 'chorusCurve', 'chorusPhase', 'chorusMix'].map(show),
    ['0.112 Hz', 'Ignored', '75 %', '11.2 ms', 'On', 'On', 'Sine', '0', '50 %']);
  eq(['reverbRoomType', 'reverbRoomSize', 'reverbDecay', 'reverbLevel', 'reverbHighColor', 'reverbHighFactor', 'reverbLowColor', 'reverbLowFactor'].map(show),
    ['Curved', 'Small', '1.5 s', '0', 'Real', '0', 'Real', '0']);
});

test('cards 1-59 and 1-73 photos: Ratio OFF and 64:1', () => {
  const show = (b: number, n: number, id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(cardPreset(b, n).get(q)); };
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map((id) => show(1, 59, id)), ['-2 dB', 'Off', 'Soft', '40 dB/s']);
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map((id) => show(1, 73, id)), ['-12 dB', '64:1', 'Hard', '23 dB/s']);
});

test('card 1-75 photos: Chorus tempo 1/4, Reverb Grand, Wool, Tight', () => {
  const p = cardPreset(1, 75);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden'].map(show), ['1.79 Hz', '1/4', '100 %', '11.3 ms', 'On']);
  eq(['reverbRoomSize', 'reverbDecay', 'reverbLevel', 'reverbHighColor', 'reverbHighFactor', 'reverbLowColor'].map(show),
    ['Grand', '10.0 s', '7', 'Wool', '41', 'Tight']);
});

test('card 1-76 photos: Phaser, Adv. Tremolo, Fixed 2 Voice, Stereo delay, Chorus LFO, Low Color Round', () => {
  const p = cardPreset(1, 76);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(['filters', 'pantrem', 'pitch', 'delay', 'chorus', 'compress', 'reverb'].map(sub),
    ['PHASER', 'ADV. TREMOLO', 'FIXED 2 VOICE', 'STEREO', 'ADVANCED CHORUS', 'SIMPLE', 'ADVANCED']);
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden', 'chorusPhaseRev', 'chorusCurve', 'chorusPhase', 'chorusMix'].map(show),
    ['0.188 Hz', 'Ignored', '100 %', '11.3 ms', 'On', 'On', 'Sine', '180', '45 %']);
  eq(['compThreshold', 'compRatio', 'compInLevel', 'compOutLevel'].map(show), ['-15 dB', '2.0:1', '0 dB', '0 dB']);
  eq(['delayStereoTime', 'delayStereoTempo', 'delayStereoFeedback', 'delayStereoLoCut', 'delayStereoHiCut'].map(show),
    ['400 ms', 'Ignored', '29 %', '10.0 Hz', '16.0 kHz']);
  eq(['phaserSpeed', 'phaserTempo', 'phaserDepth', 'phaserOrder'].map(show), ['8.06 Hz', '1', '100 %', '4th']);
  eq(['pantremSpeed', 'pantremTempo', 'pantremDepth', 'pantremCurve'].map(show), ['5.12 Hz', 'Ignored', '100 %', 'Square']);
  eq(['pitchFixed2Voice1', 'pitchFixed2Voice2', 'pitchFixed2Delay1', 'pitchFixed2Delay2'].map(show), ['1200 cent', '-1200 cent', '400 ms', '400 ms']);
  eq(['reverbLowColor', 'reverbLowFactor', 'reverbRoomLevel', 'reverbColor'].map(show), ['Round', '-30', '20', 'Auto']);
});

test('card 1-83 photos: Formant, Quad-tap, Simple Reverb, 16-bit Chorus Delay', () => {
  const p = cardPreset(1, 83);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(['filters', 'delay', 'chorus', 'compress', 'reverb'].map(sub), ['FORMANT', 'QUAD-TAP', 'ADVANCED CHORUS', 'SIMPLE', 'SIMPLE']);
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden'].map(show), ['0.050 Hz', '1/2', '17 %', '45.0 ms', 'On']);
  eq(['compThreshold', 'compRatio', 'compInLevel', 'compOutLevel'].map(show), ['-30 dB', '1.25:1', '0 dB', '0 dB']);
  eq([1, 2, 3, 4].map((n) => show(`delayQuadTap${n}`)), ['505 ms', '375 ms', '325 ms', '225 ms']);
  eq(['formantStart', 'formantThru', 'formantEnd', 'formantResonance', 'formantAgeSex'].map(show), ['But', 'Hit', 'Foot', '100 %', '65 %']);
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show),
    ['Spring', '18.6 s', '-50', '12', 'Wool']);
  eq(paramsFor(p, 'reverb').slice(0, 5).map((q) => q.id), ['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor']);
});

test('card 1-89 photos: Adv. Flanger, Surround Panner, Advanced Compressor and Reverb', () => {
  const p = cardPreset(1, 89);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(['pantrem', 'delay', 'chorus', 'compress', 'reverb'].map(sub), ['SURROUND PAN.', 'ONE-TAP', 'ADVANCED FLANGER', 'ADVANCED', 'ADVANCED']);
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'flangerFeedback', 'flangerCrossFeed'].map(show), ['0.089 Hz', '1/2', '40 %', '-23 %', '13 %']);
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map(show), ['-15 dB', '2.5:1', 'Hard', '37 dB/s']);
  eq(['delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show), ['10.0 Hz', '16.0 kHz', '100 %', '0 dB']);
  eq(['pantremSpeed', 'pantremTempo', 'pantremSurroundCurve', 'pantremSurroundPulse'].map(show), ['0.848 Hz', '1', 'Sine', '50 %']);
  eq(['reverbRoomLevel', 'reverbColor', 'reverbColFactor', 'reverbPreDelay', 'reverbDecayLevel'].map(show), ['12', 'Bright', '35', '50', '4']);
  eq(['reverbDecay', 'reverbLevel', 'reverbHighColor', 'reverbHighFactor', 'reverbLowColor', 'reverbLowFactor'].map(show),
    ['2.2 s', '8', 'Glass', '27', 'Thin', '19']);
});

test('card 2-1 photos: Resonance filter, Intelligent pitch, Infinite ratio', () => {
  const p = cardPreset(2, 1);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  const sub = (block: string) => p.subAlgo(ROUTED.find((b) => b.block === block)!);
  eq(['filters', 'pitch', 'delay', 'compress'].map(sub), ['RESONANCE', 'INTELLIGENT 2 VOICE', 'ONE-TAP', 'SIMPLE']);
  eq(['compThreshold', 'compRatio'].map(show), ['-10 dB', 'Infinite:1']);
  eq(['delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show), ['10.0 Hz', '3.16 kHz', '18 %', '0 dB']);
  eq(['resonanceType', 'resonanceLoFreq', 'resonanceHiFreq', 'resonanceLoReson'].map(show), ['2nd Order', '20.0 Hz', '15.0 kHz', '100 %']);
  eq(['pitchIntKey', 'pitchIntScale', 'pitchIntMode', 'pitchIntVoice1'].map(show), ['C', 'Ionian Maj.', 'Stepping', '8']);
  const q = cardPreset(1, 36); // "E Dorian"
  eq(['pitchIntKey', 'pitchIntScale'].map((id) => { const d = PARAMS.find((x) => x.id === id)!; return d.format(q.get(d)); }), ['E?', 'Dorian?']);
});

test('card 2-12 photo: One-tap cut filters 298 Hz and 3.66 kHz, In Level under a modifier', () => {
  const p = cardPreset(2, 12);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show), ['298 Hz', '3.66 kHz', '58 %', '-15 dB']);
});

test('card 2-40 photos: One-tap Tempo 1/4, Locut 106 Hz, Mix under a modifier', () => {
  const p = cardPreset(2, 40);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayTime', 'delayTempo', 'delayFeedback', 'delayPan', 'delayLoCut', 'delayHiCut', 'delayMix', 'delayInLevel'].map(show),
    ['805 ms', '1/4', '42 %', '0', '106 Hz', '3.66 kHz', '16 %', '0 dB']);
});

test('■ marks linked parameters: cards 2-12 (In Level), 2-40 (Mix), 2-1 (Resonance frequencies)', () => {
  const linked = (b: number, n: number) => PARAMS.filter((q) => paramApplies(q, cardPreset(b, n)) && cardPreset(b, n).linked(q)).map((q) => q.id);
  eq(linked(2, 12).filter((id) => id.startsWith('delay')), ['delayInLevel']);
  eq(linked(2, 40), ['delayMix']);
  eq(linked(2, 1).filter((id) => id.startsWith('resonance')), ['resonanceLoFreq', 'resonanceHiFreq']);
  eq(ROUTED.filter((r) => r.block !== 'drive').every((r) => PARAMS.find((q) => q.id === `${r.block}Mute`) && (r.block === 'compress' || PARAMS.find((q) => q.id === `${r.block}Mix`)!.link === 1000 * (r.code - 3))), true);
});

test('card 2-44 photo: Locut 16.0 kHz, Hicut 464 Hz, Pan R9, nothing linked', () => {
  const p = cardPreset(2, 44);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayPan', 'delayLoCut', 'delayHiCut', 'delayMix'].map(show), ['R9', '16.0 kHz', '464 Hz', '2 %']);
  eq(p.linkTargets().size, 0);
});

test('card 2-45 photos: Ratio 32:1, Delay Dual Two-tap line 1', () => {
  const p = cardPreset(2, 45);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(p.subAlgo(ROUTED.find((b) => b.block === 'delay')!), 'DUAL TWO-TAP');
  eq(['compThreshold', 'compRatio', 'compKnee', 'compRelease'].map(show), ['-30 dB', '32:1', 'Hard', '10 dB/s']);
  eq(['delay2TapTime1', 'delay2TapTime2', 'delay2TapTempo1', 'delay2TapTempo2', 'delay2TapFeedback1'].map(show), ['600 ms', '600 ms', '1/4', '1/4', '25 %']);
});

test('card 2-62 photo: Locut 85.0 Hz (step 29), cut filters 10 Hz × 1600^(n/100)', () => {
  const p = cardPreset(2, 62);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayPan', 'delayLoCut', 'delayHiCut', 'delayMix'].map(show), ['0', '85.0 Hz', '16.0 kHz', '14 %']);
  const cut = PARAMS.find((x) => x.id === 'delayLoCut')!;
  const seen: [number, string][] = [[0, '10.0 Hz'], [1, '10.8 Hz'], [29, '85.0 Hz'], [32, '106 Hz'], [33, '114 Hz'], [46, '298 Hz'], [52, '464 Hz'],
    [78, '3.16 kHz'], [80, '3.66 kHz'], [83, '4.56 kHz'], [99, '14.9 kHz'], [100, '16.0 kHz']];
  eq(seen.map(([n]) => cut.format(n)), seen.map(([, s]) => s));
});

test('card 2-89 photos: Classic Flanger, linked Delay Pan, Reverb XL and Clear', () => {
  const p = cardPreset(2, 89);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(p.subAlgo(ROUTED.find((b) => b.block === 'chorus')!), 'CLASSIC FLANGER');
  eq(['chorusSpeed', 'chorusTempo', 'chorusDepth', 'flangerFeedback'].map(show), ['0.168 Hz', 'Ignored', '40 %', '36 %']);
  eq(['delayPan', 'delayLoCut', 'delayHiCut', 'delayMix'].map(show), ['0', '178 Hz', '6.13 kHz', '100 %']);
  eq(p.linked(PARAMS.find((x) => x.id === 'delayPan')!), true);
  eq(['reverbRoomType', 'reverbRoomSize', 'reverbDecay', 'reverbLevel', 'reverbHighColor'].map(show), ['Curved', 'XL', '6.1 s', '0', 'Real']);
  eq(['reverbRoomLevel', 'reverbColor', 'reverbColFactor', 'reverbPreDelay', 'reverbDecayLevel'].map(show), ['8', 'Clear', '50', '0', '3']);
});

test('cards 3-36 and 3-41 photos: Chorus speeds 5.12 and 0.336 Hz', () => {
  const show = (n: number, id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(cardPreset(3, n).get(q)); };
  const ids = ['chorusSpeed', 'chorusTempo', 'chorusDepth', 'chorusDelay', 'chorusGolden'];
  eq(ids.map((id) => show(36, id)), ['5.12 Hz', 'Ignored', '100 %', '0.1 ms', 'Off']);
  eq(ids.map((id) => show(41, id)), ['0.336 Hz', 'Ignored', '12 %', '0.1 ms', 'On']);
});

test('ROM 8 photo: Phaser Order 8TH, Speed 0.504 Hz', () => {
  const p = romPreset(8);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['phaserSpeed', 'phaserTempo', 'phaserDepth', 'phaserOrder'].map(show), ['0.504 Hz', 'Ignored', '90 %', '8th']);
});

test('ROM 66 photo: Phaser Order 12TH, Speed and Depth under modifiers (2500, 2502)', () => {
  const p = romPreset(66);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['phaserSpeed', 'phaserTempo', 'phaserDepth', 'phaserOrder'].map(show), ['0.424 Hz', 'Ignored', '100 %', '12th']);
  eq(['phaserSpeed', 'phaserTempo', 'phaserDepth', 'phaserOrder'].map((id) => p.linked(PARAMS.find((x) => x.id === id)!)), [true, false, true, false]);
});

test('ROM 196 photo: Stereo Delay Tempo 1/4 at 0x1E4', () => {
  const p = romPreset(196);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayStereoTime', 'delayStereoTempo', 'delayStereoFeedback', 'delayStereoLoCut', 'delayStereoHiCut'].map(show), ['500 ms', '1/4', '35 %', '10.0 Hz', '16.0 kHz']);
});

test('card 2-22 photo: Stereo Delay Tempo 1/32 = 9', () => {
  const p = cardPreset(2, 22);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayStereoTime', 'delayStereoTempo', 'delayStereoFeedback', 'delayStereoLoCut', 'delayStereoHiCut'].map(show), ['316 ms', '1/32', '50 %', '10.0 Hz', '16.0 kHz']);
});

test('card 2-24 photo: Stereo Delay Tempo 1/8. (dotted) = 4, cut filters 63.2 Hz and 4.24 kHz', () => {
  const p = cardPreset(2, 24);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['delayStereoTime', 'delayStereoTempo', 'delayStereoFeedback', 'delayStereoLoCut', 'delayStereoHiCut'].map(show), ['322 ms', '1/8.', '69 %', '63.2 Hz', '4.24 kHz']);
});

test('card 1-78 photos: vowels HEAT, HAD, ALL; Simple Reverb CLUB, REAL', () => {
  const p = cardPreset(1, 78);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['formantStart', 'formantThru', 'formantEnd', 'formantResonance', 'formantAgeSex'].map(show), ['Heat', 'Had', 'All', '0 %', '49 %']);
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Club', '18.9 s', '100', '8', 'Real']);
});

test('ROM 157 photos: vowels FATHER, BOOT, BIRD; Dual Two-tap lines in byte order', () => {
  const p = romPreset(157);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['formantStart', 'formantThru', 'formantEnd', 'formantResonance', 'formantAgeSex'].map(show), ['Father', 'Boot', 'Bird', '0 %', '70 %']);
  eq(['delay2TapTime1', 'delay2TapTime2', 'delay2TapTempo1', 'delay2TapTempo2', 'delay2TapFeedback1'].map(show), ['200 ms', '300 ms', 'Ignored', 'Ignored', '0 %']);
  eq(['delay2TapL2Time1', 'delay2TapL2Time2', 'delay2TapL2Tempo1', 'delay2TapL2Tempo2', 'delay2TapL2Feedback1'].map(show), ['500 ms', '600 ms', 'Ignored', 'Ignored', '18 %']);
});

test('ROM 176 photo: vowel HEAD = 2, all ten vowels named', () => {
  const p = romPreset(176);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['formantStart', 'formantThru', 'formantEnd', 'formantResonance', 'formantAgeSex'].map(show), ['Head', 'Hit', 'Father', '1 %', '0 %']);
  const start = PARAMS.find((x) => x.id === 'formantStart')!;
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => start.format(v)), ['Heat', 'Hit', 'Head', 'Had', 'But', 'Father', 'All', 'Boot', 'Foot', 'Bird']);
});

test('ROM 180 photo: Simple Reverb ROOM, BRIGHT', () => {
  const p = romPreset(180);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Room', '1.2 s', '0', '-4', 'Bright']);
});

test('ROM 181 photo: Simple Reverb CHURCH, CLEAR', () => {
  const p = romPreset(181);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Church', '2.0 s', '0', '-4', 'Clear']);
});

test('ROM 182 photo: Simple Reverb GRAND HALL', () => {
  const p = romPreset(182);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Grand Hall', '3.0 s', '0', '-3', 'Clear']);
});

test('ROM 183 photo: Simple Reverb CATHEDRAL', () => {
  const p = romPreset(183);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Cathedral', '6.0 s', '0', '-3', 'Real']);
});

test('ROM 185 photo: Simple Reverb SLOW DECAY, GLASS', () => {
  const p = romPreset(185);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Slow Decay', '2.6 s', '0', '-4', 'Glass']);
});

test('card 1-40 photo: Simple Reverb FAST DECAY', () => {
  const p = cardPreset(1, 40);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Fast Decay', '2.5 s', '0', '0', 'Real']);
});

test('card 1-44 photo: Simple Reverb PLATE, WARM', () => {
  const p = cardPreset(1, 44);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Plate', '1.0 s', '-23', '8', 'Warm']);
});

test('card 1-46 photo: Simple Reverb HALL, all ten types named', () => {
  const p = cardPreset(1, 46);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Hall', '2.5 s', '0', '0', 'Real']);
  const type = PARAMS.find((x) => x.id === 'reverbSimpleType')!;
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => type.format(v)).some((n) => n.endsWith('?')), false);
});

test('card 1-97 photos: Resonance bytes (Lo Reson 0x188, Hicut 0x189) and sweeps, Simple Reverb EXTREME', () => {
  const p = cardPreset(1, 97);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['resonanceType', 'resonanceLoFreq', 'resonanceHiFreq', 'resonanceLoReson'].map(show), ['2nd Order', '88.8 Hz', '5.20 kHz', '45 %']);
  eq(p.linkTargets().size, 0);
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Plate', '2.4 s', '-50', '11', 'Extreme']);
});

test('Formant links: Age/Sex 2413 marked on ROMs 157 and 176, Resonance 2415 unmarked', () => {
  const ids = (p: Preset) => ['formantResonance', 'formantAgeSex'].map((id) => p.linked(PARAMS.find((x) => x.id === id)!));
  eq(ids(romPreset(157)), [false, true]);
  eq(ids(romPreset(176)), [false, true]);
});

test('card 2-2 photos: Resonance 4TH ORDER, 182 Hz, 3.77 kHz as predicted; Simple Reverb CRISP', () => {
  const p = cardPreset(2, 2);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['resonanceType', 'resonanceLoFreq', 'resonanceHiFreq', 'resonanceLoReson'].map(show), ['4th Order', '182 Hz', '3.77 kHz', '50 %']);
  eq(['reverbSimpleType', 'reverbSimpleDecay', 'reverbSimplePreDelay', 'reverbSimpleLevel', 'reverbSimpleColor'].map(show), ['Plate', '2.2 s', '0', '-7', 'Crisp']);
});

test('edit-parameters-3: ROM 2 Chorus SPEED 103 = 19.2 Hz (the top), TEMPO 11 = 1/2.', () => {
  const a = romDump('gforce-edit-parameters-2.syx').preset(1), b = romDump('gforce-edit-parameters-3.syx').preset(1);
  const diff: number[] = [];
  for (let o = PARAMS_AT; o < RECORD_SIZE; o++) if (a.byte(o) !== b.byte(o)) diff.push(o);
  eq(diff, [0x23a, 0x23b]);
  const speed = PARAMS.find((x) => x.id === 'chorusSpeed')!;
  eq(speed.format(b.get(speed)), '19.2 Hz');
  const tempo = PARAMS.find((x) => x.id === 'chorusTempo')!;
  eq(tempo.format(b.get(tempo)), '1/2.'); // photo: 1/2. with 0.66 Hz under the bar
});

test('edit-parameters-4: one Chorus per remaining tempo, so every Tempo byte is named', () => {
  const bank = romDump('gforce-edit-parameters-4.syx');
  const tempo = PARAMS.find((x) => x.id === 'chorusTempo')!;
  eq([0, 1, 2, 3, 4, 5, 6, 7].map((n) => tempo.format(bank.preset(n).get(tempo))), ['1/2T', '1/4.', '1/4T', '1/16.', '1/8T', '1/16T', '1/32.', '1/32T']);
  eq(Array.from({ length: 17 }, (_, v) => tempo.format(v)).some((n) => n.includes('?')), false);
  const speed = PARAMS.find((x) => x.id === 'chorusSpeed')!;
  eq([bank.preset(8).byte(0x23a), speed.format(bank.preset(8).get(speed))], [255, 'Off']); // User 9: SPEED OFF
});

test('ROM 173 photo: Resonance 492 Hz, ■9.04 kHz, 31 %, 70 % as predicted', () => {
  const p = romPreset(173);
  const show = (id: string) => { const q = PARAMS.find((x) => x.id === id)!; return q.format(p.get(q)); };
  eq(['resonanceLoFreq', 'resonanceHiFreq', 'resonanceLoReson', 'resonanceHiReson', 'filtersMix'].map(show), ['492 Hz', '9.04 kHz', '31 %', '70 %', '50 %']);
  eq(['resonanceLoFreq', 'resonanceHiFreq'].map((id) => p.linked(PARAMS.find((x) => x.id === id)!)), [false, true]);
});

test('G-Card: every value in range for the blocks each preset routes, block thousands hold', () => {
  for (let b = 1; b <= 3; b++) {
    for (let n = 1; n <= GCARD_NAMES[b - 1].length; n++) {
      const pr = cardPreset(b, n);
      for (let k = 0; k < 20; k++) {
        const at = 0x76 + 10 * k, id = (pr.byte(at + 8) << 8) | pr.byte(at + 9), blk = pr.byte(at + 6);
        if (id && blk) eq(Math.floor(id / 1000), blk - 3, `card ${b}-${n}`);
      }
      for (const r of ROUTED) {
        if (!(pr.blockMask() & (1 << (r.code - ROUTED[0].code)))) continue;
        for (const p of paramsFor(pr, r.block)) {
          const v = pr.get(p);
          eq(v >= p.min && v <= p.max, true, `card ${b}-${n} ${p.id} = ${v}`);
        }
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
