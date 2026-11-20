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

**Banks:** the tabs above the list switch between **ROM**, **USER** and
**CARD 1–6**, like the BANK field on the unit's Recall page. Clicking a preset
in any bank recalls it on the G-Force.
- **USER**: the presets from the dump, which you can edit.
- **ROM**: the 225 factory presets, with names from the manual's preset list
  (`src/rom.ts`). They are read-only: the dump doesn't carry them.
- **CARD 1–6**: presets 1–100 (card bank 6: 1–99), by number only. The
  editor can't read what is on the card. Card presets need Fine or Coarse
  bank select.

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
| RECALL | PARAMETER (or ◄ ►, ←/→) switches the bank, VALUE (or ↑/↓) chooses the preset, ENTER recalls it on the G-Force (a User preset is also loaded into the edit buffer) |
| STORE | VALUE chooses the target slot, ENTER stores the edit buffer there |
| EFFECTS | edit mode: PARAMETER (or ◄ ►) moves through the preset bytes, VALUE changes the one under the cursor |
| GATE … REVERB | jump to that block's decoded parameters (REVERB: DECAY TIME). Other blocks are not decoded yet. |
| UTILITY | PARAMETER/VALUE choose User Bank to MIDI or MIDI to User Bank, ENTER starts it |
| EXIT | back to RECALL; cancels a receive |
| BYPASS, TUNER, TEMPO, MOD, I/O SETUP | on the unit only |

The value strip shows the decoded parameters, the byte under the cursor and the
stored value. The name field renames the edit buffer; STORE writes it. In the
PRESET DATA grid, click a byte to put the cursor on it. Orange bytes differ
from the stored preset.

Keyboard shortcuts: `R` recall, `S` store, `E` edit, `U` utility, `Enter`,
`Esc` exit, ↑/↓ and ←/→ turn the wheels, `Delete` clears the selected slot.

## Assumptions to verify on hardware

Everything has been tested against the four dumps in `docs/samples/` and a
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
9. **Panel look**: the colours and the Recall and parameter screens follow
   photos of a real unit (yellow-green LCD, red billboard LEDs and key LEDs,
   green meters). The LCD resolution (240 × 100 dots here), the fonts and the
   Store and Utility screens are approximations. The SELECT grid on Recall
   only shows ALL, because the editor doesn't decode which blocks a preset
   uses.

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
src/ui/screens.ts      LCD pages: Recall, Store, parameter list, Utility
src/rom.ts             names of the 225 ROM presets (from the manual)
docs/G-Force_Manual_EN.pdf  TC Electronic owner's manual
docs/SYSEX_FORMAT.md   the dump format, as recovered
docs/samples/          User bank dumps from a real G-Force
tests/run.ts           tests
```

## License

Copyright (C) 2026 Alessandro Pilotti

`AGPL-3.0-or-later`, see the repository [LICENSE](../LICENSE).
The owner's manual in `docs/` belongs to TC Electronic. It is included for
reference only and is not covered by the license.

TC Electronic is a trademark of MUSIC Tribe Global Brands Ltd. This editor is
unofficial and not affiliated with or endorsed by TC Electronic or MUSIC Tribe;
see [Trademarks](../README.md#trademarks).
