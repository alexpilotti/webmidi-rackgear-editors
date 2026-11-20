// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

import { joinMessages, splitSysex, type Codec } from './codec.ts';
import { GfMidi } from './midi.ts';
import {
  recallBankProgram, CARD_BANKS, MAX_BANK, cardIndex, romIndex, userIndex, Bank, BLOCKS, cleanName, NAME_LEN, paramAt, PARAMS, PARAMS_AT, Preset, RECORD_SIZE, SLOTS,
  type BlockId, type ParamDef,
} from './model.ts';
import { Billboard, GraphicLcd, h, Knob, NumberField, PanelKey } from './ui/components.ts';
import { ROM_NAMES } from './rom.ts';
import { infoPage, LCD_H, LCD_W, messageBox, paramPage, presetPage, selectGrid, textBox, type ListRow } from './ui/screens.ts';

/** Panel modes (owner's manual: Recall, Store, Effects/Edit, Utility). */
type Mode = 'recall' | 'edit' | 'store' | 'utility' | 'receive' | 'send';

const pad3 = (n: number) => String(n).padStart(3, '0');
const presets = (n: number) => `${n} User preset${n === 1 ? '' : 's'}`;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const hex3 = (n: number) => n.toString(16).toUpperCase().padStart(3, '0');
const toB64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Gap between outgoing block messages: 137 bytes take ~44 ms at MIDI speed. */
const SEND_GAP_MS = 60;
/** Give up on a dump when no block arrives for this long. */
const BLOCK_TIMEOUT_MS = 3000;
/**
 * How a preset is recalled with MIDI (owner's manual, I/O Setup → MIDI).
 * With bank selection the G-Force takes bank × Bank size + program change as a
 * preset index: ROM fills 0–299 (225 used), USER 1–100 is 300–399 and card
 * bank n starts at 400 + 100 × (n − 1). With Bank size 100 this gives the
 * manual's table (USER = bank 3, card banks 1–6 = banks 4–9).
 */
const PC_MODES = [
  { id: 'fine', label: 'Fine Adjust', title: 'G-Force: Bank selection Fine adjust (bank in CC 32)' },
  { id: 'coarse', label: 'Coarse Adjust', title: 'G-Force: Bank selection Coarse adjust (bank in CC 0)' },
  { id: 'pc', label: 'PC only', title: 'G-Force: Bank selection disabled, Mapping mode into the USER bank' },
  { id: 'off', label: 'Off', title: 'Selecting a preset sends nothing' },
] as const;
type PcMode = (typeof PC_MODES)[number]['id'];
/** Bank size on the unit: 1–128 (I/O Setup → MIDI). */
const BANK_SIZE_MAX = 128;

/** Banks as on the unit's Recall page: 0 = ROM, 1 = USER, 2–7 = CARD 1–6. */
const ROM = 0;
const USER = 1;
const bankLabel = (b: number) => (b === ROM ? 'ROM' : b === USER ? 'USER' : `CARD ${b - 1}`);
const bankCount = (b: number) => (b === ROM ? ROM_NAMES.length : b === USER ? SLOTS : b === CARD_BANKS + 1 ? 99 : 100);
const BANK_TOTAL = CARD_BANKS + 2;

const UTILITY_ITEMS = [
  { id: 'receive', label: 'User Bank to MIDI   (editor receives)' },
  { id: 'send', label: 'MIDI to User Bank   (editor sends)' },
] as const;

interface Collect {
  id: number;
  count: number;
  msgs: Uint8Array[];
  timer: number;
}

export class App {
  // ---- data
  bank = new Bank();
  /** What the G-Force is believed to hold (last dump received, sent or loaded). */
  baseline = new Bank();
  hasData = false;
  current = 0;
  edit: Preset = this.bank.preset(0);

  // ---- panel state
  mode: Mode = 'recall';
  recallTarget = 0;
  /** Bank shown in the list and on the Recall page. */
  view = USER;
  /** Last preset selected in the list or recalled (kept across reloads). */
  unitSel: { bank: number; n: number } | null = null;
  storeTarget = 0;
  cursor = PARAMS_AT;
  utilityItem = 0;
  sysexId = 0;
  channel = 0;
  pcMode: PcMode = 'fine';
  bankSize = 100;
  private message: { text: string; until: number } | null = null;
  private collect: Collect | null = null;
  private receiveTimer = 0;
  private sendProgress = 0;
  private sendTotal = 0;

  // ---- ui
  readonly midi = new GfMidi();
  private lcd = new GraphicLcd(LCD_W, LCD_H);
  private billboard = new Billboard();
  private keys = {} as Record<string, PanelKey>;
  private indicators = {} as Record<'edited' | 'midi' | 'pedal' | 'overflow', HTMLElement>;
  private strip: Record<string, HTMLElement> = {};
  private nameInput!: HTMLInputElement;
  private libRows: HTMLElement[] = [];
  private libList!: HTMLElement;
  private libTitle!: HTMLElement;
  private libHelp!: HTMLElement;
  private bankTabs: HTMLButtonElement[] = [];
  private dataCells: HTMLButtonElement[] = [];
  private statusEl!: HTMLElement;
  private logEl!: HTMLElement;
  private inSel!: HTMLSelectElement;
  private outSel!: HTMLSelectElement;
  private idSel!: HTMLSelectElement;
  private chSel!: HTMLSelectElement;
  private pcSel!: HTMLSelectElement;
  private mapNote = h('div', { class: 'map-note', role: 'note' },
    h('b', { text: '⚠ G-Force: ' }), 'I/O Setup → MIDI → Mapping mode must be ', h('b', { text: 'EXTERNAL' }),
    ', with Bank selection and Bank size as set here.');
  private midiLeds = {} as Record<'in' | 'out', HTMLElement>;
  private btns: Record<string, HTMLButtonElement> = {};
  private fileInput!: HTMLInputElement;

  constructor(private root: HTMLElement, private codec: Codec) {
    this.restore();
    this.build();
    this.wireMidi();
    this.wireKeyboard();
    void this.autoConnect();
    window.addEventListener('pagehide', () => this.persist());
    this.render();
  }

  // =========================================================================
  // Model helpers

  get editDirty(): boolean {
    return !this.edit.equals(this.bank.preset(this.current));
  }

  slotUnsent(i: number): boolean {
    return !this.bank.presetEquals(i, this.baseline);
  }

  get anyUnsent(): boolean {
    for (let i = 0; i < SLOTS; i++) if (this.slotUnsent(i)) return true;
    return false;
  }

  private get busy(): boolean {
    return this.mode === 'receive' || this.mode === 'send';
  }

  private loadEdit(): void {
    this.edit = this.bank.preset(this.current);
  }

