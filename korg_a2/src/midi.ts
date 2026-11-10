// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Web MIDI transport for the A2.

import { parseMessage, type A2Message } from './sysex.ts';

export interface PortInfo {
  id: string;
  name: string;
}

type Listener = (msg: A2Message) => void;
type RawListener = (data: Uint8Array) => void;

export class A2Midi {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private listeners = new Set<Listener>();
  private rawListeners = new Set<RawListener>();
  onPortsChanged: () => void = () => {};
  onActivity: (dir: 'in' | 'out') => void = () => {};
  /** Program change received from the A2 (0-99). */
  onProgramChange: (program: number, channel: number) => void = () => {};

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get connected(): boolean {
    return !!this.access;
  }

  get hasOutput(): boolean {
    return !!this.output;
  }

  async connect(): Promise<void> {
    if (!A2Midi.supported) throw new Error('Web MIDI is not available in this browser (use Chrome, Edge or Opera).');
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => this.onPortsChanged();
  }

  inputs(): PortInfo[] {
    return this.access ? [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id })) : [];
  }

  outputs(): PortInfo[] {
    return this.access ? [...this.access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id })) : [];
  }

  selectInput(id: string | null): void {
    if (this.input) this.input.onmidimessage = null;
    this.input = id && this.access ? this.access.inputs.get(id) ?? null : null;
    if (this.input) this.input.onmidimessage = (e) => this.handle(e.data);
  }

  selectOutput(id: string | null): void {
    this.output = id && this.access ? this.access.outputs.get(id) ?? null : null;
  }

  get inputId(): string | null {
    return this.input?.id ?? null;
  }
  get outputId(): string | null {
    return this.output?.id ?? null;
  }

  private handle(data: Uint8Array | null): void {
    if (!data || data.length === 0) return;
    if (data[0] === 0xf8 || data[0] === 0xfe) return; // clock / active sensing
    this.onActivity('in');
    for (const l of this.rawListeners) l(data);
    if ((data[0] & 0xf0) === 0xc0 && data.length >= 2) {
      this.onProgramChange(data[1], data[0] & 0x0f);
      return;
    }
    if (data[0] !== 0xf0) return;
    const msg = parseMessage(data);
    if (!msg) return;
    for (const l of this.listeners) l(msg);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onRaw(l: RawListener): () => void {
    this.rawListeners.add(l);
    return () => this.rawListeners.delete(l);
  }

  send(bytes: Uint8Array | number[]): void {
    if (!this.output) throw new Error('No MIDI output selected');
    this.output.send(bytes);
    this.onActivity('out');
  }

  /** Wait for the first A2 message whose function byte is in `fns`. */
  waitFor(fns: number[], timeoutMs: number, channel?: number): Promise<A2Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Timed out waiting for the A2 — check cables, MIDI channel and that EXCLUSIVE is ON (UTILITY → MIDI).'));
      }, timeoutMs);
      const off = this.on((m) => {
        if (!fns.includes(m.fn)) return;
        if (channel !== undefined && m.channel !== channel) return;
        clearTimeout(timer);
        off();
        resolve(m);
      });
    });
  }

  programChange(ch: number, program: number): void {
    // Bank select: MSB 0, LSB 0 = internal (manual 1-1, "c : Bank (0 = Internal / 1 = Card)").
    this.send([0xb0 | ch, 0x00, 0x00]);
    this.send([0xb0 | ch, 0x20, 0x00]);
    this.send([0xc0 | ch, program & 0x7f]);
  }

  /** CC 91 (0x5B) "Effect 1 Depth" = bypass: 0-63 off, 64-127 on. */
  bypass(ch: number, on: boolean): void {
    this.send([0xb0 | ch, 0x5b, on ? 0x7f : 0x00]);
  }
}
