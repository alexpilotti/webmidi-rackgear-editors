// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Effect groups, parameters and the 97 factory chains of the Korg A2
// (transcribed from docs/Korg_A2.pdf "Effect Parameters" pp.41-78 and
// docs/Korg-A2ProgramChainList.pdf).
//
// The manuals document the *displayed* ranges but not the raw byte encoding.
// Each parameter here is modelled as an ordered list of display values; the raw
// byte is the index into that list, except for ranges that straddle zero, which
// are stored as a signed (two's complement) step count around zero.
// See README.md -> "Assumptions".

export interface ParamDef {
  /** 4-character label as shown on the A2's LCD. */
  label: string;
  /** Full name from the manual. */
  name: string;
  unit: string;
  values: string[];
  /** Index of the value that raw byte 0 maps to (non-zero for signed ranges). */
  zero: number;
}

export interface EffectGroup {
  id: string;
  name: string;
  /** [LCD abbreviation (4 chars), full name] per variation. */
  variations: [string, string][];
  /** Parameters on editors A..F (null = unused editor). */
  params: (ParamDef | null)[];
  /** Sub-block of another effect (e.g. REVERB II colour block). */
  subBlock?: boolean;
}

// ---------------------------------------------------------------------------
// Parameter builders

function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function num(label: string, name: string, min: number, max: number, step = 1, unit = '', dec?: number): ParamDef {
  const d = dec ?? decimalsOf(step);
  const count = Math.round((max - min) / step) + 1;
  const values: string[] = [];
  for (let i = 0; i < count; i++) values.push((min + i * step).toFixed(d));
  const zero = min < 0 ? Math.round(-min / step) : 0;
  return { label, name, unit, values, zero };
}

function list(label: string, name: string, values: string[], unit = ''): ParamDef {
  return { label, name, unit, values, zero: 0 };
}

const speeds = num('SPD', 'SPEED', 0.05, 10, 0.05, 'Hz').values;
const SPD = (label = 'SPD', name = 'SPEED') => list(label, name, speeds, 'Hz');
const DPTH = (max = 100) => num('DPTH', 'DEPTH', 0, max);
const EBAL = () => num('EBAL', 'EFFECT BALANCE', 0, 100);
const FBAK = (label = 'FBAK', name = 'FEEDBACK') => num(label, name, -99, 99);
const DAMP = (max = 99) => num('DAMP', 'HIGH DAMP', 0, max);
const GAIN = (label = 'GAIN', name = 'GAIN') => num(label, name, -12, 12, 1, 'dB');
const LEVL = (name = 'LEVEL') => num('LEVL', name, 0, 100);
const DRIV = () => num('DRIV', 'DRIVE', 0, 100);
const FINE = (max = 9.9) => num('FINE', 'TIME FINE', 0, max, 0.1, 'ms');
const MIDFC = (label = 'M-Fc', name = 'MID-Fc') => num(label, name, 0.55, 8.0, 0.05, 'kHz');
const XFREQ = (label: string, name: string) => num(label, name, 1.9, 18.6, 0.1, 'kHz');
const ONOFF = (label: string, name: string) => list(label, name, ['OFF', 'ON']);
const PREDLY = (max: number) => num('PreD', 'PRE DELAY', 0, max, 1, 'ms');

// 0.0-9.9 ms in 0.1 ms steps, then 10-50 ms in 1 ms steps (MODULATION II).
const modIIDelay = (label: string, name: string): ParamDef => {
  const values: string[] = [];
  for (let i = 0; i < 100; i++) values.push((i / 10).toFixed(1));
  for (let i = 10; i <= 50; i++) values.push(String(i));
  return { label, name, unit: 'ms', values, zero: 0 };
};

const variants = (prefix: [string, string][]) => prefix;

// ---------------------------------------------------------------------------
// Effect groups

