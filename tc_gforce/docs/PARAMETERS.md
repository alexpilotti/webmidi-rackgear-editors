# G-Force preset parameters

The checklist for decoding the 592 parameter bytes of a preset record (see
[SYSEX_FORMAT.md](SYSEX_FORMAT.md)). It lists every block, sub-algorithm and
parameter from the owner's manual ("The Blocks", printed pp.33–51; the
Effects, Modifier and Recall chapters for the rest).

- **Manual name** is the manual's wording. **LCD name** is what the unit
  shows, filled in from photos of its Edit pages; the editor's UI uses it.
  Where they differ, the LCD wins (example: the manual's "Room shape" is
  `ROOM TYPE` on the unit).
- **Range / values** come from the manual where it states them; `?` means it
  doesn't, and a photo or a dump has to tell.
- **Offset** is the byte offset in the 614-byte record, filled in as each one
  is found, with the evidence in the last column. Only DECAY TIME is known so
  far.

## How the offsets are found

1. **Structure dump**: ROM 180–225 (one block per preset, plus Empty
   Routing) stored into User 1–46, dumped as
   `samples/gforce-rom180-225.syx`. Bytes that differ from Empty Routing show
   where each block lives.
2. **Photos** of each of those presets' Edit pages (and MIX page) in
   `screens/`, named by ROM number (`180-1.jpg`, `180-mix.jpg` …). They give
   the LCD names and the true values to match against the bytes.
3. **Matching** values across presets of the same block gives offset, width
   and scaling. Whatever stays ambiguous gets a one-change dump pair.
4. Each confirmed parameter goes into `PARAMS` in `src/model.ts` with a test.
5. Values of the lookup tables (room types, colors, ratios, sub-algorithm
   names, step tables) not yet seen on the unit are listed, with presets that
   use them, in [PHOTO_CHECKLIST.md](PHOTO_CHECKLIST.md).

**Already found from all 225 ROM presets** (`samples/gforce-rom-*.syx`; see
"Record map from ROM 1–225" in
[SYSEX_FORMAT.md](SYSEX_FORMAT.md)):
- the routing grid at `0x28` and the block IDs
- where each block's data starts, with its sub-algorithm byte
- the likely Noise Gate (`0x48`) and modifier-link (`0x76`) areas

So step 1 only has to locate the parameters inside each block. Bytes of a
block that the preset doesn't route can differ between copies of the same
preset, so only presets that route the block can be compared with Empty
Routing.

### ROM 180–225 → User 1–46

| User | ROM | Name | Block / sub-algorithm (manual) |
|---|---|---|---|
| 1 | 180 | Bright Room | Reverb |
| 2 | 181 | Church | Reverb |
| 3 | 182 | Grand Hall | Reverb |
| 4 | 183 | Cathedral | Reverb |
| 5 | 184 | Spring Reverb | Reverb |
| 6 | 185 | Slow Reverb | Reverb |
| 7 | 186 | Chorus Straight | Chorus |
| 8 | 187 | Chorus Straight Fast | Chorus |
| 9 | 188 | Flanger Straight | Flanger |
| 10 | 189 | Flanger Straight Fast | Flanger |
| 11 | 190 | Vibrato | Chorus (100 % mix) |
| 12 | 191 | Classic Tremolo | Pan+Trem: Tremolo |
| 13 | 192 | Stereo Tremolo | Pan+Trem: Tremolo |
| 14 | 193 | Square Tremolo | Pan+Trem: Tremolo |
| 15 | 194 | Stereo Pan Tap Tempo | Pan+Trem: Panner |
| 16 | 195 | Surround Panner | Pan+Trem: Surround Panner |
| 17 | 196 | Straight Delay | Delay |
| 18 | 197 | Two Delays | Delay (Dual?) |
| 19 | 198 | Tape Delay | Delay |
| 20 | 199 | Triplet Ping-Pong | Delay |
| 21 | 200 | 4 Tap Delay Pedal | Delay: Quad Tap |
| 22 | 201 | Dynamic Delay | Delay |
| 23 | 202 | Soft Compressor | Compressor |
| 24 | 203 | Hard Compressor | Compressor |
| 25 | 204 | Limiter | Compressor |
| 26 | 205 | Dual Detune Pedal | Pitch: Detune |
| 27 | 206 | Whammy Down | Pitch |
| 28 | 207 | Whammy Up | Pitch |
| 29 | 208 | G-major Pitch Pedal | Pitch: Intelligent |
| 30 | 209 | D-minor 5 and 3 | Pitch: Intelligent |
| 31 | 210 | Octave Dubbing | Pitch |
| 32 | 211 | Phase Off | Filters: Phaser |
| 33 | 212 | Phaser Pedal Speed | Filters: Phaser |
| 34 | 213 | Clean Wah Pedal | Filters: Wah Wah |
| 35 | 214 | Clean Touch-Wah | Filters: Wah Wah |
| 36 | 215 | Clean Auto Wah | Filters: Wah Wah |
| 37 | 216 | Formant Touch | Filters: Formant |
| 38 | 217 | Formant Pedal | Filters: Formant |
| 39 | 218 | Resonance Pedal | Filters: Resonance |
| 40 | 219 | Auto Resonance | Filters: Resonance |
| 41 | 220 | Drive 1 | Drive |
| 42 | 221 | Drive 2 | Drive |
| 43 | 222 | Drive 3 | Drive |
| 44 | 223 | Noise Gate Slow | Gate (In section) |
| 45 | 224 | Noise Gate Slow | Gate (In section) |
| 46 | 225 | Empty Routing | — (reference) |

