# TC Electronic G-Force Editor

A browser editor and librarian for the **TC Electronic G-Force** guitar
effects processor. It talks to the unit over Web MIDI SysEx and draws a front
panel modelled on the real G-Force.

- **TypeScript + WebAssembly**: the dump codec (nibbles and checksums) is
  written in AssemblyScript (`assembly/index.ts`) and compiled to
  `public/gforcecodec.wasm`. The UI is plain TypeScript, built with Vite.
- **Lists all User presets**: RECEIVE BANK records the User bank that the
  G-Force sends with **Utility → User Bank to MIDI**. The list shows User 1–100
  with their names, and empty slots.
- **Edits them**: rename, copy to another slot (STORE), clear a slot, and edit
  the preset data. Only the name and the Reverb DECAY TIME are decoded so far.
  Every other parameter is shown and edited as a raw byte, in the PRESET DATA
  grid.
- **Sends them back**: SEND BANK sends the whole User bank. The G-Force has no
  known way to receive a single preset or a parameter change, so there is no
  live editing.
- **.syx files**: load or save the whole User bank. You can also drop a file
  anywhere on the page. The files are the same format as the unit's dump.
- **Follows the unit**: clicking a preset in the list sends a bank select and
  program change, so the G-Force recalls the same User preset.
- **Survives reloads**: the bank, including unsent edits, is kept in this
  browser's `localStorage` (`gforce-memory`). Nothing is sent to the G-Force on
  reload. The MIDI settings (ports, channel, SysEx ID, bank select, bank size)
  and the last bank and preset shown are kept in `gforce-editor`. Once the browser has granted MIDI access, the
  editor reconnects to the saved ports on load without pressing CONNECT.

The SysEx format isn't published by TC Electronic. It was worked out from
dumps of a real unit; see [docs/SYSEX_FORMAT.md](docs/SYSEX_FORMAT.md).

## Running

```bash
cd tc_gforce
npm install
npm run dev      # http://localhost:5173
npm test         # codec / bank tests against the real dumps (Node 22+)
npm run build    # static site in dist/
```

Web MIDI with SysEx needs Chrome, Edge or Opera, served from `localhost` or HTTPS.

### G-Force setup

1. Connect MIDI OUT → G-Force MIDI IN and G-Force MIDI OUT → MIDI IN.
2. On the G-Force, check **I/O Setup → MIDI → Sysex device ID**.
3. In the editor, press **CONNECT**, pick the IN and OUT ports and set
   **SYSEX ID** to the same number, and **CH** to the G-Force Basic channel.
4. To recall presets in every bank, set **Mapping mode: External** on the
   G-Force (I/O Setup → MIDI, manual p.22). In any other Mapping mode, the
   unit maps every program change into that one bank. Then set **BANK SEL**
   and **SIZE** (1–128) in the editor to the unit's **Bank selection** and
   **Bank size**:
   - The manual's table, for Bank size 100: bank 0–2 = ROM 1–100 / 101–200 /
     201–225, bank 3 = USER 1–100, banks 4–9 = card banks 1–6. Read as
     positions (bank × 100 + program), User 1 is position 300.
   - For any Bank size, the editor sends bank = position ÷ size and program =
     the remainder. With size 128, User 1 is bank 2, program change 45. Bank
     select stops at bank 127, so very small sizes can't reach the high banks;
     the editor says so.
   - **Coarse Adjust** sends the bank in CC 0 (and CC 32 = 0); **Fine
     Adjust** sends it in CC 32 (and CC 0 = 0).
   - **PC only**: Bank selection disabled; the unit recalls from its Mapping
     mode bank.
   - **Off**: clicking a preset sends nothing.

   The MIDI log shows the bank and program sent for each recall. While
   Fine or Coarse Adjust is selected, the MIDI unit shows a reminder that
   Mapping mode must be External.

