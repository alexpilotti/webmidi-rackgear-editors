// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Front-panel building blocks: rotary encoder (Data wheel), round LED keys and
// the 4-digit red 7-segment display.

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
// Round push key with a red LED (Marshall JMP-1 style). Label sits above.

export class LedKey {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  private led: HTMLElement;

  constructor(label: string, onClick: (e: MouseEvent) => void, title?: string) {
    this.led = h('span', { class: 'key-led' });
    this.button = h('button', { class: 'round-key', 'aria-label': label, title: title ?? label }, this.led);
    this.button.addEventListener('click', onClick);
    this.el = h('div', { class: 'key-wrap' }, h('div', { class: 'key-label', text: label }), this.button);
  }

  set(state: 'off' | 'on' | 'flash'): void {
    this.led.classList.toggle('on', state === 'on');
    this.led.classList.toggle('flash', state === 'flash');
    this.button.setAttribute('aria-pressed', String(state !== 'off'));
  }
}

// ---------------------------------------------------------------------------
// 7-segment LED digits with decimal points.

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', _: 'd',
  A: 'abcefg', C: 'adef', E: 'adefg', F: 'aefg', H: 'bcefg', I: 'ef', L: 'def', P: 'abefg',
  S: 'afgcd', U: 'bcdef', b: 'cdefg', c: 'deg', d: 'bcdeg', h: 'cefg', n: 'ceg', o: 'cdeg',
  r: 'eg', t: 'defg', u: 'cde', y: 'bcdfg',
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
  private digits: { segs: SVGElement[]; dp: SVGElement }[] = [];

  constructor(count: number) {
    this.el = h('div', { class: 'led7' });
    const ns = 'http://www.w3.org/2000/svg';
    for (let d = 0; d < count; d++) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 36 50');
      const segs: SVGElement[] = [];
      for (const k of 'abcdefg') {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', SEG_PATHS[k]);
        p.setAttribute('transform', 'skewX(-6) translate(3 0)');
        p.dataset.seg = k;
        svg.append(p);
        segs.push(p);
      }
      const dp = document.createElementNS(ns, 'circle');
      dp.setAttribute('cx', '31.5');
      dp.setAttribute('cy', '46.5');
      dp.setAttribute('r', '2.4');
      svg.append(dp);
      this.digits.push({ segs, dp });
      this.el.append(svg);
    }
  }

  /** Text of `count` characters; a '.' lights the decimal point of the preceding digit. */
  set(text: string): void {
    const chars: { c: string; dp: boolean }[] = [];
    for (const ch of text) {
      if (ch === '.' && chars.length) chars[chars.length - 1].dp = true;
      else chars.push({ c: ch, dp: false });
    }
    while (chars.length < this.digits.length) chars.unshift({ c: ' ', dp: false });
    const vis = chars.slice(-this.digits.length);
    this.digits.forEach(({ segs, dp }, i) => {
      const on = SEGMENTS[vis[i].c] ?? SEGMENTS[vis[i].c.toUpperCase()] ?? '';
      for (const s of segs) s.classList.toggle('on', on.includes(s.dataset.seg!));
      dp.classList.toggle('on', vis[i].dp);
    });
    const label = text.trim();
    // New digits while blinking: restart the cycle lit, so the value is readable while dialling.
    if (this.blinkTimer && label !== this.el.getAttribute('aria-label')) this.restartBlink();
    this.el.setAttribute('aria-label', label);
  }

  /**
   * Blink the whole display in phase from a single timer. (Per-segment CSS
   * animations start whenever a segment lights up, so newly lit segments
   * blinked out of step with the others.)
   */
  setBlink(on: boolean): void {
    if (on === !!this.blinkTimer) return;
    if (on) this.restartBlink();
    else {
      clearInterval(this.blinkTimer);
      this.blinkTimer = 0;
      this.el.classList.remove('dark');
    }
  }

  private blinkTimer = 0;

  private restartBlink(): void {
    clearInterval(this.blinkTimer);
    this.el.classList.remove('dark');
    this.blinkTimer = window.setInterval(() => this.el.classList.toggle('dark'), 350);
  }
}