  private flash(text: string, ms = 2500): void {
    this.message = { text, until: Date.now() + ms };
    setTimeout(() => this.renderDisplay(), ms + 20);
    this.renderDisplay();
  }

  // =========================================================================
  // Front-panel actions

  /** VALUE wheel. */
  private turnValue(delta: number, fast: boolean): void {
    const step = fast ? delta * 10 : delta;
    switch (this.mode) {
      case 'recall': {
        const n = bankCount(this.view);
        this.recallTarget = (this.recallTarget + step + n * 10) % n;
        return this.render();
      }
      case 'store':
        this.storeTarget = (this.storeTarget + delta + SLOTS * 10) % SLOTS;
        return this.render();
      case 'edit': {
        if (!this.bank.used(this.current) && !this.editDirty) return this.flash('EMPTY PRESET - NOTHING TO EDIT');
        const p = paramAt(this.cursor);
        if (p) this.edit.set(p, this.edit.get(p) + step);
        else this.edit.setByte(this.cursor, this.edit.byte(this.cursor) + step);
        return this.render();
      }
      case 'utility':
        this.utilityItem = (this.utilityItem + delta + UTILITY_ITEMS.length * 10) % UTILITY_ITEMS.length;
        return this.render();
      default:
    }
  }

  /** PARAMETER wheel. */
  private turnParameter(delta: number, fast: boolean): void {
    if (this.mode === 'edit') {
      const span = RECORD_SIZE - PARAMS_AT;
      this.cursor = PARAMS_AT + ((this.cursor - PARAMS_AT + (fast ? delta * 16 : delta) + span * 10) % span);
      return this.render();
    }
    if (this.mode === 'utility') return this.turnValue(delta, false);
    if (this.mode === 'recall') return this.showBank(this.view + delta);
    if (this.mode === 'store') return this.turnValue(delta, fast);
  }

  pressRecall(): void {
    if (this.busy) return;
    this.mode = 'recall';
    this.recallTarget = this.selectedIn(this.view);
    this.render();
  }

  /** The preset highlighted in bank b: the edited User preset, or the last one recalled there. */
  private selectedIn(b: number): number {
    if (b === USER) return this.current;
    return this.unitSel?.bank === b ? this.unitSel.n : 0;
  }

  /** Switch the list and the Recall page to bank b (ROM, USER, CARD 1–6). */
  showBank(b: number): void {
    if (this.busy) return;
    this.view = (b + BANK_TOTAL) % BANK_TOTAL;
    this.recallTarget = this.selectedIn(this.view);
    if (this.mode === 'store' || this.mode === 'utility') this.mode = 'recall';
    this.render();
  }

  pressStore(): void {
    if (this.busy) return;
    if (this.mode === 'store') return this.pressEnter();
    this.mode = 'store';
    this.storeTarget = this.current;
    this.render();
  }

  pressEffects(): void {
    if (this.busy) return;
    this.mode = 'edit';
    this.render();
  }

  pressUtility(): void {
    if (this.busy) return;
    this.mode = 'utility';
    this.render();
  }

  pressExit(): void {
    if (this.mode === 'receive') return this.cancelReceive();
    if (this.mode === 'send') return;
    this.mode = 'recall';
    this.recallTarget = this.selectedIn(this.view);
    this.render();
  }

  pressEnter(): void {
    switch (this.mode) {
      case 'recall':
        return this.recallAt(this.view, this.recallTarget);
      case 'store':
        return this.storeTo(this.storeTarget);
      case 'utility':
        return UTILITY_ITEMS[this.utilityItem].id === 'receive' ? void this.receiveBank() : void this.sendBank();
      default:
    }
  }

  pressBlock(id: BlockId): void {
    if (this.busy) return;
    const label = BLOCKS.find((b) => b.id === id)!.label;
    const params = PARAMS.filter((p) => p.block === id);
    this.mode = 'edit';
    if (params.length) {
      const i = params.findIndex((p) => p.offset === this.cursor);
      this.cursor = params[(i + 1) % params.length].offset;
      this.render();
    } else {
      this.render();
      this.flash(`${label}: NOT DECODED YET - RAW BYTES ONLY`);
    }
  }

  private notInEditor(what: string): void {
    this.flash(`${what}: ON THE UNIT ONLY`);
  }

  /** Select a User preset in the editor and recall it on the G-Force. */
  selectPreset(i: number): void {
    if (this.busy) return;
    const next = (i + SLOTS) % SLOTS;
    if (next !== this.current) {
      if (this.editDirty && !confirm(`User ${this.current + 1} has edits that are not stored. Discard them?`)) return;
      this.current = next;
      this.loadEdit();
    }
    this.view = USER;
    this.recallTarget = next;
    this.unitSel = { bank: USER, n: next };
    if (this.mode === 'store' || this.mode === 'utility') this.mode = 'recall';
    this.recallOnUnit(next);
    this.render();
  }

  /** Recall preset n (0-based) of bank b; User presets are also loaded into the editor. */
  recallAt(b: number, n: number): void {
    if (b === USER) return this.selectPreset(n);
    if (this.busy) return;
    const p = Math.max(0, Math.min(bankCount(b) - 1, Math.round(n)));
    this.view = b;
    this.recallTarget = p;
    this.unitSel = { bank: b, n: p };
    if (this.mode === 'store' || this.mode === 'utility') this.mode = 'recall';
    if (this.pcMode === 'off' || !this.midi.hasOutput) {
      this.render();
      return this.flash(this.midi.hasOutput ? 'RECALL IS OFF (BANK SEL)' : 'NO MIDI OUTPUT SELECTED');
    }
    if (b !== ROM && this.pcMode === 'pc') {
      this.render();
      return this.error(new Error('Card presets need bank select: set BANK SEL to Fine or Coarse, as on the G-Force.'));
    }
    const what = b === ROM ? `ROM ${p + 1} ${ROM_NAMES[p]}` : `Card bank ${b - 1} preset ${p + 1}`;
    this.sendRecall(b === ROM ? romIndex(p) : cardIndex(b - 1, p), p, what);
    this.render();
  }

  /** Program change (with bank select) for User slot i, as set in PC_MODES. */
  recallOnUnit(i: number): void {
    if (this.pcMode === 'off' || !this.midi.hasOutput) return;
    this.sendRecall(userIndex(i), i, `User ${i + 1}`);
  }

