// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Web MIDI transport for the JMP-1.
//
// The JMP-1 has no dump request: a dump is sent when PATCH + VOLUME are pressed
// on the unit, and it accepts a dump at any time (memory lock off). Apart from
// SysEx it only understands Program Change.

export interface PortInfo {
  id: string;
  name: string;
}

type SysexListener = (msg: Uint8Array) => void;

export class JmpMidi {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private sysexListeners = new Set<SysexListener>();
  onPortsChanged: () => void = () => {};
  onActivity: (dir: 'in' | 'out') => void = () => {};
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
  get inputId(): string | null {
    return this.input?.id ?? null;
  }
  get outputId(): string | null {
    return this.output?.id ?? null;
  }

  async connect(): Promise<void> {
    if (!JmpMidi.supported) throw new Error('Web MIDI is not available in this browser (use Chrome, Edge or Opera).');
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

  /** Feed an incoming MIDI message (also used by tests / simulators). */
  handle(data: Uint8Array | null): void {
    if (!data || data.length === 0 || data[0] === 0xf8 || data[0] === 0xfe) return;
    this.onActivity('in');
    if ((data[0] & 0xf0) === 0xc0 && data.length >= 2) this.onProgramChange(data[1], data[0] & 0x0f);
    else if (data[0] === 0xf0) for (const l of this.sysexListeners) l(data);
  }

  onSysex(l: SysexListener): () => void {
    this.sysexListeners.add(l);
    return () => this.sysexListeners.delete(l);
  }

  send(bytes: Uint8Array | number[]): void {
    if (!this.output) throw new Error('No MIDI output selected');
    this.output.send(bytes);
    this.onActivity('out');
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
        reject(new Error('No dump received. On the JMP-1, press PATCH and VOLUME together to send its memory.'));
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
