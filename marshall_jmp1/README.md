# Marshall JMP-1 Editor

A browser editor and librarian for the **Marshall JMP-1 valve MIDI pre-amp**.
It talks to the unit over Web MIDI SysEx and draws a front panel modelled on
the JMP-1 itself.

- **TypeScript + WebAssembly**: the dump codec (header, 10 blocks, checksums)
  is written in AssemblyScript (`assembly/index.ts`) and compiled to
  `public/jmp1codec.wasm`. The UI is plain TypeScript, built with Vite.
- **Lists all patches**: 00–99, showing channel, Bass Shift, volume, gain, the
  four tone controls and effect mix.
- **Labels (editor only)**: the JMP-1 stores no names. Its display is 4 digits,
  and a patch is 10 bytes with no room for text. You can still give patches
  labels in the editor. They are kept in the browser and saved inside `.syx`
  files from SAVE .SYX, but never sent to the unit.
- **Edits them**: the panel works like the unit. Select a parameter key, turn
  Data, pick the channel or Bass Shift, then STORE (press, choose a location,
  press again). The MIDI mapping table is edited with MAP or by clicking the
  grid.
- **Dumps**: receive the full memory, send it back, and load or save `.syx`
  files. **FACTORY 00–25** loads the 26 factory sounds from the handbook.

## Running

```bash
cd marshall_jmp1
npm install
npm run dev      # http://localhost:5173
npm test         # codec / model tests (Node 22+)
npm run build    # static site in dist/
```

Web MIDI with SysEx needs Chrome, Edge or Opera, served from `localhost` or HTTPS.

## Using it with the JMP-1

1. Connect MIDI OUT → JMP-1 MIDI IN and JMP-1 MIDI OUT → MIDI IN.
2. Press **CONNECT**, then pick the ports and the JMP-1's MIDI channel.
3. **Receive:** press **RECEIVE DUMP**, then press **PATCH + VOLUME** together on
   the JMP-1. The unit has no dump request message, so the dump must be started
   from its front panel.
4. Edit and STORE patches. A `*` marks patches that differ from what the
   JMP-1 holds.
5. **Send:** press **SEND DUMP**. Memory lock must be off; it rewrites all 100
   patches and the mapping.

**LIVE** is optional. The JMP-1 accepts no parameter messages, so to hear an
edit straight away the editor re-sends the whole 1316-byte dump plus a program
change after each change (about 0.4 s each). This writes the unstored edit into
the current patch on the unit.

## Panel

| Control | Does |
|---|---|
| Patch | patch mode; Data selects 00–99 (sends program change) |
| Store | 1st press: choose location with Data (display flashes); 2nd press: store |
| Volume, Gain, Bass, Middle, Treble, Presence, Effect | select parameter; Data changes it (0–20, −6…+6, 0–12) |
| OD1, OD2, Clean 1, Clean 2 | channel |
| Bass Shift | on/off |
| Map | `In nn` incoming program (decimal point = 100–127) → `to nn` patch → `ot nn` outgoing program → store |
| Channel | MIDI channel 1–16 / omni (`on`); press again to store |

**CLEAR PATCH nn** (above the patch list, or the `Delete` key) is editor-only, since
the JMP-1 has no clear function. It turns the selected patch into an empty slot,
stored the way the unit stores one (tones centred, volume and gain 0, Clean 1,
Bass Shift off), and removes its label. Like any edit, the patch is marked `*`
until you SEND DUMP.

Keyboard:
- **←/→:** turn Data.
- **↑/↓:** in patch and store mode, move through the patch list (↑ = previous).
  In other modes, raise or lower the value.
- **Letter keys:** `P` Patch, `S` Store, `M` Map, `Delete` clear patch.

## SysEx format

Marshall never published one. It was recovered from the 2004 freeware
JMP-Editor and is documented with evidence in
[docs/SYSEX_FORMAT.md](docs/SYSEX_FORMAT.md):

```
F0 00 20 16 01  [01 nn  128 data bytes  checksum] × 10  F7     (1316 bytes)
```

The 10 blocks form a 1280-byte stream:
- **Patches:** 100 patches × 10 bytes. Each patch is Effect, Presence, Treble,
  Middle, Bass, Gain, Volume, then a mode byte, then 2 unknown bytes.
- **Mapping:** the two 128-entry MIDI mapping tables.

### Confirmed and still inferred

A real dump (`docs/samples/marshall-jmp1.syx`) confirmed these:
- **Patch layout:** checked against the factory sounds.
- **Tones:** stored as value + 7.
- **Mode byte:** a set of relay bits.

Still inferred:
1. **Mapping tables:** block 9 is taken as incoming program → patch, and block
   10 as outgoing program.
2. **Factory sounds:** the handbook lists no Effect value, so the factory sounds
   use 0.

Unknown bytes (patch bytes 8–9, stream bytes 1000–1023) are kept exactly as
received.

## Layout

```
assembly/index.ts      AssemblyScript dump codec → public/jmp1codec.wasm
src/codec.ts           wasm loader / wrapper, .syx splitting
src/model.ts           Bank (1280-byte stream), Patch, factory sounds
src/labels.ts          editor-only labels, stored as an extra SysEx message in .syx files
src/midi.ts            Web MIDI transport
src/app.ts             panel modes, dump flows, librarian, mapping
src/ui/components.ts   Data wheel, round LED keys, 7-segment display
docs/                  handbook PDF, recovered SysEx format, a real dump (samples/)
tests/run.ts           tests
```

## License

Copyright (C) 2026 Alessandro Pilotti

`AGPL-3.0-or-later`, see the repository [LICENSE](../LICENSE).
`docs/JMP1_Handbook_EN.pdf` is Marshall's handbook, included for reference
only and not covered by the license.

Marshall is a trademark of Marshall Amplification plc. This editor
is unofficial and not affiliated with or endorsed by Marshall; see
[Trademarks](../README.md#trademarks).