  /**
   * `index` is the preset position used with bank select (Mapping mode
   * External, see model.ts); `plain` is the program number used with PC only
   * (Mapping mode into the bank being recalled).
   */
  private sendRecall(index: number, plain: number, what: string): void {
    const ch = this.channel;
    try {
      if (this.pcMode === 'pc') {
        this.midi.programChange(ch, plain);
        this.log(`→ ${what} (program ${plain + 1})`);
        return;
      }
      const bp = recallBankProgram(index, this.bankSize);
      if (!bp) {
        this.flash(`NOT REACHABLE WITH BANK SIZE ${this.bankSize}`, 4000);
        return this.error(new Error(`${what} can't be reached with Bank size ${this.bankSize}: it needs bank ${Math.floor(index / this.bankSize)}, and bank select stops at ${MAX_BANK}. Use a larger Bank size.`));
      }
      const { bank, program } = bp;
      // Both bank bytes are sent, so a value left over from earlier messages can't add up.
      this.midi.controlChange(ch, 0, this.pcMode === 'coarse' ? bank : 0);
      this.midi.controlChange(ch, 32, this.pcMode === 'fine' ? bank : 0);
      this.midi.programChange(ch, program);
      this.log(`→ ${what} (bank ${bank}, program ${program + 1})`);
    } catch (e) {
      this.error(e as Error);
    }
  }

  storeTo(target: number): void {
    if (!this.bank.used(this.current) && !this.editDirty) return this.flash('EMPTY PRESET - NOTHING TO STORE');
    if (target !== this.current && this.bank.used(target)
      && !confirm(`Overwrite User ${target + 1} "${this.bank.preset(target).name}"?`)) return;
    this.bank.store(target, this.edit);
    this.current = target;
    this.recallTarget = target;
    this.loadEdit();
    this.mode = 'recall';
    this.status(`Stored in User ${target + 1}. Use SEND BANK to update the G-Force.`);
    this.render();
  }

  clearSlot(): void {
    if (this.busy) return;
    const i = this.current;
    if (!this.bank.used(i) && !this.editDirty) return;
    if (!confirm(`Clear User ${i + 1} "${this.edit.name}"? The G-Force keeps its copy until you send the bank.`)) return;
    this.bank.clear(i);
    this.loadEdit();
    this.status(`User ${i + 1} cleared.`);
    this.render();
  }

  setName(name: string): void {
    this.edit.name = name;
    this.render();
  }

  // =========================================================================
  // MIDI

  private wireMidi(): void {
    this.midi.onPortsChanged = () => this.refreshPorts();
    this.midi.onActivity = (d) => this.blink(d);
    this.midi.onProgramChange = (p, ch) => this.log(`← program change ${p + 1} (ch ${ch + 1})`);
    this.midi.onSysex((m) => this.onSysex(m));
  }

  private onSysex(m: Uint8Array): void {
    if (this.codec.isHeader(m)) {
      if (m[4] !== this.sysexId) {
        return this.log(`← ignored a bank dump from SysEx ID ${m[4]} (the editor is set to ${this.sysexId})`);
      }
      let count: number;
      try {
        count = this.codec.headerCount(m);
      } catch (e) {
        return this.error(e as Error);
      }
      clearTimeout(this.receiveTimer);
      if (this.collect) clearTimeout(this.collect.timer);
      this.collect = { id: m[4], count, msgs: [m], timer: 0 };
      this.mode = 'receive';
      this.log(`← bank header: ${count} blocks`);
      this.armBlockTimer();
      if (count === 0) return this.finishReceive();
      return this.render();
    }
    if (this.codec.isBlock(m) && this.collect) {
      if (m[4] !== this.collect.id) return;
      this.collect.msgs.push(m);
      this.armBlockTimer();
      if (this.collect.msgs.length - 1 >= this.collect.count) return this.finishReceive();
      return this.renderDisplay();
    }
    if (m[1] === 0x00 && m[2] === 0x20 && m[3] === 0x1f) this.log(`← TC SysEx, type ${hex2(m[5] ?? 0)} (${m.length} bytes)`);
    else this.log(`← SysEx (${m.length} bytes, not from the G-Force)`);
  }

  private armBlockTimer(): void {
    if (!this.collect) return;
    clearTimeout(this.collect.timer);
    this.collect.timer = window.setTimeout(() => {
      const c = this.collect!;
      this.collect = null;
      this.mode = 'recall';
      this.render();
      this.error(new Error(`Bank dump stopped after ${c.msgs.length - 1} of ${c.count} blocks. Nothing was changed.`));
      this.flash('RECEIVE FAILED - DUMP INCOMPLETE', 4000);
    }, BLOCK_TIMEOUT_MS);
  }

  private finishReceive(): void {
    const c = this.collect!;
    clearTimeout(c.timer);
    this.collect = null;
    this.mode = 'recall';
    try {
      const dump = this.codec.decodeDump(c.msgs);
      const bank = new Bank(dump.stream);
      if (this.anyUnsent && !confirm('A User bank arrived from the G-Force. Replace the editor contents? Changes not sent to the unit will be lost.')) {
        this.status('Received bank discarded.');
        return this.render();
      }
      this.acceptBank(bank, true);
      this.status(`Bank received: ${presets(bank.usedCount)} (${c.count} blocks).`);
      this.flash('USER BANK RECEIVED');
    } catch (e) {
      this.error(e as Error);
      this.flash('RECEIVE FAILED', 4000);
    }
    this.render();
  }

  private acceptBank(bank: Bank, fromUnit: boolean): void {
    this.bank = bank;
    this.baseline = fromUnit ? bank.clone() : this.baseline;
    this.hasData = true;
    const first = Array.from({ length: SLOTS }, (_, i) => i).find((i) => bank.used(i)) ?? 0;
    this.current = bank.used(this.current) ? this.current : first;
    this.recallTarget = this.current;
    this.loadEdit();
  }

  async connect(): Promise<void> {
    try {
      await this.midi.connect();
      this.refreshPorts();
      this.status(this.portsSummary('connected') ?? 'MIDI ready. Pick the ports connected to the G-Force.');
    } catch (e) {
      this.error(e as Error);
    }
  }

  /**
   * Reconnect on page load when the browser has already granted MIDI with
   * SysEx, so the saved ports come back without pressing CONNECT. Without a
   * grant nothing is asked: the permission prompt only appears from CONNECT.
   */
  private async autoConnect(): Promise<void> {
    if (!GfMidi.supported || !navigator.permissions) return;
    try {
      const st = await navigator.permissions.query({ name: 'midi', sysex: true } as unknown as PermissionDescriptor);
      if (st.state !== 'granted') return;
      await this.midi.connect();
      this.refreshPorts();
      this.status(this.portsSummary('reconnected') ?? 'MIDI reconnected. Pick the ports connected to the G-Force.');
    } catch { /* stay disconnected; CONNECT still works */ }
  }

