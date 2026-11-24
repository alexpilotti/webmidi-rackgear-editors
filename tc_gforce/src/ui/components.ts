// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Front-panel building blocks: rotary wheels (Parameter / Value), rectangular
// keys with an LED, the graphic LCD and the LED dot-matrix "billboard".

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

// ---------------------------------------------------------------------------
// Rotary encoder (endless). Drag, wheel or arrow keys turn it.

export interface KnobOptions {
  className?: string;
  label: string;
  onTurn: (delta: number, fast: boolean) => void;
}

export class Knob {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private cap: HTMLElement;
  private angle = 0;

  constructor(private o: KnobOptions) {
    this.cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-mark' }));
    this.body = h('div', { class: 'knob-body', tabindex: '0', role: 'slider', 'aria-label': o.label }, this.cap);
    this.el = h('div', { class: `knob ${o.className ?? ''}` }, this.body);
    this.wire();
  }

  private turn(delta: number, fast: boolean): void {
    this.angle += delta * 18;
    this.cap.style.transform = `rotate(${this.angle}deg)`;
    this.o.onTurn(delta, fast);
  }

  private wire(): void {
    const body = this.body;
    let startY = 0, startX = 0, acc = 0, active = false;
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      body.setPointerCapture(e.pointerId);
      startY = e.clientY; startX = e.clientX; acc = 0; active = true;
      body.classList.add('grab');
      body.focus();
      e.preventDefault();
    });
    body.addEventListener('pointermove', (e) => {
      if (!active) return;
      const d = (startY - e.clientY) + (e.clientX - startX);
      const px = 8;
      const steps = Math.trunc((d - acc) / px);
      if (steps !== 0) {
        acc += steps * px;
        this.turn(steps, Math.abs(steps) > 1);
      }
    });
    const end = () => { active = false; body.classList.remove('grab'); };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    body.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
      if (d !== 0) this.turn(Math.sign(d), false);
    }, { passive: false });
    body.addEventListener('keydown', (e) => {
      const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (e.key in map) {
        e.preventDefault();
        e.stopPropagation();
        this.turn(map[e.key], Math.abs(map[e.key]) > 1);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Rectangular key with a small LED on its left (G-Force style).

export class PanelKey {
  readonly button: HTMLButtonElement;
  private led: HTMLElement | null;

  constructor(label: string, onClick: (e: MouseEvent) => void, opts: { title?: string; led?: boolean; className?: string } = {}) {
    this.led = opts.led === false ? null : h('span', { class: 'key-led' });
    this.button = h('button', { class: `pkey ${opts.className ?? ''}`, title: opts.title ?? label, 'aria-label': label },
      this.led, h('span', { class: 'pkey-label', text: label }));
    this.button.addEventListener('click', onClick);
  }

  set(state: 'off' | 'on' | 'flash'): void {
    if (!this.led) return;
    this.led.classList.toggle('on', state === 'on');
    this.led.classList.toggle('flash', state === 'flash');
    this.button.setAttribute('aria-pressed', String(state !== 'off'));
  }
}

// ---------------------------------------------------------------------------
// 5×7 bitmap font (rows top to bottom, 5 bits each, MSB = left column).

export const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12],
  ':': [0, 12, 12, 0, 12, 12, 0], '?': [14, 17, 1, 2, 4, 0, 4], '/': [1, 1, 2, 4, 8, 16, 16],
  '<': [2, 4, 8, 16, 8, 4, 2], '>': [8, 4, 2, 1, 2, 4, 8], '+': [0, 4, 4, 31, 4, 4, 0],
  '=': [0, 0, 31, 0, 31, 0, 0], '%': [24, 25, 2, 4, 8, 19, 3], '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8], ',': [0, 0, 0, 0, 12, 4, 8], "'": [12, 4, 8, 0, 0, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4], '*': [0, 4, 21, 14, 21, 4, 0],
  '_': [0, 0, 0, 0, 0, 0, 31], '#': [10, 10, 31, 10, 31, 10, 10], '&': [12, 18, 20, 8, 21, 18, 13],
  '▶': [16, 24, 28, 30, 28, 24, 16], '·': [0, 0, 0, 12, 12, 0, 0],
  '≈': [0, 13, 22, 0, 13, 22, 0], '■': [0, 0, 14, 14, 14, 0, 0], '~': [0, 0, 13, 22, 0, 0, 0],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  a: [0, 0, 14, 1, 15, 17, 15], b: [16, 16, 22, 25, 17, 17, 30], c: [0, 0, 14, 16, 16, 17, 14],
  d: [1, 1, 13, 19, 17, 17, 15], e: [0, 0, 14, 17, 31, 16, 14], f: [6, 9, 8, 28, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14], h: [16, 16, 22, 25, 17, 17, 17], i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12], k: [16, 16, 18, 20, 24, 20, 18], l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 17, 17], n: [0, 0, 22, 25, 17, 17, 17], o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 0, 30, 17, 30, 16, 16], q: [0, 0, 13, 19, 15, 1, 1], r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 14, 16, 14, 1, 30], t: [8, 8, 28, 8, 8, 9, 6], u: [0, 0, 17, 17, 17, 19, 13],
  v: [0, 0, 17, 17, 17, 10, 4], w: [0, 0, 17, 17, 21, 21, 10], x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 0, 17, 17, 15, 1, 14], z: [0, 0, 31, 2, 4, 8, 31],
};