**Tempo:** the G-Force has no MIDI clock input (MIDI implementation chart,
p.55), but its TEMPO control can be driven by MIDI pitch bend. On the unit,
**I/O Setup → CONTROL → TEMPO** offers NONE, PEDAL, MIDI BASIC, MIDI CH 1–16
and OMNI, each read from PITCH BEND (seen on a real unit; there is no Learn).
Set it up once:
1. On the G-Force: **I/O Setup**, ► to **CONTROL**, cursor on **TEMPO**, and
   VALUE to **MIDI BASIC** (or a MIDI CH).
2. In the editor, open **TEMPO…** (MIDI unit, or ENTER on TEMPO SETTINGS
   on the Tempo page) and set **SOURCE** to the same setting. MIDI BASIC uses the channel set as CH in the MIDI unit.

The Tempo dialog shows these steps too. From then on, changing **BPM** (20–300)
in the Tempo dialog or on the Tempo page sends the tempo as two taps,
60000 ÷ BPM ms apart. The unit counts every pitch-bend message as a tap (seen
on a real unit), so each tap is a single message, alternating full up and full
down.

**Following MIDI clock:** tick **FOLLOW MIDI CLOCK** in the Tempo dialog and
choose the input that receives the clock (a DAW, a drum machine…; "same as
MIDI IN" uses the G-Force port). The editor measures the tempo over the last
two beats (24 ticks per beat) and sends it, rounded to whole BPM, whenever it
changes. A new tempo waits until the previous one has been sent (one beat), so
the taps never overlap. While it follows, the BPM field is locked. When the clock stops, the dialog shows
"waiting for MIDI clock…". The G-Force itself still can't take MIDI clock:
the editor converts it.

**Banks:** the tabs above the list switch between **ROM**, **USER** and
**CARD 1–6**, like the BANK field on the unit's Recall page. Clicking a preset
in any bank recalls it on the G-Force.
- **USER**: the presets from the dump, which you can edit.
- **ROM**: the 225 factory presets, with names from the manual's preset list
  (`src/rom.ts`). They are read-only: the dump doesn't carry them.
- **CARD 1–6**: presets 1–100 (card bank 6: 1–99), by number only. The
  editor can't read what is on the card. Card presets need Fine or Coarse
  bank select.
- **G-CARD**: with TC's G-Card in the unit, turn this on. CARD 1–3 then show
  the card's 245 preset names (100, 100 and 45) from the preset table of its
  manual (`src/gcard.ts`), and CARD 4–6 are hidden. The setting is kept.

**Getting the bank:** press **RECEIVE BANK**, then on the G-Force go to
**Utility → User Bank to MIDI** and press **Enter** twice. A full bank can take
up to a minute. The billboard shows the progress in percent.

**Sending the bank:** first save a `.syx` backup of what the unit holds. On the
G-Force go to **Utility → MIDI to User Bank** and press **Enter** twice, so it
waits for data. Then press **SEND BANK**. This replaces **all** User presets.
A faulty transfer can leave the User bank empty, so keep the backup.

## Using the panel

| Control | What it does |
|---|---|
| RECALL | as on the unit (manual p.17): PARAMETER moves the cursor between SELECT, BANK and PRESET (its label is inverted); VALUE changes that field (BANK switches ROM / USER / CARD 1–6, PRESET previews); ENTER recalls on the G-Force (a User preset is also loaded into the edit buffer). The SELECT grid shows ALL and the blocks the preset uses, at the unit's fixed places (CPR FIL / PAN PIT DLY / DRV CHO REV): from the data for User presets, from the ROM 1–50 dump for those ROM presets, blank otherwise. SELECT stays on ALL: partial recall is on the unit only |
| STORE | VALUE chooses the target slot, ENTER stores the edit buffer there |
| EFFECTS | the Effects display, drawn like the unit's: "Eff." with the MIX / EDIT / ROUTING / LAYOUT tabs, the In and OUT bars and the edited User preset's block diagram (CPR, FIL, PAN, PIT, DLY, DRV, CHO, REV boxes, as named on the unit, wired through the 8 × 4 routing grid). ◄ ► switch EDIT and ROUTING (MIX and LAYOUT are on the unit only). On EDIT, PARAMETER moves the cursor from block to block; on ROUTING, over every cell. The value strip names the cell, its block and its sub-algorithm. ENTER on a block opens its data at the sub-algorithm byte: there PARAMETER moves through the bytes, VALUE changes them, and EXIT goes back to the diagram. The routing itself is read-only: change it on the unit |
| GATE … REVERB | jump to that block's decoded parameters (REVERB: DECAY TIME). Other blocks are not decoded yet. |
| I/O SETUP | MIDI, CONTROL and AUDIO pages (◄ ►), as on the unit. The MIDI page shows and edits the editor's settings (Basic channel, Program change, Bank selection, Bank size, SysEx ID), which must match the unit's; Mapping mode must be External on the unit. CONTROL and AUDIO are listed but set on the unit only |
| UTILITY | CONFIG and BILLBOARD pages (◄ ►), as on the unit. In CONFIG, USER BANK TO MIDI (the editor receives) and MIDI TO USER BANK (the editor sends) run with ENTER; the other items are on the unit only. Tuner MIDI Out must be Off on the unit for dumps (manual p.29) |
| ◄ ► | switch the pages of Effects (EDIT, ROUTING), I/O Setup and Utility; elsewhere they step like PARAMETER |
| EXIT | back to RECALL; cancels a receive |
| TEMPO | Tempo page, after the unit's (manual p.31): VALUE dials 20–300 BPM, which is sent to the G-Force; the TEMPO source channel is set here too. The key's LED blinks at the tempo |
| BYPASS, TUNER, MOD | on the unit only |

The value strip shows the decoded parameters, the byte under the cursor and the
stored value. The name field renames the edit buffer; STORE writes it. In the
PRESET DATA grid, click a byte to put the cursor on it. Orange bytes differ
from the stored preset.

Keyboard shortcuts: `R` recall, `S` store, `E` effects, `U` utility, `I` I/O setup, `T` tempo, `Enter`,
`Esc` exit, ↑/↓ and ←/→ turn the wheels, `Delete` clears the selected slot.

## Assumptions to verify on hardware

Everything has been tested against the dumps in `docs/samples/` (four User banks A–D, and ROM 1–50 copied to User 1–50, which checks the ROM names) and a
simulated unit, not against the G-Force receiving data.

1. **Receiving a dump**: it isn't known whether the G-Force accepts a bank
   sent this way. The editor sends the header and then each block 60 ms apart
   (a block takes about 44 ms at MIDI speed). If the unit reports an error,
   the gap or the order may need to change (`SEND_GAP_MS` in `src/app.ts`).
2. **SysEx ID**: the byte after `00 20 1F` is taken as the I/O Setup SysEx ID.
   Only ID 0 has been seen. Incoming dumps with another ID are ignored.
3. **Block count and index**: the count is taken as two 7-bit bytes, and the
   block index as wrapping at 128. Both are only seen with small values.
4. **Preset number**: bytes 0–1 of a record are taken as 224 + the User
   number. STORE writes that number when it copies a preset to another slot.
5. **Stored flags**: the 100 bytes after the magic are taken as "slot stored"
   flags. STORE sets the flag to 1 and CLEAR sets it to 0.
6. **DECAY TIME**: the byte at record offset `0x253` is DECAY TIME in 0.1 s
   steps, assumed in the range 0.1–20 s. It was found on the "Mono Reverb"
   preset. Presets with another reverb algorithm or routing may use another
   offset.
7. **Names**: any printable ASCII character is accepted. The G-Force letterbox
   may offer fewer characters.
8. **Preset recall**: confirmed on a real unit with Mapping mode External and
   Bank size 100, with both Coarse and Fine, for ROM and User presets. Other
   Bank sizes and card banks are untested: other sizes assume the unit
   computes bank × size + program and reads it as the table position.
9. **Tempo**: the unit takes every pitch-bend message on its TEMPO source as
   a tap (seen on a real unit: extra messages 5–30 ms apart gave 300 BPM). Two
   taps are sent per tempo, exactly 60000 ÷ BPM ms apart. The unit's reading
   can be off by about 1 BPM (seen: 200 BPM showed 199). Shortening the gap
   by 1 ms overshot to 204, so its tap timer is coarse; no correction is
   applied.
10. **Panel look**: the colours and the Recall and parameter screens follow
   photos of a real unit (yellow-green LCD, red billboard LEDs and key LEDs,
   green meters). The LCD resolution (240 × 100 dots here), the fonts and the
   Store, Utility and Routing screens are approximations. The SELECT grid's
   fixed block places come from one photo (ROM 7: CPR FIL / PIT / REV) and
   the block-code order; PAN, DLY, DRV and CHO's places are inferred.
11. **Routing and sub-algorithms**: found by comparing ROM 1–50
   (`docs/samples/gforce-rom-50.syx`) with the manual's preset list, not by
   single-change dumps (see "Record map from ROM 1–50" in
   `docs/SYSEX_FORMAT.md`). The grid at `0x28` (8 columns × 4 rows, column by
   column) and its block codes fit all 50 presets, and the unit's Effects
   display matches them for ROM 1–7 and 9 (photos), which also show every
   block code with its box name. Only the grid is confirmed; the per-block
   bytes are not. Three sub-algorithm names were read off the unit's LCD:
   Reverb 1 ADVANCED (ROM 1), Filters 2 WAH-WAH (ROM 7) and Delay 4 ONE-TAP
   (ROM 3). These show the bytes do *not* follow the manual's order. Every
   other name is a guess from the preset descriptions and is shown with a
   trailing `?` (for example `DETUNE?`). An unknown value shows as `SUB n`.

Bytes the editor doesn't understand are kept exactly as received. A received
bank that is sent back unedited is byte-identical.

## Decoding more parameters

Each parameter needs two dumps that differ by one known change. Take a dump,
change one parameter of one User preset by one step on the unit, store it, and
take a second dump. Note the block, the parameter and both values. Add the
files to `docs/samples/`, the offset to `PARAMS` in `src/model.ts`, the
finding to `docs/SYSEX_FORMAT.md` and a test to `tests/run.ts`.

## Layout

```
assembly/index.ts      AssemblyScript block codec  → public/gforcecodec.wasm
src/codec.ts           wasm loader / wrapper, dump framing
src/model.ts           User bank and 614-byte preset model, decoded parameters
src/midi.ts            Web MIDI transport
src/app.ts             panel logic, modes, librarian
src/ui/components.ts   wheels, keys, pixel LCD and 5×7 font, LED billboard
src/ui/screens.ts      LCD pages: Recall, Store, parameter list, Utility, Routing
src/rom.ts             names of the 225 ROM presets (from the manual)
src/gcard.ts           names of the 245 G-Card presets (from the G-Card manual)
src/clock.ts           tempo from incoming MIDI clock
docs/G-Force_Manual_EN.pdf  TC Electronic owner's manual
docs/388-tcelectronicGForceBrochure.pdf  G-Card manual and preset list
docs/SYSEX_FORMAT.md   the dump format, as recovered
docs/samples/          User bank dumps from a real G-Force
tests/run.ts           tests
```

## License

Copyright (C) 2026 Alessandro Pilotti

`AGPL-3.0-or-later`, see the repository [LICENSE](../LICENSE).
The owner's manual and the G-Card manual in `docs/` belong to TC Electronic. It is included for
reference only and is not covered by the license.

TC Electronic is a trademark of MUSIC Tribe Global Brands Ltd. This editor is
unofficial and not affiliated with or endorsed by TC Electronic or MUSIC Tribe;
see [Trademarks](../README.md#trademarks).
