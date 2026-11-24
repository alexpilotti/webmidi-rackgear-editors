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
/** Modifier links: 20 × 10 bytes from 0x76 (see SYSEX_FORMAT.md). */
export const LINKS_AT = 0x76;
export const LINK_COUNT = 20;

export interface ParamDef {
  id: string;
  /** Front-panel block key it belongs to. */
  block: BlockId;
  label: string;
  /** Byte offset inside the 614-byte record. */
  offset: number;
  min: number;
  max: number;
  /** The byte is two's complement (FF = −1). */
  signed?: boolean;
  /** 2 = a 16-bit value, high byte first, at offset, offset + 1 (signed when `signed`). */
  width?: 1 | 2;
  /** Sub-algorithm values the parameter exists in; the same bytes mean something else in the others. */
  subs?: number[];
  /** Modifier link target ID (1000 × (block code − 3) + n) that moves this parameter; the LCD marks it with ■. */
  link?: number;
  /** Section heading on the unit's Edit page (GENERAL when omitted; '' = none). */
  section?: string;
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

const dB = (v: number) => `${v} dB`;
const onOff = (v: number) => (v ? 'On' : 'Off');

/**
 * Block-specific decoded parameters (the unit's GENERAL section), checked against dumps or photos.
 * samples/gforce-edit-parameters-1.syx holds ROM 1–3 with every parameter moved one step (photos of each
 * page): each changed byte is one parameter.
 */
const BLOCK_PARAMS: ParamDef[] = [
  // In section, Noise Gate (the unit's Input page): every byte moved in edit-parameters-1's ROM 1.
  { id: 'gateMode', section: '', block: 'gate', label: 'Mode', offset: 0x48, min: 0, max: 1, format: (v) => (v ? 'Hard' : 'Soft'), source: 'edit-parameters-1: MODE HARD = 1 (was 0)' },
  { id: 'gateThreshold', section: '', block: 'gate', label: 'Threshold', offset: 0x49, min: -60, max: 0, signed: true, format: dB, source: 'edit-parameters-1: THRESHOLD -29 dB; ROM presets use -60 … -14' },
  { id: 'gateDamping', section: '', block: 'gate', label: 'Max Damping', offset: 0x4a, min: 0, max: 90, format: dB, source: 'edit-parameters-1: MAX DAMPING 32 dB; ROM presets use 0 … 50' },
  { id: 'gateRelease', section: '', block: 'gate', label: 'Release Rate', offset: 0x4b, min: 0, max: 200, format: (v) => `${v} dB/s`, source: 'edit-parameters-1: REL.RATE 101 dB/s; ROM presets use 3 … 100' },
  { id: 'gateLevel', block: 'gate', label: 'Level', offset: 0x4d, min: -40, max: 0, signed: true, format: dB, source: 'edit-parameters-1: LEVEL -5 dB; ROM presets use -9 … 0' },
  // Compressor, Advanced: photos of ROM 203 Hard Compressor's Edit page (THRESHOLD −17 dB,
  // RATIO 16:1, KNEE MODE HARD, RELEASE 18 dB/s, IN LEVEL 0 dB, OUT LEVEL −5 dB) against its record; 202 Soft Compressor
  // has knee 0. Ranges are not in the manual: these cover every ROM preset.
  {
    id: 'compThreshold',
    block: 'compress',
    label: 'Threshold',
    offset: 0x172,
    min: -40,
    max: 0,
    signed: true,
    format: (v) => `${v} dB`,
    source: 'ROM 203 photo: THRESHOLD -17 dB = EF; ROM presets use -30 … 0',
  },
  {
    id: 'compRatio',
    block: 'compress',
    label: 'Ratio',
    offset: 0x173,
    min: 0,
    max: 15,
    format: (v) => (RATIOS_SEEN.includes(v) ? COMP_RATIOS[v] : `${COMP_RATIOS[v] ?? v}?`),
    source: 'ROM 203 photo: 16:1 = step 12; edit-parameters-1: 5.6:1 = step 10; ROM 11 photo: 4.0:1 = step 9; ROM 92 photo: 3.2:1 = step 8; ROM 101 photo: 1.80:1 = step 5; ROM 114 photo: 1.12:1 = step 1; ROM 139 photo: 1.40:1 = step 3; ROM 141 photo: 1.60:1 = step 4; card 1-59: OFF = step 0; card 1-73: 64:1 = step 14; other steps guessed from the TC series, 15 (∞) in 204 Limiter',
  },
  {
    id: 'compKnee',
    block: 'compress',
    label: 'Knee Mode',
    offset: 0x175,
    subs: [1],
    min: 0,
    max: 1,
    format: (v) => (v ? 'Hard' : 'Soft'),
    source: 'ROM 203 photo: KNEE MODE HARD = 1; 202 Soft Compressor = 0',
  },
  {
    id: 'compRelease',
    block: 'compress',
    label: 'Release',
    offset: 0x174,
    subs: [1],
    min: 0,
    max: 100,
    format: (v) => `${v} dB/s`,
    source: 'ROM 203 photo: RELEASE 18 dB/s = 18; ROM presets use 0 … 100',
  },
  {
    id: 'compInLevel',
    section: 'GLOBAL',
    block: 'compress',
    label: 'In Level',
    offset: 0x168,
    min: -40,
    max: 0,
    signed: true,
    format: (v) => `${v} dB`,
    source: 'ROM 203 photo: IN LEVEL 0 dB = 00; ROM presets use -8 … 0',
  },
  {
    id: 'compOutLevel',
    section: 'GLOBAL',
    block: 'compress',
    label: 'Out Level',
    offset: 0x169,
    min: -40,
    max: 0,
    signed: true,
    format: (v) => `${v} dB`,
    source: 'ROM 203 photo: OUT LEVEL -5 dB = FB; ROM presets use -10 … 0',
  },
  // Delay One-tap (sub-algorithm 4): edit-parameters-1's ROM 3. The bytes repeat every 4 for the Quad-tap's taps.
  { id: 'delayTime', section: 'DELAY', block: 'delay', label: 'Time', offset: 0x1e2, width: 2, min: 0, max: 1480, subs: [4], format: (v) => `${v} ms`, source: 'ROM 3 photo: 310 ms = 01 36 (high byte first); edit-parameters-1: 311 ms; One-tap presets use 0 … 1480, the manual\'s range' },
  { id: 'delayTempo', section: 'DELAY', block: 'delay', label: 'Tempo', offset: 0x1ea, min: 0, max: 16, subs: [4], format: tempoName, source: 'ROM 3 photo: IGNORED = 0; edit-parameters-1: 1 = "1"; card 2-40: 1/4 = 3 (506 ms under the bar, from the tapped tempo)' },
  { id: 'delayFeedback', section: 'DELAY', block: 'delay', label: 'Feedback', offset: 0x1ee, min: 0, max: 100, subs: [4], format: (v) => `${v} %`, source: 'ROM 3 photo: 24 %; edit-parameters-1: 25 %' },
  { id: 'delayPan', section: 'DELAY', block: 'delay', label: 'Pan', offset: 0x1f6, min: -50, max: 50, signed: true, subs: [4], link: 5416, format: (v) => (v > 0 ? `R${v}` : v < 0 ? `L${-v}` : '0'), source: 'ROM 3 photo: 0; edit-parameters-1: R1 = 1; card 2-89: ■0, linked as 5416 (LFO 1)' },
  { id: 'delayLoCut', section: 'FILTERS', block: 'delay', label: 'Locut', offset: 0x1fa, min: 0, max: 100, subs: [4], format: cutFreq, source: 'ROM 75 photo: 10.0 Hz = step 0; edit-parameters-1: 10.8 Hz = step 1; ROM 141 photo: 114 Hz = step 33; card 2-62: 85.0 Hz = 29; card 2-40: 106 Hz = 32; card 2-12: 298 Hz = 46; card 2-44: 16.0 kHz = 100' },
  { id: 'delayHiCut', section: 'FILTERS', block: 'delay', label: 'Hicut', offset: 0x1fe, min: 0, max: 100, subs: [4], format: cutFreq, source: 'edit-parameters-1 and ROM 75 photos: 14.9 kHz = step 99; ROM 141 photo: 4.56 kHz = step 83; card 2-1: 3.16 kHz = 78; card 2-12: 3.66 kHz = 80; card 2-44: 464 Hz = 52' },
  // Delay, Stereo (sub-algorithm 0): card 1-76 photo, TIME 400 ms = 01 90, FEEDBACK 29 %, LOCUT 10.0 Hz = step 0,
  // HICUT 16.0 kHz = step 100, all on one DELAY page. TEMPO is 0x1E4: ROM 196 Delay Tap Tempo shows 1/4 = 3 there.
  { id: 'delayStereoTime', section: 'DELAY', block: 'delay', label: 'Time', offset: 0x1e2, width: 2, min: 0, max: 1480, subs: [0], format: (v) => `${v} ms`, source: 'card 1-76 photo: 400 ms = 01 90' },
  { id: 'delayStereoTempo', section: 'DELAY', block: 'delay', label: 'Tempo', offset: 0x1e4, min: 0, max: 16, subs: [0], format: tempoName, source: 'card 1-76 photo: IGNORED = 0; ROM 196 photo: 1/4 = 3' },
  { id: 'delayStereoFeedback', section: 'DELAY', block: 'delay', label: 'Feedback', offset: 0x1e7, min: 0, max: 100, subs: [0], format: (v) => `${v} %`, source: 'card 1-76 photo: 29 %' },
  { id: 'delayStereoLoCut', section: 'DELAY', block: 'delay', label: 'Locut', offset: 0x1e8, min: 0, max: 100, subs: [0], format: cutFreq, source: 'card 1-76 photo: 10.0 Hz = step 0' },
  { id: 'delayStereoHiCut', section: 'DELAY', block: 'delay', label: 'Hicut', offset: 0x1e9, min: 0, max: 100, subs: [0], format: cutFreq, source: 'card 1-76 photo: 16.0 kHz = step 100' },
  // Delay, Quad-tap (sub-algorithm 3): card 1-83 photo, TIME TAP 1–4 505/375/325/225 ms at 0x1E2–0x1E8
  // (16-bit). The TEMPO section follows: one byte per tap at 0x1EA–0x1ED, where the One-tap keeps its Tempo.
  ...[1, 2, 3, 4].map((n): ParamDef => ({ id: `delayQuadTap${n}`, section: 'TIME', block: 'delay', label: `Tap ${n}`, offset: 0x1e0 + 2 * n, width: 2, min: 0, max: 1480, subs: [3], format: (v) => `${v} ms`, source: 'card 1-83 photo: 505, 375, 325, 225 ms' })),
  ...[1, 2, 3, 4].map((n): ParamDef => ({ id: `delayQuadTempo${n}`, section: 'TEMPO', block: 'delay', label: `Tap ${n}`, offset: 0x1e9 + n, min: 0, max: 16, subs: [3], format: tempoName, source: 'the One-tap Tempo byte, then one per tap; presets use 0 … 9 (card 1-83\'s page shows the TEMPO heading only)' })),
  // Delay, Dual Two-tap (sub-algorithm 2): card 2-45 photo, DELAY LINE 1: TIME 1/2 600 ms, TEMPO 1/2 1/4,
  // FEEDBACK 1 25 %. ROM 157 fixes the order, line by line: times 0x1E4/0x1E6 (line 1) and 0x1E8/0x1EA (line 2) hold
  // 200/300 and 500/600 ms; FEEDBACK 1 is 0x1F0 (line 1, 0 %) and 0x1F2 (line 2, 18 %). Tempos follow: 0x1EC–0x1EF.
  { id: 'delay2TapTime1', section: 'DELAY LINE 1', block: 'delay', label: 'Time 1', offset: 0x1e4, width: 2, min: 0, max: 1480, subs: [2], format: (v) => `${v} ms`, source: 'card 2-45 photo: 600 ms = 02 58; ROM 157: 200 ms' },
  { id: 'delay2TapTime2', section: 'DELAY LINE 1', block: 'delay', label: 'Time 2', offset: 0x1e6, width: 2, min: 0, max: 1480, subs: [2], format: (v) => `${v} ms`, source: 'card 2-45 photo: 600 ms; ROM 157: 300 ms' },
  { id: 'delay2TapTempo1', section: 'DELAY LINE 1', block: 'delay', label: 'Tempo 1', offset: 0x1ec, min: 0, max: 16, subs: [2], format: tempoName, source: 'card 2-45 photo: 1/4 = 3; ROM 157: IGNORED' },
  { id: 'delay2TapTempo2', section: 'DELAY LINE 1', block: 'delay', label: 'Tempo 2', offset: 0x1ed, min: 0, max: 16, subs: [2], format: tempoName, source: 'card 2-45 photo: 1/4 = 3; ROM 157: IGNORED' },
  { id: 'delay2TapFeedback1', section: 'DELAY LINE 1', block: 'delay', label: 'Feedback 1', offset: 0x1f0, min: 0, max: 100, subs: [2], format: (v) => `${v} %`, source: 'card 2-45 photo: 25 %; ROM 157: 0 %' },
  { id: 'delay2TapL2Time1', section: 'DELAY LINE 2', block: 'delay', label: 'Time 1', offset: 0x1e8, width: 2, min: 0, max: 1480, subs: [2], format: (v) => `${v} ms`, source: 'ROM 157 photo: 500 ms = 01 F4' },
  { id: 'delay2TapL2Time2', section: 'DELAY LINE 2', block: 'delay', label: 'Time 2', offset: 0x1ea, width: 2, min: 0, max: 1480, subs: [2], format: (v) => `${v} ms`, source: 'ROM 157 photo: 600 ms = 02 58' },
  { id: 'delay2TapL2Tempo1', section: 'DELAY LINE 2', block: 'delay', label: 'Tempo 1', offset: 0x1ee, min: 0, max: 16, subs: [2], format: tempoName, source: 'ROM 157 photo: IGNORED; line 1 uses 0x1EC/0x1ED' },
  { id: 'delay2TapL2Tempo2', section: 'DELAY LINE 2', block: 'delay', label: 'Tempo 2', offset: 0x1ef, min: 0, max: 16, subs: [2], format: tempoName, source: 'ROM 157 photo: IGNORED' },
  { id: 'delay2TapL2Feedback1', section: 'DELAY LINE 2', block: 'delay', label: 'Feedback 1', offset: 0x1f2, min: 0, max: 100, subs: [2], format: (v) => `${v} %`, source: 'ROM 157 photo: 18 % (line 1 is 0 at 0x1F0)' },
  // Delay, Dual (sub-algorithm 1): card 1-43 photo, TIME LINE 1/2 0 ms, TEMPO LINE 1 1/16, LINE 2 1/8.
  // Times come first, then tempos, as in the One-tap (whose tap 1 is at the same places).
  { id: 'delayDualTime1', section: 'TIME', block: 'delay', label: 'Line 1', offset: 0x1e2, width: 2, min: 0, max: 740, subs: [1], format: (v) => `${v} ms`, source: 'card 1-43 photo: 0 ms; the One-tap TIME bytes' },
  { id: 'delayDualTime2', section: 'TIME', block: 'delay', label: 'Line 2', offset: 0x1e4, width: 2, min: 0, max: 740, subs: [1], format: (v) => `${v} ms`, source: 'card 1-43 photo: 0 ms; ROM 3\'s second tap time' },
  { id: 'delayDualTempo1', section: 'TEMPO', block: 'delay', label: 'Line 1', offset: 0x1e6, min: 0, max: 16, subs: [1], format: tempoName, source: 'card 1-43 photo: 1/16 = 7' },
  { id: 'delayDualTempo2', section: 'TEMPO', block: 'delay', label: 'Line 2', offset: 0x1e7, min: 0, max: 16, subs: [1], format: tempoName, source: 'card 1-43 photo: 1/8 = 5' },
  // Pitch, Dual Detune (sub-algorithm 3): card 1-43 photo, DELAY VOICE1 0 ms, VOICE2 6 ms = 00 06 at
  // 0x1CC (16-bit, high byte first: the high bytes 0x1CA/0x1CC are 1 in a few presets).
  { id: 'pitchDetuneDelay1', section: 'DELAY', block: 'pitch', label: 'Voice1', offset: 0x1ca, width: 2, min: 0, max: 500, subs: [3], format: (v) => `${v} ms`, source: 'card 1-43 photo: 0 ms; the pair before Voice2' },
  { id: 'pitchDetuneDelay2', section: 'DELAY', block: 'pitch', label: 'Voice2', offset: 0x1cc, width: 2, min: 0, max: 500, subs: [3], format: (v) => `${v} ms`, source: 'card 1-43 photo: 6 ms = 00 06' },
  // Pitch, Fixed 2 Voice (sub-algorithm 2): card 1-76 photo, PITCH VOICE1 1200 / VOICE2 -1200 CENT (04 B0, FB 50),
  // DELAY VOICE1/VOICE2 400 ms (01 90): the Fixed 1 Voice pitch and the Dual Detune delays, plus a second voice.
  { id: 'pitchFixed2Voice1', section: 'PITCH', block: 'pitch', label: 'Voice1', offset: 0x1c6, width: 2, signed: true, min: -1200, max: 1200, subs: [2], format: (v) => `${v} cent`, source: 'card 1-76 photo: 1200 CENT = 04 B0' },
  { id: 'pitchFixed2Voice2', section: 'PITCH', block: 'pitch', label: 'Voice2', offset: 0x1c8, width: 2, signed: true, min: -1200, max: 1200, subs: [2], format: (v) => `${v} cent`, source: 'card 1-76 photo: -1200 CENT = FB 50' },
  { id: 'pitchFixed2Delay1', section: 'DELAY', block: 'pitch', label: 'Voice1', offset: 0x1ca, width: 2, min: 0, max: 400, subs: [2], format: (v) => `${v} ms`, source: 'card 1-76 photo: 400 ms = 01 90' },
  { id: 'pitchFixed2Delay2', section: 'DELAY', block: 'pitch', label: 'Voice2', offset: 0x1cc, width: 2, min: 0, max: 400, subs: [2], format: (v) => `${v} ms`, source: 'card 1-76 photo: 400 ms = 01 90' },
  // Filter, Phaser (sub-algorithm 4): card 1-76 photo, SPEED 8.06 Hz = 88 (the LFO speed table), TEMPO 1,
  // DEPTH 100 %, ORDER 4TH = 0. The 0.49 Hz under the bar is the speed the tempo gives, not stored.
  { id: 'phaserSpeed', section: 'GENERAL', block: 'filters', label: 'Speed', offset: 0x186, min: -1, max: 103, signed: true, subs: [4], link: 2500, format: lfoSpeed, source: 'card 1-76 photo: 8.06 Hz = 88; ROM 66: ■0.424 Hz, linked as 2500' },
  { id: 'phaserTempo', section: 'GENERAL', block: 'filters', label: 'Tempo', offset: 0x187, min: 0, max: 16, subs: [4], format: tempoName, source: 'card 1-76 photo: 1 = "1"' },
  { id: 'phaserDepth', section: 'GENERAL', block: 'filters', label: 'Depth', offset: 0x188, min: 0, max: 100, subs: [4], link: 2502, format: (v) => `${v} %`, source: 'card 1-76 photo: 100 %; ROM 66: ■100 %, linked as 2502' },
  { id: 'phaserOrder', section: 'PHASER', block: 'filters', label: 'Order', offset: 0x189, min: 0, max: 2, subs: [4], format: (v) => named(['4th', '8th', '12th'], [0, 1, 2], v), source: 'card 1-76 photo: 4TH = 0; ROM 8: 8TH = 1; ROM 66: 12TH = 2' },
  // Filter, Formant (sub-algorithm 3): card 1-83 photo, VOWEL SWEEP START BUT = 4, THRU HIT = 1, END FOOT = 8,
  // RESONANCE 100 % (0x18A), AGE/SEX 65 % (0x189). The ten vowels (0 … 9) come from photos of cards 1-83, 1-78 and
  // ROMs 157, 176. Link IDs: Sweep 2414 (cards 2-97 and 3-40, "Env > Formant Sweep", link only it), so Age/Sex is
  // 2413 (ROMs 157 and 176 link 2413 + 2414 and mark AGE/SEX with ■) and Resonance 2415 (card 3-1 links all three).
  { id: 'formantStart', section: 'VOWEL SWEEP', block: 'filters', label: 'Start', offset: 0x186, min: 0, max: 9, subs: [3], format: vowel, source: 'card 1-83 photo: BUT = 4' },
  { id: 'formantThru', section: 'VOWEL SWEEP', block: 'filters', label: 'Thru', offset: 0x187, min: 0, max: 9, subs: [3], format: vowel, source: 'card 1-83 photo: HIT = 1' },
  { id: 'formantEnd', section: 'VOWEL SWEEP', block: 'filters', label: 'End', offset: 0x188, min: 0, max: 9, subs: [3], format: vowel, source: 'card 1-83 photo: FOOT = 8' },
  { id: 'formantResonance', section: 'VOWEL SWEEP', block: 'filters', label: 'Resonance', offset: 0x18a, min: 0, max: 100, subs: [3], link: 2415, format: (v) => `${v} %`, source: 'card 1-83 photo: 100 %' },
  { id: 'formantAgeSex', section: 'VOWEL SWEEP', block: 'filters', label: 'Age/Sex', offset: 0x189, min: 0, max: 100, subs: [3], link: 2413, format: (v) => `${v} %`, source: 'card 1-83 photo: 65 %' },
  // Filter, Resonance (sub-algorithm 1): TYPE 0x186 (2ND ORDER = 0), LOCUT FR. 0x187, LO RESON. 0x188, HICUT FR.
  // 0x189, HI RESON. 0x18A: card 1-97 (no links) shows 88.8 Hz, 45 %, 5.20 kHz for 27, 45, 77; card 2-1 (100 in both
  // 0x188 and 0x189) couldn't tell Lo Reson from Hicut. The link IDs follow the bytes: 2201 = Locut, 2203 = Hicut
  // (card 2-1 links both and marks both with ■), as the Phaser's 2500/2502 = 0x186/0x188.
  { id: 'resonanceType', section: 'GENERAL', block: 'filters', label: 'Type', offset: 0x186, min: 0, max: 1, subs: [1], format: (v) => named(['2nd Order', '4th Order'], [0, 1], v), source: 'cards 2-1 and 1-97 photos: 2ND ORDER = 0; card 2-2: 4TH ORDER = 1; 0/1 in every Resonance preset' },
  { id: 'resonanceLoFreq', section: 'FILTER', block: 'filters', label: 'Locut Fr.', offset: 0x187, min: 0, max: 100, subs: [1], link: 2201, format: resLoFreq, source: 'card 1-97 photo: 88.8 Hz = 27; card 2-2: 182 Hz = 40; card 2-1: 20.0 Hz = 0 (■, link 2201)' },
  { id: 'resonanceHiFreq', section: 'FILTER', block: 'filters', label: 'Hicut Fr.', offset: 0x189, min: 0, max: 100, subs: [1], link: 2203, format: resHiFreq, source: 'card 1-97 photo: 5.20 kHz = 77; card 2-2: 3.77 kHz = 70; card 2-1: 15.0 kHz = 100 (■, link 2203)' },
  { id: 'resonanceLoReson', section: 'FILTER', block: 'filters', label: 'Lo Reson.', offset: 0x188, min: 0, max: 100, subs: [1], format: (v) => `${v} %`, source: 'card 1-97 photo: 45 %; card 2-2: 50 %; card 2-1: 100 %' },
  { id: 'resonanceHiReson', section: 'FILTER', block: 'filters', label: 'Hi Reson.', offset: 0x18a, min: 0, max: 100, subs: [1], format: (v) => `${v} %`, source: 'ROM 173 photo: 70 %' },
  // Pitch, Intelligent 2 Voice (sub-algorithm 0): card 2-1 photo, KEY C, SCALE IONIAN MAJ., MODE STEPPING, VOICE1 8.
  // The first three are 0, so their bytes come from the value ranges in the 33 Intelligent presets: 0x1BE 0 … 9
  // (keys), 0x1BF 0 … 5 (scales), 0x1C0 0/1 (modes). VOICE1 8 = 7 at 0x1C3: the scale step shown as an interval.
  { id: 'pitchIntKey', section: 'GENERAL', block: 'pitch', label: 'Key', offset: 0x1be, min: 0, max: 11, subs: [0], format: (v) => named(KEYS, [0], v), source: 'card 2-1 photo: C = 0; card 1-36 ("E Dorian" in the card manual) has 4 = E, ROM 17 Stereo Harmony C-maj 0' },
  { id: 'pitchIntScale', section: 'GENERAL', block: 'pitch', label: 'Scale', offset: 0x1bf, min: 0, max: 15, subs: [0], format: (v) => named(SCALES, [0], v), source: 'card 2-1 photo: IONIAN MAJ. = 0; card 1-36 ("E Dorian") has 1; the rest assume the usual mode order' },
  { id: 'pitchIntMode', section: 'GENERAL', block: 'pitch', label: 'Mode', offset: 0x1c0, min: 0, max: 1, subs: [0], format: (v) => named(['Stepping', 'Smooth'], [0], v), source: 'card 2-1 photo: STEPPING = 0; 0/1 in the presets' },
  { id: 'pitchIntVoice1', section: 'PITCH', block: 'pitch', label: 'Voice1', offset: 0x1c3, min: -14, max: 14, signed: true, subs: [0], format: intervalName, source: 'card 2-1 photo: 8 = 7; presets use -7 … 11' },
  { id: 'pitchIntVoice2', section: 'PITCH', block: 'pitch', label: 'Voice2', offset: 0x1c4, min: -14, max: 14, signed: true, subs: [0], format: intervalName, source: 'the byte after Voice1; card 2-1 has -7 there' },
  // Pan+Trem, Simple Tremolo (0) and Simple Panner (2): ROM 146 and card 1-43 photos.
  { id: 'pantremSpeed', block: 'pantrem', label: 'Speed', offset: 0x1a8, min: -1, max: 103, signed: true, subs: [0, 1, 2, 3], format: lfoSpeed, source: 'ROM 146 photo (Simple Panner): 0.640 Hz = 44; card 1-43 (Simple Tremolo): 4.80 Hz = 79; card 1-76 (Adv. Tremolo): 5.12 Hz = 80; card 1-89 (Surround): 0.848 Hz = 49' },
  { id: 'pantremTempo', block: 'pantrem', label: 'Tempo', offset: 0x1a9, min: 0, max: 16, subs: [0, 1, 2, 3], format: tempoName, source: 'ROM 146 photo: IGNORED = 0; card 1-43: 1/8 = 5; card 1-76 (Adv. Tremolo): IGNORED = 0; card 1-89 (Surround): 1 = \"1\"' },
  { id: 'pantremDepth', block: 'pantrem', label: 'Depth', offset: 0x1aa, min: 0, max: 100, subs: [0, 1], format: (v) => `${v} %`, source: 'card 1-43 photo (Simple Tremolo): 70 %; card 1-76 (Adv. Tremolo): 100 %' },
  { id: 'pantremCurve', section: 'LFO', block: 'pantrem', label: 'Curve', offset: 0x1ab, min: 0, max: 2, subs: [1], format: (v) => named(LFO_CURVES, [0, 1, 2], v), source: 'card 1-76 photo (Adv. Tremolo): SQUARE = 0; the same table as the Surround Panner (SINE = 2) and the Chorus (TRIANGLE = 1)' },
  { id: 'pantremPulse', section: 'LFO', block: 'pantrem', label: 'Pulse Width', offset: 0x1ac, min: 0, max: 100, subs: [1], format: (v) => `${v} %`, source: 'the byte after Curve, as in the Surround Panner; card 1-76 has 50 (not on its photo)' },
  // Pan+Trem, Surround Panner (3): card 1-89 photo, title SURROUND PAN., no Depth: CURVE SINE = 2 at 0x1AA,
  // PULSE WIDTH 50 % at 0x1AB, one byte earlier than in the Advanced Tremolo.
  { id: 'pantremSurroundCurve', section: 'LFO', block: 'pantrem', label: 'Curve', offset: 0x1aa, min: 0, max: 2, subs: [3], format: (v) => named(LFO_CURVES, [0, 1, 2], v), source: 'card 1-89 photo: SINE = 2' },
  { id: 'pantremSurroundPulse', section: 'LFO', block: 'pantrem', label: 'Pulse Width', offset: 0x1ab, min: 0, max: 100, subs: [3], format: (v) => `${v} %`, source: 'card 1-89 photo: 50 %' },
  // Pitch, Fixed 1 Voice (sub-algorithm 1): ROM 11 photo, VOICE SETTINGS PITCH -1200 CENT = FB 50
  // (16-bit, high byte first). Fixed 1 Voice presets use -1200 … 1200, the manual's ±12 semitones.
  { id: 'pitchPitch', section: 'VOICE SETTINGS', block: 'pitch', label: 'Pitch', offset: 0x1c6, width: 2, signed: true, min: -1200, max: 1200, subs: [1], format: (v) => `${v} cent`, source: 'ROM 11 photo: PITCH -1200 CENT = FB 50' },
  // Chorus, Advanced Chorus (sub-algorithm 1): edit-parameters-1's ROM 2. In the Flangers 0x23D is Feedback (signed).
  { id: 'chorusSpeed', block: 'chorus', label: 'Speed', offset: 0x23a, min: -1, max: 103, signed: true, subs: [0, 1, 2, 3], format: lfoSpeed, source: 'Photos: 22 = 0.178 Hz (ROM 11), 23 = 0.188 Hz (edit-parameters-1), 51 = 0.960 Hz (ROM 187); other steps estimated; card 1-89 (Adv. Flanger); card 2-89 (Classic Flanger)' },
  { id: 'chorusTempo', block: 'chorus', label: 'Tempo', offset: 0x23b, min: 0, max: 16, subs: [0, 1, 2, 3], format: tempoName, source: 'ROM 11 photo (Classic Chorus): IGNORED = 0; edit-parameters-1 (Advanced): 1 = "1"; card 1-89 (Adv. Flanger); card 2-89 (Classic Flanger)' },
  { id: 'chorusDepth', block: 'chorus', label: 'Depth', offset: 0x23c, min: 0, max: 100, subs: [0, 1, 2, 3], format: (v) => `${v} %`, source: 'edit-parameters-1: DEPTH 52 % (was 51), Advanced Chorus; ROM 11 photo: 46 %, Classic Chorus; card 1-89 (Adv. Flanger); card 2-89 (Classic Flanger)' },
  { id: 'chorusDelay', block: 'chorus', label: 'Delay', offset: 0x242, width: 2, min: 0, max: 500, subs: [1], format: (v) => `${(v / 10).toFixed(1)} ms`, source: 'edit-parameters-1: DELAY 11.4 ms = 114 (was 113); card 1-83 photo: 45.0 ms = 01 C2 (16-bit, high byte first); presets use 1 … 450' },
  { id: 'chorusGolden', block: 'chorus', label: 'Golden Ratio', offset: 0x240, min: 0, max: 1, subs: [1], format: onOff, source: 'edit-parameters-1: GOLDEN RATIO OFF = 0 (was 1)' },
  { id: 'chorusPhaseRev', block: 'chorus', label: 'Phase Reverse', offset: 0x23d, min: 0, max: 1, subs: [1], format: onOff, source: 'edit-parameters-1: PHASE REVERSE ON = 1 (was 0); 0 or 1 in every Advanced Chorus preset' },
  // Chorus, Advanced Flanger (3): card 1-89 photo, SPEED 0.089 Hz = 10, TEMPO 1/2, DEPTH 40 %, FEEDBACK -23 % (0x23D,
  // signed), CROSS FEED 13 % (0x23E).
  { id: 'flangerFeedback', block: 'chorus', label: 'Feedback', offset: 0x23d, min: -100, max: 100, signed: true, subs: [2, 3], format: (v) => `${v} %`, source: 'card 1-89 photo: -23 % = E9; card 2-89 (Classic Flanger): 36 %' },
  { id: 'flangerCrossFeed', block: 'chorus', label: 'Cross Feed', offset: 0x23e, min: -100, max: 100, signed: true, subs: [3], format: (v) => `${v} %`, source: 'card 1-89 photo: 13 %' },
  { id: 'chorusCurve', section: 'LFO', block: 'chorus', label: 'Curve', offset: 0x23e, min: 1, max: 2, subs: [1], format: (v) => named(LFO_CURVES, [1, 2], v), source: 'card 1-43 and 1-76 photos: SINE = 2; edit-parameters-1: TRIANGLE = 1 (was 2). On the unit the Chorus offers only TRIANGLE and SINE (no Square), so the byte is 1 or 2, as in every preset' },
  { id: 'chorusPhase', section: 'LFO', block: 'chorus', label: 'Phase', offset: 0x23f, min: 0, max: 2, subs: [1], format: (v) => `${90 * v}`, source: 'card 1-43 photo: 0 = 0; edit-parameters-1: 90 = 1 (was 0); card 1-76 photo: 180 = 2; the unit offers only 0, 90 and 180' },
  // Reverb, Simple (sub-algorithm 0): card 1-83 photo, TYPE SPRING = 9, DECAY TIME 18.6 s (0x253, as in the
  // Advanced), PRE DELAY -50, REVERB LEVEL 12, COLOR WOOL = 0. The types follow the manual's list: the ROM names
  // agree (180 Bright Room 0, 181 Church 3, 183 Cathedral 4, 182 Grand Hall 5, 185 Slow Reverb 7, 184 Spring 9).
  { id: 'reverbSimpleType', section: 'GENERAL', block: 'reverb', label: 'Type', offset: 0x252, min: 0, max: 9, subs: [0], format: (v) => named(REVERB_TYPES, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], v), source: 'card 1-46: HALL = 2 (all ten seen); card 1-44: PLATE = 8; card 1-40: FAST DECAY = 6; ROM 185: SLOW DECAY = 7; card 1-83 photo: SPRING = 9; card 1-78: CLUB = 1; ROM 180: ROOM = 0; ROM 181: CHURCH = 3; ROM 183: CATHEDRAL = 4; ROM 182: GRAND HALL = 5; the rest in the manual\'s order, which the ROM preset names fit' },
  { id: 'reverbSimpleDecay', section: 'GENERAL', block: 'reverb', label: 'Decay Time', offset: 0x253, min: 1, max: 200, subs: [0], format: (v) => `${(v / 10).toFixed(1)} s`, source: 'card 1-83 photo: 18.6 s = 186; the Advanced\'s byte, 0.01 … 20.0 s in the manual' },
  { id: 'reverbSimplePreDelay', section: 'GENERAL', block: 'reverb', label: 'Pre Delay', offset: 0x254, min: -50, max: 100, signed: true, subs: [0], format: String, source: 'card 1-83 photo: -50 = CE; presets use -50 … 100, as the Advanced\'s Pre Delay (the manual says ±50)' },
  { id: 'reverbSimpleLevel', section: 'GENERAL', block: 'reverb', label: 'Reverb Level', offset: 0x255, min: -50, max: 50, signed: true, subs: [0], format: String, source: 'card 1-83 photo: 12' },
  { id: 'reverbSimpleColor', section: 'GENERAL', block: 'reverb', label: 'Color', offset: 0x256, min: 0, max: 7, subs: [0], format: (v) => named(SIMPLE_COLORS, [0, 1, 2, 3, 4, 5, 6, 7], v), source: 'card 2-2: CRISP = 5 (all eight seen); card 1-97: EXTREME = 7; card 1-44: WARM = 1; ROM 185: GLASS = 6; card 1-83 photo: WOOL = 0; card 1-78: REAL = 2; ROM 181: CLEAR = 3; ROM 180: BRIGHT = 4; the manual lists Wool … Glass, Extreme; presets use 0 … 7' },
  // Reverb, Advanced (sub-algorithm 1), in the unit's page order: edit-parameters-1 moved each one step,
  // edit-parameters-2 gave each a distinct value (ROM 1). DECAY TIME (0x253) is above, from samples B→C.
  { id: 'reverbRoomType', section: 'MASTER SECTION', block: 'reverb', label: 'Room Type', offset: 0x25b, min: 0, max: 2, subs: [1], format: (v) => ['Round', 'Curved', 'Square'][v] ?? String(v), source: 'ROM 11 photo: ROUND = 0; edit-parameters-1: CURVED = 1; edit-parameters-2: SQUARE = 2' },
  { id: 'reverbRoomSize', section: 'MASTER SECTION', block: 'reverb', label: 'Room Size', offset: 0x25c, min: 0, max: 7, subs: [1], format: (v) => named(ROOM_SIZES, [0, 1, 2, 3, 4, 5, 6, 7], v), source: 'on the unit the list ends at HUGE = 7; card 2-89 photo: XL = 5; card 1-43 photo: SMALL = 2; card 1-75: GRAND = 6; edit-parameters-1: LARGE = 4; edit-parameters-2: BOX = 0; ROM 139 photo: TINY = 1; ROM 11 photo: MEDIUM = 3; other names in the manual\'s order' },
  {
    id: 'reverbDecay',
    section: 'MASTER SECTION',
    block: 'reverb',
    label: 'Decay Time',
    offset: 0x253,
    min: 1,
    max: 200,
    subs: [1],
    format: (v) => `${(v / 10).toFixed(1)} s`,
    source: 'samples B→C: 2.4 s → 2.5 s changed this byte 0x18 → 0x19 (Mono Reverb)',
  },
  { id: 'reverbLevel', section: 'MASTER SECTION', block: 'reverb', label: 'Reverb Level', offset: 0x261, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 2' },
  { id: 'reverbHighColor', section: 'MASTER SECTION', block: 'reverb', label: 'High Color', offset: 0x255, min: 0, max: 6, subs: [1], format: (v) => named(HIGH_COLORS, [0, 1, 2, 3, 4, 5, 6], v), source: 'card 1-89 photo: GLASS = 6; card 1-75 photo: WOOL = 0; card 1-43: REAL = 2; edit-parameters-1: HIGH COLOR CRISP = 5; ROM 11 photo: BRIGHT = 4; ROM 92 photo: CLEAR = 3; ROM 139 photo: WARM = 1; 0–6 in the ROM presets; other names in the manual\'s order' },
  { id: 'reverbHighFactor', section: 'MASTER SECTION', block: 'reverb', label: 'High Factor', offset: 0x256, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 3' },
  { id: 'reverbLowColor', section: 'MASTER SECTION', block: 'reverb', label: 'Low Color', offset: 0x257, min: 0, max: 6, subs: [1], format: (v) => named(LOW_COLORS, [0, 1, 2, 3, 4, 5, 6], v), source: 'card 1-89 photo: THIN = 5; ROM 92 photo: THICK = 0; card 1-76 photo: ROUND = 1; card 1-43 photo: REAL = 2; card 1-75: TIGHT = 4; edit-parameters-1: LIGHT = 3; edit-parameters-2: NOBASS = 6; seven values, one fewer than the manual lists' },
  { id: 'reverbLowFactor', section: 'MASTER SECTION', block: 'reverb', label: 'Low Factor', offset: 0x258, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 4' },
  { id: 'reverbRoomLevel', section: 'ROOM SETTINGS', block: 'reverb', label: 'Room Level', offset: 0x25d, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 5' },
  { id: 'reverbColor', section: 'ROOM SETTINGS', block: 'reverb', label: 'Color', offset: 0x25e, min: 0, max: 7, subs: [1], format: (v) => named(COLORS, [0, 1, 2, 3, 4, 5, 6, 7], v), source: 'card 2-89 photo: CLEAR = 4; card 1-89 photo: BRIGHT = 5; card 1-76 photo: AUTO = 0 (COL.FACTOR then shows blank); edit-parameters-1: WOOL = 1; edit-parameters-2: WARM = 2; ROM 139 photo: REAL = 3; ROM 146 photo: CRISP = 6; ROM 75 photo: GLASS = 7; other names in the manual\'s order' },
  { id: 'reverbColFactor', section: 'ROOM SETTINGS', block: 'reverb', label: 'Col.Factor', offset: 0x25f, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 6' },
  { id: 'reverbPreDelay', section: 'ROOM SETTINGS', block: 'reverb', label: 'Pre Delay', offset: 0x260, min: -50, max: 100, signed: true, subs: [1], format: String, source: 'edit-parameters-1: PRE DELAY 25 (was 24); ROM presets use -50 … 100. ROM 146 photo: 20, with 45 MS under the bar: the value seems relative to the room' },
  { id: 'reverbDecayLevel', section: 'DECAY SETTINGS', block: 'reverb', label: 'Decay Level', offset: 0x254, min: -50, max: 50, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 7' },
  { id: 'reverbDecayStart', section: 'DECAY SETTINGS', block: 'reverb', label: 'Decay Start', offset: 0x259, min: -100, max: 100, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 8; ROM presets use -100 … 100' },
  { id: 'reverbDiffuse', section: 'DECAY SETTINGS', block: 'reverb', label: 'Diffuse', offset: 0x25a, min: -25, max: 25, signed: true, subs: [1], format: String, source: 'edit-parameters-1: 1; edit-parameters-2: 9; ROM presets use -25 … 25, the manual\'s range' },
];

/** A value's name; names whose value isn't in `seen` come from the manual and show with a '?'. */
function named(names: string[], seen: number[], v: number): string {
  const n = names[v];
  if (n === undefined) return String(v);
  return seen.includes(v) ? n : `${n}?`;
}
/** Reverb High Color in the manual's order; Warm = 1 and Clear … Crisp = 3–5 are seen on the unit. */
const HIGH_COLORS = ['Wool', 'Warm', 'Real', 'Clear', 'Bright', 'Crisp', 'Glass'];
/** Reverb Room Size in the manual's order; all eight seen on the unit, HUGE (7) the last. */
const ROOM_SIZES = ['Box', 'Tiny', 'Small', 'Medium', 'Large', 'XL', 'Grand', 'Huge'];
/**
 * Reverb Low Color: seven values on the unit, Thick = 0, Round = 1, Real = 2, Light = 3, Tight = 4 and
 * NoBass = 6. The manual lists eight (Thick, Fat, Round, Natural, Light, Tight, Thin, No bass): the unit
 * has no Fat, and shows Natural as Real. 5 = Thin is the only one left.
 */
const LOW_COLORS = ['Thick', 'Round', 'Real', 'Light', 'Tight', 'Thin', 'NoBass'];
/** Simple Reverb types, in the manual's order; all ten seen on the unit (cards 1-40/44/46/78/83, ROMs 180–185). */
const REVERB_TYPES = ['Room', 'Club', 'Hall', 'Church', 'Cathedral', 'Grand Hall', 'Fast Decay', 'Slow Decay', 'Plate', 'Spring'];
/** Simple Reverb Color (manual): the High Color names plus Extreme; Wool = 0 is seen. */
const SIMPLE_COLORS = ['Wool', 'Warm', 'Real', 'Clear', 'Bright', 'Crisp', 'Glass', 'Extreme'];
/** Formant vowels: the unit names them by a word; HIT 1, BUT 4, FOOT 8 (card 1-83), HEAT 0, HAD 3, ALL 6 (card 1-78),
 * FATHER 5, BOOT 7, BIRD 9 (ROM 157), HEAD 2 (ROM 176): all ten. */
const VOWELS_SEEN: Record<number, string> = { 0: 'Heat', 1: 'Hit', 2: 'Head', 3: 'Had', 4: 'But', 5: 'Father', 6: 'All', 7: 'Boot', 8: 'Foot', 9: 'Bird' };
function vowel(v: number): string {
  return VOWELS_SEEN[v] ?? String(v);
}
/** Intelligent Pitch keys; C = 0 is seen (card 2-1). */
/** Intelligent Pitch scales: Ionian Maj. = 0 is seen, Dorian = 1 fits card 1-36 "E Dorian"; the rest assume the mode order. */
const SCALES = ['Ionian Maj.', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian'];
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Intelligent Pitch voice: a scale step shown as an interval, 7 = "8" (card 2-1); the rest assume 0 = "1" (unison). */
function intervalName(v: number): string {
  if (v === 7) return '8';
  return v >= 0 ? `${v + 1}?` : `${v - 1}?`;
}
/**
 * Resonance filter frequencies, 0 … 100, two geometric sweeps that fit both photos exactly: Locut 20 Hz × 250^(n/100)
 * (20 Hz … 5 kHz; 0 = 20.0 Hz on card 2-1, 27 = 88.8 Hz on card 1-97) and Hicut 150 Hz × 100^(n/100) (150 Hz … 15 kHz;
 * 77 = 5.20 kHz on card 1-97, 100 = 15.0 kHz on card 2-1). Card 2-2 then showed 40 = 182 Hz and 70 = 3.77 kHz, as
 * predicted, and ROM 173 58 = 492 Hz and 89 = 9.04 kHz.
 */
function resLoFreq(v: number): string {
  return hz(20 * Math.pow(250, v / 100));
}
function resHiFreq(v: number): string {
  return hz(150 * Math.pow(100, v / 100));
}
/** LFO curves, in the manual's figure order: Square = 0 (Adv. Tremolo), Triangle = 1 and Sine = 2 (Chorus). */
const LFO_CURVES = ['Square', 'Triangle', 'Sine'];
/** Reverb Color: Auto, then the High Color names (manual); Auto … Real = 0–3, Crisp = 6 and Glass = 7 are seen. */
const COLORS = ['Auto', 'Wool', 'Warm', 'Real', 'Clear', 'Bright', 'Crisp', 'Glass'];

/** Start of each block's data: its sub-algorithm byte (Drive has none, the byte is 0). */
export const BLOCK_AT: Record<Exclude<BlockId, 'gate'>, number> = {
  compress: 0x166, filters: 0x17a, pantrem: 0x19c, pitch: 0x1b2, delay: 0x1d6, drive: 0x208, chorus: 0x22e, reverb: 0x246,
};

/**
 * Mute modes, as the unit's MUTE MODE list shows them from the bottom (photo of ROM 1's
 * Reverb: MIX 0%, FX OUT, OUTPUT, FX IN, INPUT, with its value 3 = FX IN). Same order as
 * the manual (p.33). FX In and Input exist only in Delay, Reverb and Pitch.
 */
const MUTE_MODES = ['Mix 0%', 'FX Out', 'Output', 'FX In', 'Input'];

/**
 * GLOBAL parameters, shared by every block (the unit's GLOBAL section), at the
 * same place after each sub-algorithm byte: +1 Mix Level, +2 In Level, +3 Out
 * Level, +4 Mute Mode. Seen on the unit: Filters MIX LEVEL 35 % at +1 (ROM 7),
 * Compressor IN LEVEL 0 dB at +2 and OUT LEVEL −5 dB at +3 (ROM 203), Reverb
 * MIX LEVEL 28 %, IN and OUT LEVEL 0 dB and MUTE MODE FX IN (ROM 1). Across
 * all 225 ROM presets +4 reaches 3–4 only in Delay, Pitch and Reverb, the
 * blocks that have FX In and Input. The Compressor shows no Mix, and Pan+Trem
 * and Chorus keep +3 at 0 (the manual: Out Level is not in every block), so
 * those are left out. The Compressor's levels are in BLOCK_PARAMS.
 */
/** Routing-grid code of each block (as in ROUTED, which is declared later). */
const BLOCK_CODE: Record<Exclude<BlockId, 'gate'>, number> = { compress: 4, filters: 5, pantrem: 6, pitch: 7, delay: 8, drive: 9, chorus: 10, reverb: 11 };
function globalParams(block: Exclude<BlockId, 'gate'>): ParamDef[] {
  const at = BLOCK_AT[block];
  const name = BLOCKS.find((b) => b.id === block)!.label;
  // Link IDs: Mix, In and Out Level are n = 0, 1, 2 of the block (see "Modifier links" in SYSEX_FORMAT.md).
  const base = 1000 * (BLOCK_CODE[block] - 3);
  const out: ParamDef[] = [];
  const level = (id: string, label: string, offset: number, source: string): ParamDef => ({
    id: `${block}${id}`, section: 'GLOBAL', block, label, offset, min: -40, max: 0, signed: true, format: (v) => `${v} dB`, source,
    link: base + (id === 'InLevel' ? 1 : 2),
  });
  if (block !== 'compress') {
    out.push({
      id: `${block}Mix`, section: 'GLOBAL', block, label: 'Mix Level', offset: at + 1, min: 0, max: 100, format: (v) => `${v} %`, link: base,
      source: `${name}: byte after the sub-algorithm, 0–100 in every ROM preset; Filters MIX LEVEL 35 % in a photo of ROM 7`,
    });
    out.push(level('InLevel', 'In Level', at + 2, `${name}: GLOBAL In Level, as the Compressor's (photo of ROM 203); 0 or negative in every ROM preset`));
    if (block !== 'pantrem' && block !== 'chorus') {
      out.push(level('OutLevel', 'Out Level', at + 3, `${name}: GLOBAL Out Level, as the Compressor's (photo of ROM 203); 0 or negative in every ROM preset`));
    }
  }
  const full = block === 'delay' || block === 'pitch' || block === 'reverb';
  out.push({
    id: `${block}Mute`, section: 'GLOBAL', block, label: 'Mute Mode', offset: at + 4, min: 0, max: full ? 4 : 2,
    format: (v) => MUTE_MODES[v] ?? String(v),
    source: `${name}: values ${full ? '0–4' : '0–2'} in the ROM presets; ROM 1 photo: Reverb MUTE MODE FX IN = 3`,
  });
  return out;
}

/**
 * Decoded parameters, per block: its own (GENERAL) first, then GLOBAL, as on
 * the unit's Edit page. Each is checked against dumps or photos; see `source`.
 */
export const PARAMS: ParamDef[] = BLOCKS.flatMap((b) => [
  ...BLOCK_PARAMS.filter((p) => p.block === b.id),
  ...(b.id === 'gate' ? [] : globalParams(b.id)),
]);

/**
 * Ratio steps seen on the unit: 0 = OFF (card 1-59), 1 = 1.12:1 (ROM 114), 2 = 1.25:1 (card 1-83), 3 = 1.40:1 (ROM 139), 4 = 1.60:1 (ROM 141), 5 = 1.80:1 (ROM 101), 6 = 2.0:1 (card 1-76), 7 = 2.5:1 (card 1-89), 8 = 3.2:1 (ROM 92), 9 = 4.0:1 (ROM 11),
 * 10 = 5.6:1 (edit-parameters-1), 11 = 8.0:1 (card 1-43), 12 = 16:1 (ROM 203), 13 = 32:1 (card 2-45), 14 = 64:1 (card 1-73), 15 = INFINITE:1 (card 2-1). The unit writes the low ratios with two decimals.
 */
const RATIOS_SEEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/**
 * Delay Locut/Hicut frequency for a step: 10 Hz × 1600^(n/100), a geometric sweep from 10 Hz to 16 kHz,
 * shown with three significant digits as on the unit. It reproduces all sixteen steps photographed (with
 * card 2-24's 25 = 63.2 Hz and 82 = 4.24 kHz):
 * 0 = 10.0 Hz, 1 = 10.8, 29 = 85.0 (card 2-62; the earlier 10^(0.03204 n) gave 84.9), 32 = 106, 33 = 114,
 * 39 = 178 (card 2-89), 46 = 298, 52 = 464 Hz, 78 = 3.16, 80 = 3.66, 83 = 4.56, 87 = 6.13 (card 2-89), 99 = 14.9,
 * 100 = 16.0 kHz.
 */
function cutFreq(v: number): string {
  return hz(10 * Math.pow(1600, v / 100));
}
/** A frequency with three significant digits, as the unit writes it. */
function hz(f: number): string {
  if (f < 100) return `${f.toFixed(1)} Hz`;
  if (f < 1000) return `${Math.round(f)} Hz`;
  if (f < 10000) return `${(f / 1000).toFixed(2)} kHz`;
  return `${(f / 1000).toFixed(1)} kHz`;
}

/**
 * LFO speed steps (Chorus, Pan+Trem, Phaser): the unit's whole table, read from a video of the Advanced Chorus
 * SPEED stepping from its lowest value to its highest (0.050 Hz … 19.2 Hz, 104 steps, about a semitone, ×1.06,
 * apart). Every step seen before on photos falls on its index (0, 10, 14, 21–23, 33, 37, 40, 44, 49, 51, 62, 79,
 * 80, 88). Below 0.050 Hz the unit offers OFF, stored as FF (-1): edit-parameters-4's User 9, a Chorus set to OFF.
 */
const LFO_SPEEDS = ['0.050', '0.053', '0.056', '0.060', '0.063', '0.067', '0.071', '0.075', '0.080', '0.084', '0.089', '0.094', '0.100', '0.106', '0.112', '0.120', '0.126', '0.134', '0.142', '0.150', '0.160', '0.168', '0.178', '0.188', '0.200', '0.212', '0.224', '0.240', '0.252', '0.268', '0.284', '0.300', '0.320', '0.336', '0.356', '0.376', '0.400', '0.424', '0.448', '0.480', '0.504', '0.536', '0.568', '0.600', '0.640', '0.672', '0.712', '0.752', '0.800', '0.848', '0.896', '0.960', '1.01', '1.07', '1.14', '1.20', '1.28', '1.34', '1.42', '1.50', '1.60', '1.70', '1.79', '1.92', '2.02', '2.14', '2.27', '2.40', '2.56', '2.69', '2.85', '3.01', '3.20', '3.39', '3.58', '3.84', '4.03', '4.29', '4.54', '4.80', '5.12', '5.38', '5.70', '6.02', '6.40', '6.78', '7.17', '7.68', '8.06', '8.58', '9.09', '9.60', '10.2', '10.8', '11.4', '12.0', '12.8', '13.6', '14.3', '15.4', '16.1', '17.2', '18.2', '19.2'];
function lfoSpeed(v: number): string {
  if (v === -1) return 'Off';
  return LFO_SPEEDS[v] !== undefined ? `${LFO_SPEEDS[v]} Hz` : `step ${v}?`;
}

/**
 * Tempo (Delay, Chorus, Pan+Trem, Phaser), all 17 bytes known. The menu order (video) is IGNORED, 1, then each note
 * as dotted, straight, triplet, but the bytes are not: photos give 0 IGNORED (ROM 3), 1 (edit-parameters-1), 2 1/2 (card 1-83),
 * 3 1/4 (ROM 196), 4 1/8. (card 2-24), 5 1/8, 7 1/16 (card 1-43), 9 1/32 (card 2-22), 11 1/2. (edit-parameters-3), and
 * edit-parameters-4 (one preset per value) the rest: 6 1/16., 8 1/32., 10 1/32T, 12 1/4., 13 1/2T, 14 1/4T, 15 1/8T, 16 1/16T.
 */
const TEMPOS = ['Ignored', '1', '1/2', '1/4', '1/8.', '1/8', '1/16.', '1/16', '1/32.', '1/32', '1/32T', '1/2.', '1/4.', '1/2T', '1/4T', '1/8T', '1/16T'];
function tempoName(v: number): string {
  return TEMPOS[v] ?? `step ${v}?`;
}
/** Compressor ratio steps (n:1). Only the steps in RATIOS_SEEN are seen on the unit; the rest are a guess. */
const COMP_RATIOS = ['Off', '1.12:1', '1.25:1', '1.40:1', '1.60:1', '1.80:1', '2.0:1', '2.5:1', '3.2:1', '4.0:1', '5.6:1', '8.0:1', '16:1', '32:1', '64:1', 'Infinite:1'];

/** A parameter's value from its raw byte. */
export function paramValue(p: ParamDef, raw: number): number {
  return p.signed && raw > 127 ? raw - 256 : raw;
}

// ---------------------------------------------------------------------------
// Routing grid and sub-algorithms, found by comparing ROM 1–225
// (samples/gforce-rom-*.syx) with the manual's
// preset list. Read-only: no single-change dump confirms them yet (see README,
// assumptions).

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
  // ROM 203 Hard Compressor (1) shows COMPRESS - ADVANCED, ROM 1 Mono Reverb (0) COMPRESS - SIMPLE.
  { code: 4, block: 'compress', short: 'CPR', subAt: 0x166, subs: ['SIMPLE', 'ADVANCED'], seen: [0, 1] },
  // ROM 7 Touchwah (2) shows FILTER - WAH-WAH: not the manual's order. The rest fit the preset list:
  // 0 EQ presets, 1 173 "Resonance Filter", 3 140 "Stepped Formant Filter", 4 the Phaser presets.
  { code: 5, block: 'filters', short: 'FIL', subAt: 0x17a, subs: ['PARAMETRIC', 'RESONANCE', 'WAH-WAH', 'FORMANT', 'PHASER'], seen: [0, 1, 2, 3, 4] },
  // ROM 146 Slow Swell Pad (2) shows PAN+TREM - SIMPLE PANNER. From the preset list: 3 195 Surround
  // Panner, 1 all three single-block Tremolos; the names follow the unit's SIMPLE/ADVANCED style.
  { code: 6, block: 'pantrem', short: 'PAN', subAt: 0x19c, subs: ['SIMPLE TREMOLO', 'ADV. TREMOLO', 'SIMPLE PANNER', 'SURROUND PAN.'], seen: [0, 1, 2, 3] },
  // ROM 11 Mono Pedal Pitch (1) shows PITCH - FIXED 1 VOICE; card 1-76 (2) PITCH - FIXED 2 VOICE; card 1-43 (3) PITCH - DUAL DETUNE.
  { code: 7, block: 'pitch', short: 'PIT', subAt: 0x1b2, subs: ['INTELLIGENT 2 VOICE', 'FIXED 1 VOICE', 'FIXED 2 VOICE', 'DUAL DETUNE'], seen: [0, 1, 2, 3] },
  // ROM 3 Mono Dyn Delay (4) shows DELAY - ONE-TAP; card 1-76 (0) DELAY - STEREO. The rest fit the single-block presets:
  // 1 197 "Two Delays", 2 29 Slap+Slow Dly (two taps), 3 200 "4 Tap Delay", 0 196 (one 500 ms Delay).
  { code: 8, block: 'delay', short: 'DLY', subAt: 0x1d6, subs: ['STEREO', 'DUAL', 'DUAL TWO-TAP', 'QUAD-TAP', 'ONE-TAP'], seen: [0, 1, 2, 3, 4] },
  { code: 9, block: 'drive', short: 'DRV' },
  { code: 10, block: 'chorus', short: 'CHO', subAt: 0x22e, subs: ['CLASSIC CHORUS', 'ADVANCED CHORUS', 'CLASSIC FLANGER', 'ADVANCED FLANGER'], seen: [0, 1, 2, 3] },
  // ROM 1 Mono Reverb (1) shows REVERB - ADVANCED.
  { code: 11, block: 'reverb', short: 'REV', subAt: 0x246, subs: ['SIMPLE', 'ADVANCED'], seen: [0, 1] },
];

export const routedBlock = (code: number): RoutedBlock | undefined => ROUTED.find((r) => r.code === code);

/** Whether a parameter exists in a preset: always, or only in the listed sub-algorithms of its block. */
export function paramApplies(p: ParamDef, preset: Preset): boolean {
  if (!p.subs || p.block === 'gate') return true;
  return p.subs.includes(preset.byte(BLOCK_AT[p.block]));
}

/** The parameter starting at a byte, in a preset (sub-algorithm parameters only in their sub-algorithm). */
export function paramAt(offset: number, preset?: Preset): ParamDef | undefined {
  return PARAMS.find((p) => p.offset === offset && (!preset || paramApplies(p, preset)));
}

/** A block's parameters that exist in a preset. */
export function paramsFor(preset: Preset, block: BlockId): ParamDef[] {
  return PARAMS.filter((p) => p.block === block && paramApplies(p, preset));
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

  /** Parameter IDs the preset's 20 modifier links (10 bytes each at 0x76) move; bytes 8–9 are the target ID. */
  linkTargets(): Set<number> {
    const out = new Set<number>();
    for (let k = 0; k < LINK_COUNT; k++) {
      const at = LINKS_AT + 10 * k;
      const id = (this.data[at + 8] << 8) | this.data[at + 9];
      if (id) out.add(id);
    }
    return out;
  }

  /** True when a modifier link moves this parameter (the unit shows ■ before its value). */
  linked(p: ParamDef): boolean {
    return p.link !== undefined && this.linkTargets().has(p.link);
  }

  get(p: ParamDef): number {
    if (p.width === 2) {
      const x = (this.data[p.offset] << 8) | this.data[p.offset + 1];
      return p.signed && x > 0x7fff ? x - 0x10000 : x;
    }
    return paramValue(p, this.data[p.offset]);
  }
  set(p: ParamDef, v: number): void {
    const x = Math.max(p.min, Math.min(p.max, Math.round(v)));
    if (p.width === 2) {
      this.data[p.offset] = (x >> 8) & 0xff;
      this.data[p.offset + 1] = x & 0xff;
    } else this.data[p.offset] = x & 0xff;
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
