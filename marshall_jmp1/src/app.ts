// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MESSAGE_LEN, splitSysex, type Codec } from './codec.ts';
import { JmpMidi } from './midi.ts';
import {
  Bank, CHANNELS, FACTORY, MAP_SIZE, PARAMS, PATCH_COUNT, Patch, type Channel, type ParamId,
} from './model.ts';
import { cleanLabel, decodeLabels, encodeLabels, LABEL_MAX } from './labels.ts';
import { h, Knob, LedKey, SevenSeg } from './ui/components.ts';

/** Front-panel modes (handbook pp.2-10). */
type Mode = 'patch' | 'param' | 'store' | 'map' | 'channel' | 'dump';

const pad2 = (n: number) => String(n).padStart(2, '0');
const OMNI = 16;

/** Two-digit field; values 100-127 show the decimal point (handbook p.9). */
const prog2 = (n: number) => (n >= 100 ? `${pad2(n - 100)}.` : pad2(n));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const signed2 = (n: number) => (n < 0 ? `-${-n}` : String(n).padStart(2, ' '));

export class App {
  // ---- data
  bank = new Bank();
  /** What the JMP-1 is believed to hold (last dump received / sent / loaded). */
  baseline = new Bank();
  names: string[] = Array.from({ length: PATCH_COUNT }, () => '');
  current = 0;
  edit: Patch = this.bank.patch(0);

  // ---- panel state
  mode: Mode = 'patch';
  param: ParamId = 'volume';
  storeTarget = 0;
  mapStep = 0;
  mapIn = 0;
  mapDraft = { patch: 0, out: 0 };
  channel = 0; // 0-15, 16 = omni
  channelDraft = 0;
  power = true;
  live = false;
  private dumpDigit: string | null = null;
  private dumpError = false;
  private waitAbort: AbortController | null = null;
  private liveTimer = 0;
  private sending = false;
  private sendAgain = false;

  // ---- ui
  readonly midi = new JmpMidi();
  private display = new SevenSeg(4);
  private keys = {} as Record<string, LedKey>;
  private stripCells: Record<string, HTMLElement> = {};
  private libRows: HTMLElement[] = [];
  private clearBtn!: HTMLButtonElement;
  private mapCells: HTMLElement[] = [];
  private statusEl!: HTMLElement;
  private logEl!: HTMLElement;
  private inSel!: HTMLSelectElement;
  private outSel!: HTMLSelectElement;
  private chSel!: HTMLSelectElement;
  private liveBox!: HTMLInputElement;
  private midiLeds = {} as Record<'in' | 'out', HTMLElement>;
  private btns: Record<string, HTMLButtonElement> = {};
  private fileInput!: HTMLInputElement;

  constructor(private root: HTMLElement, private codec: Codec) {
    this.restore();
    this.build();
    this.wireMidi();
    this.wireKeyboard();
    this.render();
  }

  // =========================================================================
  // Model helpers

  get editDirty(): boolean {
    return !this.edit.equals(this.bank.patch(this.current));
  }

  patchUnsent(i: number): boolean {
    return !this.bank.patchEquals(i, this.baseline);
  }

  get anyUnsent(): boolean {
    return this.bank.stream.some((b, i) => b !== this.baseline.stream[i]);
  }

  private loadEdit(): void {
    this.edit = this.bank.patch(this.current);
  }

  // =========================================================================
  // Front-panel actions

  /** Data entry control. */
  private turnData(delta: number, fast: boolean): void {
    if (!this.power) return;
    const step = fast ? delta * 2 : delta;
    switch (this.mode) {
      case 'patch':
        return this.selectPatch(this.current + delta);
      case 'param': {
        this.edit.set(this.param, this.edit.get(this.param) + Math.sign(step) * Math.max(1, Math.abs(delta)));
        return this.changed();
      }
      case 'store':
        this.storeTarget = (this.storeTarget + delta + PATCH_COUNT * 10) % PATCH_COUNT;
        return this.render();
      case 'map':
        if (this.mapStep === 0) {
          this.mapIn = (this.mapIn + step + MAP_SIZE * 10) % MAP_SIZE;
          this.mapDraft = { patch: this.bank.mapPatch(this.mapIn), out: this.bank.mapOut(this.mapIn) };
        } else if (this.mapStep === 1) {
          this.mapDraft.patch = (this.mapDraft.patch + step + PATCH_COUNT * 10) % PATCH_COUNT;
        } else {
          this.mapDraft.out = (this.mapDraft.out + step + MAP_SIZE * 10) % MAP_SIZE;
        }
        return this.render();
      case 'channel':
        this.channelDraft = (this.channelDraft + delta + 17 * 10) % 17;
        return this.render();
      default:
    }
  }

  private pressParam(id: ParamId): void {
    if (!this.power || this.mode === 'dump') return;
    this.mode = 'param';
    this.param = id;
    this.render();
  }

