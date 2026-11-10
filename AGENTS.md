# Rack unit editors — agent guide

This repository holds WebAssembly + TypeScript web apps that connect to MIDI
rack units. Each app lists all of the unit's patches and lets the user edit them.

- The UI must resemble the unit itself.
- Each app lives in its own folder with its own `package.json`, `README.md`,
  docs and tests.
- The repository root holds only repo-wide files:
  - `AGENTS.md`
  - `README.md`: the overview of all editors, plus the License and Trademarks
    sections
  - `LICENSE`
  - `.gitignore`
  - the `.claude/` tooling config
- A new unit adds a row to the root README's table, and gets its own README.

| Folder | Unit | Dev port |
|---|---|---|
| `korg_a2/` | Korg A2 Performance Signal Processor | 5178 |
| `marshall_jmp1/` | Marshall JMP-1 valve MIDI pre-amp | 5179 |

## Shared conventions

Both apps use the same stack and structure:

- **Stack:** AssemblyScript for the SysEx codec (`assembly/index.ts` →
  `public/*.wasm`, no imports, gitignored build output) and Vite + TypeScript
  for the UI. Neither app uses a UI framework.
- **Layout:** `src/codec.ts` loads the wasm; `src/midi.ts` is the Web MIDI
  transport; `src/app.ts` holds panel modes, MIDI flows, librarian and
  rendering; `src/ui/components.ts` holds knobs, keys and displays; all styling
  is in `src/style.css`.
- **Tests:** `tests/run.ts` uses no framework. Run with `npm test`
  (Node 22+, `--experimental-strip-types`).

Run these from the app's folder after changes:

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

Rules for both apps:

- **Unknown bytes are preserved.** Models edit bytes in place. Data sent back
  unedited must stay byte-identical.
- **Guesses are documented.** Anything not stated by the docs is listed under
  "Assumptions to verify on hardware" in the app's README.
- **No hardware tests yet.** Everything has been tested against simulated
  units, not hardware. Don't claim hardware behaviour is verified.
- **Rack look.** The UI is a 19" rack: the unit's front panel, a value strip, a
  MIDI unit and lists. It is laid out at a fixed 1520px width and scaled with
  CSS `zoom`. Text uses the Helvetica font stack. Hardware LEDs keep their real
  colours.