// ---------------------------------------------------------------------------
// Graphic LCD: a dot framebuffer drawn on a canvas (G-Force style, green
// backlight). Coordinates are LCD dots.

export class GraphicLcd {
  readonly el: HTMLCanvasElement;
  private fb: Uint8Array;
  private ctx: CanvasRenderingContext2D;
  private static readonly S = 3;

  constructor(readonly w: number, readonly h: number) {
    this.el = h_canvas(w * GraphicLcd.S, h * GraphicLcd.S);
    this.ctx = this.el.getContext('2d')!;
    this.fb = new Uint8Array(w * h);
  }

  clear(): void {
    this.fb.fill(0);
  }

  px(x: number, y: number, on = true): void {
    // Whole dots only: a fractional index would set a stray property on the typed array, not a dot.
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.fb[y * this.w + x] = on ? 1 : 0;
  }

  fill(x: number, y: number, w: number, h: number, on = true): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, on);
  }

  frame(x: number, y: number, w: number, h: number, on = true): void {
    this.fill(x, y, w, 1, on);
    this.fill(x, y + h - 1, w, 1, on);
    this.fill(x, y, 1, h, on);
    this.fill(x + w - 1, y, 1, h, on);
  }

  dotted(x0: number, x1: number, y: number): void {
    for (let x = x0; x <= x1; x += 2) this.px(x, y);
  }

  static measure(s: string, scale = 1): number {
    return s.length ? s.length * 6 * scale - scale : 0;
  }

  /** Draw text; `on = false` draws it clear (on a filled background). Returns the width. */
  text(x: number, y: number, s: string, opts: { scale?: number; on?: boolean; right?: boolean } = {}): number {
    const sc = opts.scale ?? 1;
    const on = opts.on ?? true;
    const width = GraphicLcd.measure(s, sc);
    let cx = opts.right ? x - width : x;
    for (const ch of s) {
      const rows = FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT['?'];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if ((rows[r] >> (4 - c)) & 1) this.fill(cx + c * sc, y + r * sc, sc, sc, on);
        }
      }
      cx += 6 * sc;
    }
    return width;
  }

  /** Text on a filled bar (the inverted look of selected items). */
  inverse(x: number, y: number, w: number, s: string): void {
    this.fill(x, y, w, 9);
    this.text(x + 2, y + 1, s, { on: false });
  }

  flush(label: string): void {
    const S = GraphicLcd.S;
    const css = getComputedStyle(this.el);
    const ink = css.getPropertyValue('--lcd-ink').trim() || '#14240a';
    const ghost = css.getPropertyValue('--lcd-ghost').trim() || 'rgba(20,36,10,0.06)';
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        ctx.fillStyle = this.fb[y * this.w + x] ? ink : ghost;
        ctx.fillRect(x * S, y * S, S - 0.6, S - 0.6);
      }
    }
    this.el.setAttribute('aria-label', label);
  }
}

