// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tempo from incoming MIDI clock (24 ticks per quarter note).

export const TICKS_PER_BEAT = 24;

export class ClockMeter {
  private ticks: number[] = [];
  private readonly gapMs: number;
  private readonly window: number;

  /** Ticks further apart than `gapMs` mean the clock stopped; measuring starts again. */
  constructor(gapMs = 500, window = TICKS_PER_BEAT * 2) {
    this.gapMs = gapMs;
    this.window = window;
  }

  reset(): void {
    this.ticks = [];
  }

  /** Add a tick; returns the tempo in BPM once a full beat has been measured. */
  tick(time: number): number | null {
    const last = this.ticks[this.ticks.length - 1];
    if (last !== undefined && (time - last > this.gapMs || time <= last)) this.ticks = [];
    this.ticks.push(time);
    if (this.ticks.length > this.window + 1) this.ticks.shift();
    return this.bpm;
  }

  /** Average over the last window (up to two beats), or null before one beat. */
  get bpm(): number | null {
    const n = this.ticks.length - 1;
    if (n < TICKS_PER_BEAT) return null;
    const perTick = (this.ticks[n] - this.ticks[0]) / n;
    return perTick > 0 ? 60000 / (perTick * TICKS_PER_BEAT) : null;
  }

  get lastTick(): number | null {
    return this.ticks.length ? this.ticks[this.ticks.length - 1] : null;
  }
}
