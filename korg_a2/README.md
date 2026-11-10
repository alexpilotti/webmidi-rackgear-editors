# Korg A2 Editor

A browser editor and librarian for the **Korg A2 Performance Signal Processor**.
It talks to the unit over Web MIDI SysEx and draws a front panel modelled on
the real A2.

- **TypeScript + WebAssembly**: the Korg 7‑in‑8 SysEx codec is written in
  AssemblyScript (`assembly/index.ts`) and compiled to `public/a2codec.wasm`.
  The UI is plain TypeScript, built with Vite.
- **Lists all patches**: GET ALL requests the 100 internal programs (SysEx `1C` → `4C`).
- **Edits them**: chain, variations, effect on/off, all effect parameters, name,
  master volume and threshold. Changes go live to the A2 edit buffer (`40`).
  WRITE stores them (`11`), including copying a program to another number.
- **.syx files**: load or save the whole bank or a single program. You can also drop a file anywhere on the page.

## Running

```bash
cd korg_a2
npm install
npm run dev      # http://localhost:5173
npm test         # codec / protocol / data tests (Node 22+)
npm run build    # static site in dist/
```

Web MIDI with SysEx needs Chrome, Edge or Opera, served from `localhost` or HTTPS.

### A2 setup

1. Connect MIDI OUT → A2 MIDI IN and A2 MIDI OUT → MIDI IN. Set the rear switch to **OUT**, not THRU.
2. On the A2, go to **UTILITY → MIDI**. Set **EXCLUSIVE ON** (shown in capitals) and note the channel.
3. In the editor, press **CONNECT**. Pick the IN and OUT ports and set **CH** to the A2's channel.
4. Press **GET ALL**.

## Using the panel

The controls work like the hardware (owner's manual pp.9–24).

| Control | Play mode | PARAM EDIT mode |
|---|---|---|
| CHAIN/EFFECT turn | chain 01–97 | choose the effect (A–F) to edit |
| CHAIN/EFFECT press | BYPASS (CC 91) | BYPASS |
| A–F turn | effect variation | parameter value (Shift = fine) |
| A–F press | effect on/off (lowercase on the LCD = off) | edit that effect |
| DISPLAY SELECT | INDIVID ↔ PERFORM view | show all values |
| ▲ / ▼ | program up/down (sends program change) | — |
| UTILITY | A cursor, B character (or type), C volume, D threshold, E MIDI channel, F exit | |
| WRITE | WRITE prompt: A turns the target program, A press or Enter confirms, F cancels | |

Knobs respond to drag (vertical or horizontal), the mouse wheel and the arrow keys.
In play mode, clicking an effect name on the LCD opens it for editing.
The scribble strip below the panel shows each parameter's full name, value and unit.
Hover a strip cell to see the raw byte.

Keyboard shortcuts: ↑/↓ previous/next program (as in the program list), `E` edit, `U` utility, `D` display select, `W` write,
`1`–`6` pick an effect (in edit mode), `Esc` back to play.

## Protocol (owner's manual pp.33–34)

Header `F0 42 3n 2D` (n = channel), then the function byte:

| Fn | Direction | Message |
|---|---|---|
| 10 | → A2 | program parameter dump request |
| 1C | → A2 | all program parameter dump request |
| 11 `0c 0ppppppp` | → A2 | write edit buffer to bank c, program p |
| 40 + 74 bytes | ↔ | one program (64 bytes, 7‑in‑8 packed) |
| 4C + 9363 + 7315 bytes | ↔ | chain data (8192) + 100 programs (6400) |
| 21/22, 23/24, 26 | A2 → | write ok/error, load ok/error, format error |

Program layout (TABLE 1): chain number, volume, threshold, variation nibbles,
a 7‑character name, and 8 FX slots × 6 parameter bytes (see `src/program.ts`).

## Assumptions to verify on hardware

The manuals give the *displayed* range of every parameter, but they don't
document the raw byte encoding. These choices are best guesses. Once you can
compare the editor with the A2's own LCD, check them and adjust
`src/effects.ts`. Each one lives in a single place.

1. **Parameter bytes**: a byte is taken as an index into the displayed value list.
   Ranges that cross zero (‑12…+12, ‑99…+99, pan L50…R50) are taken as signed
   two's‑complement step counts. Some step sizes aren't stated and were chosen to fit a byte:
   stereo‑delay time in 2 ms steps, mid frequency in 0.05 kHz steps, and pitch in 5‑cent steps.
2. **Effect on/off**: variations only use bits 0–2 of each nibble, so bit 3 is
   treated as "effect OFF".
3. **FX slots**: slots 1–6 map to chain blocks A–F. Slots 7–8 are kept untouched.
4. **Chain 39**: the chain chart is ambiguous about which block is C. It is modelled as EQ, S.DLY, MIXER, REV II, COLOR.
5. **All‑dump "f" byte**: NOTE 6 mentions an `f` selector that the message table
   omits. Incoming dumps are accepted with or without it. Outgoing dumps omit it.
6. Card chains (`0x80–0x89`) aren't defined in the docs, so their parameters appear as raw bytes.

Bytes the editor doesn't understand are kept exactly as received. A received
program that is sent back unedited therefore stays byte‑identical.

## Layout

```
assembly/index.ts      AssemblyScript 7-in-8 codec  → public/a2codec.wasm
src/codec.ts           wasm loader / wrapper
src/sysex.ts           message builders & parsers
src/program.ts         64-byte program model
src/effects.ts         44 effect groups, parameters, 97 chains
src/midi.ts            Web MIDI transport
src/app.ts             panel logic, modes, librarian
src/ui/components.ts   knob, LCD, 7-segment LED
docs/                  Korg manuals: owner's manual, effect parameter list, chain list
tests/run.ts           tests
```

## License

Copyright (C) 2026 Alessandro Pilotti

`AGPL-3.0-or-later`, see the repository [LICENSE](../LICENSE).
The PDFs in `docs/` are Korg's manuals, included for reference only and not
covered by the license.

Korg is a trademark of Korg Inc. This editor is unofficial and not affiliated
with or endorsed by Korg; see [Trademarks](../README.md#trademarks).