function h_canvas(w: number, hgt: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  c.className = 'glcd';
  c.setAttribute('role', 'img');
  return c;
}

// ---------------------------------------------------------------------------
// Billboard: a coarse grid of red LEDs showing the preset number (3×5 digits).

const DIGITS: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7],
  '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7], '-': [0, 0, 7, 0, 0], ' ': [0, 0, 0, 0, 0],
};

export class Billboard {
  readonly el: HTMLElement;
  private dots: HTMLElement[] = [];
  static readonly COLS = 14;
  static readonly ROWS = 5;

  constructor() {
    this.el = h('div', { class: 'billboard', role: 'img' });
    for (let i = 0; i < Billboard.COLS * Billboard.ROWS; i++) {
      const d = h('i');
      this.dots.push(d);
      this.el.append(d);
    }
  }

  /** Right-aligned digits (up to 3). */
  set(text: string): void {
    const t = text.slice(-3);
    const lit = new Set<number>();
    let x = Billboard.COLS - 4 * t.length + 1;
    for (const ch of t) {
      const rows = DIGITS[ch] ?? DIGITS['-'];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if ((rows[r] >> (2 - c)) & 1) lit.add(r * Billboard.COLS + x + c);
      x += 4;
    }
    this.dots.forEach((d, i) => d.classList.toggle('on', lit.has(i)));
    this.el.setAttribute('aria-label', t.trim());
  }
}

// ---------------------------------------------------------------------------
// Whole-number field with − / + buttons. Typing, the arrow keys, Page Up/Down
// and the mouse wheel change it; out-of-range input is clamped when committed.

export class NumberField {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private value: number;

  constructor(private o: { label: string; min: number; max: number; value: number; title?: string; onChange: (v: number) => void }) {
    this.value = this.clamp(o.value);
    this.input = h('input', {
      class: 'num-input', type: 'text', inputmode: 'numeric', 'aria-label': o.label,
      role: 'spinbutton', 'aria-valuemin': String(o.min), 'aria-valuemax': String(o.max), title: o.title,
    });
    const dec = h('button', { class: 'num-btn', type: 'button', 'aria-label': `Decrease ${o.label}`, text: '−' });
    const inc = h('button', { class: 'num-btn', type: 'button', 'aria-label': `Increase ${o.label}`, text: '+' });
    dec.addEventListener('click', () => this.set(this.value - 1));
    inc.addEventListener('click', () => this.set(this.value + 1));
    this.input.addEventListener('input', () => {
      const t = this.input.value.trim();
      const ok = /^\d+$/.test(t) && Number(t) >= o.min && Number(t) <= o.max;
      this.el.classList.toggle('invalid', !ok && t !== '');
      if (ok) this.set(Number(t), false);
    });
    this.input.addEventListener('blur', () => this.show());
    this.input.addEventListener('keydown', (e) => {
      const step: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      if (e.key in step) {
        e.preventDefault();
        this.set(this.value + step[e.key]);
      } else if (e.key === 'Enter' || e.key === 'Escape') {
        this.show();
        this.input.blur();
      }
    });
    this.input.addEventListener('wheel', (e) => {
      if (document.activeElement !== this.input) return;
      e.preventDefault();
      this.set(this.value + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    this.el = h('div', { class: 'num-field' }, dec, this.input, inc);
    this.show();
  }

  get(): number {
    return this.value;
  }

  /** Grey out the field and ignore input. */
  setDisabled(off: boolean): void {
    this.el.classList.toggle('disabled', off);
    for (const c of this.el.querySelectorAll('input, button')) (c as HTMLInputElement | HTMLButtonElement).disabled = off;
  }

  private clamp(v: number): number {
    return Math.max(this.o.min, Math.min(this.o.max, Math.round(v)));
  }

  /** Set the value (clamped); `redraw = false` keeps what the user is typing. */
  set(v: number, redraw = true): void {
    const n = this.clamp(v);
    const changed = n !== this.value;
    this.value = n;
    if (redraw) this.show();
    if (changed) this.o.onChange(n);
  }

  private show(): void {
    this.input.value = String(this.value);
    this.input.setAttribute('aria-valuenow', String(this.value));
    this.el?.classList.remove('invalid');
  }
}