const G: EffectGroup[] = [
  {
    id: 'REV', name: 'REVERB',
    variations: variants([['RM 1', 'ROOM 1'], ['RM 2', 'ROOM 2'], ['HL 1', 'HALL 1'], ['HL 2', 'HALL 2'], ['PL 1', 'PLATE 1'], ['PL 2', 'PLATE 2']]),
    params: [num('RevT', 'REVERB TIME', 0.1, 5.0, 0.1, 's'), DAMP(), PREDLY(100), GAIN('L.EQ', 'LOW EQ'), GAIN('H.EQ', 'HIGH EQ'), EBAL()],
  },
  {
    id: 'COMP', name: 'COMPRESSOR', variations: [['COMP', 'COMPRESSOR']],
    params: [num('SENS', 'SENSITIVITY', 0, 100), num('ATCK', 'ATTACK', 0, 20), LEVL(), null, null, null],
  },
  {
    id: 'DIST', name: 'DISTORTION',
    variations: [['DST1', 'DISTORTION 1'], ['DST2', 'DISTORTION 2'], ['OVD1', 'OVER DRIVE 1'], ['OVD2', 'OVER DRIVE 2']],
    params: [DRIV(), LEVL(), MIDFC('FREQ', 'FREQUENCY'), GAIN(), num('Q', 'Q', 2.0, 10.0, 0.1), null],
  },
  {
    id: 'DLY', name: 'DELAY', variations: [['DLY1', 'DELAY 1'], ['DLY2', 'DELAY 2'], ['DLY3', 'DELAY 3']],
    params: [num('TIME', 'DELAY TIME', 0, 800, 10, 'ms'), FINE(), FBAK(), DAMP(), EBAL(), null],
  },
  {
    id: 'SDLY', name: 'STEREO DELAY', variations: [['SDLY', 'STEREO DELAY'], ['XDLY', 'CROSS DELAY']],
    params: [num('DT-L', 'DELAY TIME L', 0, 400, 2, 'ms'), FBAK('FB-L', 'FEEDBACK L'), num('DT-R', 'DELAY TIME R', 0, 400, 2, 'ms'), FBAK('FB-R', 'FEEDBACK R'), DAMP(), EBAL()],
  },
  {
    id: 'MDLY', name: 'MODULATION DELAY', variations: [['MDL1', 'MOD DELAY 1 (sine)'], ['MDL2', 'MOD DELAY 2 (triangle)']],
    params: [num('TIME', 'DELAY TIME', 0, 500, 10, 'ms'), FINE(), FBAK(), SPD(), DPTH(), EBAL()],
  },
  {
    id: 'MOD', name: 'MODULATION',
    variations: [['CHO1', 'STEREO CHORUS 1'], ['CHO2', 'STEREO CHORUS 2'], ['FLN1', 'STEREO FLANGER 1'], ['FLN2', 'STEREO FLANGER 2']],
    params: [SPD(), DPTH(), FBAK(), num('TIME', 'DELAY TIME', 0, 50, 1, 'ms'), FINE(0.9), EBAL()],
  },
  {
    id: 'RSP', name: 'ROTARY SPEAKER', variations: [['R.SP', 'ROTARY SPEAKER']],
    params: [DPTH(99), num('RATO', 'SPEED RATIO', -10, 10), list('SEL', 'SPEED SELECT', ['LOW', 'HIGH']), null, null, null],
  },
  {
    id: 'APAN', name: 'AUTO PAN', variations: [['PAN1', 'AUTO PAN 1 (sine)'], ['PAN2', 'AUTO PAN 2 (triangle)']],
    params: [SPD(), DPTH(), null, null, null, null],
  },
  {
    id: 'PEQ', name: 'PARAMETRIC EQ', variations: [['P.EQ', 'PARAMETRIC EQUALIZER']],
    params: [num('L-Fc', 'LOW-Fc', 0.1, 2.0, 0.1, 'kHz'), GAIN('GAIN', 'LOW GAIN'), MIDFC(), GAIN('GAIN', 'MID GAIN'), num('Q', 'Q', 2.0, 10.0, 0.1), null],
  },
  {
    id: 'PTCH', name: 'PITCH SHIFTER', variations: [['PTCH', 'PITCH SHIFTER']],
    params: [num('PTCH', 'PITCH', -100, 100, 5, 'cent'), EBAL(), null, null, null, null],
  },
  {
    id: 'XCIT', name: 'EXCITER', variations: [['XCIT', 'EXCITER']],
    params: [num('BLND', 'BLEND', -100, 100), XFREQ('FREQ', 'FREQUENCY'), null, null, null, null],
  },
  {
    id: 'ENS', name: 'ENSEMBLE', variations: [['ENS ', 'ENSEMBLE']],
    params: [SPD(), DPTH(), PREDLY(50), EBAL(), null, null],
  },
  {
    id: 'PHA', name: 'PHASER', variations: [['PHA1', 'PHASER 1 (sine)'], ['PHA2', 'PHASER 2 (triangle)']],
    params: [SPD(), DPTH(), num('MANU', 'MANUAL', 0, 100), num('RESO', 'RESONANCE', 0, 99), null, null],
  },
  {
    id: 'EQ3', name: '3 BAND EQ', variations: [['EQ  ', '3 BAND EQUALIZER']],
    params: [num('L-Fc', 'LOW-Fc', 0.1, 2.0, 0.1, 'kHz'), GAIN('GAIN', 'LOW GAIN'), MIDFC(), GAIN('GAIN', 'MID GAIN'), num('H-Fc', 'HIGH-Fc', 1.0, 8.0, 0.1, 'kHz'), GAIN('GAIN', 'HIGH GAIN')],
  },
  {
    id: 'SPSM', name: 'SPEAKER SIMULATION', variations: [['SP 1', 'SPEAKER SIM 1'], ['SP 2', 'SPEAKER SIM 2'], ['SP 3', 'SPEAKER SIM 3']],
    params: [ONOFF('FAT', 'FAT'), ONOFF('BRIT', 'BRIGHT'), null, null, null, null],
  },
  {
    id: 'PPAN', name: 'PEDAL PAN', variations: [['PPAN', 'PEDAL PAN']],
    params: [DPTH(), null, null, null, null, null],
  },
  {
    id: 'GATE', name: 'GATE', variations: [['GATE', 'GATE']],
    params: [num('LEVL', 'THRESHOLD LEVEL', 0, 99), num('ATCK', 'ATTACK TIME', 0, 99), num('REL', 'RELEASE TIME', 0, 99), PREDLY(50), null, null],
  },
  {
    id: 'WAH', name: 'WAH', variations: [['WAH1', 'AUTO WAH DRIVE UP'], ['WAH2', 'AUTO WAH DRIVE DOWN'], ['PWAH', 'PEDAL WAH']],
    params: [num('SENS', 'SENSITIVITY', 0, 100), num('FC', 'CUTOFF FREQUENCY', 0, 100), num('RESO', 'RESONANCE', 0, 99), num('ATCK', 'ATTACK TIME', 1, 20), num('REL', 'RELEASE TIME', 1, 20), null],
  },
  {
    id: 'EREF', name: 'EARLY REFLECTION', variations: [['ER 1', 'EARLY REFLECTION 1'], ['ER 2', 'EARLY REFLECTION 2'], ['ER 3', 'EARLY REFLECTION 3']],
    params: [num('TIME', 'E/R TIME', 5, 500, 5, 'ms'), PREDLY(100), GAIN('L.EQ', 'LOW EQ'), GAIN('H.EQ', 'HIGH EQ'), EBAL(), null],
  },
  {
    id: 'HDST', name: 'HARD DISTORTION', variations: [['HDST', 'HARD DISTORTION'], ['TOD ', 'TUBE OVERDRIVE']],
    params: [DRIV(), LEVL(), GAIN('BASS', 'BASS GAIN'), MIDFC(), GAIN('MID', 'MID GAIN'), GAIN('TRBL', 'TREBLE')],
  },
  {
    id: 'SPH', name: 'SPACE PHASER', variations: [['SPH1', 'SPACE PHASER 1 (sine)'], ['SPH2', 'SPACE PHASER 2 (triangle)']],
    params: [SPD(), DPTH(), num('MANU', 'MANUAL', 0, 100), num('RESO', 'RESONANCE', 0, 99), null, null],
  },
  {
    id: 'MTD', name: 'MULTI-TAP DELAY',
    variations: [['MTD1', 'MULTI-TAP DELAY 1'], ['MTD2', 'MULTI-TAP DELAY 2'], ['MTD3', 'MULTI-TAP DELAY 3'], ['MTD4', 'MULTI-TAP DELAY 4'], ['MTD5', 'MULTI-TAP DELAY 5'], ['MTD6', 'MULTI-TAP DELAY 6']],
    params: [num('DT-L', 'DELAY TIME L', 0, 800, 10, 'ms'), num('DT-R', 'DELAY TIME R', 0, 800, 10, 'ms'), num('FB-T', 'FEEDBACK TIME', 0, 800, 10, 'ms'), FBAK('FB-G', 'FEEDBACK GAIN'), num('AMB', 'AMBIENCE', 0, 20), EBAL()],
  },
  {
    id: 'LDLY', name: 'LONG DELAY', variations: [['LDL1', 'LONG DELAY 1'], ['LDL2', 'LONG DELAY 2'], ['LDL3', 'LONG DELAY 3']],
    params: [num('TIME', 'DELAY TIME', 0, 1600, 10, 'ms'), FINE(), FBAK(), DAMP(), EBAL(), null],
  },
  {
    id: 'TDLY', name: 'TEMPO DELAY', variations: [['TDLY', 'TEMPO DELAY']],
    params: [
      num('TEMP', 'TEMPO', 40, 192, 1, 'BPM'),
      list('NOTE', 'NOTE', ['1/2', '1/4D', '1/4', '1/8D', '1/4T', '1/8', '1/8T', '1/16', '16T', '1/32', '32T']),
      num('AJST', 'ADJUST', -9.9, 9.9, 0.1, '%'),
      FBAK(), DAMP(), EBAL(),
    ],
  },
  {
    id: 'DMOD', name: 'DYNAMIC MODULATION',
    variations: [['DMD1', 'DYNAMIC MOD 1'], ['DMD2', 'DYNAMIC MOD 2'], ['PMD1', 'PEDAL MOD 1'], ['PMD2', 'PEDAL MOD 2']],
    params: [num('ATCK', 'ATTACK', 0, 20), num('REL', 'RELEASE', 0, 20), DPTH(), FBAK(), num('TIME', 'DELAY TIME', 0, 50, 1, 'ms'), EBAL()],
  },
  {
    id: 'MIX', name: '4CH MIXER', variations: [['MIX ', '4CH MIXER']],
    params: [
      num('LVL1', 'Ch1 LEVEL', 0, 100), panParam('PAN1', 'Ch1 PAN'),
      num('LVL2', 'Ch2 LEVEL', 0, 100), panParam('PAN2', 'Ch2 PAN'),
      num('LVL3', 'Ch3 LEVEL', 0, 100), num('LVL4', 'Ch4 LEVEL', 0, 100),
    ],
  },
  {
    id: 'GAT2', name: 'GATE II', variations: [['GAT1', 'GATE 1'], ['GAT2', 'GATE 2']],
    params: [num('LEVL', 'THRESHOLD LEVEL', 0, 99), num('ATCK', 'ATTACK TIME', 0, 50), num('HLDT', 'HOLD TIME', 0, 1600, 10, 'ms'), num('REL', 'RELEASE TIME', 0, 50), PREDLY(50), null],
  },
  {
    id: 'LIM', name: 'LIMITER', variations: [['LIM ', 'LIMITER']],
    params: [num('THR', 'THRESHOLD', 0, 99), num('RATO', 'RATIO', 0, 100), num('ATCK', 'ATTACK', 0, 30), num('REL', 'RELEASE', 0, 30), LEVL(), null],
  },
  {
    id: 'BCH', name: 'BAND CHORUS',
    variations: [['BCH1', 'BAND CHORUS 1'], ['BCH2', 'BAND CHORUS 2'], ['BCH3', 'BAND CHORUS 3'], ['BCH4', 'BAND CHORUS 4']],
    params: [
      SPD('SPDL', 'SPEED LOW'), num('DPTL', 'DEPTH LOW', 0, 100),
      list('SPDH', 'SPEED HIGH', ['SYNC', ...speeds], 'Hz'), num('DPTH', 'DEPTH HIGH', 0, 100),
      num('MBAL', 'MIX BALANCE', 0, 100), EBAL(),
    ],
  },
  {
    id: 'SXIT', name: 'STEREO EXCITER', variations: [['SXIT', 'STEREO EXCITER']],
    params: [num('BLNL', 'BLEND LEFT', -100, 100), XFREQ('FREL', 'FREQUENCY LEFT'), num('BLNR', 'BLEND RIGHT', -100, 100), XFREQ('FRER', 'FREQUENCY RIGHT'), null, null],
  },
  {
    id: 'CLM', name: 'COMP/LIMITER', variations: [['C/LM', 'COMP/LIMITER']],
    params: [num('THR', 'THRESHOLD LEVEL', 0, 99), num('RATO', 'RATIO', 0, 100), num('ATCK', 'ATTACK', 0, 30), num('REL', 'RELEASE', 0, 30), LEVL('OUT LEVEL'), null],
  },
  {
    id: 'SDS', name: 'SUPER DISTORTION',
    variations: [['SDS1', 'SUPER DISTORTION 1'], ['SDS2', 'SUPER DISTORTION 2'], ['SOD1', 'SUPER OVERDRIVE 1'], ['SOD2', 'SUPER OVERDRIVE 2']],
    params: [DRIV(), LEVL('EFFECT LEVEL'), list('MODE', 'OUTPUT MODE', ['AMP1', 'AMP2', 'LINE']), null, null, null],
  },
  {
    id: 'HD2', name: 'HARD DISTORTION II', variations: [['HD2 ', 'HARD DISTORTION 2'], ['TOD2', 'TUBE OVERDRIVE 2']],
    params: [DRIV(), LEVL('EFFECT LEVEL'), null, null, null, null],
  },
  {
    id: 'EQ3B', name: 'NEW 3 BAND EQ', variations: [['3BEQ', 'NEW 3 BAND EQUALIZER']],
    params: [GAIN('BASS', 'BASS GAIN'), MIDFC('M-Fc', 'MID FREQUENCY'), num('M-Q', 'MID Q', 2, 5), GAIN('MID', 'MID GAIN'), GAIN('TRBL', 'TREBLE GAIN'), num('TRIM', 'INPUT TRIM', 0, 100)],
  },
  {
    id: 'MTC', name: 'MULTI-TAP CHORUS', variations: [['MTC1', 'MULTI-TAP CHORUS 1'], ['MTC2', 'MULTI-TAP CHORUS 2']],
    params: [SPD(), DPTH(), num('FAT', 'FAT MODE', 0, 3), FBAK(), num('TIME', 'DELAY TIME MODE', 1, 4), EBAL()],
  },
  {
    id: 'MTCT', name: 'MULTI-TAP CHORUS TAPS', variations: [['>>  ', 'TAPS BLOCK']], subBlock: true,
    params: [1, 2, 3, 4, 5].map((n) => list(`TAP${n}`, `TAP ${n} PAN`, ['OFF', 'L', 'R', 'L+R'])),
  },
  {
    id: 'REV2', name: 'REVERB II', variations: [['RM 3', 'ROOM 3'], ['HL 3', 'HALL 3'], ['PL 3', 'PLATE 3']],
    params: [num('RevT', 'REVERB TIME', 0.1, 5.0, 0.1, 's'), num('DAMP', 'HIGH DAMP', 0, 80, 1, '%'), PREDLY(200), num('RevD', 'REVERB DELAY', 0, 200, 1, 'ms'), num('E/RB', 'E/R-REV BALANCE', 0, 100, 1, '%'), EBAL()],
  },
  {
    id: 'REV2C', name: 'REVERB II COLOR', variations: [['>>  ', 'COLOR BLOCK']], subBlock: true,
    params: [num('EAmb', 'E/R AMBIENCE', 0, 100, 1, '%'), num('RAmb', 'REVERB AMBIENCE', 0, 100, 1, '%'), GAIN('L.EQ', 'LOW EQ'), GAIN('H.EQ', 'HIGH EQ'), null, null],
  },
  {
    id: 'DRV', name: 'DRIVER', variations: [['DRV1', 'DRIVER 1'], ['DRV2', 'DRIVER 2'], ['DRV3', 'DRIVER 3'], ['DRV4', 'DRIVER 4']],
    params: [DRIV(), LEVL(), null, null, null, null],
  },
  {
    id: 'RSP2', name: 'ROTARY SPEAKER II', variations: [['RSP2', 'ROTARY SPEAKER 2']],
    params: [list('SPD', 'SPEED CHANGE', ['LOW', 'HIGH']), num('Lspd', 'LOW SPEED', -5, 5), num('Hspd', 'HIGH SPEED', -5, 5), num('RATO', 'SPEED RATIO', -3, 3), num('WEIT', 'WEIGHT', 1, 3), null],
  },
  {
    id: 'RSP2C', name: 'ROTARY SPEAKER II COLOR', variations: [['COLR', 'COLOR BLOCK']], subBlock: true,
    params: [num('TONE', 'UPPER TONE', 1, 10), list('AMB', 'AMBIENCE', ['MONO', 'ST0', 'ST1', 'ST2', 'ST3', 'ST4']), num('BAL', 'BALANCE', 0, 100), null, null, null],
  },
  {
    id: 'MOD2', name: 'MODULATION II',
    variations: [['CHO3', 'STEREO CHORUS 3'], ['CHO4', 'STEREO CHORUS 4'], ['FLN3', 'STEREO FLANGER 3'], ['FLN4', 'STEREO FLANGER 4']],
    params: [SPD(), num('DPTH', 'DEPTH', -100, 100), FBAK(), modIIDelay('EDLY', 'EFFECT DELAY TIME'), modIIDelay('DDLY', 'DIRECT DELAY TIME'), EBAL()],
  },
  {
    id: 'LIML', name: 'STEREO COMP/LIMITER L', variations: [['LIML', 'COMP/LIMITER LEFT']],
    params: [num('THR', 'THRESHOLD', 0, 99), num('RATO', 'RATIO', 0, 100), num('ATCK', 'ATTACK', 0, 100), num('REL', 'RELEASE', 0, 100), list('MODE', 'MODE', ['DUAL', 'LNK1', 'LNK2']), LEVL('OUTPUT LEVEL')],
  },
  {
    id: 'LIMR', name: 'STEREO COMP/LIMITER R', variations: [['LIMR', 'COMP/LIMITER RIGHT']],
    params: [num('THR', 'THRESHOLD', 0, 99), num('RATO', 'RATIO', 0, 100), num('ATCK', 'ATTACK', 0, 100), num('REL', 'RELEASE', 0, 100), LEVL('OUTPUT LEVEL'), null],
  },
  {
    id: 'SPT', name: 'STEREO PITCH SHIFTER/DELAY', variations: [['SPT1', 'STEREO PITCH 1'], ['SPT2', 'STEREO PITCH 2']],
    params: [num('DT-L', 'DELAY TIME LEFT', 0, 400, 2, 'ms'), num('FB-L', 'FEEDBACK LEFT', 0, 99), num('DT-R', 'DELAY TIME RIGHT', 0, 400, 2, 'ms'), num('FB-R', 'FEEDBACK RIGHT', 0, 99), num('PTCH', 'PITCH', -100, 100, 1, 'cent'), EBAL()],
  },
  {
    id: 'SREV', name: 'SPACIAL REVERB',
    variations: [['SRM1', 'SPACIAL ROOM 1'], ['SRM2', 'SPACIAL ROOM 2'], ['SHL1', 'SPACIAL HALL 1'], ['SHL2', 'SPACIAL HALL 2'], ['SPL1', 'SPACIAL PLATE 1'], ['SPL2', 'SPACIAL PLATE 2']],
    params: [num('RevT', 'REVERB TIME', 0.1, 5.0, 0.1, 's'), DAMP(80), PREDLY(100), num('ICFM', 'INPUT CROSS FADE', 0, 100), num('OCFM', 'OUTPUT CROSS FADE', 0, 100), EBAL()],
  },
];

