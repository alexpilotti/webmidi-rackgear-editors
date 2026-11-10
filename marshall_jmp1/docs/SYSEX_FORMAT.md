# Marshall JMP-1 SysEx dump format

Marshall never published a byte-level spec. The handbook
(`JMP1_Handbook_EN.pdf`, pp.10–11) only says this:

- **What a dump holds:** all patches and the MIDI mapping table.
- **Sending:** the dump is started on the unit with **PATCH + VOLUME**. The
  display counts blocks **0–9** while it sends.
- **Receiving:** the unit accepts the same dump back when **memory lock is off**.
  Loading it rewrites every patch and the mapping table.
- **What isn't there:** no dump request message and no Control Change
  messages. Program Change 0–127 is the only other MIDI it handles.

The layout below was recovered by static analysis of the 2004 freeware
**JMP-Editor 0.9.03** (Markus Mattzick, `jmp-editor.mattzick.com`). It is a VB6
native-code binary. The installer was unpacked without being run, and the
dump-building routine was disassembled (around VA `0x5FB6C0`). Each finding
cites the instruction it comes from.

## Message

A single SysEx message, **1316 bytes**:

```
F0 00 20 16 01                      header (5 bytes)
[01 nn  d0 … d127  cs] × 10         blocks nn = 01…0A (131 bytes each)
F7
```

- **Header:** stored as `F0, 00, 20, 16, 01`. `00 20 16` is a 3-byte
  manufacturer ID (`0x5FB849`–`0x5FB921`).
- **Block marker and number:** each block starts with `01`, then the block
  number 1–10 (`0x5FB974`, `0x5FB9B5`, `0x5FC14C`, `0x5FC195`).
- **Checksum:** `cs = (d0 + … + d127) & 0x7F`
  (loop `0x5FC04A`–`0x5FC0EF`, `and ecx, 0x8000007F`).
- **Data ranges:** in a full dump, block *k*'s data lives at message offsets
  `7 + 131·(k-1)` … `+127`. Blocks 9 and 10 run 0x41F–0x49E and 0x4A2–0x521;
  `F7` is at 0x523.

## Data stream

The ten 128-byte blocks join into one **1280-byte stream**:

| Stream bytes | Content |
|---|---|
| 0–999 | 100 patches × 10 bytes (patch *i* at `10·i`) |
| 1000–1023 | not written by JMP-Editor (keep as received) |
| 1024–1151 | block 9: MIDI mapping, internal patch for incoming program 0–127 |
| 1152–1279 | block 10: MIDI mapping, outgoing program for entry 0–127 |

Patches run across block boundaries. Patch 12 starts at stream byte 120,
block 2's patch writes begin at block offset 2, and patch 13 starts at
stream byte 130.

## Patch (10 bytes)

| Offset | Field | Range |
|---|---|---|
| 0 | Effect mix | 0–12 |
| 1 | Presence | tone: value + 7 (1–13 for −6…+6) |
| 2 | Treble | tone |
| 3 | Middle | tone |
| 4 | Bass | tone |
| 5 | Gain | 0–20 |
| 6 | Volume | 0–20 |
| 7 | Mode (channel + Bass Shift) | see below |
| 8–9 | `00` on a real unit; not written by JMP-Editor (keep as received) | |

In the JMP-Editor record, the serialisation order is record offsets
0x28, 0x27, 0x26, 0x25, 0x24, 0x20, 0x1F. The INI loader maps those offsets
to Effect, Presence, Treble, Middle, Bass, Gain and Volume (`0x600DFA`…).

A blank (never programmed) patch on the unit is
`00 07 07 07 07 00 00 13 00 00`: tones centred, volume and gain 0, Clean 1
with Bass Shift off.

### Mode byte

The mode byte is a set of relay bits. Each bit only matters for some channels:

| Bit | Meaning |
|---|---|
| 0 | Clean channel (0 = overdrive) |
| 1 | Bass Shift **off** (active low) |
| 2 | Clean 2 instead of Clean 1 (ignored on overdrive) |
| 3 | OD1 instead of OD2 (ignored on clean) |
| 4 | Always set by the unit |

Values on a real unit (`docs/samples/marshall-jmp1.syx`, checked against the
handbook's factory sounds):

| Channel | Bass Shift on | Bass Shift off |
|---|---|---|
| OD1 | `18`, `1C` | `1A` |
| OD2 | `10` | `16` |
| Clean 1 | `19` | `1B` (blank: `13`) |
| Clean 2 | `1D` | `1F` |

JMP-Editor 0.9.03 writes `08/0A`, `04/06`, `09/0B` and `05/07` without bit 4
(`0x5FBCF6`–`0x5FC00D`). These decode the same way under the relay-bit rule.
The editor therefore decodes by bits, and changes only the bits it needs,
keeping the rest.

## Confirmed with a real dump

- **Tones:** stored as `value + 7`. Patch 00 "Smoke-em" has bass +3 = `0A`
  and middle −3 = `04`; patch 16 "Sunshine" has treble −6 = `01`.
- **Patch layout:** volume, gain and the field order match the factory table
  for patches 00–25.
- **Unknown bytes:** stream bytes 1000–1003 are `7F 24 40 24`, and 1004–1023
  are `00`. Their meaning is unknown, and the editor preserves them.
- **Round trip:** decoding a real dump and re-encoding it is byte-identical.

## Still inferred

- **Mapping tables:** which table is "incoming → patch" and which is
  "outgoing program" is inferred from the handbook's MAP key sequence. On the
  sample unit, block 9 starts `26, 27, 2, 3, …` and block 10 is the identity.

## Editor-only labels (not part of the JMP-1 format)

The JMP-1 stores no patch names. When SAVE .SYX is used and any label is set,
this editor appends a second message to the file. It is never sent to the unit:

```
F0 7D 4A 4D 50 31 4C 01  label0 00  label1 00 … label99 00  F7
      "J  M  P  1  L" ver
```

- **Manufacturer ID:** `7D` is the "non-commercial" ID, so no real device
  claims the message.
- **Labels:** printable ASCII, each up to 20 characters and terminated by `00`.

LOAD .SYX restores labels from this message when it is present. Tools that send
a whole `.syx` file (MIDI-OX, SysEx Librarian) would also send this message.
The JMP-1 should ignore it because of the foreign ID, but that hasn't been
tried on hardware. To be safe, send only the first 1316 bytes, or use the
editor's SEND DUMP.
