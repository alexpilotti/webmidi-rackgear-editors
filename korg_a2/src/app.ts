// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Codec } from './codec.ts';
import {
  CHAIN_COUNT, chainBlocks, formatValue, stepRaw, type EffectGroup, type ParamDef,
} from './effects.ts';
import { A2Midi } from './midi.ts';
import { NAME_LENGTH, Program } from './program.ts';
import {
  buildAllDump, buildProgramDump, buildRequest, buildWriteRequest, decodeAllDump,
  CHAIN_DATA_SIZE, decodeProgramDump, FN_NAMES, Fn, hex, parseMessage, PROGRAM_COUNT, PROGRAM_SIZE, splitSysex,
  type A2Message,
} from './sysex.ts';
import { h, Knob, Lcd, SevenSeg } from './ui/components.ts';

type Mode = 'play' | 'edit' | 'utility' | 'write';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~';

/** Fallback for card chains / unknown chains: show raw bytes. */
const RAW_PARAM = (i: number): ParamDef => ({
  label: `P${i + 1}`, name: `RAW BYTE ${i + 1}`, unit: '', zero: 0,
  values: Array.from({ length: 256 }, (_, v) => String(v)),
});
const RAW_GROUP: EffectGroup = {
  id: 'RAW', name: 'UNKNOWN (CARD CHAIN)', variations: [['????', 'unknown']],
  params: [0, 1, 2, 3, 4, 5].map(RAW_PARAM),
};

const pad = (s: string | number, n: number) => String(s).padStart(n, '0');
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const MEMORY_KEY = 'a2-memory';

export class App {
  // ---- data
  programs: Program[] = Array.from({ length: PROGRAM_COUNT }, () => Program.init('INIT'));
  originals: Program[] = this.programs.map((p) => p.clone());
  chainData: Uint8Array | null = null;
  current = 0;
  hasData = false;
  private noDataEl = h('div', { class: 'no-data', text: 'NO DATA FROM THE A2 YET · PLACEHOLDER PROGRAMS · USE GET ALL OR LOAD .SYX' });

  // ---- panel state
  mode: Mode = 'play';
  showPerform = false;
  showAllValues = false;
  editSlot = 0;
  touched: number | null = null;
  bypass = false;
  power = true;
  utilCursor = 0;
  channel = 0;
  liveSend = true;
  private message: { text: string; until: number } | null = null;
  private liveTimer = 0;
  private busy = false;

  // ---- ui
  readonly midi = new A2Midi();
  private lcd = new Lcd(40);
  private led = new SevenSeg(3);
  private knobs: Knob[] = [];
  private chainKnob!: Knob;
  private ledEls: Record<string, HTMLElement> = {};
  private meter: HTMLElement[] = [];
  private strip: HTMLElement[] = [];
  private libRows: HTMLElement[] = [];
  private statusEl!: HTMLElement;
  private logEl!: HTMLElement;
  private inSel!: HTMLSelectElement;
  private outSel!: HTMLSelectElement;
  private chSel!: HTMLSelectElement;
  private midiLeds: Record<'in' | 'out', HTMLElement> = {} as never;
  private actionBtns: Record<string, HTMLButtonElement> = {};
  private fileInput!: HTMLInputElement;

  constructor(private root: HTMLElement, private codec: Codec) {
    this.build();
    this.restoreSettings();
    this.restoreMemory();
    window.addEventListener('pagehide', () => this.persist()); // don't lose the last 300 ms
    this.wireMidi();
    this.wireKeyboard();
    this.flash('   KORG A2  PERFORMANCE SIGNAL PROCESSOR', 1600);
    this.render();
    setInterval(() => this.tick(), 250);
  }

  // =========================================================================
  // Model helpers

  get prog(): Program {
    return this.programs[this.current];
  }

  blocks(p = this.prog): EffectGroup[] {
    if (p.isCardChain || p.chain < 1 || p.chain > CHAIN_COUNT) return [RAW_GROUP];
    return chainBlocks(p.chain);
  }

  isDirty(i: number): boolean {
    return !this.programs[i].equals(this.originals[i]);
  }

  private chainLabel(p: Program): string {
    if (p.isCardChain) return `C${p.chain & 0x0f}`;
    return pad(p.chain, 2).slice(-2);
  }

  private abbr(g: EffectGroup, p: Program, slot: number): string {
    const v = g.variations[Math.min(p.variation(slot), g.variations.length - 1)][0];
    return p.isOff(slot) ? v.toLowerCase() : v;
  }

  effectSummary(p: Program): string {
    return this.blocks(p).map((g, i) => this.abbr(g, p, i)).join('-');
  }

  private changed(): void {
    this.render();
    this.scheduleLiveSend();
  }

  // =========================================================================
  // Front-panel actions

  private turnChain(delta: number): void {
    if (!this.power) return;
    this.message = null;
    const p = this.prog;
    if (this.mode === 'play') {
      if (p.isCardChain) return;
      p.chain = Math.max(1, Math.min(CHAIN_COUNT, p.chain + delta));
      this.changed();
    } else if (this.mode === 'edit') {
      const n = this.blocks().length;
      this.editSlot = Math.max(0, Math.min(n - 1, this.editSlot + delta));
      this.touched = null;
      this.render();
    } else if (this.mode === 'write') {
      this.writeTarget = Math.max(0, Math.min(PROGRAM_COUNT - 1, this.writeTarget + delta));
      this.render();
    }
  }

  private pressChain(): void {
    if (!this.power) return;
    this.message = null;
    if (this.mode === 'write') return this.cancelWrite();
    this.bypass = !this.bypass;
    if (this.midi.hasOutput) this.trySend(() => this.midi.bypass(this.channel, this.bypass));
    this.render();
  }