  private portsSummary(verb: string): string | null {
    const i = this.inSel.selectedOptions[0], o = this.outSel.selectedOptions[0];
    if (!this.inSel.value && !this.outSel.value) return null;
    return `MIDI ${verb}: IN ${this.inSel.value ? i.text : '—'}, OUT ${this.outSel.value ? o.text : '—'}.`;
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

  /** Wait for a bank dump started on the unit (Utility → User Bank to MIDI). */
  receiveBank(): void {
    if (this.mode === 'receive') return this.cancelReceive();
    if (this.busy) return;
    this.mode = 'receive';
    this.status('Waiting… On the G-Force: Utility → User Bank to MIDI, then press Enter twice.');
    clearTimeout(this.receiveTimer);
    this.receiveTimer = window.setTimeout(() => {
      if (this.collect || this.mode !== 'receive') return;
      this.mode = 'recall';
      this.render();
      this.error(new Error('No bank dump arrived from the G-Force. Check the MIDI cables, ports and SysEx ID.'));
      this.flash('NO DUMP FROM THE G-FORCE - CHECK MIDI', 6000);
    }, 120000);
    this.render();
  }

  private cancelReceive(): void {
    clearTimeout(this.receiveTimer);
    if (this.collect) clearTimeout(this.collect.timer);
    this.collect = null;
    this.mode = 'recall';
    this.status('Receive cancelled.');
    this.render();
  }

  /** The bank as SysEx messages (header + blocks), with the edit buffer left out. */
  bankMessages(): Uint8Array[] {
    return this.codec.encodeDump(this.bank.stream(), this.sysexId);
  }

  async sendBank(): Promise<void> {
    if (this.busy) return;
    if (!this.midi.hasOutput) return this.error(new Error('No MIDI output selected.'));
    if (this.editDirty && !confirm(`User ${this.current + 1} has edits that are not stored, and they will not be sent. Send the bank anyway?`)) return;
    if (!confirm('Send the editor bank to the G-Force?\n\nFirst, on the G-Force: Utility → MIDI to User Bank, press Enter twice so it waits for data. Then press OK.\n\nThis replaces ALL User presets on the unit. Keep a saved .syx of the current bank as a backup.')) return;
    const msgs = this.bankMessages();
    this.mode = 'send';
    this.sendTotal = msgs.length;
    this.sendProgress = 0;
    this.render();
    try {
      await this.midi.sendPaced(msgs, SEND_GAP_MS, (n) => {
        this.sendProgress = n;
        this.renderDisplay();
      });
      this.baseline = this.bank.clone();
      this.status(`Bank sent: ${presets(this.bank.usedCount)} in ${msgs.length - 1} blocks. Check the G-Force display for its result.`);
      this.flash('USER BANK SENT');
    } catch (e) {
      this.error(e as Error);
    }
    this.mode = 'recall';
    this.render();
  }

  // ---- files
  async loadFile(file: File): Promise<void> {
    if (this.busy) return;
    try {
      const msgs = splitSysex(new Uint8Array(await file.arrayBuffer()));
      const dump = this.codec.decodeDump(msgs);
      const bank = new Bank(dump.stream);
      if (this.anyUnsent && !confirm('Replace the editor contents with this file? Changes not sent to the unit will be lost.')) return;
      this.acceptBank(bank, false);
      this.status(`Loaded ${file.name}: ${presets(bank.usedCount)}. Use SEND BANK to transfer it to the G-Force.`);
      this.render();
    } catch (e) {
      this.error(e as Error);
    }
  }

  saveFile(): void {
    const url = URL.createObjectURL(new Blob([joinMessages(this.bankMessages()) as BlobPart], { type: 'application/octet-stream' }));
    h('a', { href: url, download: 'tc-gforce-user-bank.syx' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // =========================================================================
  // Feedback

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
    for (const el of dir === 'in' ? [this.midiLeds.in, this.indicators.midi] : [this.midiLeds.out]) {
      el.classList.add('on');
      clearTimeout(Number(el.dataset.t));
      el.dataset.t = String(setTimeout(() => el.classList.remove('on'), 90));
    }
  }

  // =========================================================================
  // Persistence (this browser only)

  private settings(): {
    input?: string; output?: string; id?: number; channel?: number; pc?: string; bankSize?: number;
    view?: number; unitSel?: { bank: number; n: number } | null;
  } {
    try {
      return JSON.parse(localStorage.getItem('gforce-editor') ?? '{}');
    } catch {
      return {};
    }
  }

  private saveSettings(): void {
    try {
      // Port names are only known while connected; keep the saved ones otherwise.
      const old = this.settings();
      const port = (sel: HTMLSelectElement, saved?: string) => (this.midi.connected ? (sel.value ? sel.selectedOptions[0]?.text : undefined) : saved);
      localStorage.setItem('gforce-editor', JSON.stringify({
        input: port(this.inSel, old.input),
        output: port(this.outSel, old.output),
        view: this.view,
        unitSel: this.unitSel,
        id: this.sysexId,
        channel: this.channel,
        pc: this.pcMode,
        bankSize: this.bankSize,
      }));
    } catch { /* storage unavailable */ }
  }

  restoreMemory(): boolean {
    try {
      const m = JSON.parse(localStorage.getItem('gforce-memory') ?? 'null');
      if (m?.v !== 1) return false;
      const bank = new Bank(fromB64(m.bank));
      const baseline = new Bank(fromB64(m.baseline));
      const edit = fromB64(m.edit);
      if (edit.length !== RECORD_SIZE) return false;
      this.bank = bank;
      this.baseline = baseline;
      this.hasData = true;
      this.current = Math.max(0, Math.min(SLOTS - 1, Number(m.current) || 0));
      this.recallTarget = this.current;
      this.edit = new Preset(edit);
      return true;
    } catch {
      return false;
    }
  }

  private restore(): void {
    const id = Number(this.settings().id);
    this.sysexId = Number.isInteger(id) && id >= 0 && id <= 126 ? id : 0;
    const ch = Number(this.settings().channel);
    this.channel = Number.isInteger(ch) && ch >= 0 && ch <= 15 ? ch : 0;
    const pc = PC_MODES.find((m) => m.id === this.settings().pc);
    if (pc) this.pcMode = pc.id;
    const bs = Number(this.settings().bankSize);
    if (Number.isInteger(bs) && bs >= 1 && bs <= BANK_SIZE_MAX) this.bankSize = bs;
    this.restoreMemory();
    const v = Number(this.settings().view);
    if (Number.isInteger(v) && v >= 0 && v < BANK_TOTAL) this.view = v;
    const u = this.settings().unitSel;
    if (u && Number.isInteger(u.bank) && u.bank >= 0 && u.bank < BANK_TOTAL && Number.isInteger(u.n) && u.n >= 0 && u.n < bankCount(u.bank)) {
      this.unitSel = { bank: u.bank, n: u.n };
      if (u.bank === USER && !this.hasData) this.current = u.n;
    }
    this.recallTarget = this.selectedIn(this.view);
  }

  persist(): void {
    if (this.inSel) this.saveSettings();
    try {
      if (!this.hasData && !this.editDirty) return localStorage.removeItem('gforce-memory');
      localStorage.setItem('gforce-memory', JSON.stringify({
        v: 1, bank: toB64(this.bank.stream()), baseline: toB64(this.baseline.stream()), edit: toB64(this.edit.data), current: this.current,
      }));
    } catch { /* storage unavailable */ }
  }

  private persistTimer = 0;
  private persistSoon(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persist(), 300);
  }

  // =========================================================================
  // DOM

  private build(): void {
    const scaler = h('div', { class: 'scaler' });
    scaler.append(this.buildPanel(), this.buildStrip(), this.buildMidiUnit(), this.buildLibrary(), this.buildData());
    this.root.append(scaler);
    const fit = () => scaler.style.setProperty('zoom', String(Math.min(1.25, this.root.clientWidth / 1520)));
    new ResizeObserver(fit).observe(this.root);
    fit();

    this.fileInput = h('input', { type: 'file', accept: '.syx,application/octet-stream', hidden: '' });
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

  private key(id: string, label: string, fn: () => void, title?: string, led = true): HTMLElement {
    const k = new PanelKey(label, fn, { title, led });
    this.keys[id] = k;
    return k.button;
  }

  private buildPanel(): HTMLElement {
    // Left: power, input/output knobs, brand, memory card slot.
    const levelKnob = (label: string) => {
      const k = new Knob({ className: 'level', label: `${label} level (on the unit)`, onTurn: () => {} });
      return h('div', { class: 'level-wrap' }, k.el, h('div', { class: 'silk', text: label }));
    };
    const power = h('div', { class: 'power-key', title: 'Power (on the unit)' }, h('span', { class: 'key-led on' }), h('span', { text: 'POWER' }));
    const left = h('div', { class: 'gf-left' },
      h('div', { class: 'gf-left-top' }, power, levelKnob('IN'), levelKnob('OUT')),
      h('div', { class: 'brand' }, h('span', { class: 'brand-tc', text: 't.c. electronic' }), h('span', { class: 'brand-model', text: 'G-Force' })),
      h('div', { class: 'card-slot', title: 'PCMCIA memory card slot' }));

    // Display window: input meters, graphic LCD, billboard and indicators.
    const meterCol = (ch: string) => {
      const col = h('div', { class: 'meter-col' });
      for (let i = 0; i < 8; i++) col.append(h('i', { class: i < 2 ? 'hot' : '' }));
      col.append(h('span', { class: 'meter-ch', text: ch }));
      return col;
    };
    const scale = h('div', { class: 'meter-scale' }, ...['0', '-3', '-6', '-12', '-18', '-24', '-40', '-60'].map((t) => h('span', { text: t })));
    const meters = h('div', { class: 'meters', title: 'Input meters (on the unit)' }, meterCol('L'), meterCol('R'), scale);
    const ind = (id: keyof App['indicators'], label: string) => {
      const led = h('span', { class: 'ind-led' });
      this.indicators[id] = led;
      return h('span', { class: 'ind' }, led, h('span', { text: label }));
    };
    const gr = h('div', { class: 'gr-row' });
    for (let i = 0; i < 14; i++) gr.append(h('i'));
    const bill = h('div', { class: 'billboard-wrap' }, this.billboard.el,
      h('div', { class: 'ind-row' }, ind('edited', 'EDITED'), ind('midi', 'MIDI IN'), ind('pedal', 'PEDAL'), ind('overflow', 'OVERFLOW')),
      h('div', { class: 'gr-labels' }, h('span', { text: 'NOISE GATE' }), h('span', { text: 'GAIN REDUCTION' }), h('span', { text: 'COMPRESSION' })),
      gr);
    const window_ = h('div', { class: 'gf-window' }, meters, h('div', { class: 'lcd-wrap' }, this.lcd.el), bill);

    // Effects control: bypass/tuner/tempo + nine block keys.
    const fx = h('div', { class: 'key-group' }, h('div', { class: 'group-title', text: 'EFFECTS CONTROL' }),
      h('div', { class: 'fx-grid' },
        this.key('bypass', 'BYPASS', () => this.notInEditor('BYPASS'), 'Overall bypass (on the unit)'),
        ...BLOCKS.slice(0, 3).map((b) => this.key(b.id, b.label, () => this.pressBlock(b.id), `${b.label}: jump to its decoded parameters`)),
        this.key('tuner', 'TUNER', () => this.notInEditor('TUNER'), 'Tuner (on the unit)'),
        ...BLOCKS.slice(3, 6).map((b) => this.key(b.id, b.label, () => this.pressBlock(b.id), `${b.label}: jump to its decoded parameters`)),
        this.key('tempo', 'TEMPO', () => this.notInEditor('TEMPO'), 'Tap tempo (on the unit)'),
        ...BLOCKS.slice(6, 9).map((b) => this.key(b.id, b.label, () => this.pressBlock(b.id), `${b.label}: jump to its decoded parameters`))));

    const control = h('div', { class: 'key-group' }, h('div', { class: 'group-title', text: 'CONTROL' }),
      h('div', { class: 'ctl-grid' },
        this.key('recall', 'RECALL', () => this.pressRecall(), 'Recall: turn VALUE to choose a User preset, ENTER loads it (R)'),
        this.key('store', 'STORE', () => this.pressStore(), 'Store: turn VALUE to choose the slot, ENTER stores (S)'),
        this.key('effects', 'EFFECTS', () => this.pressEffects(), 'Edit: PARAMETER moves through the preset bytes, VALUE changes them (E)'),
        this.key('mod', 'MOD', () => this.notInEditor('MODIFIERS'), 'Modifiers (not decoded yet)'),
        this.key('io', 'I/O SETUP', () => this.notInEditor('I/O SETUP'), 'I/O setup (on the unit)'),
        this.key('utility', 'UTILITY', () => this.pressUtility(), 'Utility: send or receive the User bank (U)')));

    const nav = h('div', { class: 'nav' },
      h('div', { class: 'nav-row' },
        h('div', { class: 'arrows' }, this.key('left', '◄', () => this.turnParameter(-1, false), 'Previous', false), this.key('right', '►', () => this.turnParameter(1, false), 'Next', false)),
        h('div', { class: 'exit-enter' }, this.key('exit', 'EXIT', () => this.pressExit(), 'Exit (Esc)', false), this.key('enter', 'ENTER', () => this.pressEnter(), 'Enter'))),
      h('div', { class: 'wheels' },
        h('div', { class: 'wheel-wrap' }, h('div', { class: 'silk', text: 'PARAMETER' }),
          new Knob({ className: 'wheel', label: 'Parameter wheel', onTurn: (d, f) => this.turnParameter(d, f) }).el),
        h('div', { class: 'wheel-wrap' }, h('div', { class: 'silk', text: 'VALUE' }),
          new Knob({ className: 'wheel', label: 'Value wheel', onTurn: (d, f) => this.turnValue(d, f) }).el)));

    return h('section', { class: 'unit gforce', 'aria-label': 'TC Electronic G-Force front panel' },
      this.ear(), h('div', { class: 'face' }, left, window_, fx, control, nav), this.ear());
  }

  private buildStrip(): HTMLElement {
    const cell = (id: string, label: string, onClick?: () => void, title?: string) => {
      const v = h('div', { class: 'strip-value' });
      const c = h('button', { class: 'strip-cell', title: title ?? label }, h('div', { class: 'strip-title', text: label }), v);
      if (onClick) c.addEventListener('click', onClick);
      else c.disabled = true;
      this.strip[id] = v;
      return c;
    };
    this.nameInput = h('input', { class: 'name-input', maxlength: String(NAME_LEN), 'aria-label': 'Preset name', title: 'Preset name (20 characters). STORE writes it into the bank.' });
    this.nameInput.addEventListener('input', () => this.setName(cleanName(this.nameInput.value)));
    const head = h('div', { class: 'strip-head' }, h('div', { class: 'strip-title', text: 'User preset · name' }),
      h('div', { class: 'strip-head-row' }, h('span', { class: 'strip-num' }), this.nameInput));
    this.strip.num = head.querySelector('.strip-num')!;
    return h('section', { class: 'unit strip' }, this.ear(), h('div', { class: 'face' },
      head,
      ...PARAMS.map((p) => cell(p.id, `${BLOCKS.find((b) => b.id === p.block)!.label} · ${p.label}`, () => this.jumpTo(p.offset), p.source)),
      cell('byte', 'Cursor byte', () => this.pressEffects(), 'The byte under the PARAMETER cursor'),
      cell('stored', 'Stored value', undefined, 'The same byte in the stored preset'),
      cell('state', 'State')), this.ear());
  }

  jumpTo(offset: number): void {
    if (this.busy) return;
    this.mode = 'edit';
    this.cursor = offset;
    this.render();
  }

  private buildMidiUnit(): HTMLElement {
    this.inSel = h('select', { 'aria-label': 'MIDI input' });
    this.outSel = h('select', { 'aria-label': 'MIDI output' });
    this.idSel = h('select', { 'aria-label': 'SysEx ID', title: 'The G-Force SysEx ID (I/O Setup → MIDI)' });
    for (let i = 0; i <= 126; i++) this.idSel.append(h('option', { value: String(i), text: String(i) }));
    this.idSel.value = String(this.sysexId);
    this.inSel.addEventListener('change', () => { this.midi.selectInput(this.inSel.value || null); this.saveSettings(); this.renderMidi(); });
    this.outSel.addEventListener('change', () => { this.midi.selectOutput(this.outSel.value || null); this.saveSettings(); this.renderMidi(); });
    this.idSel.addEventListener('change', () => { this.sysexId = Number(this.idSel.value); this.saveSettings(); });
    this.chSel = h('select', { 'aria-label': 'MIDI channel', title: 'The G-Force Basic channel (I/O Setup → MIDI)' });
    for (let i = 0; i < 16; i++) this.chSel.append(h('option', { value: String(i), text: String(i + 1) }));
    this.chSel.value = String(this.channel);
    this.chSel.addEventListener('change', () => { this.channel = Number(this.chSel.value); this.saveSettings(); });
    this.pcSel = h('select', { 'aria-label': 'Preset recall', title: 'What selecting a preset sends to the G-Force' });
    for (const m of PC_MODES) this.pcSel.append(h('option', { value: m.id, text: m.label, title: m.title }));
    this.pcSel.value = this.pcMode;
    this.pcSel.addEventListener('change', () => {
      this.pcMode = this.pcSel.value as PcMode;
      this.pcSel.title = PC_MODES.find((m) => m.id === this.pcMode)!.title;
      this.saveSettings();
      this.renderMidi();
    });
    this.pcSel.title = PC_MODES.find((m) => m.id === this.pcMode)!.title;
    const sizeField = new NumberField({
      label: 'Bank size', min: 1, max: BANK_SIZE_MAX, value: this.bankSize,
      title: 'The G-Force Bank size, 1–128 (I/O Setup → MIDI). Needs Mapping mode External.',
      onChange: (v) => { this.bankSize = v; this.saveSettings(); },
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
        field('IN', this.inSel), field('OUT', this.outSel),
        h('div', { class: 'field-row' }, field('CH', this.chSel), field('SYSEX ID', this.idSel)),
        h('div', { class: 'field-row' }, field('BANK SEL', this.pcSel), field('SIZE', sizeField.el)),
        this.mapNote),
      h('div', { class: 'midi-actions' },
        btn('receive', 'RECEIVE BANK', () => this.receiveBank(), 'Wait for a User bank dump: on the G-Force, Utility → User Bank to MIDI'),
        btn('send', 'SEND BANK', () => void this.sendBank(), 'Send the User bank: on the G-Force, first arm Utility → MIDI to User Bank'),
        btn('load', 'LOAD .SYX', () => this.fileInput.click(), 'Load a G-Force User bank file'),
        btn('save', 'SAVE .SYX', () => this.saveFile(), 'Save the editor bank as a .syx file')),
      h('div', { class: 'midi-status' }, this.statusEl, this.logEl)), this.ear());
  }

  private buildLibrary(): HTMLElement {
    this.libList = h('div', { class: 'lib-list', role: 'listbox', 'aria-label': 'Presets' });
    for (let i = 0; i < ROM_NAMES.length; i++) {
      const row = h('div', { class: 'lib-row', role: 'option' });
      row.addEventListener('click', () => this.recallAt(this.view, i));
      row.addEventListener('dblclick', () => { if (this.view === USER) this.nameInput.focus(); });
      this.libRows.push(row);
      this.libList.append(row);
    }
    const tabs = h('div', { class: 'bank-tabs', role: 'tablist', 'aria-label': 'Bank' });
    for (let b = 0; b < BANK_TOTAL; b++) {
      const t = h('button', { class: 'bank-tab', role: 'tab', text: bankLabel(b) });
      t.addEventListener('click', () => this.showBank(b));
      this.bankTabs.push(t);
      tabs.append(t);
    }
    this.libTitle = h('div', { class: 'midi-title' });
    this.libHelp = h('div', { class: 'silk' });
    this.btns.clear = h('button', { class: 'rack-btn', title: 'Empty the selected User slot (Delete key)' });
    this.btns.clear.addEventListener('click', () => this.clearSlot());
    return h('section', { class: 'unit library' }, this.ear(), h('div', { class: 'face' },
      h('div', { class: 'lib-head' }, this.libTitle, tabs, this.btns.clear),
      this.libHelp,
      this.libList), this.ear());
  }

  private buildData(): HTMLElement {
    const grid = h('div', { class: 'data-grid' });
    for (let off = PARAMS_AT; off < RECORD_SIZE; off++) {
      const c = h('button', { class: 'data-cell' });
      c.addEventListener('click', () => this.jumpTo(off));
      this.dataCells.push(c);
      grid.append(c);
    }
    return h('section', { class: 'unit data' }, this.ear(), h('div', { class: 'face' },
      h('div', { class: 'lib-head' }, h('div', { class: 'midi-title', text: 'PRESET DATA' }),
        h('div', { class: 'silk', text: `bytes ${PARAMS_AT}–${RECORD_SIZE - 1} of the record, hex · click a byte to edit it with VALUE · named = decoded · orange = differs from the stored preset` })),
      grid), this.ear());
  }

  private wireKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.classList?.contains('knob-body')) return;
      const k = e.key.toLowerCase();
      const list = this.mode === 'recall' || this.mode === 'store';
      if (e.key === 'ArrowUp') (list ? this.turnValue(-1, false) : this.turnValue(1, false));
      else if (e.key === 'ArrowDown') (list ? this.turnValue(1, false) : this.turnValue(-1, false));
      else if (e.key === 'ArrowRight') this.turnParameter(1, false);
      else if (e.key === 'ArrowLeft') this.turnParameter(-1, false);
      else if (e.key === 'Enter') this.pressEnter();
      else if (e.key === 'Escape') this.pressExit();
      else if (k === 'r') this.pressRecall();
      else if (k === 's') this.pressStore();
      else if (k === 'e') this.pressEffects();
      else if (k === 'u') this.pressUtility();
      else if (e.key === 'Delete') this.clearSlot();
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
    this.renderData();
    this.renderMidi();
  }