function panParam(label: string, name: string): ParamDef {
  const values: string[] = [];
  for (let v = -50; v <= 50; v++) values.push(v < 0 ? `L${-v}` : v > 0 ? `R${v}` : 'C');
  return { label, name, unit: '', values, zero: 50 };
}

export const GROUPS: Record<string, EffectGroup> = Object.fromEntries(G.map((g) => [g.id, g]));

// Normalise every group to exactly 6 editor slots.
for (const g of G) {
  while (g.params.length < 6) g.params.push(null);
  g.params = g.params.map((p) => p ?? null);
}

// ---------------------------------------------------------------------------
// The 97 factory chains: effect blocks on editors A..F, in signal order.

export const CHAINS: string[][] = [
  /* 01 */ ['COMP', 'DIST', 'XCIT', 'DLY', 'MOD', 'REV'],
  /* 02 */ ['COMP', 'EQ3', 'XCIT', 'DLY', 'MOD', 'REV'],
  /* 03 */ ['WAH', 'DIST', 'EQ3', 'XCIT', 'MDLY', 'REV'],
  /* 04 */ ['COMP', 'DIST', 'XCIT', 'DLY', 'APAN', 'REV'],
  /* 05 */ ['COMP', 'DIST', 'XCIT', 'DLY', 'PHA', 'REV'],
  /* 06 */ ['COMP', 'XCIT', 'SDLY', 'ENS', 'REV'],
  /* 07 */ ['DIST', 'XCIT', 'SPSM', 'DLY', 'MOD', 'REV'],
  /* 08 */ ['DIST', 'EQ3', 'WAH', 'SPSM', 'MDLY', 'REV'],
  /* 09 */ ['COMP', 'DIST', 'XCIT', 'WAH', 'MDLY', 'REV'],
  /* 10 */ ['XCIT', 'PTCH', 'MDLY', 'APAN', 'SDLY', 'REV'],
  /* 11 */ ['PEQ', 'COMP', 'XCIT', 'GATE', 'PTCH', 'REV'],
  /* 12 */ ['PEQ', 'COMP', 'EQ3', 'DLY', 'REV', 'GATE'],
  /* 13 */ ['DIST', 'XCIT', 'MDLY', 'PTCH', 'SDLY', 'SDLY'],
  /* 14 */ ['COMP', 'XCIT', 'PTCH', 'EREF', 'REV'],
  /* 15 */ ['DIST', 'DLY', 'XCIT', 'REV', 'RSP'],
  /* 16 */ ['COMP', 'EQ3', 'XCIT', 'SDLY', 'ENS', 'REV'],
  /* 17 */ ['EQ3', 'PTCH', 'XCIT', 'DLY', 'MOD', 'REV'],
  /* 18 */ ['COMP', 'PTCH', 'EQ3', 'XCIT', 'DLY', 'REV'],
  /* 19 */ ['COMP', 'EQ3', 'DLY', 'REV', 'PTCH', 'PPAN'],
  /* 20 */ ['COMP', 'PTCH', 'XCIT', 'REV', 'RSP'],
  /* 21 */ ['DIST', 'WAH', 'XCIT', 'DLY', 'MOD', 'REV'],
  /* 22 */ ['HDST', 'XCIT', 'DLY', 'MOD', 'REV'],
  /* 23 */ ['HDST', 'LDLY', 'EREF', 'REV'],
  /* 24 */ ['HDST', 'XCIT', 'MOD', 'SDLY', 'REV'],
  /* 25 */ ['COMP', 'XCIT', 'SPH', 'EQ3', 'MTD', 'REV'],
  /* 26 */ ['HDST', 'XCIT', 'SPH', 'MTD', 'SDLY'],
  /* 27 */ ['HDST', 'XCIT', 'COMP', 'SDLY', 'REV'],
  /* 28 */ ['HDST', 'LDLY', 'PTCH', 'REV'],
  /* 29 */ ['HDST', 'XCIT', 'WAH', 'DLY', 'MOD', 'SDLY'],
  /* 30 */ ['COMP', 'PTCH', 'XCIT', 'MTD', 'REV'],
  /* 31 */ ['XCIT', 'PTCH', 'TDLY', 'REV2', 'REV2C'],
  /* 32 */ ['EQ3', 'PTCH', 'SDLY', 'REV2', 'REV2C'],
  /* 33 */ ['COMP', 'XCIT', 'TDLY', 'MOD', 'REV2', 'REV2C'],
  /* 34 */ ['REV', 'DLY', 'MOD', 'REV2', 'REV2C'],
  /* 35 */ ['COMP', 'XCIT', 'REV', 'DMOD', 'MOD', 'SDLY'],
  /* 36 */ ['REV', 'DMOD', 'SDLY', 'XCIT', 'REV', 'MIX'],
  /* 37 */ ['EREF', 'SDLY', 'MIX', 'REV2', 'REV2C'],
  /* 38 */ ['XCIT', 'PTCH', 'PTCH', 'SDLY', 'MOD', 'MIX'],
  /* 39 */ ['EQ3', 'SDLY', 'MIX', 'REV2', 'REV2C'],
  /* 40 */ ['GAT2', 'REV', 'REV'],
  /* 41 */ ['COMP', 'EQ3', 'XCIT', 'BCH', 'SDLY'],
  /* 42 */ ['DLY', 'BCH', 'EREF', 'REV'],
  /* 43 */ ['XCIT', 'BCH', 'SDLY', 'REV'],
  /* 44 */ ['COMP', 'EQ3', 'XCIT', 'MTD', 'REV'],
  /* 45 */ ['XCIT', 'PTCH', 'MTD', 'ENS', 'REV'],
  /* 46 */ ['COMP', 'PTCH', 'XCIT', 'MTD', 'MOD', 'REV'],
  /* 47 */ ['PEQ', 'LIM', 'EQ3', 'XCIT', 'EREF', 'REV'],
  /* 48 */ ['PEQ', 'LIM', 'EQ3', 'DLY', 'ENS', 'REV'],
  /* 49 */ ['EQ3', 'DLY', 'MOD', 'SXIT', 'SDLY', 'REV'],
  /* 50 */ ['XCIT', 'PTCH', 'DLY', 'SDLY', 'REV', 'MOD'],
  /* 51 */ ['CLM', 'HD2', 'EQ3B', 'DLY', 'REV'],
  /* 52 */ ['CLM', 'SDS', 'EQ3B', 'XCIT', 'DLY', 'ENS'],
  /* 53 */ ['CLM', 'SDS', 'EQ3B', 'XCIT', 'DLY', 'EREF'],
  /* 54 */ ['CLM', 'SDS', 'EQ3B', 'SPSM', 'DLY', 'MOD'],
  /* 55 */ ['CLM', 'SDS', 'EQ3B', 'DLY', 'MTC', 'MTCT'],
  /* 56 */ ['CLM', 'SDS', 'HD2', 'EQ3B', 'SDLY'],
  /* 57 */ ['HD2', 'EQ3B', 'SPSM', 'MDLY', 'REV'],
  /* 58 */ ['HD2', 'EQ3B', 'MDLY', 'REV', 'MIX'],
  /* 59 */ ['CLM', 'EQ3B', 'SDLY', 'MTC', 'MTCT', 'MIX'],
  /* 60 */ ['CLM', 'EQ3B', 'XCIT', 'MTC', 'MTCT', 'REV'],
  /* 61 */ ['MOD', 'MTD', 'MIX', 'REV2', 'REV2C'],
  /* 62 */ ['EQ3', 'DLY', 'MOD', 'SDLY', 'REV2', 'REV2C'],
  /* 63 */ ['XCIT', 'DLY', 'ENS', 'REV2', 'REV2C'],
  /* 64 */ ['EQ3', 'XCIT', 'SDLY', 'MOD', 'MOD', 'MIX'],
  /* 65 */ ['COMP', 'PEQ', 'XCIT', 'MOD', 'REV2', 'REV2C'],
  /* 66 */ ['EQ3', 'REV', 'XCIT', 'SDLY', 'EREF', 'MIX'],
  /* 67 */ ['EQ3', 'MDLY', 'XCIT', 'MTD', 'REV', 'MIX'],
  /* 68 */ ['EQ3', 'MDLY', 'MDLY', 'XCIT', 'REV', 'MIX'],
  /* 69 */ ['DRV', 'RSP2', 'RSP2C'],
  /* 70 */ ['EQ3', 'XCIT', 'MDLY', 'APAN', 'REV2', 'REV2C'],
  /* 71 */ ['PPAN', 'COMP', 'COMP', 'EQ3B', 'MDLY', 'REV'],
  /* 72 */ ['PPAN', 'COMP', 'COMP', 'MDLY', 'MDLY', 'REV'],
  /* 73 */ ['PPAN', 'COMP', 'COMP', 'MDLY', 'XCIT', 'REV'],
  /* 74 */ ['PPAN', 'COMP', 'MOD', 'EQ3B', 'DLY', 'REV'],
  /* 75 */ ['COMP', 'XCIT', 'REV', 'MOD', 'REV'],
  /* 76 */ ['HDST', 'EQ3B', 'MOD', 'REV'],
  /* 77 */ ['XCIT', 'MDLY', 'REV', 'CLM', 'MDLY', 'REV'],
  /* 78 */ ['XCIT', 'MDLY', 'REV', 'DLY', 'MOD', 'REV'],
  /* 79 */ ['DLY', 'XCIT', 'REV', 'DLY', 'PTCH', 'REV'],
  /* 80 */ ['XCIT', 'MDLY', 'REV', 'EREF', 'REV'],
  /* 81 */ ['XCIT', 'MDLY', 'REV', 'REV', 'REV'],
  /* 82 */ ['SXIT', 'SPT', 'MTD', 'MTD', 'MIX'],
  /* 83 */ ['SXIT', 'SPT', 'MOD2', 'SDLY', 'REV'],
  /* 84 */ ['SXIT', 'MOD2', 'MOD2', 'SDLY', 'REV'],
  /* 85 */ ['SXIT', 'DLY', 'DLY', 'MOD2', 'REV', 'MIX'],
  /* 86 */ ['SXIT', 'EQ3', 'EQ3', 'SDLY', 'SREV'],
  /* 87 */ ['SXIT', 'EQ3', 'EQ3', 'SDLY', 'REV2', 'REV2C'],
  /* 88 */ ['MOD2', 'MOD2', 'MIX', 'SREV'],
  /* 89 */ ['MOD2', 'MOD2', 'MIX', 'REV2', 'REV2C'],
  /* 90 */ ['SXIT', 'MOD2', 'SDLY', 'SREV'],
  /* 91 */ ['SXIT', 'MOD2', 'SDLY', 'REV2', 'REV2C'],
  /* 92 */ ['SXIT', 'SPT', 'SREV'],
  /* 93 */ ['SXIT', 'SPT', 'REV2', 'REV2C'],
  /* 94 */ ['SXIT', 'ENS', 'SREV'],
  /* 95 */ ['SXIT', 'ENS', 'REV2', 'REV2C'],
  /* 96 */ ['LIML', 'LIMR', 'SREV'],
  /* 97 */ ['LIML', 'LIMR', 'REV2', 'REV2C'],
];