  private turnEditor(k: number, delta: number, fine: boolean): void {
    if (!this.power) return;
    this.message = null;
    const p = this.prog;
    const blocks = this.blocks();
    if (this.mode === 'play') {
      const g = blocks[k];
      if (!g || g.variations.length < 2) return;
      p.setVariation(k, Math.max(0, Math.min(g.variations.length - 1, p.variation(k) + delta)));
      this.changed();
    } else if (this.mode === 'edit') {
      const g = blocks[this.editSlot];
      const def = g?.params[k];
      if (!def) return;
      const step = fine ? 1 : Math.abs(delta) >= 10 ? delta : delta * this.accel(def);
      p.setParam(this.editSlot, k, stepRaw(def, p.param(this.editSlot, k), step));
      this.touched = k;
      this.changed();
    } else if (this.mode === 'utility') {
      this.turnUtility(k, delta);
    } else if (this.mode === 'write' && k === 0) {
      this.writeTarget = Math.max(0, Math.min(PROGRAM_COUNT - 1, this.writeTarget + delta));
      this.render();
    }
  }

  private lastTurn = 0;
  private fastStreak = 0;
  private accel(def: ParamDef): number {
    // Large ranges speed up when the knob is spun quickly for a while.
    const now = performance.now();
    this.fastStreak = now - this.lastTurn < 40 ? this.fastStreak + 1 : 0;
    this.lastTurn = now;
    return this.fastStreak >= 6 && def.values.length > 60 ? 4 : 1;
  }

  private pressEditor(k: number): void {
    if (!this.power) return;
    this.message = null;
    const blocks = this.blocks();
    if (this.mode === 'play') {
      if (!blocks[k]) return;
      this.prog.setOff(k, !this.prog.isOff(k));
      this.changed();
    } else if (this.mode === 'edit') {
      if (!blocks[k]) return;
      this.editSlot = k;
      this.touched = null;
      this.render();
    } else if (this.mode === 'utility') {
      if (k === 5) this.setMode('play');
    } else if (this.mode === 'write') {
      if (k === 0) void this.confirmWrite();
      if (k === 5) this.cancelWrite();
    }
  }

  private turnUtility(k: number, delta: number): void {
    const p = this.prog;
    switch (k) {
      case 0:
        this.utilCursor = Math.max(0, Math.min(NAME_LENGTH - 1, this.utilCursor + delta));
        this.render();
        return;
      case 1: {
        const name = p.name.split('');
        const i = NAME_CHARS.indexOf(name[this.utilCursor]);
        name[this.utilCursor] = NAME_CHARS[(Math.max(0, i) + delta + NAME_CHARS.length * 10) % NAME_CHARS.length];
        p.name = name.join('');
        break;
      }
      case 2: p.volume = p.volume + delta; break;
      case 3: p.threshold = p.threshold + delta; break;
      case 4:
        this.channel = Math.max(0, Math.min(15, this.channel + delta));
        this.chSel.value = String(this.channel);
        this.saveSettings();
        this.render();
        return;
      default: return;
    }
    this.changed();
  }

  private typeName(ch: string): void {
    const p = this.prog;
    const name = p.name.split('');
    name[this.utilCursor] = ch;
    p.name = name.join('');
    this.utilCursor = Math.min(NAME_LENGTH - 1, this.utilCursor + 1);
    this.changed();
  }

  setMode(m: Mode): void {
    if (!this.power) return;
    this.message = null;
    this.mode = m;
    this.touched = null;
    if (m === 'edit' && this.editSlot >= this.blocks().length) this.editSlot = 0;
    this.render();
  }

  selectProgram(i: number): void {
    if (i < 0 || i >= PROGRAM_COUNT) return;
    this.message = null;
    this.current = i;
    this.touched = null;
    if (this.editSlot >= this.blocks().length) this.editSlot = 0;
    if (this.midi.hasOutput) {
      this.trySend(() => {
        this.midi.programChange(this.channel, i);
        if (this.isDirty(i)) this.sendEditBuffer();
      });
    }
    this.render();
    this.libRows[i]?.scrollIntoView({ block: 'nearest' });
  }

  // ---- WRITE
  private writeTarget = 0;

  private startWrite(): void {
    if (!this.power) return;
    this.message = null;
    if (this.mode === 'write') return void this.confirmWrite();
    this.writeTarget = this.current;
    this.mode = 'write';
    this.render();
  }

  private cancelWrite(): void {
    this.mode = 'play';
    this.render();
  }

  private async confirmWrite(): Promise<void> {
    const target = this.writeTarget;
    const src = this.prog.clone();
    this.mode = 'play';
    if (target !== this.current) {
      // Copy: restore the source slot, put the edited data into the target.
      this.programs[target] = src;
      this.programs[this.current] = this.originals[this.current].clone();
      this.current = target;
    }
    if (!this.midi.hasOutput) {
      this.originals[target] = src.clone();
      this.flash(` STORED IN LIBRARY ${pad(target + 1, 2)} (NOT SENT - NO MIDI OUT)`, 2200);
      this.render();
      return;
    }
    await this.task(`Writing program ${target + 1}`, async () => {
      this.midi.send(buildProgramDump(this.codec, this.channel, src.data));
      const load = await this.midi.waitFor([Fn.DATA_LOAD_COMPLETED, Fn.DATA_LOAD_ERROR, Fn.FORMAT_ERROR], 3000);
      if (load.fn !== Fn.DATA_LOAD_COMPLETED) throw new Error(`A2 replied ${FN_NAMES[load.fn]}`);
      this.midi.send(buildWriteRequest(this.channel, 0, target));
      const res = await this.midi.waitFor([Fn.WRITE_COMPLETED, Fn.WRITE_ERROR], 4000);
      if (res.fn !== Fn.WRITE_COMPLETED) throw new Error('A2 replied WRITE ERROR (memory protect?)');
      this.originals[target] = src.clone();
      this.flash(`         WRITE COMPLETED  -> ${pad(target + 1, 3)}`, 1800);
    });
  }

  // =========================================================================
  // MIDI

