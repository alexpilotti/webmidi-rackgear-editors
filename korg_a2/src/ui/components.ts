// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Front-panel building blocks: rotary "double function editors", the 40x1
// backlit LCD and the 3-digit 7-segment program display.

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
// Rotary encoder with push switch ("double function editor").

export interface KnobOptions {
  label: string;
  caption?: string;
  big?: boolean;
  onTurn: (delta: number, fine: boolean) => void;
  onPress: () => void;
}

export class Knob {
  readonly el: HTMLElement;
  private cap: HTMLElement;
  private angle = 0;

  constructor(private o: KnobOptions) {
    this.cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-mark' }));
    const ring = h('div', { class: 'knob-ring' });
    for (let i = 0; i < 9; i++) {
      const a = -135 + i * (270 / 8);
      const dot = h('i');
      dot.style.transform = `rotate(${a}deg) translateY(calc(var(--knob) * -0.66))`;
      ring.append(dot);
    }
    const body = h('div', { class: 'knob-body', tabindex: '0', role: 'slider', 'aria-label': o.caption ?? o.label }, ring, this.cap);
    this.el = h('div', { class: `knob${o.big ? ' big' : ''}` }, h('div', { class: 'knob-label', text: o.label }), body);
    if (o.caption) this.el.append(h('div', { class: 'knob-caption', text: o.caption }));
    this.wire(body);
  }

  setActive(on: boolean): void {
    this.el.classList.toggle('active', on);
  }

  setTitle(t: string): void {
    this.el.title = t;
  }

  private rotate(delta: number): void {
    this.angle += delta * 15;
    this.cap.style.transform = `rotate(${this.angle}deg)`;
  }

  private turn(delta: number, fine: boolean): void {
    this.rotate(delta);
    this.o.onTurn(delta, fine);
  }

  private wire(body: HTMLElement): void {
    let startY = 0, startX = 0, acc = 0, moved = false, active = false;
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      body.setPointerCapture(e.pointerId);
      startY = e.clientY; startX = e.clientX; acc = 0; moved = false; active = true;
      body.classList.add('grab');
      body.focus();
      e.preventDefault();
    });
    body.addEventListener('pointermove', (e) => {
      if (!active) return;
      const d = (startY - e.clientY) + (e.clientX - startX);
      if (Math.abs(d) > 3) moved = true;
      const px = e.shiftKey ? 14 : 6;
      const steps = Math.trunc((d - acc) / px);
      if (steps !== 0) {
        acc += steps * px;
        this.turn(steps, e.shiftKey);
      }
    });
    const end = () => {
      if (!active) return;
      active = false;
      body.classList.remove('grab');
      if (!moved) {
        body.classList.add('pressed');
        setTimeout(() => body.classList.remove('pressed'), 120);
        this.o.onPress();
      }
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    body.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
      if (d !== 0) this.turn(Math.sign(d), e.shiftKey);
    }, { passive: false });
    body.addEventListener('keydown', (e) => {
      const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (e.key in map) {
        e.preventDefault();
        e.stopPropagation();
        this.turn(map[e.key], e.shiftKey);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.o.onPress();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 40 x 1 character backlit LCD.

export class Lcd {
  readonly el: HTMLElement;
  private cells: HTMLElement[] = [];
  onCellClick: (col: number) => void = () => {};

  constructor(readonly cols = 40) {
    const row = h('div', { class: 'lcd-row' });
    for (let i = 0; i < cols; i++) {
      const c = h('span', { class: 'lcd-cell' });
      c.addEventListener('click', () => this.onCellClick(i));
      this.cells.push(c);
      row.append(c);
    }
    this.el = h('div', { class: 'lcd' }, h('div', { class: 'lcd-glass' }, row));
  }

  set(text: string, opts: { cursor?: number; highlight?: [number, number][]; clickable?: [number, number][] } = {}): void {
    const t = text.padEnd(this.cols).slice(0, this.cols);
    for (let i = 0; i < this.cols; i++) {
      const c = this.cells[i];
      const ch = t[i];
      c.textContent = ch === ' ' ? ' ' : ch;
      c.classList.toggle('cursor', opts.cursor === i);
      c.classList.toggle('hl', !!opts.highlight?.some(([a, b]) => i >= a && i < b));
      c.classList.toggle('click', !!opts.clickable?.some(([a, b]) => i >= a && i < b));
    }
    this.el.setAttribute('aria-label', t.trim());
  }

  setPower(on: boolean): void {
    this.el.classList.toggle('off', !on);
  }
}

// ---------------------------------------------------------------------------
// 3-digit 7-segment LED.

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
  A: 'abcefg', C: 'adef', E: 'adefg', F: 'aefg', P: 'abefg', U: 'bcdef', L: 'def',
  d: 'bcdeg', r: 'eg', t: 'defg', n: 'ceg', o: 'cdeg', H: 'bcefg', c: 'deg', b: 'cdefg',
};

const SEG_PATHS: Record<string, string> = {
  a: 'M6,2 L26,2 L22,6 L10,6 Z',
  b: 'M27,3 L27,23 L23,21 L23,7 Z',
  c: 'M27,27 L27,47 L23,43 L23,29 Z',
  d: 'M6,48 L26,48 L22,44 L10,44 Z',
  e: 'M5,27 L5,47 L9,43 L9,29 Z',
  f: 'M5,3 L5,23 L9,21 L9,7 Z',
  g: 'M7,25 L10,22.5 L22,22.5 L25,25 L22,27.5 L10,27.5 Z',
};

export class SevenSeg {
  readonly el: HTMLElement;
  private digits: SVGElement[][] = [];

  constructor(count = 3) {
    this.el = h('div', { class: 'led7' });
    const ns = 'http://www.w3.org/2000/svg';
    for (let d = 0; d < count; d++) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 32 50');
      const segs: SVGElement[] = [];
      for (const k of 'abcdefg') {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', SEG_PATHS[k]);
        p.setAttribute('transform', 'skewX(-6) translate(3 0)');
        p.dataset.seg = k;
        svg.append(p);
        segs.push(p);
      }
      this.digits.push(segs);
      this.el.append(svg);
    }
  }

  set(text: string): void {
    const t = text.padStart(this.digits.length).slice(-this.digits.length);
    this.digits.forEach((segs, i) => {
      const on = SEGMENTS[t[i]] ?? SEGMENTS[t[i].toUpperCase()] ?? '';
      for (const s of segs) s.classList.toggle('on', on.includes((s as SVGElement).dataset.seg!));
    });
  }
}