Not covered by these presets: Parametric EQ, Custom scale, the routing grid
with several blocks, the modifier matrix and the modifiers. Those need a few
multi-block presets later.

## Every block

The unit's Edit page shows these under **GLOBAL**, after the block's own
**GENERAL** parameters (photos of ROM 7 and 203). In the record they sit at
the same place in every block, right after its sub-algorithm byte (+5 is 0
in every ROM preset). The editor shows them for all eight blocks.

Common to the eight effect blocks (manual p.33): **Mix**, **In Level**, **Out
Level** (not in every sub-algorithm), and **Mute mode** as the last
parameter: Mix 0% · FX Out · Output · FX In · Input (FX In and Input only in
Delay, Reverb and Pitch). Every block also has a bypass state and a place in
the routing grid (4 × 8). The Tempo parameters take Ignored or a note value
(1/1 … 1/32, straight, dotted or triplet).

| Parameter | Range / values | LCD name | Offset | Evidence |
|---|---|---|---|---|
| Mix | 0–100 % | MIX LEVEL | sub-algorithm byte + 1 | ROM 7 photo: Filters 35 % at `0x17B`; ROM 1 photo: Reverb 28 % at `0x247`. 0–100 in every block of every ROM preset. Not on the Compressor page |
| In Level | dB, signed (ROM −34 … 0) | IN LEVEL | sub-algorithm byte + 2 | ROM 203 photo: Compressor 0 dB at `0x168`; ROM 7 photo: Filters 0 dB |
| Out Level | dB, signed (ROM −22 … 0) | OUT LEVEL | sub-algorithm byte + 3 | ROM 203 photo: Compressor −5 dB at `0x169`. Always 0 in Pan+Trem and Chorus, left out there |
| Mute mode | 0 Mix 0% · 1 FX Out · 2 Output · 3 FX In · 4 Input | MUTE MODE | sub-algorithm byte + 4 | ROM 1 photo: Reverb FX IN = 3; its list shows the five modes in this order. 3–4 appear only in Delay, Pitch and Reverb |
| Bypass | on / off | | | |
| Routing position | column 1–8, row 1–4 | | `0x28 + 4·column + row` holds the block ID | ROM 1–225 vs the preset list, photos |

## In section: Noise Gate (GATE key)

| Parameter | Range / values | LCD name | Offset | Evidence |
|---|---|---|---|---|
| Mode | Hard · Soft | MODE | `0x48` (0 Soft, 1 Hard) | edit-parameters-1: HARD = 1 |
| Threshold | dB, signed (ROM −60 … −14) | THRESHOLD | `0x49` | edit-parameters-1: −29 dB |
| Max. Damping | dB (0 = off; ROM 0 … 50) | MAX DAMPING | `0x4A` | edit-parameters-1: 32 dB |
| Release rate | dB/s (ROM 3 … 100) | REL.RATE | `0x4B` | edit-parameters-1: 101 dB/s; 223 Slow 15 vs 224 Fast 100 Noise Gate |
| Level | dB, signed (ROM −9 … 0) | LEVEL | `0x4D` | edit-parameters-1: −5 dB. `0x4C` (0/1) didn't change and is still unknown |

