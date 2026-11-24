// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Web MIDI transport for the G-Force.
//
// The G-Force has no known dump request: the User bank is sent from the unit
// (Utility → User Bank to MIDI), and received after Utility → MIDI to User
// Bank has been armed on the unit.

export interface PortInfo {
  id: string;
  name: string;
}

type SysexListener = (msg: Uint8Array) => void;

export class GfMidi {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private clockInput: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private sysexListeners = new Set<SysexListener>();
  onPortsChanged: () => void = () => {};
  onActivity: (dir: 'in' | 'out') => void = () => {};
  onProgramChange: (program: number, channel: number) => void = () => {};
  /** MIDI clock tick (F8) with its arrival time in ms. */
  onClock: (time: number) => void = () => {};
  /** MIDI Start (FA) / Continue (FB) / Stop (FC). */
  onTransport: (status: number) => void = () => {};

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get connected(): boolean {
    return !!this.access;
  }
  get hasOutput(): boolean {
    return !!this.output;
  }
  get inputId(): string | null {
    return this.input?.id ?? null;
  }
  get outputId(): string | null {
    return this.output?.id ?? null;
  }

  async connect(): Promise<void> {
    if (!GfMidi.supported) throw new Error('Web MIDI is not available in this browser (use Chrome, Firefox, Edge or Opera).');
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
    if (this.input) this.input.onmidimessage = (e) => this.handle(e.data, e.timeStamp);
    this.selectClockInput(this.clockId);
  }

  private clockId: string | null = null;

  /**
   * Listen for MIDI clock on another input too (null: the main input only).
   * Clock on the main input is always reported.
   */
  selectClockInput(id: string | null): void {
    this.clockId = id;
    if (this.clockInput && this.clockInput !== this.input) this.clockInput.onmidimessage = null;
    this.clockInput = id && this.access ? this.access.inputs.get(id) ?? null : null;
    if (this.clockInput && this.clockInput !== this.input) {
      this.clockInput.onmidimessage = (e) => this.handleRealtime(e.data, e.timeStamp);
    }
  }

  /** Clock and transport only (from the clock input). */
  handleRealtime(data: Uint8Array | null, time = performance.now()): void {
    if (!data || data.length === 0) return;
    if (data[0] === 0xf8) this.onClock(time);
    else if (data[0] === 0xfa || data[0] === 0xfb || data[0] === 0xfc) this.onTransport(data[0]);
  }
  selectOutput(id: string | null): void {
    this.output = id && this.access ? this.access.outputs.get(id) ?? null : null;
  }

  /** Feed an incoming MIDI message (also used by tests / simulators). */
  handle(data: Uint8Array | null, time = performance.now()): void {
    if (!data || data.length === 0 || data[0] === 0xfe) return;
    if (data[0] >= 0xf8) return this.handleRealtime(data, time);
    this.onActivity('in');
    if ((data[0] & 0xf0) === 0xc0 && data.length >= 2) this.onProgramChange(data[1], data[0] & 0x0f);
    else if (data[0] === 0xf0) for (const l of this.sysexListeners) l(data);
  }

  onSysex(l: SysexListener): () => void {
    this.sysexListeners.add(l);
    return () => this.sysexListeners.delete(l);
  }

  send(bytes: Uint8Array | number[], timestamp?: number): void {
    if (!this.output) throw new Error('No MIDI output selected');
    this.output.send(bytes, timestamp);
    this.onActivity('out');
  }

  /**
   * Send messages one after another, `gapMs` apart (scheduled with Web MIDI
   * timestamps). Resolves when the last one is due.
   */
  sendPaced(msgs: Uint8Array[], gapMs: number, onProgress?: (sent: number) => void): Promise<void> {
    if (!this.output) return Promise.reject(new Error('No MIDI output selected'));
    const t0 = performance.now() + 20;
    msgs.forEach((m, i) => this.send(m, t0 + i * gapMs));
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        i = Math.min(msgs.length, Math.floor((performance.now() - t0) / gapMs) + 1);
        onProgress?.(i);
        if (i >= msgs.length) resolve();
        else setTimeout(tick, Math.max(50, gapMs));
      };
      tick();
    });
  }

  controlChange(channel: number, cc: number, value: number): void {
    this.send([0xb0 | (channel & 0x0f), cc & 0x7f, value & 0x7f]);
  }

  programChange(channel: number, program: number): void {
    this.send([0xc0 | (channel & 0x0f), program & 0x7f]);
  }

  /** Resolve with the next SysEx message accepted by `match`. */
  waitForSysex(match: (m: Uint8Array) => boolean, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); off(); signal?.removeEventListener('abort', abort); };
      const abort = () => { done(); reject(new Error('Cancelled')); };
      const timer = setTimeout(() => {
        done();
        reject(Object.assign(new Error('Timed out waiting for the G-Force'), { name: 'TimeoutError' }));
      }, timeoutMs);
      const off = this.onSysex((m) => {
        if (!match(m)) return;
        done();
        resolve(m);
      });
      signal?.addEventListener('abort', abort);
    });
  }
}
