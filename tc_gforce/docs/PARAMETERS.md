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

**Already found from ROM 1–50** (`samples/gforce-rom-50.syx`; see "Record map
from ROM 1–50" in [SYSEX_FORMAT.md](SYSEX_FORMAT.md)):
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

Common to the eight effect blocks (manual p.33): **Mix**, **In Level**, **Out
Level** (not in every sub-algorithm), and **Mute mode** as the last
parameter: Mix 0% · FX Out · Output · FX In · Input (FX In and Input only in
Delay, Reverb and Pitch). Every block also has a bypass state and a place in
the routing grid (4 × 8). The Tempo parameters take Ignored or a note value
(1/1 … 1/32, straight, dotted or triplet).

| Parameter | Range / values | LCD name | Offset | Evidence |
|---|---|---|---|---|
| Mix | % ? | | | |
| In Level | dB ? | | | |
| Out Level | dB ? | | | |
| Mute mode | Mix 0% · FX Out · Output · FX In · Input | | | |
| Bypass | on / off | | | |
| Routing position | column 1–8, row 1–4 | | `0x28 + 4·column + row` holds the block ID | ROM 1–50 vs the preset list |

## In section: Noise Gate (GATE key)

| Parameter | Range / values | LCD name | Offset | Evidence |
|---|---|---|---|---|
| Mode | Hard · Soft | | | |
| Threshold | dB ? | | | |
| Max. Damping | dB ? (0 = off) | | | |
| Release rate | dB/s ? | | | |
| Level | dB ? | | | |

## Compressor (COMPRESS key)

Sub-algorithms: Simple, Advanced.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Threshold | dB ? | both | | | |
| Ratio | n:1 ? | both | | | |
| Knee Mode | Soft · Hard | Advanced | | | |
| Release | dB/s ? | Advanced | | | |
| In Level | dB ? | both | | | |
| Out Level | dB ? | both | | | |

## Filters (FILTERS key)

Sub-algorithms: Parametric EQ, Wah Wah, Formant, Resonance, Phaser.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Freq 1–5 | Hz ? | Parametric EQ | | | |
| Slope/BW 1–5 | ? (1, 5 shelving slope; 2–4 bandwidth) | Parametric EQ | | | |
| Gain 1–5 | ±12 dB | Parametric EQ | | | |
| Freq | Hz ? | Wah Wah | | | |
| Instrument mode | Guitar · Bass | Wah Wah | | | |
| Start | ? | Formant | | | |
| Thru | ? | Formant | | | |
| End | ? | Formant | | | |
| Resonance | ? | Formant | | | |
| Age/Sex | ? | Formant | | | |
| Sweep | ? | Formant | | | |
| Order | 2nd (12 dB/oct) · 4th (24 dB/oct) | Resonance | | | |
| Locut Freq | Hz ? | Resonance | | | |
| Hicut Freq | Hz ? | Resonance | | | |
| Lo Resonance | ? | Resonance | | | |
| Hi Resonance | ? | Resonance | | | |
| Speed | Hz ? | Phaser | | | |
| Tempo | Ignored · note values | Phaser | | | |
| Depth | % ? | Phaser | | | |
| Order | 4 · 8 · 12 | Phaser | | | |
| Feedback Level | % ? (can be negative) | Phaser | | | |
| Instrument Mode | Guitar · Bass | Phaser | | | |

## Pan+Trem (PAN+TREM key)

Sub-algorithms: Tremolo (simple), Tremolo Advanced, Panner (simple),
Surround Panner.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Speed | Hz ? | all | | | |
| Tempo | Ignored · note values | all | | | |
| Depth | % ? | Tremolo | | | |
| Curve | Square · Sine · Triangle | Tremolo Adv., Surround | | | |
| Pulsewidth | % ? | Tremolo Adv., Surround | | | |
| LFO Phase | degrees ? | Tremolo Adv., Surround | | | |
| Pan Center | ? | Panner | | | |
| Width | % ? (> 100 % pans past stereo) | Surround | | | |

## Pitch (PITCH key)

Sub-algorithms: Intelligent, Custom scale (part of Intelligent), Fixed 1 & 2
Voice (±12 semitones), 2 Voice 2 Octave (±24 semitones), Detune (±50 cents).

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Key | C … B | Intelligent | | | |
| Scale | Ionian Major … Custom ? | Intelligent | | | |
| Mode | Stepped · Smooth | Intelligent | | | |
| Voice 1, 2 | scale step, ±1 octave | Intelligent | | | |
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

## Delay (DELAY key)

Sub-algorithms: Stereo, Dual, Dual Two Tap, One Tap, Quad Tap.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Time | 0–740 ms | Stereo | | | |
| Time 1, 2 | 0–740 ms | Dual | | | |
| Time 1, 2 (per line) | 0–1480 ms | Dual Two Tap | | | |
| Time | 0–1480 ms | One Tap | | | |
| Tap 1–4 | 0–1480 ms | Quad Tap | | | |
| Tempo (1, 2, 1–4) | Ignored · note values | all | | | |
| Feedback | % ? | Stereo, One Tap | | | |
| Feedback 1→1, 2→2, 1→2, 2→1 | % ? (sum ≤ 100 %) | Dual | | | |
| Feedback 1, 2 / 1–4 | % ? (sum ≤ 100 %) | Dual Two Tap, Quad Tap | | | |
| Levels 1, 2 / 1–4 | dB ? | Dual, Dual Two Tap, Quad Tap | | | |
| Pan (Position) 1, 2 / 1–4 | ? | Dual, Dual Two Tap, One Tap, Quad Tap | | | |
| Lowcut (1, 2 / 1–4) | Hz ? | all | | | |
| Highcut (1, 2 / 1–4) | Hz ? | all | | | |
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
| Speed | Hz ? | all | | | |
| Tempo | Ignored · note values | all | | | |
| Depth | % ? | all | | | |
| Delay | ms ? | Advanced | | | |
| Feedback | % ? (can be negative) | Flanger | | | |
| Golden Ratio | On · Off | Advanced | | | |
| Phase Reversed | On · Off | Advanced | | | |
| Cross Feedback | % ? (can be negative) | Advanced Flanger | | | |
| LFO Curve | Sine · Triangle | Advanced | | | |
| LFO Phase | degrees ? | Advanced | | | |

## Reverb (REVERB key)

Sub-algorithms: Advanced (photo: `REVERB - ADVANCED`, first group
`MASTER SECTION`), Simple.

| Parameter | Range / values | Sub-algorithm | LCD name | Offset | Evidence |
|---|---|---|---|---|---|
| Room shape | Square · Round · Curved | Advanced | ROOM TYPE | | photo |
| Room size | Box · Tiny · Small · Medium · Large · XL · Grand · Huge | Advanced | ROOM SIZE | | photo |
| Decay time | 0.01–20.0 s | both | DECAY TIME | `0x253` (1 byte, 0.1 s steps) | samples B→C, Mono Reverb |
| Reverb level | ±50 | both | REVERB LEVEL | | photo |
| High color | Wool · Warm · Real · Clear · Bright · Crisp · Glass | Advanced | HIGH COLOR | | photo |
| High factor | ±25 | Advanced | | | |
| Low color | Thick · Fat · Round · Natural · Light · Tight · Thin · No bass | Advanced | | | |
| Low factor | ±25 | Advanced | | | |
| Room level | ±50 | Advanced | | | |
| Color | Auto · Wool · Warm · Real · Clear · Bright · Crisp · Glass | Advanced | | | |
| Color factor | ±50 | Advanced | | | |
| Predelay | ±50 | both | | | |
| Decay level | ±50 | Advanced | | | |
| Diffuse | ±25 | Advanced | | | |
| Decay start | ±50 | Advanced | | | |
| Type | Room · Club · Hall · Church · Cathedral · Grand Hall · Fast Decay · Slow Decay · Plate · Spring | Simple | | | |
| Color | Wool … Glass · Extreme | Simple | | | |

The DECAY TIME range in the manual is 0.01–20.0 s, but the decoded byte
counts 0.1 s steps; finer steps at short times may use another scale.

## Out section

Level and Speaker Filters (On/Off, Locut 40/80 Hz, Hicut 2.5–5 kHz) are global
and **not stored in presets** (manual p.51).

## Modifiers and matrix (MOD key)

Stored with the preset (manual pp.25–28). Not covered by the first dump.

| Item | Parameters |
|---|---|
| Matrix | up to 20 links: source (Ext 1–8, LFO 1–2 outputs, ADSR 1–2, ENV, Pitch) → parameter |
| Link | Low input, Mid input, High input, Slope, Glide time |
| Envelope follower | Attack, Release |
| Pitch detector | Range: 6s GTR D-E · 7s GTR A-E · 4s Bass D-E |
| ADSR 1, 2 | Attack, Decay, Sustain, Sustain level, Release, Mode (Once, Once-Retrig, Loop, Loop-Retrig, Sustain, Sust-Retrig), Threshold |
| LFO 1, 2 | Speed, Depth, Tempo, Curve (Square · Sine · Triangle), Pulsewidth, Out2 phase |