  private pressChannelKey(c: Channel): void {
    if (!this.power || this.mode === 'dump') return;
    if (this.mode === 'store' || this.mode === 'map' || this.mode === 'channel') this.mode = 'patch';
    this.edit.channel = c;
    this.changed();
  }

  private pressBassShift(): void {
    if (!this.power || this.mode === 'dump') return;
    if (this.mode === 'store' || this.mode === 'map' || this.mode === 'channel') this.mode = 'patch';
    if (!this.edit.channel) this.edit.channel = 'OD1';
    this.edit.bassShift = !this.edit.bassShift;
    this.changed();
  }

  private pressPatch(): void {
    if (!this.power) return;
    if (this.mode === 'dump') return this.cancelWait();
    this.mode = 'patch';
    this.render();
  }

  private pressStore(): void {
    if (!this.power || this.mode === 'dump') return;
    if (this.mode !== 'store') {
      this.mode = 'store';
      this.storeTarget = this.current;
      return this.render();
    }
    // Second press completes the store.
    const target = this.storeTarget;
    if (target !== this.current && !this.names[target]) this.names[target] = this.names[this.current];
    this.bank.setPatch(target, this.edit);
    if (target !== this.current) {
      this.current = target;
      this.loadEdit();
    }
    this.saveNames();
    this.mode = 'patch';
    this.status(`Stored in patch ${pad2(target)}.${this.midi.hasOutput && !this.live ? ' Press SEND DUMP to update the JMP-1.' : ''}`);
    this.changed();
  }

  private pressMap(): void {
    if (!this.power || this.mode === 'dump') return;
    if (this.mode !== 'map') {
      this.mode = 'map';
      this.mapStep = 0;
      this.mapDraft = { patch: this.bank.mapPatch(this.mapIn), out: this.bank.mapOut(this.mapIn) };
    } else if (this.mapStep < 2) {
      this.mapStep++;
    } else {
      // Fourth press stores the edits and returns to patch mode.
      this.bank.setMapPatch(this.mapIn, this.mapDraft.patch);
      this.bank.setMapOut(this.mapIn, this.mapDraft.out);
      this.mode = 'patch';
      this.status(`Mapping stored: program ${this.mapIn} → patch ${pad2(this.mapDraft.patch)} → out ${this.mapDraft.out}.`);
      this.scheduleLive();
    }
    this.render();
  }

  openMapEntry(n: number): void {
    if (!this.power || this.mode === 'dump') return;
    this.mapIn = n;
    this.mode = 'map';
    this.mapStep = 1;
    this.mapDraft = { patch: this.bank.mapPatch(n), out: this.bank.mapOut(n) };
    this.render();
  }

  private pressChannel(): void {
    if (!this.power || this.mode === 'dump') return;
    if (this.mode !== 'channel') {
      this.mode = 'channel';
      this.channelDraft = this.channel;
    } else {
      this.channel = this.channelDraft;
      this.chSel.value = String(this.channel);
      this.saveSettings();
      this.mode = 'patch';
    }
    this.render();
  }

  selectPatch(i: number): void {
    const next = (i + PATCH_COUNT) % PATCH_COUNT;
    if (next === this.current) return;
    if (this.editDirty && !confirm(`Patch ${pad2(this.current)} has edits that are not stored. Discard them?`)) return;
    this.current = next;
    this.loadEdit();
    if (this.mode === 'store' || this.mode === 'map' || this.mode === 'channel') this.mode = 'patch';
    if (this.midi.hasOutput) this.trySend(() => this.midi.programChange(this.txChannel, next));
    this.render();
  }

  private get txChannel(): number {
    return this.channel === OMNI ? 0 : this.channel;
  }

  private changed(): void {
    this.render();
    this.scheduleLive();
  }

  // =========================================================================
  // MIDI