  private presetName(i: number): string {
    const p = i === this.current ? this.edit : this.bank.preset(i);
    return this.bank.used(i) || (i === this.current && this.editDirty) ? p.name : '';
  }

  private renderDisplay(): void {
    const lcd = this.lcd;
    const nm = (i: number) => this.presetName(i) || '- empty -';
    let bb = String(this.current + 1);
    let label = '';
    switch (this.mode) {
      case 'recall':
        bb = String(this.recallTarget + 1);
        {
          const b = this.view, t = this.recallTarget;
          const name = b === USER ? nm(t) : b === ROM ? ROM_NAMES[t] : '- on the card -';
          presetPage(lcd, {
            title: 'Recall', leftLabel: 'SELECT:', left: selectGrid,
            bank: bankLabel(b), cardLabel: b > USER ? bankLabel(b) : 'CARD 1', number: t + 1, name,
          });
          label = `Recall, ${bankLabel(b)} ${t + 1}: ${name}`;
        }
        break;
      case 'store':
        bb = String(this.storeTarget + 1);
        presetPage(lcd, {
          title: 'Store', leftLabel: 'INTO:',
          left: textBox(this.bank.used(this.storeTarget)
            ? ['REPLACES', this.presetName(this.storeTarget).toUpperCase(), '', 'ENTER: STORE']
            : ['EMPTY SLOT', '', '', 'ENTER: STORE']),
          bank: 'USER', cardLabel: 'CARD 1', number: this.storeTarget + 1, name: this.edit.name || '- no name -',
        });
        label = `Store ${this.edit.name} into User ${this.storeTarget + 1}`;
        break;
      case 'edit': {
        const p = paramAt(this.cursor);
        const v = this.edit.byte(this.cursor);
        const stored = this.bank.preset(this.current).byte(this.cursor);
        const fmt = (q: ParamDef | undefined, x: number) => (q ? q.format(x) : `${hex2(x)}H`);
        const rows: ListRow[] = [{ label: `U${pad3(this.current + 1)} ${this.edit.name}`.toUpperCase(), header: true }];
        for (let off = PARAMS_AT; off < RECORD_SIZE; off++) {
          const q = paramAt(off);
          rows.push({ label: q ? q.label.toUpperCase() : `BYTE ${off}`, value: fmt(q, this.edit.byte(off)).toUpperCase() });
        }
        const block = p ? BLOCKS.find((b) => b.id === p.block)!.label : 'PRESET DATA';
        paramPage(lcd, {
          title: p ? `${block} - DECODED` : 'PRESET DATA - RAW',
          tab: 'PARAM',
          rows,
          cursor: 1 + this.cursor - PARAMS_AT,
          barLabel: p ? p.label.toUpperCase() : `BYTE ${this.cursor}`,
          bar: p ? (v - p.min) / (p.max - p.min) : v / 255,
          barNote: v !== stored ? `WAS ${fmt(p, stored).toUpperCase()}` : `${v}`,
        });
        label = `Edit ${p ? p.label : `byte ${this.cursor}`}: ${fmt(p, v)}`;
        break;
      }
      case 'utility':
        infoPage(lcd, {
          title: 'Utility',
          lines: [...UTILITY_ITEMS.map((it) => it.label.toUpperCase().replace(/\s+\(/, ' (')), '', 'ENTER STARTS IT HERE. ON THE G-FORCE,', 'CHOOSE THE SAME ITEM, ENTER TWICE.'],
          select: this.utilityItem,
        });
        label = `Utility: ${UTILITY_ITEMS[this.utilityItem].label}`;
        break;
      case 'receive': {
        const c = this.collect;
        const f = c ? (c.msgs.length - 1) / Math.max(1, c.count) : 0;
        bb = c ? String(Math.min(99, Math.floor(f * 100))) : '-';
        infoPage(lcd, {
          title: 'MIDI Receive',
          lines: [c ? `BLOCK ${c.msgs.length - 1} OF ${c.count}` : 'WAITING FOR THE G-FORCE...', '', 'ON THE G-FORCE: UTILITY, USER BANK', 'TO MIDI, ENTER TWICE.  EXIT CANCELS'],
          progress: c ? f : undefined,
        });
        label = 'Receiving the User bank';
        break;
      }
      case 'send': {
        const f = this.sendProgress / Math.max(1, this.sendTotal);
        bb = String(Math.min(99, Math.floor(f * 100)));
        infoPage(lcd, {
          title: 'MIDI Send',
          lines: [`MESSAGE ${this.sendProgress} OF ${this.sendTotal}`, '', 'DO NOT TOUCH THE G-FORCE UNTIL', 'IT REPORTS THE RESULT.'],
          progress: f,
        });
        label = 'Sending the User bank';
        break;
      }
    }
    if (this.message && Date.now() < this.message.until) {
      messageBox(lcd, this.message.text);
      label += ` — ${this.message.text}`;
    } else this.message = null;
    lcd.flush(label);
    this.billboard.set(bb);
    this.indicators.edited.classList.toggle('on', this.editDirty);
  }

  private renderKeys(): void {
    const set = (id: string, s: 'off' | 'on' | 'flash') => this.keys[id]?.set(s);
    set('recall', this.mode === 'recall' ? 'on' : 'off');
    set('store', this.mode === 'store' ? 'flash' : 'off');
    set('effects', this.mode === 'edit' ? 'on' : 'off');
    set('utility', this.mode === 'utility' || this.busy ? 'on' : 'off');
    set('enter', this.mode === 'store' || this.mode === 'utility' || (this.mode === 'recall' && (this.view !== USER || this.recallTarget !== this.current)) ? 'flash' : 'off');
    const p = paramAt(this.cursor);
    for (const b of BLOCKS) set(b.id, this.mode === 'edit' && p?.block === b.id ? 'on' : 'off');
  }

  private renderStrip(): void {
    this.strip.num.textContent = `U${pad3(this.current + 1)}`;
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.presetName(this.current);
    const used = this.bank.used(this.current) || this.editDirty;
    this.nameInput.disabled = !used;
    this.nameInput.placeholder = used ? '' : 'empty slot';
    for (const p of PARAMS) {
      this.strip[p.id].textContent = used ? p.format(this.edit.get(p)) : '—';
      this.strip[p.id].parentElement!.classList.toggle('sel', this.mode === 'edit' && this.cursor === p.offset);
    }
    const v = this.edit.byte(this.cursor), s = this.bank.preset(this.current).byte(this.cursor);
    this.strip.byte.textContent = `${this.cursor} · ${hex2(v)}h · ${v}`;
    this.strip.stored.textContent = `${hex2(s)}h · ${s}`;
    const unsent = this.slotUnsent(this.current);
    this.strip.state.textContent = this.editDirty ? 'Edited · not stored' : unsent ? 'Stored · not sent' : used ? 'Stored' : 'Empty slot';
    this.strip.state.parentElement!.classList.toggle('warn', this.editDirty);
  }

  private renderLibrary(): void {
    const b = this.view, count = bankCount(b);
    this.bankTabs.forEach((t, k) => {
      t.classList.toggle('sel', k === b);
      t.setAttribute('aria-selected', String(k === b));
    });
    this.libTitle.textContent = `${bankLabel(b)} BANK`;
    this.libHelp.textContent = b === USER
      ? 'User 1–100 · click to recall on the unit and edit · double-click to rename · ✎ = edited, not stored · * = not sent to the G-Force'
      : b === ROM
        ? 'Factory presets 1–225 (names from the manual) · click to recall on the unit · read-only: the dump only carries the User bank'
        : `Card bank ${b - 1}, presets 1–${count} · click to recall on the unit · the editor can't read card contents`;
    this.btns.clear.hidden = b !== USER;
    this.btns.clear.textContent = `CLEAR USER ${this.current + 1}`;
    this.btns.clear.disabled = this.busy || (!this.bank.used(this.current) && !this.editDirty);
    const rows = b === ROM ? 45 : 25;
    this.libList.style.gridTemplateRows = `repeat(${rows}, auto)`;
    this.libList.style.gridTemplateColumns = `repeat(${Math.ceil(count / rows)}, 1fr)`;
    this.libList.classList.toggle('readonly', b !== USER);
    const sel = b === USER ? this.current : this.unitSel?.bank === b ? this.unitSel.n : -1;
    this.libRows.forEach((row, i) => {
      row.hidden = i >= count;
      if (i >= count) return;
      let name = '', flags = '';
      if (b === USER) {
        name = this.presetName(i);
        flags = `${i === this.current && this.editDirty ? '✎' : ''}${this.slotUnsent(i) ? '*' : ''}`;
      } else if (b === ROM) name = ROM_NAMES[i];
      row.replaceChildren(
        h('span', { class: 'n', text: pad3(i + 1) }),
        h('span', { class: 'name', text: name || (b === USER ? '—' : '') }),
        h('span', { class: 'flags', text: flags }));
      row.classList.toggle('sel', i === sel);
      row.classList.toggle('blank', b === USER && !name);
      row.setAttribute('aria-selected', String(i === sel));
    });
  }

  private renderData(): void {
    const stored = this.bank.preset(this.current);
    const used = this.bank.used(this.current) || this.editDirty;
    this.dataCells.forEach((c, k) => {
      const off = PARAMS_AT + k;
      const v = this.edit.byte(off);
      const p = paramAt(off);
      c.textContent = hex2(v);
      c.title = `byte ${off} (0x${hex3(off)}) = ${v}${p ? ` · ${p.label}: ${p.format(v)}` : ''}`;
      c.classList.toggle('known', !!p);
      c.classList.toggle('zero', v === 0);
      c.classList.toggle('diff', v !== stored.byte(off));
      c.classList.toggle('cur', this.mode === 'edit' && off === this.cursor);
      c.disabled = !used;
    });
  }

  private renderMidi(): void {
    if (!this.statusEl) return;
    const c = this.midi.connected, out = this.midi.hasOutput, inp = !!this.midi.inputId;
    this.btns.connect.textContent = c ? 'RESCAN' : 'CONNECT';
    this.inSel.disabled = !c;
    this.outSel.disabled = !c;
    this.btns.receive.disabled = !inp || this.mode === 'send';
    this.btns.receive.textContent = this.mode === 'receive' ? 'CANCEL' : 'RECEIVE BANK';
    this.btns.send.disabled = !out || this.busy;
    this.btns.load.disabled = this.busy;
    this.mapNote.hidden = this.pcMode !== 'fine' && this.pcMode !== 'coarse';
    if (!this.statusEl.textContent) {
      this.statusEl.textContent = GfMidi.supported
        ? 'Press CONNECT and pick the G-Force ports, then RECEIVE BANK and start User Bank to MIDI on the unit.'
        : 'Web MIDI is unavailable in this browser — use Chrome or Edge. You can still load and save .syx files.';
    }
    if (this.hasData && this.statusEl.textContent.startsWith('Press CONNECT')) {
      this.statusEl.textContent = 'Bank restored from this browser. It may differ from the G-Force: use RECEIVE BANK to refresh it.';
    }
  }
}