## Compressor (COMPRESS key)

Sub-algorithms: Simple, Advanced.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Threshold | dB, signed (ROM presets −30 … 0) | both | THRESHOLD | `0x172` | ROM 203 photo: −17 dB = `EF`; 202–204: −6, −17, −20 |
| Ratio | step 0–15 | both | RATIO | `0x173` | Photos: 1.12:1 = 1 (ROM 114), 1.40:1 = 3 (ROM 139), 1.60:1 = 4 (ROM 141), 1.80:1 = 5 (ROM 101), 3.2:1 = 8 (ROM 92), 4.0:1 = 9 (ROM 11), 5.6:1 = 10 (edit-parameters-1), 16:1 = 12 (ROM 203). Also 0 = OFF (card 1-59), 8.0:1 = 11 (card 1-43), 64:1 = 14 (card 1-73). *Guess* for the other steps: OFF, 1.12, 1.25, 1.40, 1.60, 1.80, 2.0, 2.5, 3.2, 4.0, 5.6, 8.0, 16, 32, 64, ∞ (204 Limiter = 15) |
| Knee Mode | Soft · Hard | Advanced | KNEE MODE | `0x175` (0 Soft, 1 Hard) | ROM 203 photo: HARD = 1; 202 Soft Compressor = 0. Not on the Simple page (ROM 11 photo); 0 in every Simple preset |
| Release | dB/s (ROM presets 0 … 100) | Advanced | RELEASE | `0x174` | ROM 203 photo: 18 dB/s = 18 |
| In Level | dB, signed (ROM presets −8 … 0) | both | IN LEVEL | `0x168` | ROM 203 photo: 0 dB |
| Out Level | dB, signed (ROM presets −10 … 0) | both | OUT LEVEL | `0x169` | ROM 203 photo: −5 dB = `FB` |

The Edit page groups them as GENERAL (Threshold, Ratio, Knee Mode, Release)
and GLOBAL (In Level, Out Level); it shows no Mix. `0x167` (100 in 203, 47–100
across the ROM) sits where other blocks keep Mix and is still unexplained.

## Filters (FILTERS key)

Sub-algorithms: Parametric EQ, Wah Wah, Formant, Resonance, Phaser.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Freq 1–5 | Hz ? | Parametric EQ | | | |
| Slope/BW 1–5 | ? (1, 5 shelving slope; 2–4 bandwidth) | Parametric EQ | | | |
| Gain 1–5 | ±12 dB | Parametric EQ | | | |
| Freq | 0–1 ? (LCD: `0.45`) | Wah Wah | FREQ | `0x187` (×100) | ROM 7 photo: 0.45 = 45 |
| Instrument mode | Guitar · Bass | Wah Wah | INSTR.MODE | | ROM 7 photo: GUITAR |
| Start | vowel 0–9 | Formant | START (VOWEL SWEEP) | `0x186` | card 1-83 photo: BUT = 4; card 1-78: HEAT = 0, HAD = 3, ALL = 6; ROM 157: FATHER = 5, BOOT = 7, BIRD = 9; ROM 176: HEAD = 2 (Start/Thru/End). Order: HEAT, HIT, HEAD, HAD, BUT, FATHER, ALL, BOOT, FOOT, BIRD. The manual doesn't list the vowels; the page draws ten on a circle |
| Thru | vowel 0–9 | Formant | THRU | `0x187` | card 1-83 photo: HIT = 1 |
| End | vowel 0–9 | Formant | END | `0x188` | card 1-83 photo: FOOT = 8 |
| Resonance | % | Formant | RESONANCE | `0x18A` | card 1-83 photo: 100 %. Link ID 2415 |
| Age/Sex | % | Formant | AGE/SEX | `0x189` (before Resonance, unlike the page) | card 1-83 photo: 65 %. ROMs 157 and 176 link 2413 and 2414 and show ■ on AGE/SEX. Link IDs: Age/Sex 2413, Sweep 2414 (cards 2-97, 3-40 link only it) |
| Sweep | ? | Formant | | | |
| Order | 2nd (12 dB/oct) · 4th (24 dB/oct) | Resonance | TYPE (GENERAL) | `0x186` | card 2-1 photo: 2ND ORDER = 0; 0/1 in every Resonance preset |
| Locut Freq | 0–100: 20 Hz × 250^(n/100) | Resonance | LOCUT FR. | `0x187` | card 1-97 (no links): 88.8 Hz = 27; card 2-2: 182 Hz = 40; ROM 173: 492 Hz = 58; card 2-1: 20.0 Hz = 0. Link ID 2201 |
| Lo Resonance | % | Resonance | LO RESON. | `0x188` | card 1-97 photo: 45 %; card 2-1: 100 % |
| Hicut Freq | 0–100: 150 Hz × 100^(n/100) | Resonance | HICUT FR. | `0x189` | card 1-97: 5.20 kHz = 77; card 2-2: 3.77 kHz = 70; ROM 173: 9.04 kHz = 89; card 2-1: 15.0 kHz = 100. Link ID 2203 ("Fil Res hi cut freq" in the G-Card manual) |
| Hi Resonance | % | Resonance | HI RESON. | `0x18A` | ROM 173 photo: 70 % |
| Speed | Hz, the LFO step table | Phaser | SPEED | `0x186` | card 1-76 photo: 8.06 Hz = 88 (the 0.49 Hz under the bar is what TEMPO gives, not stored) |
| Tempo | Ignored · note values | Phaser | TEMPO | `0x187` | card 1-76 photo: 1 = "1" |
| Depth | % | Phaser | DEPTH | `0x188` | card 1-76 photo: 100 % |
| Order | 4th · 8th · 12th | Phaser | ORDER (PHASER) | `0x189` | card 1-76 photo: 4TH = 0; ROM 8: 8TH = 1; ROM 66: 12TH = 2. ROM 66 also links SPEED (2500) and DEPTH (2502), shown with ■ |
| Feedback Level | % ? (can be negative) | Phaser | | | |
| Instrument Mode | Guitar · Bass | Phaser | | | |