  private wireMidi(): void {
    this.midi.onPortsChanged = () => this.refreshPorts();
    this.midi.onActivity = (d) => this.blink(d);
    this.midi.onProgramChange = (p, ch) => this.log(`← program change ${p} (ch ${ch + 1})`);
    this.midi.onSysex((m) => {
      if (this.waitAbort) return; // handled by receiveDump()
      if (!this.codec.isJmp1(m)) return this.log(`← SysEx (${m.length} bytes, not a JMP-1 dump)`);
      if (this.anyUnsent && !confirm('A dump arrived from the JMP-1. Replace the editor contents (unsent changes will be lost)?')) return;
      this.acceptDump(m, 'Dump received from the JMP-1.');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.midi.connect();
      this.refreshPorts();
      this.status('MIDI ready. Pick the ports connected to the JMP-1.');
    } catch (e) {
      this.error(e as Error);
    }
  }

  private refreshPorts(): void {
    const s = this.settings();
    const fill = (sel: HTMLSelectElement, ports: { id: string; name: string }[], cur: string | null, saved?: string) => {
      sel.replaceChildren(h('option', { value: '', text: '— none —' }), ...ports.map((p) => h('option', { value: p.id, text: p.name })));
      const pick = ports.find((p) => p.id === cur) ?? ports.find((p) => p.name === saved);
      sel.value = pick?.id ?? '';
    };
    fill(this.inSel, this.midi.inputs(), this.midi.inputId, s.input);
    fill(this.outSel, this.midi.outputs(), this.midi.outputId, s.output);
    this.midi.selectInput(this.inSel.value || null);
    this.midi.selectOutput(this.outSel.value || null);
    this.renderMidi();
  }

  private acceptDump(message: Uint8Array, msg: string): void {
    try {
      const stream = this.codec.decode(message);
      this.bank = new Bank(stream);
      this.baseline = this.bank.clone();
      this.loadEdit();
      this.animateBlocks(false);
      this.status(msg);
    } catch (e) {
      this.dumpError = true;
      setTimeout(() => { this.dumpError = false; this.render(); }, 1500);
      this.error(e as Error);
    }
    this.render();
  }

  async receiveDump(): Promise<void> {
    if (this.waitAbort) return this.cancelWait();
    this.waitAbort = new AbortController();
    this.mode = 'dump';
    this.dumpDigit = null;
    this.render();
    this.status('Waiting… On the JMP-1, press PATCH and VOLUME together to send its memory.');
    try {
      const m = await this.midi.waitForSysex((x) => this.codec.isJmp1(x), 120000, this.waitAbort.signal);
      this.waitAbort = null;
      this.mode = 'patch';
      this.acceptDump(m, `Dump received: 100 patches and the MIDI mapping (${m.length} bytes).`);
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') this.error(e as Error);
      else this.status('Receive cancelled.');
      this.waitAbort = null;
      this.mode = 'patch';
      this.render();
    }
  }

  private cancelWait(): void {
    this.waitAbort?.abort();
  }

  /** Send the whole memory. `withEdit` puts the unstored edit buffer into the current slot. */
  private sendDump(withEdit: boolean): void {
    const bank = this.bank.clone();
    if (withEdit) bank.setPatch(this.current, this.edit);
    this.midi.send(this.codec.encode(bank.stream));
    if (!withEdit || !this.editDirty) this.baseline = this.bank.clone();
    this.animateBlocks(true);
  }

  sendDumpClicked(): void {
    if (!confirm('Send the editor memory to the JMP-1? This rewrites all 100 patches and the MIDI mapping (memory lock must be off).')) return;
    this.trySend(() => {
      this.sendDump(false);
      this.midi.programChange(this.txChannel, this.current);
      this.status(`Dump sent (${MESSAGE_LEN} bytes). The JMP-1 counts blocks 0–9 while loading.`);
    });
    this.render();
  }

  /**
   * LIVE: the JMP-1 has no parameter messages, so every change is heard by
   * re-sending the whole dump followed by a program change (as JMP-Editor does).
   */
  private scheduleLive(): void {
    if (!this.live || !this.midi.hasOutput) return;
    clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => this.liveSend(), 350);
  }

  private liveSend(): void {
    if (this.sending) {
      this.sendAgain = true;
      return;
    }
    this.sending = true;
    this.trySend(() => {
      this.sendDump(true);
      this.midi.programChange(this.txChannel, this.current);
    });
    // 1316 bytes take ~0.42 s at 31250 baud; give the unit time to store.
    setTimeout(() => {
      this.sending = false;
      if (this.sendAgain) {
        this.sendAgain = false;
        this.liveSend();
      }
    }, 700);
  }

