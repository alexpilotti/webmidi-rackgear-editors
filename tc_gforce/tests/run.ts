// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal test runner: node --experimental-strip-types tests/run.ts
// The samples in docs/samples/ are User bank dumps from a real G-Force.
import { readFileSync } from 'node:fs';
import { BLOCK_LEN, codecFromInstance, joinMessages, splitSysex } from '../src/codec.ts';
import { ROM_NAMES } from '../src/rom.ts';
import { ClockMeter } from '../src/clock.ts';
import { GCARD_NAMES } from '../src/gcard.ts';
import { Bank, bankProgram, recallBankProgram, romIndex, cardIndex, HEADER_SIZE, userIndex, NAME_LEN, PARAMS, Preset, RECORD_SIZE, SLOTS } from '../src/model.ts';

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

test('ROM names 1–50 match the unit (ROM 1–50 copied to User 1–50)', () => {
  const dump = new Uint8Array(readFileSync(new URL('../docs/samples/gforce-rom-50.syx', import.meta.url)));
  const bank = new Bank(codec.decodeDump(splitSysex(dump)).stream);
  for (let i = 0; i < 50; i++) {
    eq(bank.used(i), true);
    eq(bank.preset(i).name.trimEnd(), ROM_NAMES[i]);
  }
  eq(bank.used(50), false);
});

test('G-Card names: banks of 100, 100 and 45 from its manual', () => {
  eq(GCARD_NAMES.map((b) => b.length), [100, 100, 45]);
  eq([GCARD_NAMES[0][0], GCARD_NAMES[0][1], GCARD_NAMES[1][99], GCARD_NAMES[2][44]], ['Run Like Hell', 'Tremendous Delay', 'Simple Blues Delay', 'Panned Pitch']);
  for (const b of GCARD_NAMES) for (const n of b) if (!/^[\x20-\x7e]+$/.test(n)) throw new Error(`odd name ${n}`);
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
