# G-Force User bank dump format

TC Electronic never published the G-Force SysEx format. Everything here was
worked out from dumps of a real unit (`samples/`), sent with
**Utility → User Bank to MIDI**. Items marked *guess* are not confirmed yet.
`tests/run.ts` checks the confirmed items against the samples.

## Samples

| File | User bank contents |
|---|---|
| `gforce-user-bank-a.syx` | User 1 = "Mono Reverb" (copied from ROM), DECAY TIME 2.4 s |
| `gforce-user-bank-b.syx` | as A, renamed "TEST ABC" |
| `gforce-user-bank-c.syx` | as B, DECAY TIME 2.5 s |
| `gforce-user-bank-d.syx` | User 1 "Mono Reverb", User 2 "Tremendous Delay", User 5 "Rhythmic"; Users 3–4 empty |
| `gforce-rom-001-100.syx` | ROM 1–100 copied unedited to User 1–100 (see "Record map from ROM 1–200"). An earlier dump of ROM 1–50 alone was byte-identical to its User 1–50, unused-block bytes included |
| `gforce-rom-101-200.syx` | ROM 101–200 copied unedited to User 1–100. 16 names differ from the manual, 15 in spelling only; ROM 196 is "Delay Tap Tempo" on the unit and "Straight Delay" in the manual |

A first capture with an empty User bank sent only the header message, with a
block count of `02` (its data blocks were not recorded).

## Messages

All messages start with `F0 00 20 1F` (TC Electronic) and the SysEx device ID
(`00` on the sampled unit; *guess:* the I/O Setup "Sysex device ID" setting).

**Header**, 9 bytes:

```
F0 00 20 1F id 10 nh nl F7
```

`nh nl` = number of data blocks that follow (`00 0C` = 12, `00 32` = 50).
*Guess:* a 14-bit count, high 7 bits first.

**Data block**, 137 bytes, sent once per block:

```
F0 00 20 1F id 11 ix  n0 n1 … n127  ck F7
```

- `ix`: block index, 0, 1, 2 … *Guess:* it wraps at 128 in long dumps.
- `n0 … n127`: 64 data bytes, each sent as two nibbles, **high nibble first**.
- `ck`: `(−sum of the 64 decoded bytes) & 0x7F`. Confirmed on every block of
  all four samples.

Decoding the blocks in order gives a byte stream of `64 × count` bytes.

## Byte stream

| Offset | Size | Meaning |
|---|---|---|
| `0x00` | 4 | magic `DD EE AA BB` |
| `0x04` | 100 | one byte per User slot: `01` = stored, `00` = empty |
| `0x68` | 614 × n | one record per slot, User 1 … the last stored slot |
| … | | zero padding to a multiple of 64 |

Empty slots below the last stored one are sent as 614 zero bytes. Slots after
the last stored one are not sent, so a bank with only User 1 stored is 12
blocks, and one with User 5 as the last stored slot is 50 blocks:
`0x68 + 5 × 614 = 3174` bytes, padded to 3200.

## Preset record (614 bytes)

| Offset | Size | Meaning |
|---|---|---|
| `0x000` | 2 | preset number, big-endian: `00 E1` = User 1, `00 E2` = User 2, `00 E5` = User 5. *Guess:* 224 + the User number (after the 225 ROM presets). |
| `0x002` | 20 | name, ASCII, padded with spaces |
| `0x016` | 592 | parameters; not decoded yet, except: |
| `0x253` | 1 | Reverb DECAY TIME in 0.1 s steps (`18` = 2.4 s, `19` = 2.5 s), on the "Mono Reverb" preset |

The name and DECAY TIME offsets come from diffing samples A–C: nothing else
changed. *Guess:* the DECAY TIME offset is the same in every preset. The
other presets may lay out their blocks differently.

The checklist of parameters still to find, and the method, is in
[PARAMETERS.md](PARAMETERS.md).

## Record map from ROM 1–200

`gforce-rom-001-100.syx` holds ROM 1–100 and `gforce-rom-101-200.syx` ROM
101–200, each copied unedited to User 1–100. The map below comes from
comparing those
100 records with the manual's preset list
(descriptions, Mono / Stereo / 3-Way, pedal column). Single-change pairs are
still needed to confirm it. The routing grid is the most certain part:
photos of the unit's Effects display for ROM 1–7 and 9 show exactly the
decoded routings (1 CPR → REV; 2 CPR → REV ∥ CHO; 3 CPR → REV ∥ DLY;
4 CPR → REV ∥ PIT ∥ DLY; 5 CPR → REV ∥ PIT; 6 PAN → REV;
7 PIT → CPR → FIL → REV; 9 CPR → DRV → REV). Every block code is now seen on
the unit, with its box name: 4 CPR, 5 FIL, 6 PAN, 7 PIT, 8 DLY, 9 DRV, 10 CHO,
11 REV.

