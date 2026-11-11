# Rack unit editors

Browser editors and librarians for MIDI rack units. Each editor talks to its
unit over Web MIDI SysEx, lists all of its patches and lets you edit them. Its
screen is laid out like the unit's own front panel.

| Folder | Unit | Docs |
|---|---|---|
| [`korg_a2/`](korg_a2/) | Korg A2 Performance Signal Processor | [korg_a2/README.md](korg_a2/README.md) |
| [`marshall_jmp1/`](marshall_jmp1/) | Marshall JMP-1 valve MIDI pre-amp | [marshall_jmp1/README.md](marshall_jmp1/README.md) |

## Use them online

The editors are published on GitHub Pages:
<https://alexpilotti.github.io/webmidi-rackgear-editors/>. Every push to
`master` rebuilds and redeploys them (`.github/workflows/pages.yml`).

## How the editors are built

- **TypeScript + WebAssembly**: each unit's SysEx codec is written in
  AssemblyScript and compiled to WebAssembly. The UI is plain TypeScript,
  built with Vite and using no UI framework.
- **One folder per unit**: each folder is a self-contained app with its own
  `package.json`, tests, and `docs/` (manuals and format notes).
- **Data safety**: bytes an editor doesn't understand are kept exactly as
  received, so unedited data goes back to the unit byte-identical.

## Running an editor

```bash
cd korg_a2          # or marshall_jmp1
npm install
npm run dev         # http://localhost:5173
npm test            # codec / protocol tests (Node 22+)
npm run build       # static site in dist/
```

Web MIDI with SysEx needs Chrome, Edge or Opera, served from `localhost` or
HTTPS. Without MIDI you can still load and save `.syx` files.

## License

Copyright (C) 2026 Alessandro Pilotti

The code is licensed under the **GNU Affero General Public License v3.0 or
later** (`AGPL-3.0-or-later`); see [LICENSE](LICENSE). If you run a modified
version as a network service, you must offer its source to its users.

The manufacturer documents in the `docs/` folders are not covered by this
license. These are the Korg A2 manuals and the Marshall JMP-1 handbook, which
remain the property of their owners and are included for reference only.

## Trademarks

Korg is a trademark of Korg Inc., and Marshall is a trademark of Marshall
Amplification plc. Product names such as A2 and JMP-1 are used only to
identify the hardware these editors work with.

This project is not affiliated with, endorsed by, or sponsored by Korg or
Marshall. The on-screen panels are recreations for usability and use no
official logos or artwork.