  private wireMidi(): void {
    this.midi.onPortsChanged = () => this.refreshPorts();
    this.midi.onActivity = (dir) => this.blink(dir);
    this.midi.onProgramChange = (prog, ch) => {
      if (ch !== this.channel || prog >= PROGRAM_COUNT) return;
      this.current = prog;
      this.render();
    };
    this.midi.on((m) => this.onMessage(m));
  }

  private onMessage(m: A2Message): void {
    if (m.channel !== this.channel) {
      this.log(`ignored message on channel ${m.channel + 1} (set CH to ${m.channel + 1}?)`);
      return;
    }
    this.log(`← ${FN_NAMES[m.fn] ?? `function ${hex([m.fn])}`}${m.body.length ? ` (${m.body.length} bytes)` : ''}`);
    // Replies to our own requests are handled by the task that asked for them.
    if (this.busy && (m.fn === Fn.PROGRAM_DUMP || m.fn === Fn.ALL_DUMP)) return;
    try {
      if (m.fn === Fn.PROGRAM_DUMP) {
        // Sent by the A2 when its program is changed from the front panel.
        const p = new Program(decodeProgramDump(this.codec, m.body));
        this.programs[this.current] = p;
        this.originals[this.current] = p.clone();
        this.hasData = true;
        this.render();
      } else if (m.fn === Fn.ALL_DUMP) {
        this.loadAll(decodeAllDump(this.codec, m.body));
        this.flash('           DATA RECEIVED', 1400);
      } else if (m.fn === Fn.FORMAT_ERROR) {
        this.clip();
        this.flash('       MIDI IN DATA FORMAT ERROR', 2000);
      } else if (m.fn === Fn.DATA_LOAD_ERROR) {
        this.clip();
      }
    } catch (e) {
      this.error(e as Error);
    }
  }

  private loadAll(d: { chainData: Uint8Array; programs: Uint8Array[] }): void {
    this.chainData = d.chainData;
    this.programs = d.programs.map((b) => new Program(b));
    this.originals = this.programs.map((p) => p.clone());
    this.hasData = true;
    this.render();
  }

  async connect(): Promise<void> {
    try {
      await this.midi.connect();
      this.refreshPorts();
      this.status('MIDI ready. Choose the ports the A2 is connected to.');
    } catch (e) {
      this.error(e as Error);
    }
  }

  private refreshPorts(): void {
    const fill = (sel: HTMLSelectElement, ports: { id: string; name: string }[], cur: string | null, saved: string | null) => {
      sel.replaceChildren(h('option', { value: '', text: '— none —' }), ...ports.map((p) => h('option', { value: p.id, text: p.name })));
      const pick = ports.find((p) => p.id === cur) ?? ports.find((p) => p.id === saved || p.name === saved)
        ?? ports.find((p) => /a2|korg/i.test(p.name));
      sel.value = pick?.id ?? '';
    };
    const s = this.settings();
    fill(this.inSel, this.midi.inputs(), this.midi.inputId, s.input ?? null);
    fill(this.outSel, this.midi.outputs(), this.midi.outputId, s.output ?? null);
    this.midi.selectInput(this.inSel.value || null);
    this.midi.selectOutput(this.outSel.value || null);
    this.renderMidiUnit();
  }