| Offset | Size | Meaning | Evidence |
|---|---|---|---|
| `0x016` | 2 | `03 00` in 197 of 200; `01 00` in 92 Surround Reverb, 175 Pedal Hold + Reverb and 176 Very Scary Horror. *Unknown* | |
| `0x018` | 8 × 2 | one value 0–3 per block, at even offsets, in block-ID order (Comp … Reverb). *Unknown*; not the sub-algorithm (Comp reaches 3). Set for blocks that are not routed too | varies with the preset |
| `0x028` | 32 | **routing grid**, 8 columns × 4 rows, column by column: cell = `0x28 + 4·column + row` | see below |
| `0x048` | 10 | *Guess:* In section / Noise Gate. `0x49` signed −60 … −14 (Threshold dB?), `0x4A` 0–50 (Max. Damping dB?), `0x4B` 3–100 (Release?), `0x4C` 0/1 (Mode?), `0x4D` signed 0 … −9 (Level dB?); `0x4E` = 100, 75 in six presets (105, 113, 119, 123, 193, 200) | ranges over ROM 1–200 |
| `0x076` | 200 | **modifier matrix**: 20 links of 10 bytes (the manual's maximum is 20), see below. Unused links are zeros | every pedal preset has links |
| `0x140` | ~38 | *Guess:* global or In/Out section; mostly constant | |
| `0x166` | 20 | **Compressor**; `0x166` = sub-algorithm (0 Simple, 1 Advanced) | 1 in 60 of ROM 1–200, none before 40 |
| `0x17A` | 34 | **Filters**; `0x17A` = sub-algorithm: **2 = WAH-WAH** (photo, ROM 7); from the preset list 0 Parametric EQ (38 Go Direct "EQ"), 1 Resonance (173 "Resonance Filter"), 3 Formant (140 "Stepped Formant Filter", the talk-box presets), 4 Phaser (every Phaser preset). Not the manual's order. `0x17B` = MIX LEVEL % (35, photo), `0x187` = Wah FREQ ×100 (45 = 0.45, photo) | ROM 7 photo, preset list |
| `0x19C` | 22 | **Pan+Trem**; `0x19C` = sub-algorithm: 2 Panner (194 Stereo Pan), 3 Surround Panner (195 Surround Panner, 15 Wide Panner, the rotary presets), 1 in all three single-block Tremolos (191–193; Classic, Stereo, Square), 0 in 6 Mono Tremolo | single-block presets |
| `0x1B2` | 36 | **Pitch**; `0x1B2` = sub-algorithm: 0 Intelligent (Harmony presets), 1 one voice (11/25 "lower octave", 33 "octave up"), 2 two voices, 3 Detune (all Doubler presets) | |
| `0x1D6` | ~50 | **Delay**; `0x1D6` = sub-algorithm: **4 = ONE-TAP** (photo, ROM 3; also 198 Tape Delay); from the preset list 1 Dual (197 "Two Delays" L 500 / R 400 ms, 199 Ping-Pong), 2 Dual Two-tap (29 Slap+Slow), 3 Quad-tap (200 "4 Tap Delay", 147 Expandelay "first four repeats"), 0 likely Stereo (196, one 500 ms Delay). One-Tap: `0x1E3` = TIME, 16-bit little-endian ms (`36 01` = 310, photo), `0x1EE` = FEEDBACK % (24, photo). `0x1E5`, `0x1E7`, `0x1E9` hold further 16-bit times, likely the other taps' | ROM 3 photo, preset list |
| `0x208` | ~38 | **Drive** (no sub-algorithms); `0x214`–`0x217` differ only in presets 9, 22, 44, which route the Drive | |
| `0x22E` | 24 | **Chorus/Flanger**; `0x22E` = sub-algorithm: 1 in the straight Chorus presets (186, 187, 190 Vibrato), 3 in the Flanger presets (188, 189, 44, the flanging presets). *Guess:* manual order (0 Classic Chorus, 1 Advanced Chorus, 2 Classic Flanger, 3 Advanced Flanger) | preset list |
| `0x246` | 32 | **Reverb**; `0x246` = sub-algorithm, 1 = Advanced (photo of Mono Reverb). 0 only in the six single-block Reverbs 180–185 where the Reverb is routed, *guess:* Simple. `0x253` = DECAY TIME | |

**Routing grid.** Each cell holds a block ID, 0 for an empty cell, 1 for the
pipeline icon:

| ID | 1 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|
| Block | pipe | Compressor | Filters | Pan+Trem | Pitch | Delay | Drive | Chorus | Reverb |

For example, ROM 4 Mono Harmony is `4 | 11/7/8`: the Compressor, then Reverb,
Pitch and Delay in parallel. All the 3-Way presets put their blocks in
parallel in column 1. 38 Go Direct ("EQ & Compression") is `-/4 | -/5`. IDs 2
and 3 are not used here. *Guess:* they are the In and Out sections. The
Noise Gate never appears in the grid.

**Modifier links** (`0x76 + 10·k`, k = 0–19), as found in ROM 1–200:

| Byte | Meaning | Evidence |
|---|---|---|
| 0, 1, 2 | Link Low / Mid / High input, 0–100 (mostly `0 50 100`, a straight line) | manual p.25 link page |
| 3 | Slope, signed (`FC` = −4 … `15` = 21) | 0 on straight links |
| 4 | Glide time (mostly 10) | |
| 5 | source: **1–4 = Ext 1–4** (1 is the pedal: 43 of the 45 presets marked X use it; 174 Jam with Loop, "Ext. 1 controls the looping, Ext. 2 controls the adding", uses 1 and 2; 173 links 1, 2, 3, 4 to four Delay taps), **10 = ENV** (Dyn Delays, Touchwahs; 121 "Envelope controlled crossfade between Reverb and Delay" links 10 to both Mixes, 5000 and 8000; 165 and 167 speed a panner up or down with the signal), **13, 14 = LFO 1, 15, 16 = LFO 2**, likely each LFO's two outputs (164 War of the Worlds moves its two pitch voices with 13 and 15; 171 Who's Next's autowah uses 15). *Guess:* 5–8 Ext 5–8; 9, 11, 12 the ADSRs and the Pitch detector | pedal column, descriptions |
| 6 | target block, as a routing grid code (0 = none) | equals the ID's thousands + 3 |
| 7 | 0 in all 200 | |
| 8–9 | **target parameter ID**, 16-bit big-endian; 0 = no target | see below |

Parameter IDs are `1000 × (block code − 3) + n`, so 2xxx Filters, 3xxx Pan+Trem,
4xxx Pitch, 5xxx Delay, 6xxx Drive, 7xxx Chorus, 8xxx Reverb (Compressor
1xxx and the In section 0xxx are not linked in these presets). This holds for
all 165 links with a target in ROM 1–200. `n` = 0, 1, 2 are shared by every
sub-algorithm and fit Mix, In Level and Out Level: 5002 is the Delay Out
Level, which the manual's ducking example connects to ENV (p.19) and both Dyn
Delays use; 5001 is what 10 Mono Pedal Delay's pedal moves ("pedal feeds the
Delay input"); 8002 is what 36 Pedal Reverb's pedal moves ("controls the level
of the Reverb"); 121's crossfade moves 5000 and 8000, the two Mixes.

From 100 up, the hundreds digit is a parameter group. For Filters, Pan+Trem
and Chorus it is **sub-algorithm byte + 1** in every link: Filters 1
Resonance 2201/2203, 2 Wah-Wah 2300, 3 Formant 2413/2414, 4 Phaser 2500/2502;
Pan+Trem 1 3200/3202, 2 3300, 3 3400; Chorus 1 7200/7202, 2 7300/7302, 3
7400/7402. Delay follows it for 1 Dual (52xx) and 2 Dual Two-tap (53xx), but
3 Quad-tap and 4 One-tap share 54xx. Pitch uses 41xx for sub-algorithms 0–2
(the shifters) and 42xx for 3 (Detune). Exceptions to the pedal rule: 84
Crunch Phasecomp and 111 Wes M Jazz Lead are marked X in the manual but have
no Ext 1 link with a target. Many links name a block but have ID 0.

**Values.** Most parameters are single bytes, signed where needed (`FE` =
−2, `CE` = −50, as in pan pairs `32 CE` = +50 / −50). Some are 16-bit
little-endian, such as the filter frequencies at `0x18A`, `0x18E`, `0x192`
and `0x196`: `6D 03` = 877.

**Unused blocks are not reliable.** ROM 1 here and User 1 of samples A–D are
both "Mono Reverb" copied from ROM. They differ in six bytes, `0x1EE`–`0x1F3`
(`1F 1F 63 63 64 64` here, zeros there). Those bytes are inside the Delay
block, which that preset does not route. So bytes of a block that is not in
the routing can't be decoded from this dump. Decode each block from presets
that use it.

## Open questions

- The meaning of the other 591 parameter bytes. Each needs a dump pair that
  differs by one known change, like B → C.
- Whether the record layout depends on the routing or the blocks in use.
- Whether the G-Force accepts a dump with a different SysEx ID, and what it
  answers after **MIDI to User Bank** (no reply has been seen yet).