- **Trademarks.** Brand names are used only to identify the hardware.
  - Panels recreate the layout but never use official logo artwork: brand
    names are set in ordinary fonts.
  - Every editor page ends with a `footer.disclaimer` ("Unofficial editor ·
    not affiliated with or endorsed by …").
  - The root README has a Trademarks section. Add each new unit's brand to
    both places.
  - Claim only marks known to be registered, such as the brand name.
    Model numbers (A2, JMP-1) are not claimed; they are only "used to identify
    the hardware".
- **Simulating a unit.** `window.a2` / `window.jmp1` expose the `App`. To test
  MIDI flows, replace `app.midi.output` with a fake whose `send()` replies
  through `app.midi.handle(bytes)`. For the JMP-1, also set `app.midi.input` so
  RECEIVE DUMP is enabled. Tests in the browser pane leave data in its
  `localStorage`; clear it afterwards.
- **Dev server.** The browser pane's `preview_start` with `.claude/launch.json`
  has hung in this environment. Instead, start Vite from the shell in the
  background:
  `cd <app> && node node_modules/vite/bin/vite.js --port <port> --strictPort`
  Then open the URL with `preview_start` and a `url`.

---

## Korg A2 (`korg_a2/`)

The PDFs in `korg_a2/docs/` are the source of truth for the A2's SysEx
messages, parameters and chains. User docs, the protocol summary and the
unverified assumptions are in `korg_a2/README.md`.

| Path (in `korg_a2/`) | Role |
|---|---|
| `assembly/index.ts` | Korg 7-in-8 pack/unpack → `public/a2codec.wasm` |
| `src/sysex.ts` | SysEx builders and parsers (header `F0 42 3n 2D`) |
| `src/program.ts` | 64-byte program model (`Program`) |
| `src/effects.ts` | 44 effect groups, their parameters, and the 97 chains |
| `src/midi.ts` | `A2Midi`, request/reply via `waitFor` |
| `src/ui/components.ts` | `Knob`, `Lcd` (40×1), `SevenSeg` |

### Where the A2 docs are

The PDFs are mostly scans; `pdftotext` returns nothing for them, so use OCR
(`pdftoppm` + `tesseract`) or read the page images.

- `korg_a2/docs/Korg_A2.pdf`
  - pp.33–34: MIDI implementation, message formats, TABLE 1 (program layout)
  - pp.41–78: effect parameters, names and ranges
  - p.4: front panel drawing
  - p.9: LCD display format
- `korg_a2/docs/Korg-A2ProgramChainList.pdf`: the 97 chain diagrams.
- `korg_a2/docs/Korg-A2EffectParameterList.pdf`: the same parameters in Japanese.

### A2 rules

- **Encoding guesses live only in `src/effects.ts`.**
- **LCD colour:** the LCD and LCD-like screens use a blue backlight
  (`--lcd-bg`, `--lcd-bg-2`, `--lcd-ink`), not green.
- **Other colours:** red program display; green/amber meter.

---

## Marshall JMP-1 (`marshall_jmp1/`)

User docs are in `marshall_jmp1/README.md`.

| Path (in `marshall_jmp1/`) | Role |
|---|---|
| `assembly/index.ts` | Dump codec: header, 10 blocks, checksums ↔ 1280-byte stream → `public/jmp1codec.wasm` |
| `src/model.ts` | `Bank` (stream, mapping tables), `Patch` (10 bytes), handbook factory sounds |
| `src/midi.ts` | `JmpMidi`: raw SysEx listener, `waitForSysex`, program change |
| `src/ui/components.ts` | `Knob` (Data wheel), `LedKey` (round key + LED), `SevenSeg` (with decimal points) |
| `docs/JMP1_Handbook_EN.pdf` | Marshall handbook (Nov '98); has text, so `pdftotext` works |
| `docs/SYSEX_FORMAT.md` | The dump format, with disassembly evidence |

### JMP-1 rules

- **The format is reverse-engineered, not documented.** The handbook gives no
  byte layout. `docs/SYSEX_FORMAT.md` was recovered from the 2004 freeware
  JMP-Editor 0.9.03, by static analysis of its unpacked installer (never run).
  Keep that doc in sync with any format change.
- **Real dump:** `docs/samples/marshall-jmp1.syx` comes from a real unit, and
  the tests check against it.
  - Tones are value + 7 (`TONE_OFFSET`).
  - The mode byte is a set of relay bits: decode by bits and change only the
    bits you need. Don't use a lookup table.
- **No dump request exists.** The user must press PATCH + VOLUME on the unit.
  Sending a dump rewrites all memory (memory lock must be off). The unit
  accepts only SysEx and Program Change, so LIVE edits work by re-sending the
  whole dump plus a program change.
- **No patch names on the unit.** The UI calls them "labels (editor only)" and
  must keep saying so.
  - Labels, the editor memory and settings are kept in `localStorage`
    (`jmp1-names`, `jmp1-memory`, `jmp1-editor`).
  - `.syx` files carry labels as an extra `F0 7D "JMP1L"` message
    (`src/labels.ts`). This message is never sent to the unit.
- **Panel look.** Follow the handbook p.12 drawing:
  - brushed-gold rack face (`--chassis-*` variables, as on the real unit; the
    handbook drawing is monochrome), with Input/Phones jacks and Output Level
    on the left
  - a dark rounded inset holding the script logo, a 4-digit red display
    (Patch | Data), Patch/Store keys, the Data wheel, and two rows of seven
    round keys with red LEDs
  - Power on the right
- **Display codes:**
  - `In nn` / `to nn` / `ot nn` for MAP, where a decimal point marks 100–127
  - `Ch nn` / `Chon` for the MIDI channel
  - `--` while waiting for a dump, and `Er` on a bad dump