## Pan+Trem (PAN+TREM key)

Sub-algorithms: Tremolo (simple), Tremolo Advanced, Panner (simple),
Surround Panner. Card 1-76 shows 1 as **ADV. TREMOLO**, card 1-89 shows 3 as **SURROUND PAN.** (no Depth: its LFO bytes start one earlier). The unit names 2 **SIMPLE PANNER** (photo of ROM 146: title
PAN+TREM - SIMPLE PANNER). On that page SPEED is `0x1A8` (step 44 =
0.640 Hz; possibly the same LFO speed table as the Chorus, 22 = 0.178 Hz,
23 = 0.188 Hz) and TEMPO `0x1A9` (0 = IGNORED), then GLOBAL.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Speed | Hz, the LFO step table | all | SPEED | `0x1A8` | ROM 146: 0.640 Hz = 44; card 1-43: 4.80 Hz = 79; card 1-76 (Adv.): 5.12 Hz = 80 |
| Tempo | Ignored · note values | all | TEMPO | `0x1A9` | ROM 146 and card 1-76: IGNORED = 0; card 1-43: 1/8 = 5 |
| Depth | % | Tremolo, Tremolo Adv. | DEPTH | `0x1AA` | card 1-43: 70 %; card 1-76: 100 % |
| Curve | Square · Triangle · Sine | Tremolo Adv., Surround | CURVE (LFO) | `0x1AB` (Adv. Tremolo), `0x1AA` (Surround) | card 1-76 photo (Adv.): SQUARE = 0; card 1-89 (Surround): SINE = 2; the Chorus's TRIANGLE = 1 |
| Pulsewidth | % | Tremolo Adv., Surround | PULSE WIDTH (LFO) | `0x1AC` (Adv., inferred), `0x1AB` (Surround) | card 1-89 photo (Surround): 50 %; card 1-76 has 50 at `0x1AC` |
| LFO Phase | degrees ? | Tremolo Adv., Surround | | | |
| Pan Center | ? | Panner | | | |
| Width | % ? (> 100 % pans past stereo) | Surround | | | |

## Pitch (PITCH key)