export const CHAIN_COUNT = CHAINS.length;

/** Effect groups on editors A..F for a chain number (1-97). Unknown/card chains -> []. */
export function chainBlocks(chain: number): EffectGroup[] {
  const c = CHAINS[chain - 1];
  return c ? c.map((id) => GROUPS[id]) : [];
}

// ---------------------------------------------------------------------------
// Raw byte <-> display value

/** Index into def.values for a raw byte, or -1 when out of range. */
export function rawToIndex(def: ParamDef, raw: number): number {
  const signed = def.zero !== 0 ? ((raw & 0xff) << 24) >> 24 : raw & 0xff;
  const idx = signed + def.zero;
  return idx >= 0 && idx < def.values.length ? idx : -1;
}

export function indexToRaw(def: ParamDef, idx: number): number {
  const i = Math.max(0, Math.min(def.values.length - 1, idx));
  return (i - def.zero) & 0xff;
}

export function formatValue(def: ParamDef, raw: number): string {
  const i = rawToIndex(def, raw);
  return i < 0 ? `?${(raw & 0xff).toString(16).padStart(2, '0').toUpperCase()}` : def.values[i];
}

/** Clamp a raw byte to the nearest valid value. */
export function stepRaw(def: ParamDef, raw: number, delta: number): number {
  let i = rawToIndex(def, raw);
  if (i < 0) i = delta > 0 ? -1 : def.values.length;
  return indexToRaw(def, i + delta);
}