  private scheduleLiveSend(): void {
    if (!this.liveSend || !this.midi.hasOutput || this.busy) return;
    clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => this.trySend(() => this.sendEditBuffer()), 120);
  }

  private sendEditBuffer(): void {
    this.midi.send(buildProgramDump(this.codec, this.channel, this.prog.data));
  }

  private trySend(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.error(e as Error);
    }
  }

  private async task(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.renderMidiUnit();
    this.status(`${label}…`);
    try {
      await fn();
      this.status(`${label}: done.`);
    } catch (e) {
      this.error(e as Error);
      // Keep the failure on the LCD until the next panel action, so it can't be missed.
      const err = e as Error;
      this.message = {
        text: err.name === 'TimeoutError' ? '     NO REPLY FROM THE A2 - CHECK MIDI' : `     ${err.message.toUpperCase().slice(0, 35)}`,
        until: Infinity,
      };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async receiveAll(): Promise<void> {
    await this.task('Receiving all programs (≈6 s)', async () => {
      this.flash('     EXCLUSIVE DUMP RECEIVING...', 10000);
      // 16,684 bytes at 3125 bytes/s take 5.3 s; Web MIDI delivers SysEx only when complete.
      const wait = this.midi.waitFor([Fn.ALL_DUMP, Fn.DATA_LOAD_ERROR], 10000, this.channel);
      wait.catch(() => {}); // awaited below; avoids an unhandled rejection if send() throws
      this.midi.send(buildRequest(this.channel, Fn.ALL_DUMP_REQUEST));
      const m = await wait;
      if (m.fn !== Fn.ALL_DUMP) throw new Error('A2 replied DATA LOAD ERROR');
      this.loadAll(decodeAllDump(this.codec, m.body));
      this.flash('           DATA RECEIVED', 1400);
    });
  }

  async receiveCurrent(): Promise<void> {
    await this.task('Receiving edit buffer', async () => {
      const wait = this.midi.waitFor([Fn.PROGRAM_DUMP, Fn.DATA_LOAD_ERROR], 4000, this.channel);
      wait.catch(() => {}); // awaited below; avoids an unhandled rejection if send() throws
      this.midi.send(buildRequest(this.channel, Fn.PROGRAM_DUMP_REQUEST));
      const m = await wait;
      if (m.fn !== Fn.PROGRAM_DUMP) throw new Error('A2 replied DATA LOAD ERROR');
      const p = new Program(decodeProgramDump(this.codec, m.body));
      this.programs[this.current] = p;
      this.originals[this.current] = p.clone();
      this.hasData = true;
    });
  }

  async sendAll(): Promise<void> {
    if (!this.chainData) return;
    if (!confirm('Overwrite ALL 100 internal programs on the A2 with the programs in this editor?')) return;
    await this.task('Sending all programs', async () => {
      this.flash('     EXCLUSIVE DUMP SENDING...', 8000);
      const wait = this.midi.waitFor([Fn.DATA_LOAD_COMPLETED, Fn.DATA_LOAD_ERROR, Fn.FORMAT_ERROR], 20000, this.channel);
      wait.catch(() => {}); // awaited below; avoids an unhandled rejection if send() throws
      this.midi.send(buildAllDump(this.codec, this.channel, { chainData: this.chainData!, programs: this.programs.map((p) => p.data) }));
      const m = await wait;
      if (m.fn !== Fn.DATA_LOAD_COMPLETED) throw new Error(`A2 replied ${FN_NAMES[m.fn]}`);
      this.originals = this.programs.map((p) => p.clone());
      this.flash('           LOAD COMPLETED', 1600);
    });
  }

  // ---- .syx files
  async loadFile(file: File): Promise<void> {
    try {
      const msgs = splitSysex(new Uint8Array(await file.arrayBuffer())).map(parseMessage).filter((m): m is A2Message => !!m);
      const all = msgs.find((m) => m.fn === Fn.ALL_DUMP);
      if (all) {
        this.loadAll(decodeAllDump(this.codec, all.body));
        this.status(`Loaded 100 programs from ${file.name}. Use SEND ALL to transfer them to the A2.`);
        return;
      }
      const one = msgs.filter((m) => m.fn === Fn.PROGRAM_DUMP);
      if (one.length) {
        const p = new Program(decodeProgramDump(this.codec, one[0].body));
        this.programs[this.current] = p;
        this.hasData = true;
        this.status(`Loaded program "${p.name.trim()}" from ${file.name} into slot ${this.current + 1} (not written yet).`);
        this.changed();
        return;
      }
      throw new Error(`${file.name}: no Korg A2 program data found`);
    } catch (e) {
      this.error(e as Error);
    }
  }

  private download(bytes: Uint8Array, name: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  saveAll(): void {
    if (!this.chainData) return;
    this.download(buildAllDump(this.codec, this.channel, { chainData: this.chainData, programs: this.programs.map((p) => p.data) }), 'korg-a2-all.syx');
  }

  saveCurrent(): void {
    const name = this.prog.name.trim().replace(/[^\w-]+/g, '_') || 'program';
    this.download(buildProgramDump(this.codec, this.channel, this.prog.data), `a2-${pad(this.current + 1, 3)}-${name}.syx`);
  }

  // =========================================================================
  // Feedback

  private flash(text: string, ms: number): void {
    this.message = { text, until: performance.now() + ms };
    this.renderLcd();
  }

  private tick(): void {
    if (this.message && performance.now() > this.message.until) {
      this.message = null;
      this.renderLcd();
    }
  }

  private status(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('err');
    this.log(text);
  }

  private error(e: Error): void {
    this.statusEl.textContent = e.message;
    this.statusEl.classList.add('err');
    this.log(`ERROR: ${e.message}`);
    this.clip();
    console.error(e);
  }

  private log(text: string): void {
    const line = h('div', { text: `${new Date().toLocaleTimeString()}  ${text}` });
    this.logEl.prepend(line);
    while (this.logEl.childElementCount > 60) this.logEl.lastElementChild!.remove();
  }

  private blink(dir: 'in' | 'out'): void {
    const el = this.midiLeds[dir];
    el.classList.add('on');
    clearTimeout(Number(el.dataset.t));
    el.dataset.t = String(setTimeout(() => el.classList.remove('on'), 80));
    if (dir === 'in') {
      // Animate the input level meter on incoming traffic.
      const lvl = 1 + Math.floor(Math.random() * 3);
      this.meter.forEach((m, i) => m.classList.toggle('on', i >= this.meter.length - lvl));
      clearTimeout(Number(this.meter[0].dataset.t));
      this.meter[0].dataset.t = String(setTimeout(() => this.meter.forEach((m) => m.classList.remove('on')), 120));
    }
  }

  private clip(): void {
    const el = this.ledEls.clip;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 700);
  }

  // =========================================================================
  // Settings

  private settings(): { channel?: number; input?: string; output?: string; live?: boolean } {
    try {
      return JSON.parse(localStorage.getItem('a2-editor') ?? '{}');
    } catch {
      return {};
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('a2-editor', JSON.stringify({
        channel: this.channel,
        input: this.inSel.selectedOptions[0]?.text,
        output: this.outSel.selectedOptions[0]?.text,
        live: this.liveSend,
      }));
    } catch { /* storage unavailable */ }
  }

  // =========================================================================
  // Editor memory: kept in this browser across reloads, never sent anywhere.

  private persistTimer = 0;

  private persistSoon(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persist(), 300);
  }

  private persist(): void {
    const join = (ps: Program[]) => {
      const out = new Uint8Array(PROGRAM_COUNT * PROGRAM_SIZE);
      ps.forEach((p, i) => out.set(p.data, i * PROGRAM_SIZE));
      return toB64(out);
    };
    try {
      // Nothing worth keeping until data arrived or a placeholder was edited.
      if (!this.hasData && !this.programs.some((_, i) => this.isDirty(i))) {
        localStorage.removeItem(MEMORY_KEY);
        return;
      }
      localStorage.setItem(MEMORY_KEY, JSON.stringify({
        v: 1,
        programs: join(this.programs),
        originals: join(this.originals),
        chainData: this.chainData ? toB64(this.chainData) : null,
        current: this.current,
        hasData: this.hasData,
      }));
    } catch { /* storage unavailable or full */ }
  }

  private restoreMemory(): void {
    try {
      const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null');
      if (m?.v !== 1) return;
      const programs = fromB64(m.programs), originals = fromB64(m.originals);
      const chainData = m.chainData ? fromB64(m.chainData) : null;
      const size = PROGRAM_COUNT * PROGRAM_SIZE;
      if (programs.length !== size || originals.length !== size) return;
      if (chainData && chainData.length !== CHAIN_DATA_SIZE) return;
      const split = (b: Uint8Array) =>
        Array.from({ length: PROGRAM_COUNT }, (_, i) => new Program(b.subarray(i * PROGRAM_SIZE, (i + 1) * PROGRAM_SIZE)));
      this.programs = split(programs);
      this.originals = split(originals);
      this.chainData = chainData;
      this.current = Math.max(0, Math.min(PROGRAM_COUNT - 1, Number(m.current) || 0));
      this.hasData = !!m.hasData;
      if (this.hasData) {
        this.status('Programs restored from this browser; they may differ from the A2. GET ALL to refresh.');
      }
    } catch { /* ignore a corrupt or unreadable copy */ }
  }

  private restoreSettings(): void {
    const s = this.settings();
    this.channel = s.channel ?? 0;
    this.liveSend = s.live ?? true;
    this.chSel.value = String(this.channel);
  }

  // =========================================================================
  // Building the DOM

  private build(): void {
    const scaler = h('div', { class: 'scaler' });
    scaler.append(this.buildA2(), this.buildStrip(), this.buildMidiUnit(), this.buildLibrary());
    this.root.append(scaler);
    const fit = () => {
      const w = this.root.clientWidth;
      scaler.style.setProperty('zoom', String(Math.min(1.25, w / 1520)));
    };
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
    return h('div', { class: 'ear' }, h('span', { class: 'slot' }));
  }

  private key(label: string, onClick: () => void, opts: { led?: string; cls?: string; title?: string } = {}): HTMLElement {
    const b = h('button', { class: `key ${opts.cls ?? ''}`, title: opts.title ?? label.replace(/\n/g, ' ') });
    if (opts.led) {
      const l = h('span', { class: 'led' });
      this.ledEls[opts.led] = l;
      b.append(l);
    }
    b.append(h('span', { class: 'key-label', text: label }));
    b.addEventListener('click', onClick);
    return b;
  }

  private buildA2(): HTMLElement {
    // Left: input / phones level pots and jacks (decorative)
    const pot = (label: string) => h('div', { class: 'pot' }, h('div', { class: 'pot-knob' }), h('div', { class: 'pot-scale', text: '0      10' }), h('div', { class: 'silk', text: label }));
    const jack = (label: string) => h('div', { class: 'jack' }, h('div', { class: 'jack-hole' }), h('div', { class: 'silk', text: label }));
    const io = h('div', { class: 'io' }, pot('INPUT'), pot('PHONES'), jack('GUITAR IN'), jack('PHONES'));

    // Keys
    const keys = h('div', { class: 'keys' },
      this.key('WRITE', () => this.startWrite(), { title: 'WRITE (W)' }),
      this.key('PARAM\nEDIT', () => this.setMode(this.mode === 'edit' ? 'play' : 'edit'), { led: 'edit', title: 'PARAM EDIT (E)' }),
      this.key('▲', () => this.selectProgram(this.current + 1), { cls: 'arrow', title: 'Program UP (next program; ↓ key)' }),
      this.key('UTILITY', () => this.setMode(this.mode === 'utility' ? 'play' : 'utility'), { led: 'util', title: 'UTILITY (U)' }),
      this.key('DISPLAY\nSELECT', () => this.displaySelect(), { title: 'DISPLAY SELECT (D)' }),
      this.key('▼', () => this.selectProgram(this.current - 1), { cls: 'arrow', title: 'Program DOWN (previous program; ↑ key)' }),
    );

    // LED program number + mode LEDs
    const modeLed = (id: string, label: string) => {
      const l = h('span', { class: 'led' });
      this.ledEls[id] = l;
      return h('div', { class: 'mode-led' }, h('div', { class: 'silk', text: label }), l);
    };
    const ledBox = h('div', { class: 'ledbox' },
      h('div', { class: 'led7-window' }, this.led.el),
      h('div', { class: 'mode-leds' }, modeLed('perform', 'PERFORM'), modeLed('individ', 'INDIVID'), modeLed('bypass', 'BYPASS')),
    );

    // Level meter
    const meterRow = (label: string, cls = '') => {
      const l = h('span', { class: `led ${cls}` });
      return { row: h('div', { class: 'meter-row' }, l, h('span', { class: 'silk', text: label })), led: l };
    };
    const clip = meterRow('DIGITAL CLIP', 'red');
    this.ledEls.clip = clip.led;
    const meter = h('div', { class: 'meter' }, clip.row);
    for (const db of ['+6dB', '0dB', '-6dB', '-10dB', '-20dB']) {
      const r = meterRow(db, db === '+6dB' ? 'amber' : 'green');
      this.meter.push(r.led);
      meter.append(r.row);
    }

    // LCD + editors
    this.chainKnob = new Knob({
      label: '', caption: 'CHAIN/EFFECT', big: false,
      onTurn: (d) => this.turnChain(d),
      onPress: () => this.pressChain(),
    });
    this.chainKnob.el.classList.add('chain');
    this.chainKnob.el.append(h('div', { class: 'bypass-label', text: '[BYPASS]' }));
    const editors = h('div', { class: 'editors' }, this.chainKnob.el);
    LETTERS.forEach((L, k) => {
      const knob = new Knob({
        label: L,
        onTurn: (d, fine) => this.turnEditor(k, d, fine),
        onPress: () => this.pressEditor(k),
      });
      this.knobs.push(knob);
      editors.append(knob.el);
    });
    this.lcd.onCellClick = (col) => this.lcdClick(col);
    const center = h('div', { class: 'center' }, h('div', { class: 'lcd-bezel' }, this.lcd.el), editors);

    // Logo, power, card
    const power = h('button', { class: 'power on', title: 'POWER' });
    power.addEventListener('click', () => {
      this.power = !this.power;
      power.classList.toggle('on', this.power);
      if (this.power) this.flash('   KORG A2  PERFORMANCE SIGNAL PROCESSOR', 1200);
      this.render();
    });
    const card = h('button', { class: 'card-slot', title: 'CARD — load a .syx file (or drop it anywhere)' });
    card.addEventListener('click', () => this.fileInput.click());
    const brand = h('div', { class: 'brand' },
      h('div', { class: 'brand-top' },
        h('div', { class: 'logo' }, h('span', { class: 'korg', text: 'KORG' }), h('span', { class: 'model', text: 'A2' })),
        h('div', { class: 'power-wrap' }, power, h('div', { class: 'silk', text: 'POWER' })),
      ),
      h('div', { class: 'silk tagline', text: 'PERFORMANCE SIGNAL PROCESSOR' }),
      h('div', { class: 'card-wrap' }, card, h('div', { class: 'silk', text: 'CARD' })),
    );

    return h('section', { class: 'unit a2', 'aria-label': 'Korg A2 front panel' },
      this.ear(),
      h('div', { class: 'face' }, io, keys, ledBox, meter, center, brand),
      this.ear(),
    );
  }

  private buildStrip(): HTMLElement {
    const cells = LETTERS.map((L) => {
      const c = h('div', { class: 'strip-cell' });
      this.strip.push(c);
      return h('div', { class: 'strip-slot' }, h('span', { class: 'strip-letter', text: L }), c);
    });
    this.strip.unshift(h('div', { class: 'strip-cell' }));
    return h('section', { class: 'unit strip' }, this.ear(),
      h('div', { class: 'face' }, h('div', { class: 'strip-head' }, h('div', { class: 'silk', text: 'SCRIBBLE STRIP' }), this.strip[0]), ...cells),
      this.ear());
  }

  private buildMidiUnit(): HTMLElement {
    this.inSel = h('select', { 'aria-label': 'MIDI input' });
    this.outSel = h('select', { 'aria-label': 'MIDI output' });
    this.chSel = h('select', { 'aria-label': 'Global MIDI channel' });
    for (let i = 0; i < 16; i++) this.chSel.append(h('option', { value: String(i), text: String(i + 1) }));
    this.inSel.addEventListener('change', () => { this.midi.selectInput(this.inSel.value || null); this.saveSettings(); this.renderMidiUnit(); });
    this.outSel.addEventListener('change', () => { this.midi.selectOutput(this.outSel.value || null); this.saveSettings(); this.renderMidiUnit(); });
    this.chSel.addEventListener('change', () => { this.channel = Number(this.chSel.value); this.saveSettings(); this.render(); });

    const live = h('input', { type: 'checkbox' });
    live.checked = true;
    live.addEventListener('change', () => { this.liveSend = live.checked; this.saveSettings(); });
    queueMicrotask(() => { live.checked = this.liveSend; });

    const btn = (id: string, label: string, fn: () => void, title: string) => {
      const b = h('button', { class: 'rack-btn', title, text: label });
      b.addEventListener('click', fn);
      this.actionBtns[id] = b;
      return b;
    };
    const ledIn = h('span', { class: 'led green' });
    const ledOut = h('span', { class: 'led amber' });
    this.midiLeds = { in: ledIn, out: ledOut };
    this.statusEl = h('div', { class: 'status', role: 'status' });
    this.logEl = h('div', { class: 'log' });

    const field = (label: string, ctl: HTMLElement) => h('label', { class: 'field' }, h('span', { class: 'silk', text: label }), ctl);

    return h('section', { class: 'unit midi' }, this.ear(),
      h('div', { class: 'face' },
        h('div', { class: 'midi-brand' }, h('div', { class: 'midi-title', text: 'MIDI' }), h('div', { class: 'silk', text: 'SYSTEM EXCLUSIVE INTERFACE' }),
          h('div', { class: 'midi-leds' }, h('span', { class: 'silk', text: 'IN' }), ledIn, h('span', { class: 'silk', text: 'OUT' }), ledOut)),
        h('div', { class: 'midi-ports' },
          btn('connect', 'CONNECT', () => void this.connect(), 'Request Web MIDI access (with SysEx)'),
          field('IN', this.inSel), field('OUT', this.outSel), field('CH', this.chSel),
          h('label', { class: 'field check' }, live, h('span', { class: 'silk', text: 'LIVE EDIT' })),
        ),
        h('div', { class: 'midi-actions' },
          btn('getAll', 'GET ALL', () => void this.receiveAll(), 'Request all 100 programs (SysEx 1C → 4C)'),
          btn('getCur', 'GET EDIT', () => void this.receiveCurrent(), 'Request the edit buffer into the selected slot (SysEx 10 → 40)'),
          btn('sendCur', 'SEND EDIT', () => this.trySend(() => this.sendEditBuffer()), 'Send the selected program to the A2 edit buffer (SysEx 40)'),
          btn('sendAll', 'SEND ALL', () => void this.sendAll(), 'Send all 100 programs to the A2 (SysEx 4C) — requires a full dump first'),
          btn('load', 'LOAD .SYX', () => this.fileInput.click(), 'Load a .syx file (all-dump or single program)'),
          btn('saveAll', 'SAVE ALL', () => this.saveAll(), 'Save all programs as a .syx all-dump'),
          btn('saveCur', 'SAVE PROG', () => this.saveCurrent(), 'Save the selected program as a .syx program dump'),
        ),
        h('div', { class: 'midi-status' }, this.statusEl, this.logEl),
      ),
      this.ear());
  }

  private buildLibrary(): HTMLElement {
    const list = h('div', { class: 'lib-list', role: 'listbox', 'aria-label': 'Programs' });
    for (let i = 0; i < PROGRAM_COUNT; i++) {
      const row = h('div', { class: 'lib-row', role: 'option' });
      row.addEventListener('click', () => this.selectProgram(i));
      row.addEventListener('dblclick', () => { this.selectProgram(i); this.setMode('edit'); });
      this.libRows.push(row);
      list.append(row);
    }
    return h('section', { class: 'unit library' }, this.ear(),
      h('div', { class: 'face' },
        h('div', { class: 'lib-head' },
          h('div', { class: 'midi-title', text: 'PROGRAMS' }),
          h('div', { class: 'silk', text: 'INTERNAL 001–100 · CLICK TO SELECT · DOUBLE-CLICK TO EDIT · * = EDITED, NOT WRITTEN' }),
          this.noDataEl),
        list),
      this.ear());
  }

  private displaySelect(): void {
    if (!this.power) return;
    this.message = null;
    if (this.mode === 'edit') this.showAllValues = !this.showAllValues;
    else if (this.mode === 'play') this.showPerform = !this.showPerform;
    this.render();
  }

  private lcdClick(col: number): void {
    if (this.mode !== 'play' || this.showPerform) return;
    const slot = Math.floor((col - 11) / 5);
    if (col >= 11 && slot < this.blocks().length) {
      this.editSlot = slot;
      this.setMode('edit');
    }
  }

  private wireKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.mode === 'utility' && e.key.length === 1 && NAME_CHARS.includes(e.key)) {
        e.preventDefault();
        this.typeName(e.key);
        return;
      }
      if (this.mode === 'utility' && e.key === 'Backspace') {
        e.preventDefault();
        this.utilCursor = Math.max(0, this.utilCursor - 1);
        this.render();
        return;
      }
      if (this.mode === 'write' && e.key === 'Enter') return void this.confirmWrite();
      switch (e.key) {
        // Like the program list: ↑ moves up to the previous program, ↓ down to the next.
        case 'ArrowUp': this.selectProgram(this.current - 1); break;
        case 'ArrowDown': this.selectProgram(this.current + 1); break;
        case 'e': case 'E': this.setMode(this.mode === 'edit' ? 'play' : 'edit'); break;
        case 'u': case 'U': this.setMode(this.mode === 'utility' ? 'play' : 'utility'); break;
        case 'd': case 'D': this.displaySelect(); break;
        case 'w': case 'W': this.startWrite(); break;
        case 'Escape': this.setMode('play'); break;
        default:
          if (this.mode === 'edit' && /^[1-6]$/.test(e.key)) this.pressEditor(Number(e.key) - 1);
          else return;
      }
      e.preventDefault();
    });
  }

  // =========================================================================
  // Rendering

  render(): void {
    this.renderLcd();
    this.renderLeds();
    this.renderStrip();
    this.renderLibrary();
    this.renderMidiUnit();
    this.persistSoon();
  }

  private renderLeds(): void {
    const on = this.power;
    this.led.set(on ? String(this.current + 1) : '   ');
    this.ledEls.edit.classList.toggle('on', on && this.mode === 'edit');
    this.ledEls.util.classList.toggle('on', on && this.mode === 'utility');
    this.ledEls.perform.classList.toggle('on', on && this.mode === 'play' && this.showPerform);
    this.ledEls.individ.classList.toggle('on', on && this.mode === 'play' && !this.showPerform);
    this.ledEls.bypass.classList.toggle('on', on && this.bypass);
    this.root.classList.toggle('powered-off', !on);
    const blocks = this.blocks();
    this.knobs.forEach((k, i) => {
      let active = false, title = '';
      if (this.mode === 'play') {
        active = !!blocks[i];
        title = blocks[i] ? `${blocks[i].name}: turn = variation, press = on/off` : '';
      } else if (this.mode === 'edit') {
        const def = blocks[this.editSlot]?.params[i];
        active = !!def;
        title = def ? `${def.name}: turn to edit (Shift = fine), press = select effect ${LETTERS[i]}` : `Press to edit effect ${LETTERS[i]}`;
      } else if (this.mode === 'utility') {
        active = i < 5;
        title = ['Name cursor', 'Name character', 'Master volume', 'Threshold', 'MIDI channel', 'Press: EXIT'][i];
      } else if (this.mode === 'write') {
        active = i === 0 || i === 5;
        title = i === 0 ? 'Turn: target program, press: WRITE' : i === 5 ? 'Press: cancel' : '';
      }
      k.setActive(on && active);
      k.setTitle(title);
    });
    this.chainKnob.setActive(on);
    this.chainKnob.setTitle(this.mode === 'edit' ? 'Turn: select effect to edit · Press: bypass' : 'Turn: chain number · Press: bypass');
  }

  private renderLcd(): void {
    this.lcd.setPower(this.power);
    if (!this.power) return this.lcd.set('');
    if (this.message) return this.lcd.set(this.message.text);
    const p = this.prog;
    const blocks = this.blocks();
    switch (this.mode) {
      case 'play': {
        if (this.showPerform) {
          return this.lcd.set(`P${pad(this.current + 1, 3)} ${p.name}  CHAIN ${this.chainLabel(p)} VOL${pad(p.volume, 2)} THR${pad(p.threshold, 2)}`);
        }
        const fx = blocks.map((g, i) => this.abbr(g, p, i)).join('-');
        const clickable: [number, number][] = blocks.map((_, i) => [11 + i * 5, 15 + i * 5]);
        return this.lcd.set(`${this.chainLabel(p)} ${p.name}:${fx}`, { clickable });
      }
      case 'edit': {
        const g = blocks[this.editSlot];
        const head = `[${LETTERS[this.editSlot]}] ${g ? this.abbr(g, p, this.editSlot) : '----'} :`;
        let line = head;
        const hl: [number, number][] = [];
        for (let k = 0; k < 6; k++) {
          const def = g?.params[k];
          const start = 11 + k * 5;
          let cell = '';
          if (def) {
            const showVal = this.showAllValues || this.touched === k;
            cell = showVal ? this.fit(formatValue(def, p.param(this.editSlot, k))) : def.label;
            if (this.touched === k) hl.push([start, start + 4]);
          }
          line = line.padEnd(start) + cell.padEnd(4).slice(0, 4);
        }
        return this.lcd.set(line, { highlight: hl });
      }
      case 'utility': {
        const line = `NAME:${p.name} VOL:${pad(p.volume, 2)} THR:${pad(p.threshold, 2)} CH:${pad(this.channel + 1, 2)}  EXIT`;
        return this.lcd.set(line, { cursor: 5 + this.utilCursor });
      }
      case 'write': {
        const line = `WRITE ${p.name} TO:${pad(this.writeTarget + 1, 3)}   [A]OK [F]CANCEL`;
        return this.lcd.set(line, { highlight: [[17, 20]] });
      }
    }
  }

  /** Squeeze a value into a 4-character LCD field. */
  private fit(v: string): string {
    if (v.length <= 4) return v;
    if (v.includes('.')) {
      const n = Number(v);
      if (!Number.isNaN(n)) return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
    }
    return v.slice(0, 4);
  }

  private renderStrip(): void {
    const p = this.prog;
    const blocks = this.blocks();
    const set = (i: number, title: string, value: string, on: boolean) => {
      const c = this.strip[i + 1];
      c.replaceChildren(h('div', { class: 'strip-title', text: title }), h('div', { class: 'strip-value', text: value }));
      c.classList.toggle('dim', !on);
    };
    if (!this.power) {
      this.strip.forEach((c) => c.replaceChildren());
      return;
    }
    if (this.mode === 'edit') {
      const g = blocks[this.editSlot];
      const varName = g ? g.variations[Math.min(p.variation(this.editSlot), g.variations.length - 1)][1] : '';
      this.strip[0].replaceChildren(
        h('div', { class: 'strip-title', text: `EDITING ${LETTERS[this.editSlot]}` }),
        h('div', { class: 'strip-value', text: g ? `${g.name} · ${varName}` : '—' }));
      for (let k = 0; k < 6; k++) {
        const def = g?.params[k];
        if (!def) set(k, '', '', false);
        else {
          const raw = p.param(this.editSlot, k);
          set(k, def.name, `${formatValue(def, raw)}${def.unit ? ` ${def.unit}` : ''}`, true);
          this.strip[k + 1].title = `raw byte 0x${raw.toString(16).padStart(2, '0').toUpperCase()}`;
        }
      }
      return;
    }
    if (this.mode === 'utility') {
      this.strip[0].replaceChildren(h('div', { class: 'strip-title', text: 'UTILITY' }), h('div', { class: 'strip-value', text: 'Type to rename · F = exit' }));
      const u = [['NAME CURSOR', String(this.utilCursor + 1)], ['CHARACTER', `"${p.name[this.utilCursor]}"`], ['MASTER VOLUME', String(p.volume)],
        ['THRESHOLD', String(p.threshold)], ['MIDI CHANNEL', String(this.channel + 1)], ['EXIT', '']];
      u.forEach(([t, v], k) => set(k, t, v, true));
      return;
    }
    this.strip[0].replaceChildren(
      h('div', { class: 'strip-title', text: `PROGRAM ${pad(this.current + 1, 3)}${this.isDirty(this.current) ? ' *' : ''}` }),
      h('div', { class: 'strip-value', text: `"${p.name.trimEnd()}" · CHAIN ${this.chainLabel(p)}` }));
    for (let k = 0; k < 6; k++) {
      const g = blocks[k];
      if (!g) set(k, '', '', false);
      else {
        const v = g.variations[Math.min(p.variation(k), g.variations.length - 1)][1];
        set(k, g.name, `${v}${p.isOff(k) ? ' (OFF)' : ''}`, !p.isOff(k));
        this.strip[k + 1].title = '';
      }
    }
  }

  private renderLibrary(): void {
    // Until a dump or file arrives the list holds INIT placeholders, not the A2's programs.
    this.noDataEl.hidden = this.hasData;
    this.libRows[0]?.parentElement?.classList.toggle('placeholder', !this.hasData);
    this.programs.forEach((p, i) => {
      const row = this.libRows[i];
      const dirty = this.isDirty(i);
      row.replaceChildren(
        h('span', { class: 'n', text: pad(i + 1, 3) }),
        h('span', { class: 'name', text: p.name }),
        h('span', { class: 'chain', text: this.chainLabel(p) }),
        h('span', { class: 'fx', text: this.effectSummary(p) }),
        h('span', { class: 'dirty', text: dirty ? '*' : '' }),
      );
      row.classList.toggle('sel', i === this.current);
      row.setAttribute('aria-selected', String(i === this.current));
      row.title = `${pad(i + 1, 3)} ${p.name.trim()} — chain ${this.chainLabel(p)}: ${this.blocks(p).map((g) => g.name).join(' → ')}`;
    });
  }

  private renderMidiUnit(): void {
    if (!this.statusEl) return;
    const c = this.midi.connected, out = this.midi.hasOutput, idle = !this.busy;
    this.actionBtns.connect.textContent = c ? 'RESCAN' : 'CONNECT';
    this.inSel.disabled = !c;
    this.outSel.disabled = !c;
    this.actionBtns.getAll.disabled = !(out && idle);
    this.actionBtns.getCur.disabled = !(out && idle);
    this.actionBtns.sendCur.disabled = !(out && idle);
    this.actionBtns.sendAll.disabled = !(out && idle && this.chainData);
    this.actionBtns.saveAll.disabled = !this.chainData;
    this.actionBtns.sendAll.title = this.chainData ? 'Send all 100 programs to the A2 (SysEx 4C)' : 'Needs chain data: GET ALL or load an all-dump .syx first';
    this.actionBtns.saveAll.title = this.chainData ? 'Save all programs as a .syx all-dump' : 'Needs chain data: GET ALL or load an all-dump .syx first';
    if (!this.statusEl.textContent) {
      this.statusEl.textContent = A2Midi.supported
        ? 'Press CONNECT, pick the A2 ports, set EXCLUSIVE ON on the A2 (UTILITY → MIDI), then GET ALL.'
        : 'Web MIDI is unavailable in this browser — use Chrome or Edge. You can still load/save .syx files.';
    }
  }
}