Sub-algorithms: Intelligent, Custom scale (part of Intelligent), Fixed 1 & 2
Voice (±12 semitones), 2 Voice 2 Octave (±24 semitones), Detune (±50 cents).
Sub-algorithm byte 2 shows **FIXED 2 VOICE** (card 1-76), not 2 Voice 2 Octave; byte 0
shows **INTELLIGENT 2 VOICE** (card 2-1).

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Key | C … B | Intelligent | KEY | `0x1BE` | card 2-1 photo: C = 0; card 1-36 "E Dorian": 4 |
| Scale | Ionian Major … Custom ? | Intelligent | SCALE | `0x1BF` | card 2-1 photo: IONIAN MAJ. = 0; card 1-36 "E Dorian": 1 |
| Mode | Stepped · Smooth | Intelligent | MODE | `0x1C0` | card 2-1 photo: STEPPING = 0; 0/1 in the presets |
| Voice 1, 2 | scale step, ±1 octave | Intelligent | VOICE1/VOICE2 (PITCH) | `0x1C3`/`0x1C4`, signed | card 2-1 photo: VOICE1 8 = 7 (an interval: 7 steps up is the octave) |
| Detune Voice 1, 2 | cents ? | Intelligent | | | |
| Notes used | 4–8 | Custom scale | | | |
| Tonic | C … B | Custom scale | | | |
| Note 2–8 | notes within an octave | Custom scale | | | |
| Voice 1, 2 | ±12 semitones | Fixed | | | |
| Voice 1, 2 | ±24 semitones | 2 Voice 2 Octave | | | |
| Voice 1, 2 | ±50 cents | Detune | | | |
| Delay 1, 2 | 0–400 ms | all | | | |
| Pan Position 1, 2 | L … R ? | all | | | |
| Level 1, 2 | dB ? | Intelligent, Fixed, Detune | | | |
| Feedback 1, 2 | % ? | Fixed, 2 Voice 2 Octave | | | |
| Pitch (Fixed 1 Voice) | ±1200 cents | Fixed 1 Voice | PITCH (VOICE SETTINGS) | `0x1C6`, 16-bit signed, high byte first | ROM 11 photo: −1200 CENT = `FB 50`; Fixed 1 Voice presets use ±1200 |
| Voice 1, 2 (Fixed 2 Voice) | ±1200 cents | Fixed 2 Voice | VOICE1/VOICE2 (PITCH) | `0x1C6`/`0x1C8`, 16-bit signed | card 1-76 photo: 1200 = `04 B0`, −1200 = `FB 50` |
| Delay 1, 2 (Fixed 2 Voice) | 0–400 ms | Fixed 2 Voice, Dual Detune | VOICE1/VOICE2 (DELAY) | `0x1CA`/`0x1CC`, 16-bit | card 1-76 photo: 400 ms = `01 90`; card 1-43 (Detune): 0 and 6 ms |

## Delay (DELAY key)

