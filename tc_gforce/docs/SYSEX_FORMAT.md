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
| `gforce-rom-50.syx` | ROM 1–50 copied unedited to User 1–50 (see "Record map from ROM 1–50") |

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

## Record map from ROM 1–50

`gforce-rom-50.syx` holds ROM 1–50 copied unedited to User 1–50. The map below
comes from comparing those 50 records with the manual's preset list
(descriptions, Mono / Stereo / 3-Way, pedal column). Single-change pairs are
still needed to confirm it. The routing grid is the most certain part.

| Offset | Size | Meaning | Evidence |
|---|---|---|---|
| `0x016` | 2 | `03 00` in all 50 | constant |
| `0x018` | 8 × 2 | one value 0–3 per block, at even offsets, in block-ID order (Comp … Reverb). *Unknown*; not the sub-algorithm (Comp reaches 3). Set for blocks that are not routed too | varies with the preset |
| `0x028` | 32 | **routing grid**, 8 columns × 4 rows, column by column: cell = `0x28 + 4·column + row` | see below |
| `0x048` | 10 | *Guess:* In section / Noise Gate. `0x49` signed (−30, −60, −25: Threshold dB?), `0x4A` 18–50 (Max. Damping?), `0x4B` 10–100 (Release?), `0x4C` 0/1 (Mode?), `0x4D` signed small (Level dB?) | 38 Go Direct and other Rhythm presets differ |
| `0x076` | ~56 | *Guess:* modifier matrix links, 10 bytes each (`0x76`, `0x80`, `0x8A`, …). Filled only in presets with a pedal (10, 11, 24, 25, 36, 37, 40, 48) or a dynamic or LFO effect (3, 7, 12, 16, 23, 29, 30). In the pedal presets, byte 6 of the link is the target block's ID: 8 Delay (10, 24), 7 Pitch (11, 25, 37), 11 Reverb (36) | matches the pedal column |
| `0x0AE` | 146 | zero in all 50 | constant |
| `0x140` | ~38 | *Guess:* global or In/Out section; mostly constant | |
| `0x166` | 20 | **Compressor**; `0x166` = sub-algorithm (0 Simple, 1 Advanced) | 1 only in Rhythm presets 40–47, 50 |
| `0x17A` | 34 | **Filters**; `0x17A` = sub-algorithm: 0 Parametric EQ (38 Go Direct "EQ"), 2 in both Touchwahs, 4 Phaser (8, 12). *Guess:* manual order | |
| `0x19C` | 22 | **Pan+Trem**; `0x19C` = sub-algorithm: 0 Tremolo, 1 Tremolo Advanced (12), 2 Panner (34 "subtle slow panning"), 3 Surround Panner (15 "pans beyond a normal stereo image") | manual order fits all |
| `0x1B2` | 36 | **Pitch**; `0x1B2` = sub-algorithm: 0 Intelligent (Harmony presets), 1 one voice (11/25 "lower octave", 33 "octave up"), 2 two voices, 3 Detune (all Doubler presets) | |
| `0x1D6` | ~50 | **Delay**; `0x1D6` = sub-algorithm 0–4 (*guess:* Stereo, Dual, Dual Two-tap, One-tap, Quad-tap; 29 Slap+Slow = 2 Dual Two-tap) | |
| `0x208` | ~38 | **Drive** (no sub-algorithms); `0x214`–`0x217` differ only in presets 9, 22, 44, which route the Drive | |
| `0x22E` | 24 | **Chorus/Flanger**; `0x22E` = sub-algorithm: 0 Classic Chorus, 1 Advanced Chorus, 2 Classic Flanger, 3 Advanced Flanger (44 "flanging") | manual order fits |
| `0x246` | 32 | **Reverb**; `0x246` = sub-algorithm, 1 = Advanced (photo of Mono Reverb), *guess:* 0 = Simple. `0x253` = DECAY TIME | |

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