  private trySend(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.error(e as Error);
    }
  }

  // ---- files
  async loadFile(file: File): Promise<void> {
    try {
      const all = splitSysex(new Uint8Array(await file.arrayBuffer()));
      const msgs = all.filter((m) => this.codec.isJmp1(m));
      if (!msgs.length) throw new Error(`${file.name}: no JMP-1 dump found`);
      this.bank = new Bank(this.codec.decode(msgs[0]));
      const labels = all.map(decodeLabels).find((l) => l !== null);
      if (labels) {
        this.names = labels;
        this.saveNames();
      }
      this.loadEdit();
      this.status(`Loaded ${file.name}${labels ? ' (with editor labels)' : ''}. Press SEND DUMP to transfer it to the JMP-1.`);
      this.render();
    } catch (e) {
      this.error(e as Error);
    }
  }

  /** The dump, followed by the editor-only label message when any label is set (see labels.ts). */
  saveFile(): void {
    const parts: BlobPart[] = [this.codec.encode(this.bank.stream) as BlobPart];
    if (this.names.some((n) => n)) parts.push(encodeLabels(this.names) as BlobPart);
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    h('a', { href: url, download: 'marshall-jmp1.syx' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Blank the selected patch the way the JMP-1 stores an empty slot, and drop its label. */
  clearPatch(): void {
    if (!this.power || this.mode === 'dump') return;
    const i = this.current;
    const label = this.names[i] ? ` "${this.names[i]}"` : '';
    if (!confirm(`Clear patch ${pad2(i)}${label}? It becomes an empty slot (volume and gain 0). The JMP-1 keeps its copy until you send a dump.`)) return;
    const p = this.bank.patch(i);
    p.data.set(Patch.blank().data.subarray(0, 8)); // bytes 8-9 (unknown) are kept
    this.bank.setPatch(i, p);
    this.names[i] = '';
    this.saveNames();
    this.loadEdit();
    this.mode = 'patch';
    this.status(`Patch ${pad2(i)} cleared.${this.live ? '' : ' Press SEND DUMP to update the JMP-1.'}`);
    this.changed();
  }

  loadFactory(): void {
    if (!confirm('Load the 26 factory sounds (handbook p.6) into patches 00–25 of the editor?')) return;
    FACTORY.forEach((f, i) => {
      this.bank.setPatch(i, f.patch);
      this.names[i] = f.name;
    });
    this.saveNames();
    this.loadEdit();
    this.status('Factory sounds loaded into patches 00–25 (Effect set to 0; not sent yet).');
    this.changed();
  }

  // =========================================================================
  // Feedback

  private animateBlocks(sending: boolean): void {
    let i = 0;
    const tick = () => {
      this.dumpDigit = String(i);
      this.renderDisplay();
      if (++i <= 9) setTimeout(tick, sending ? 42 : 30);
      else setTimeout(() => { this.dumpDigit = null; this.renderDisplay(); }, 150);
    };
    tick();
  }

  private status(t: string): void {
    this.statusEl.textContent = t;
    this.statusEl.classList.remove('err');
    this.log(t);
  }

  private error(e: Error): void {
    this.statusEl.textContent = e.message;
    this.statusEl.classList.add('err');
    this.log(`ERROR: ${e.message}`);
    console.error(e);
  }

  private log(t: string): void {
    this.logEl.prepend(h('div', { text: `${new Date().toLocaleTimeString()}  ${t}` }));
    while (this.logEl.childElementCount > 50) this.logEl.lastElementChild!.remove();
  }

  private blink(dir: 'in' | 'out'): void {
    const el = this.midiLeds[dir];
    el.classList.add('on');
    clearTimeout(Number(el.dataset.t));
    el.dataset.t = String(setTimeout(() => el.classList.remove('on'), 90));
  }

  // =========================================================================
  // Persistence (names and settings live in the browser; the JMP-1 has no patch names)

  private settings(): { channel?: number; input?: string; output?: string } {
    try {
      return JSON.parse(localStorage.getItem('jmp1-editor') ?? '{}');
    } catch {
      return {};
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('jmp1-editor', JSON.stringify({
        channel: this.channel,
        input: this.inSel.selectedOptions[0]?.text,
        output: this.outSel.selectedOptions[0]?.text,
      }));
    } catch { /* storage unavailable */ }
  }

  private saveNames(): void {
    try {
      localStorage.setItem('jmp1-names', JSON.stringify(this.names));
    } catch { /* storage unavailable */ }
  }

  private restore(): void {
    this.channel = this.settings().channel ?? 0;
    try {
      const n = JSON.parse(localStorage.getItem('jmp1-names') ?? 'null');
      if (Array.isArray(n)) this.names = Array.from({ length: PATCH_COUNT }, (_, i) => cleanLabel(String(n[i] ?? '')));
      const m = JSON.parse(localStorage.getItem('jmp1-memory') ?? 'null');
      if (m?.bank && m?.baseline) {
        this.bank = new Bank(fromB64(m.bank));
        this.baseline = new Bank(fromB64(m.baseline));
        this.current = Math.max(0, Math.min(PATCH_COUNT - 1, m.current ?? 0));
        this.loadEdit();
      }
    } catch { /* ignore */ }
  }

  private persistTimer = 0;
  /** Keep the editor memory across reloads (browser storage only). */
  private persistSoon(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      try {
        localStorage.setItem('jmp1-memory', JSON.stringify({ bank: toB64(this.bank.stream), baseline: toB64(this.baseline.stream), current: this.current }));
      } catch { /* storage unavailable */ }
    }, 300);
  }

  // =========================================================================
  // DOM

  private build(): void {
    const scaler = h('div', { class: 'scaler' });
    scaler.append(this.buildPanel(), this.buildStrip(), this.buildMidiUnit(), this.buildLibrary(), this.buildMapping());
    this.root.append(scaler);
    const fit = () => scaler.style.setProperty('zoom', String(Math.min(1.25, this.root.clientWidth / 1520)));
    new ResizeObserver(fit).observe(this.root);
    fit();

    this.fileInput = h('input', { type: 'file', accept: '.syx,.mid,application/octet-stream', hidden: '' });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.loadFile(f);
      this.fileInput.value = '';
    });
    this.root.append(this.fileInput);
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f);
    });
  }

  private ear(): HTMLElement {
    return h('div', { class: 'ear' });
  }

  private buildPanel(): HTMLElement {
    const jack = (label: string) => h('div', { class: 'jack-wrap' }, h('div', { class: 'silk', text: label }), h('div', { class: 'jack' }));
    const outLevel = new Knob({ className: 'small', label: 'Output Level', onTurn: () => {} });
    const ring = h('div', { class: 'dot-ring' });
    for (let i = 0; i < 7; i++) {
      const dot = h('i');
      dot.style.transform = `rotate(${-135 + i * 45}deg) translateY(-25px)`;
      ring.append(dot);
    }
    outLevel.el.prepend(ring);
    const left = h('div', { class: 'left' }, jack('Input'), jack('Phones'),
      h('div', { class: 'out-level' }, h('div', { class: 'silk', text: 'Output Level' }), outLevel.el));

    // Inset: logo, display, patch/store, data wheel, parameter + channel keys.
    const logo = h('div', { class: 'logo' }, h('div', { class: 'script', text: 'Marshall' }),
      h('div', { class: 'logo-sub', text: 'VALVE MIDI PRE-AMP' }), h('div', { class: 'logo-model', text: 'JMP-1' }));

    const display = h('div', { class: 'display' },
      h('div', { class: 'display-labels' }, h('span', { text: 'Patch' }), h('span', { text: 'Data' })),
      h('div', { class: 'display-window' }, this.display.el));

    this.keys.patch = new LedKey('Patch', () => this.pressPatch(), 'Patch mode (P) — turn Data to select 00–99');
    this.keys.store = new LedKey('Store', () => this.pressStore(), 'Store (S): press, choose location with Data, press again');
    const ps = h('div', { class: 'key-col' }, this.keys.patch.el, this.keys.store.el);

    const data = new Knob({ className: 'data', label: 'Data entry', onTurn: (d, f) => this.turnData(d, f) });
    const dataWrap = h('div', { class: 'data-wrap' }, h('div', { class: 'data-label', text: 'Data' }),
      h('div', { class: 'data-arc' }, h('span', { class: 'minus', text: '-' }), data.el, h('span', { class: 'plus', text: '+' })));

    const top = PARAMS.map((p) => {
      const k = new LedKey(p.label, () => this.pressParam(p.id), `${p.label} ${p.min}…${p.max}`);
      this.keys[p.id] = k;
      return k.el;
    });
    const bottomDefs: [string, string, () => void][] = [
      ['OD1', 'OD1', () => this.pressChannelKey('OD1')],
      ['OD2', 'OD2', () => this.pressChannelKey('OD2')],
      ['bassShift', 'Bass Shift', () => this.pressBassShift()],
      ['CL1', 'Clean 1', () => this.pressChannelKey('CL1')],
      ['CL2', 'Clean 2', () => this.pressChannelKey('CL2')],
      ['map', 'Map', () => this.pressMap()],
      ['channel', 'Channel', () => this.pressChannel()],
    ];
    const bottom = bottomDefs.map(([id, label, fn]) => {
      const titles: Record<string, string> = {
        map: 'MIDI mapping (M): incoming program → patch → outgoing program; 4th press stores',
        channel: 'MIDI channel 1–16 / omni; press again to store',
      };
      const k = new LedKey(label, fn, titles[id]);
      this.keys[id] = k;
      return k.el;
    });
    const grid = h('div', { class: 'key-grid' }, ...top, ...bottom);

    const inset = h('div', { class: 'inset' }, logo, display, ps, dataWrap, grid);

    const power = h('button', { class: 'power on', 'aria-label': 'Power', title: 'Power' });
    power.addEventListener('click', () => {
      this.power = !this.power;
      power.classList.toggle('on', this.power);
      this.render();
    });
    const right = h('div', { class: 'right' }, h('div', { class: 'silk', text: 'Power' }), power,
      h('div', { class: 'silk small', text: 'Made in England' }));

    return h('section', { class: 'unit jmp1', 'aria-label': 'Marshall JMP-1 front panel' },
      this.ear(), h('div', { class: 'face' }, left, inset, right), this.ear());
  }

  private buildStrip(): HTMLElement {
    const cell = (id: string, label: string, onClick: () => void) => {
      const v = h('div', { class: 'strip-value' });
      const c = h('button', { class: 'strip-cell', title: `Select ${label}` }, h('div', { class: 'strip-title', text: label }), v);
      c.addEventListener('click', onClick);
      this.stripCells[id] = v;
      return c;
    };
    const labelHelp = 'Editor-only label. The JMP-1 does not store names: labels are kept in this browser and saved inside .syx files from SAVE .SYX, but never sent to the unit.';
    const nameInput = h('input', { class: 'name-input', maxlength: String(LABEL_MAX), placeholder: 'add a label', 'aria-label': 'Label (editor only)', title: labelHelp });
    nameInput.addEventListener('input', () => {
      this.names[this.current] = cleanLabel(nameInput.value);
      this.saveNames();
      this.renderLibrary();
    });
    this.stripCells.nameInput = nameInput;
    const head = h('div', { class: 'strip-head' },
      h('div', { class: 'strip-title', title: labelHelp, text: 'Patch · label (editor only)' }),
      h('div', { class: 'strip-head-row' }, h('span', { class: 'strip-num' }), nameInput));
    this.stripCells.num = head.querySelector('.strip-num')!;
    return h('section', { class: 'unit strip' }, this.ear(), h('div', { class: 'face' },
      head,
      cell('channel', 'Channel', () => this.pressChannelKey(this.nextChannel())),
      cell('bassShift', 'Bass Shift', () => this.pressBassShift()),
      ...PARAMS.map((p) => cell(p.id, p.label, () => this.pressParam(p.id))),
      cell('state', 'State', () => {}),
    ), this.ear());
  }

  private nextChannel(): Channel {
    const i = CHANNELS.findIndex((c) => c.id === this.edit.channel);
    return CHANNELS[(i + 1) % CHANNELS.length].id;
  }

  private buildMidiUnit(): HTMLElement {
    this.inSel = h('select', { 'aria-label': 'MIDI input' });
    this.outSel = h('select', { 'aria-label': 'MIDI output' });
    this.chSel = h('select', { 'aria-label': 'MIDI channel' });
    for (let i = 0; i < 16; i++) this.chSel.append(h('option', { value: String(i), text: String(i + 1) }));
    this.chSel.append(h('option', { value: String(OMNI), text: 'Omni' }));
    this.chSel.value = String(this.channel);
    this.inSel.addEventListener('change', () => { this.midi.selectInput(this.inSel.value || null); this.saveSettings(); this.renderMidi(); });
    this.outSel.addEventListener('change', () => { this.midi.selectOutput(this.outSel.value || null); this.saveSettings(); this.renderMidi(); });
    this.chSel.addEventListener('change', () => { this.channel = Number(this.chSel.value); this.saveSettings(); this.render(); });
    this.liveBox = h('input', { type: 'checkbox' });
    this.liveBox.addEventListener('change', () => {
      if (this.liveBox.checked && !confirm('LIVE re-sends the whole JMP-1 memory after every change (the JMP-1 has no other way to receive edits). Your unstored edit is written into the current patch on the unit. Continue?')) {
        this.liveBox.checked = false;
      }
      this.live = this.liveBox.checked;
      if (this.live) this.scheduleLive();
    });

    const btn = (id: string, label: string, fn: () => void, title: string) => {
      const b = h('button', { class: 'rack-btn', title, text: label });
      b.addEventListener('click', fn);
      this.btns[id] = b;
      return b;
    };
    this.midiLeds = { in: h('span', { class: 'led green' }), out: h('span', { class: 'led amber' }) };
    this.statusEl = h('div', { class: 'status', role: 'status' });
    this.logEl = h('div', { class: 'log' });
    const field = (label: string, ctl: HTMLElement) => h('label', { class: 'field' }, h('span', { class: 'silk', text: label }), ctl);

    return h('section', { class: 'unit midi' }, this.ear(), h('div', { class: 'face' },
      h('div', { class: 'midi-brand' }, h('div', { class: 'midi-title', text: 'MIDI' }), h('div', { class: 'silk', text: 'SYSTEM EXCLUSIVE' }),
        h('div', { class: 'midi-leds' }, h('span', { class: 'silk', text: 'IN' }), this.midiLeds.in, h('span', { class: 'silk', text: 'OUT' }), this.midiLeds.out)),
      h('div', { class: 'midi-ports' },
        btn('connect', 'CONNECT', () => void this.connect(), 'Request Web MIDI access (with SysEx)'),
        field('IN', this.inSel), field('OUT', this.outSel), field('CH', this.chSel),
        h('label', { class: 'field check', title: 'Re-send the whole memory after each change' }, this.liveBox, h('span', { class: 'silk', text: 'LIVE' }))),
      h('div', { class: 'midi-actions' },
        btn('receive', 'RECEIVE DUMP', () => void this.receiveDump(), 'Wait for a dump — then press PATCH + VOLUME on the JMP-1'),
        btn('send', 'SEND DUMP', () => this.sendDumpClicked(), 'Send all patches and mapping to the JMP-1 (memory lock off)'),
        btn('factory', 'FACTORY 00–25', () => this.loadFactory(), 'Load the 26 factory sounds from the handbook'),
        btn('load', 'LOAD .SYX', () => this.fileInput.click(), 'Load a JMP-1 dump file'),
        btn('save', 'SAVE .SYX', () => this.saveFile(), 'Save the editor memory as a JMP-1 dump file')),
      h('div', { class: 'midi-status' }, this.statusEl, this.logEl)), this.ear());
  }

  private buildLibrary(): HTMLElement {
    const list = h('div', { class: 'lib-list', role: 'listbox', 'aria-label': 'Patches' });
    for (let i = 0; i < PATCH_COUNT; i++) {
      const row = h('div', { class: 'lib-row', role: 'option' });
      row.addEventListener('click', () => this.selectPatch(i));
      row.addEventListener('dblclick', () => {
        this.selectPatch(i);
        (this.stripCells.nameInput as HTMLInputElement).focus();
      });
      this.libRows.push(row);
      list.append(row);
    }
    this.clearBtn = h('button', { class: 'rack-btn clear-btn', title: 'Clear the selected patch to an empty slot (Delete key)' });
    this.clearBtn.addEventListener('click', () => this.clearPatch());
    const head = h('div', { class: 'lib-cols' }, ...['#', 'Label', 'Ch', 'BS', 'Vol', 'Gain', 'Bass', 'Mid', 'Treb', 'Pres', 'FX', ''].map((t) => h('span', { text: t })));
    return h('section', { class: 'unit library' }, this.ear(), h('div', { class: 'face' },
      h('div', { class: 'lib-head' }, h('div', { class: 'midi-title', text: 'PATCHES' }),
        h('div', { class: 'silk', text: '00–99 · click to select · double-click to label (editor only — the JMP-1 has no names) · ✎ = edited, not stored · * = not sent to the JMP-1' }),
        this.clearBtn),
      h('div', { class: 'lib-scroll' }, head, list)), this.ear());
  }

  private buildMapping(): HTMLElement {
    const grid = h('div', { class: 'map-grid' });
    for (let i = 0; i < MAP_SIZE; i++) {
      const c = h('button', { class: 'map-cell' });
      c.addEventListener('click', () => this.openMapEntry(i));
      this.mapCells.push(c);
      grid.append(c);
    }
    return h('section', { class: 'unit mapping' }, this.ear(), h('div', { class: 'face' },
      h('div', { class: 'lib-head' }, h('div', { class: 'midi-title', text: 'MIDI MAPPING' }),
        h('div', { class: 'silk', text: 'incoming program → internal patch → outgoing program · click an entry to edit it with the MAP key' })),
      grid), this.ear());
  }

  private wireKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.classList?.contains('knob-body')) return;
      const k = e.key.toLowerCase();
      // When stepping through patches (patch mode, choosing a STORE location), ↑/↓ follow
      // the patch list: ↑ = previous patch. Elsewhere ↑ raises the value as usual.
      const listMode = this.mode === 'patch' || this.mode === 'store';
      const up = listMode ? -1 : 1;
      if (e.key === 'ArrowUp') this.turnData(up, false);
      else if (e.key === 'ArrowDown') this.turnData(-up, false);
      else if (e.key === 'ArrowRight') this.turnData(1, false);
      else if (e.key === 'ArrowLeft') this.turnData(-1, false);
      else if (k === 'p' || e.key === 'Escape') this.pressPatch();
      else if (k === 's' || (e.key === 'Enter' && this.mode === 'store')) this.pressStore();
      else if (k === 'm') this.pressMap();
      else if (e.key === 'Delete') this.clearPatch();
      else return;
      e.preventDefault();
    });
  }

  // =========================================================================
  // Rendering

  render(): void {
    this.persistSoon();
    this.renderDisplay();
    this.renderKeys();
    this.renderStrip();
    this.renderLibrary();
    this.renderMapping();
    this.renderMidi();
  }

  private renderDisplay(): void {
    this.root.classList.toggle('powered-off', !this.power);
    // Store mode and waiting for a dump blink; everything else is steady.
    this.display.setBlink(this.power && !this.dumpError && this.dumpDigit === null && (this.mode === 'store' || this.mode === 'dump'));
    if (!this.power) return this.display.set('    ');
    if (this.dumpError) return this.display.set('  Er');
    if (this.dumpDigit !== null) return this.display.set(`   ${this.dumpDigit}`);
    const p = pad2(this.current);
    switch (this.mode) {
      case 'patch':
        return this.display.set(`${p}  `);
      case 'param':
        return this.display.set(`${p}${signed2(this.edit.get(this.param))}`);
      case 'store':
        return this.display.set(`${pad2(this.storeTarget)}  `);
      case 'map':
        if (this.mapStep === 0) return this.display.set(`In${prog2(this.mapIn)}`);
        if (this.mapStep === 1) return this.display.set(`to${pad2(this.mapDraft.patch)}`);
        return this.display.set(`ot${prog2(this.mapDraft.out)}`);
      case 'channel':
        return this.display.set(`Ch${this.channelDraft === OMNI ? 'on' : String(this.channelDraft + 1).padStart(2, ' ')}`);
      case 'dump':
        return this.display.set('--  ');
    }
  }

  private renderKeys(): void {
    const on = this.power;
    const set = (id: string, s: 'off' | 'on' | 'flash') => this.keys[id].set(on ? s : 'off');
    set('patch', this.mode === 'patch' || this.mode === 'dump' ? 'on' : 'off');
    set('store', this.mode === 'store' ? 'flash' : 'off');
    for (const p of PARAMS) set(p.id, this.mode === 'param' && this.param === p.id ? 'on' : 'off');
    for (const c of CHANNELS) set(c.id, this.edit.channel === c.id ? 'on' : 'off');
    set('bassShift', this.edit.channel && this.edit.bassShift ? 'on' : 'off');
    set('map', this.mode === 'map' ? 'on' : 'off');
    set('channel', this.mode === 'channel' ? 'on' : 'off');
  }

  private renderStrip(): void {
    const e = this.edit;
    const ch = CHANNELS.find((c) => c.id === e.channel);
    const sel = (id: string, active: boolean) => this.stripCells[id].parentElement!.classList.toggle('sel', active);
    this.stripCells.num.textContent = pad2(this.current);
    const input = this.stripCells.nameInput as HTMLInputElement;
    if (document.activeElement !== input) input.value = this.names[this.current];
    this.stripCells.channel.textContent = ch ? ch.name : `? (0x${e.mode.toString(16).padStart(2, '0')})`;
    this.stripCells.bassShift.textContent = e.channel ? (e.bassShift ? 'On' : 'Off') : '—';
    for (const p of PARAMS) {
      const v = e.get(p.id);
      this.stripCells[p.id].textContent = p.tone && v > 0 ? `+${v}` : String(v);
      sel(p.id, this.mode === 'param' && this.param === p.id);
    }
    const unsent = this.patchUnsent(this.current);
    this.stripCells.state.textContent = this.editDirty ? 'Edited · not stored' : unsent ? 'Stored · not sent' : e.isBlank ? 'Blank patch' : 'Stored';
    this.stripCells.state.parentElement!.classList.toggle('warn', this.editDirty);
  }

  private renderLibrary(): void {
    if (this.clearBtn) {
      this.clearBtn.textContent = `CLEAR PATCH ${pad2(this.current)}`;
      const blank = this.edit.isBlank && !this.editDirty && !this.names[this.current];
      this.clearBtn.disabled = !this.power || this.mode === 'dump' || blank;
    }
    for (let i = 0; i < PATCH_COUNT; i++) {
      const p = i === this.current ? this.edit : this.bank.patch(i);
      const ch = CHANNELS.find((c) => c.id === p.channel);
      const tone = (id: ParamId) => {
        const v = p.get(id);
        return v > 0 ? `+${v}` : String(v);
      };
      const edited = i === this.current && this.editDirty;
      const blank = p.isBlank;
      const cells = [
        pad2(i), this.names[i] || (blank ? '—' : ''),
        blank ? '' : ch ? ch.label.replace('Clean ', 'CL') : '?', !blank && ch && p.bassShift ? 'BS' : '',
        ...(blank ? ['', '', '', '', '', '', ''] : [String(p.get('volume')), String(p.get('gain')), tone('bass'), tone('middle'), tone('treble'), tone('presence'), String(p.get('effect'))]),
        `${edited ? '✎' : ''}${this.patchUnsent(i) ? '*' : ''}`,
      ];
      const row = this.libRows[i];
      row.replaceChildren(...cells.map((t, k) => h('span', { class: k === 1 ? 'name' : k === 0 ? 'n' : k === 11 ? 'flags' : '', text: t })));
      row.classList.toggle('sel', i === this.current);
      row.classList.toggle('blank', blank);
      row.setAttribute('aria-selected', String(i === this.current));
    }
  }

  private renderMapping(): void {
    for (let i = 0; i < MAP_SIZE; i++) {
      const editing = this.mode === 'map' && this.mapIn === i;
      const patch = editing ? this.mapDraft.patch : this.bank.mapPatch(i);
      const out = editing ? this.mapDraft.out : this.bank.mapOut(i);
      const c = this.mapCells[i];
      c.replaceChildren(h('span', { class: 'in', text: String(i) }), h('span', { class: 'p', text: pad2(patch) }), h('span', { class: 'o', text: String(out) }));
      c.classList.toggle('sel', editing);
      c.classList.toggle('custom', patch !== i % PATCH_COUNT || out !== i);
      c.title = `Program ${i} → patch ${pad2(patch)} → out ${out}`;
    }
  }

  private renderMidi(): void {
    if (!this.statusEl) return;
    const c = this.midi.connected, out = this.midi.hasOutput, inp = !!this.midi.inputId;
    this.btns.connect.textContent = c ? 'RESCAN' : 'CONNECT';
    this.inSel.disabled = !c;
    this.outSel.disabled = !c;
    this.btns.receive.disabled = !inp;
    this.btns.receive.textContent = this.waitAbort ? 'CANCEL' : 'RECEIVE DUMP';
    this.btns.send.disabled = !out || !!this.waitAbort;
    this.liveBox.disabled = !out;
    if (!this.statusEl.textContent) {
      this.statusEl.textContent = JmpMidi.supported
        ? 'Press CONNECT and pick the JMP-1 ports, then RECEIVE DUMP and press PATCH + VOLUME on the JMP-1.'
        : 'Web MIDI is unavailable in this browser — use Chrome or Edge. You can still load/save .syx files.';
    }
  }
}
