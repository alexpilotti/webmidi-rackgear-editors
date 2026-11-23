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
  - `.github/`: the GitHub Pages workflow (`workflows/pages.yml`) and the
    landing page (`pages/index.html`) that links to every editor
- A new unit adds a row to the root README's table, and gets its own README.
  It also needs an entry in the `matrix.app` list of
  `.github/workflows/pages.yml` and a card on `.github/pages/index.html`,
  including its brand in that page's footer.

| Folder | Unit | Dev port |
|---|---|---|
| `korg_a2/` | Korg A2 Performance Signal Processor | 5178 |
| `marshall_jmp1/` | Marshall JMP-1 valve MIDI pre-amp | 5179 |
| `tc_gforce/` | TC Electronic G-Force guitar effects processor | 5181 |

## Shared conventions

All apps use the same stack and structure:

- **Stack:** AssemblyScript for the SysEx codec (`assembly/index.ts` →
  `public/*.wasm`, no imports, gitignored build output) and Vite + TypeScript
  for the UI. No app uses a UI framework.
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

Rules for all apps:

- **Unknown bytes are preserved.** Models edit bytes in place. Data sent back
  unedited must stay byte-identical.
- **Guesses are documented.** Anything not stated by the docs is listed under
  "Assumptions to verify on hardware" in the app's README.
- **No hardware tests yet.** Everything has been tested against simulated
  units, not hardware (the JMP-1 and G-Force tests do use dumps recorded from
  real units). Don't claim hardware behaviour is verified.
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
- **Simulating a unit.** `window.a2` / `window.jmp1` / `window.gforce` expose the `App`. To test
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

---

## TC Electronic G-Force (`tc_gforce/`)

User docs are in `tc_gforce/README.md`.

| Path (in `tc_gforce/`) | Role |
|---|---|
| `assembly/index.ts` | Block codec: nibbles, checksum, header count → `public/gforcecodec.wasm` |
| `src/codec.ts` | Dump framing: header + 137-byte blocks ↔ byte stream |
| `src/model.ts` | `Bank` (magic, 100 stored flags, 614-byte records), `Preset`, decoded `PARAMS` |
| `src/midi.ts` | `GfMidi`: raw SysEx listener, paced sending with Web MIDI timestamps |
| `src/ui/components.ts` | `Knob` (Parameter/Value wheels), `PanelKey` (key + LED), `GraphicLcd` (dot framebuffer, 5×7 font), `Billboard` (14×5 LEDs) |
| `src/ui/screens.ts` | LCD pages drawn like the unit's: Recall, Store, parameter list, Utility, Routing |
| `src/rom.ts` | Names of the 225 ROM presets, from the manual's preset list |
| `src/gcard.ts` | Names of the 245 G-Card presets (card banks 1–3), from the G-Card manual's preset table, spelled as the unit stores them, and their blocks, from `docs/samples/gforce-g-card-*.syx` |
| `docs/388-tcelectronicGForceBrochure.pdf` | G-Card manual (software 1.13 changes, preset list); `pdftotext -layout` works |
| `src/clock.ts` | `ClockMeter`: tempo from incoming MIDI clock, for FOLLOW MIDI CLOCK |
| `docs/G-Force_Manual_EN.pdf` | TC owner's manual (a ManualsLib copy); has text, so `pdftotext` works. Page numbers here are the printed ones (PDF page = printed + 2): front panel pp.8–9; Recall p.17; MIDI setup and bank select pp.21–22; the blocks pp.33–51; MIDI implementation chart p.55; preset list pp.57–61 |
| `docs/SYSEX_FORMAT.md` | The dump format, as recovered from real dumps |
| `docs/PARAMETERS.md` | Every block, sub-algorithm and parameter from the manual, with LCD names and offsets as they are found |
| `docs/samples/*.syx` | User bank dumps from a real unit; the tests check against them |

### G-Force rules

- **The format is reverse-engineered, not documented.** TC never published it.
  Every finding comes from diffing dumps in `docs/samples/` that differ by one
  known change. Keep `docs/SYSEX_FORMAT.md`, `PARAMS` in `src/model.ts` and
  the tests in sync, and add the sample pair for each new parameter.
- **Only the whole User bank moves over MIDI.** The unit sends it with
  Utility → User Bank to MIDI, and receives it after Utility → MIDI to User
  Bank is armed. No request, single-preset or parameter message is known, so
  there is no live editing.
- **Slots after the last stored one are not in the dump**; empty slots below
  it are 614 zero bytes. `Bank.stream()` rebuilds the dump and must stay
  byte-identical for unedited banks.
- **Undecoded bytes are edited raw** (PRESET DATA grid), never guessed at.
- **Use the local manual.** Read `docs/G-Force_Manual_EN.pdf` instead of
  fetching the manual online.
- **Panel look.** Follow the manual's front panel drawing (pp.8–9 of the
  printed manual): power, IN/OUT knobs, brand, card slot; the window with
  input meters, graphic LCD and LED dot-matrix billboard with EDITED / MIDI IN
  / PEDAL / OVERFLOW; EFFECTS CONTROL (BYPASS, TUNER, TEMPO and the nine block
  keys); CONTROL (RECALL, STORE, EFFECTS, MOD, I/O SETUP, UTILITY); arrows,
  EXIT, ENTER and the PARAMETER / VALUE wheels.
- **LCD.** A yellow-green graphic LCD with dark dots (`--lcd-*`), drawn dot by
  dot. Recall shows SELECT / BANK / PRESET boxes and the name in a big font;
  parameter pages show a framed title, a PARAM tab, a ▶ list and a bar graph.
  The billboard is a 14×5 grid of red LEDs showing the preset number.