Sub-algorithms: Stereo, Dual, Dual Two Tap, One Tap, Quad Tap.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Time | 0–740 ms (manual) | Stereo | TIME | `0x1E2`, 16-bit | card 1-76 photo: 400 ms = `01 90`. Stereo keeps TEMPO `0x1E4` (ROM 196: 1/4 = 3), FEEDBACK `0x1E7`, LOCUT `0x1E8`, HICUT `0x1E9`, all on its DELAY page (card 1-76: IGNORED, 29 %, 10.0 Hz = 0, 16.0 kHz = 100) |
| Time 1, 2 | 0–740 ms | Dual | | | |
| Time 1, 2 (per line) | 0–1480 ms | Dual Two Tap | TIME 1/2 (DELAY LINE 1) | `0x1E4`–`0x1EB`, four 16-bit times | card 2-45 photo: 600 ms each; ROM 157: 200/300 (line 1), 500/600 (line 2), so line by line. Tempos `0x1EC`/`0x1ED` (line 1), `0x1EE`/`0x1EF` (line 2); FEEDBACK 1 `0x1F0` (line 1), `0x1F2` (line 2, ROM 157: 18 %) |
| Time | 0–1480 ms | One Tap | TIME | `0x1E2`, 16-bit, high byte first | ROM 3 photo: 310 ms = `01 36`; edit-parameters-1: 311 ms |
| Tap 1–4 | 0–1480 ms | Quad Tap | TAP 1–4 (TIME) | `0x1E2`/`0x1E4`/`0x1E6`/`0x1E8`, 16-bit | card 1-83 photo: 505, 375, 325, 225 ms. TEMPO TAP 1–4 is likely `0x1EA`–`0x1ED` (the One-tap's Tempo byte; presets use 0–9), not yet on a photo |
| Tempo (1, 2, 1–4) | bytes 0–16: Ignored, 1, 1/2, 1/4, 1/8., 1/8, 1/16., 1/16, 1/32., 1/32, 1/32T, 1/2., 1/4., 1/2T, 1/4T, 1/8T, 1/16T (photos, edit-parameters-3, edit-parameters-4; the menu lists them in another order) | all | TEMPO | One-tap `0x1EA` | ROM 3 photo: IGNORED = 0; edit-parameters-1: 1 (shown as 1); card 2-40: 3 = 1/4 |
| Feedback | % (ROM 0 … 85) | Stereo, One Tap | FEEDBACK | `0x1EE` (One Tap) | ROM 3 photo: 24 %; edit-parameters-1: 25 % |
| Feedback 1→1, 2→2, 1→2, 2→1 | % ? (sum ≤ 100 %) | Dual | | | |
| Feedback 1, 2 / 1–4 | % ? (sum ≤ 100 %) | Dual Two Tap, Quad Tap | | | |
| Levels 1, 2 / 1–4 | dB ? | Dual, Dual Two Tap, Quad Tap | | | |
| Pan (Position) 1, 2 / 1–4 | L50 … 0 … R50, signed | Dual, Dual Two Tap, One Tap, Quad Tap | PAN | One-tap `0x1F6` | edit-parameters-1: R1 = 1; card 2-44: R9; card 2-89: ■0, modifier link ID 5416 |
| Lowcut (1, 2 / 1–4) | Hz, a step index | all | LOCUT | One-tap `0x1FA`, Stereo `0x1E8` | Photos: 10.0 Hz = 0 (ROM 75), 10.8 Hz = 1 (edit-parameters-1), 114 Hz = 33 (ROM 141). Table shared with Hicut: 10 Hz × 1600^(n/100), three significant digits; it reproduces all sixteen photographed steps (card 2-24: 63.2 Hz = 25, 4.24 kHz = 82; card 2-89: 178 Hz = 39, 6.13 kHz = 87; card 2-62: 85.0 Hz = 29, which the earlier 10^(0.03204 n) missed; card 2-40: 106 Hz = 32; card 2-44: 464 Hz = 52, Locut 16.0 kHz = 100; card 1-76: 16.0 kHz = 100; card 2-1: 3.16 kHz = 78; card 2-12: 298 Hz = 46, 3.66 kHz = 80) |
| Highcut (1, 2 / 1–4) | Hz, a step index | all | HICUT | One-tap `0x1FE`, Stereo `0x1E9` | edit-parameters-1 and ROM 75 photos: 14.9 kHz = 99; ROM 141: 4.56 kHz = 83. Same table as Locut |
| Line Level 1, 2 | % of In Level | Dual Two Tap | | | |

## Drive (DRIVE key)

| Parameter | Range / values | LCD name | Offset | Evidence |
|---|---|---|---|---|
| Drive | ? | | | |
| Brightness | % (100 % = flat) | | | |
| Body | ? | | | |
| Smasher | ? | | | |
| Out Drive | ? | | | |

## Chorus/Flanger (CHORUS key)

Sub-algorithms: Classic Chorus, Advanced Chorus, Classic Flanger, Advanced
Flanger.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Speed | OFF (-1), 0.050 … 19.2 Hz, 104 steps (0–103) | all | SPEED | Chorus `0x23A`, Pan+Trem `0x1A8`, Phaser `0x186` | The whole table read from a video of the Advanced Chorus SPEED; each step is about ×1.06 (a semitone). Photos match it at 0, 10, 14, 21–23, 33, 37, 40, 44, 49, 51, 62, 79, 80, 88. OFF (below 0.050) is FF (-1): edit-parameters-4 User 9 |
| Tempo | Ignored · note values | all | | | |
| Depth | % | all | DEPTH | Classic and Adv. Chorus `0x23C` | edit-parameters-1: 52 %; ROM 11 photo (Classic): 46 % |
| Delay | 0.1 ms steps | Advanced | DELAY | Adv. Chorus `0x242`, 16-bit, high byte first | edit-parameters-1: 11.4 ms = 114; card 1-83 photo: 45.0 ms = `01 C2`. Presets use 0.1 … 45.0 ms |
| Feedback | % (signed) | Flanger | FEEDBACK | Flangers `0x23D` | card 1-89 photo (Adv.): -23 % = `E9`; card 2-89 (Classic): 36 %. The Adv. Flanger also shares SPEED/TEMPO/DEPTH `0x23A`–`0x23C` (0.089 Hz = 10, 1/2, 40 %) |
| Golden Ratio | On · Off | Advanced | GOLDEN RATIO | Adv. Chorus `0x240` | edit-parameters-1: OFF = 0 (was 1) |
| Phase Reversed | On · Off | Advanced | PHASE REVERSE | Adv. Chorus `0x23D` (Feedback in the Flangers) | edit-parameters-1: ON = 1; only 0/1 in every Advanced Chorus preset |
| Cross Feedback | % (signed) | Advanced Flanger | CROSS FEED | `0x23E` | card 1-89 photo: 13 % |
| LFO Curve | Triangle · Sine (bytes 1, 2; the unit offers no Square here) | Advanced | CURVE | Adv. Chorus `0x23E` | edit-parameters-1: TRIANGLE = 1 (was 2); cards 1-43 and 1-76: SINE = 2 |
| LFO Phase | 0 · 90 · 180 (bytes 0–2, all the unit offers) | Advanced | PHASE | Adv. Chorus `0x23F` | card 1-43: 0 = 0; edit-parameters-1: 90 = 1 (was 0); card 1-76: 180 = 2. Earlier notes had Curve and Phase swapped |

## Reverb (REVERB key)

Sub-algorithms: Advanced (photo: `REVERB - ADVANCED`, first group
`MASTER SECTION`), Simple.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Room type | Round? · Curved · Square | Advanced | ROOM TYPE | `0x25B` | edit-parameters-1: CURVED = 1; edit-parameters-2: SQUARE = 2 |
| Room size | Box · Tiny · Small · Medium · Large · XL · Grand · Huge | Advanced | ROOM SIZE | `0x25C` | edit-parameters-2: BOX = 0; ROM 139 photo: TINY = 1; card 1-43: SMALL = 2; ROM 11: MEDIUM = 3; edit-parameters-1: LARGE = 4; card 2-89: XL = 5; card 1-75: GRAND = 6; HUGE = 7 is the last on the unit |
| Decay time | 0.1 s steps | both | DECAY TIME | `0x253` | samples B→C, edit-parameters-1: 2.5 s = 25 |
| Reverb level | signed (ROM −11 … 20) | Advanced | REVERB LEVEL | `0x261` | edit-parameters-1: 1; edit-parameters-2: 2 |
| High color | Wool · Warm · Real · Clear · Bright · Crisp · Glass | Advanced | HIGH COLOR | `0x255` | ROM 139 photo: WARM = 1; ROM 92: CLEAR = 3; ROM 11: BRIGHT = 4; edit-parameters-1: CRISP = 5 |
| High factor | signed (ROM ±50) | Advanced | HIGH FACTOR | `0x256` | edit-parameters-1: 1; edit-parameters-2: 3 |
| Low color | 7 values: Thick · Round · Real · Light · Tight · Thin · NoBass | Advanced | LOW COLOR | `0x257` | ROM 92 photo: THICK = 0; card 1-76: ROUND = 1; card 1-43: REAL = 2; edit-parameters-1: LIGHT = 3; card 1-75: TIGHT = 4; edit-parameters-2: NOBASS = 6. The manual lists eight: the unit has no Fat, and calls Natural Real |
| Low factor | signed (ROM ±50) | Advanced | LOW FACTOR | `0x258` | edit-parameters-1: 1; edit-parameters-2: 4 |
| Room level | signed (ROM −50 … 20) | Advanced | ROOM LEVEL | `0x25D` | edit-parameters-1: 1; edit-parameters-2: 5 |
| Color | Auto · Wool · Warm · Real · Clear · Bright · Crisp · Glass | Advanced | COLOR | `0x25E` | edit-parameters-1: WOOL = 1; edit-parameters-2: WARM = 2; ROM 139 photo: REAL = 3; ROM 75: GLASS = 7 |
| Color factor | signed (ROM ±50) | Advanced | COL.FACTOR | `0x25F` | edit-parameters-1: 1; edit-parameters-2: 6 |
| Predelay | signed (ROM −50 … 100) | both | PRE DELAY | `0x260` | edit-parameters-1: 25 (was 24) |
| Decay level | signed (ROM −50 … 20) | Advanced | DECAY LEVEL | `0x254` | edit-parameters-1: 1; edit-parameters-2: 7 |
| Decay start | signed (ROM ±100) | Advanced | DECAY START | `0x259` | edit-parameters-1: 1; edit-parameters-2: 8 |
| Diffuse | ±25 | Advanced | DIFFUSE | `0x25A` | edit-parameters-1: 1; edit-parameters-2: 9 |
| Type | Room · Club · Hall · Church · Cathedral · Grand Hall · Fast Decay · Slow Decay · Plate · Spring | Simple | TYPE (GENERAL) | `0x252` | card 1-83 photo: SPRING = 9. The ROM names fit the manual's order: 180 Bright Room 0, 181 Church 3, 183 Cathedral 4, 182 Grand Hall 5, 185 Slow Reverb 7, 184 Spring Reverb 9. Simple keeps DECAY TIME `0x253` (18.6 s), PRE DELAY `0x254` (-50; presets go to 100), REVERB LEVEL `0x255` (12) and COLOR `0x256` (Wool … Glass, Extreme; WOOL = 0) |
| Color | Wool … Glass · Extreme | Simple | | | |

The DECAY TIME range in the manual is 0.01–20.0 s, but the decoded byte
counts 0.1 s steps; finer steps at short times may use another scale.

The Advanced Reverb's bytes `0x253`–`0x261` are all placed: edit-parameters-1 moved each
one step, and edit-parameters-2 gave each a distinct value. They are stored in a
different order from the page.

**Not stored with the preset.** The Output page (LEVEL, speaker FILTERS,
LOCUT, HICUT) says "(global)": moving all four in edit-parameters-1 changed no byte.

**Card 1-43 Tele Something Good** (photos of every block) added: Filter 0 =
PARAMETRIC, Pan+Trem 0 = SIMPLE TREMOLO (SPEED `0x1A8`, TEMPO `0x1A9`, DEPTH
`0x1AA`, as in the Simple Panner), Pitch 3 = DUAL DETUNE (DELAY VOICE1/2 at
`0x1CA`/`0x1CC`, 16-bit), Delay 1 = DUAL (TIME LINE 1/2 at `0x1E2`/`0x1E4`,
16-bit; TEMPO LINE 1/2 at `0x1E6`/`0x1E7`), Chorus CURVE and PHASE (read
swapped at first; card 1-76 corrected them: CURVE `0x23E` 2 = SINE, PHASE `0x23F` 0 = 0), Tempo 5 = 1/8 and 7 = 1/16, Reverb LOW
COLOR 2 = REAL (not in the manual's list). The PARAMETRIC filters (FREQ
273.8 Hz and 459.7 Hz, SLOPE 6 dB/OCT, GAIN 2.0 dB) aren't placed yet: the
filter bytes are `186=5B 187=01 189=14 18A=6D 18B=03 18D=18 …`.

## Out section

Level and Speaker Filters (On/Off, Locut 40/80 Hz, Hicut 2.5–5 kHz) are global
and **not stored in presets** (manual p.51).

## Modifiers and matrix (MOD key)

Stored with the preset (manual pp.25–28). The 20 links are at `0x76` (10 bytes each); see "Modifier links" in [SYSEX_FORMAT.md](SYSEX_FORMAT.md) for the layout and the parameter IDs.

| Item | Parameters |
|---|---|
| Matrix | up to 20 links: source (Ext 1–8, LFO 1–2 outputs, ADSR 1–2, ENV, Pitch) → parameter |
| Link | Low input, Mid input, High input, Slope, Glide time: bytes 0–4 of each link at `0x76 + 10·k` |
| Envelope follower | Attack, Release |
| Pitch detector | Range: 6s GTR D-E · 7s GTR A-E · 4s Bass D-E |
| ADSR 1, 2 | Attack, Decay, Sustain, Sustain level, Release, Mode (Once, Once-Retrig, Loop, Loop-Retrig, Sustain, Sust-Retrig), Threshold |
| LFO 1, 2 | Speed, Depth, Tempo, Curve (Square · Sine · Triangle), Pulsewidth, Out2 phase |
