// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// LCD screens, laid out like the G-Force's own (Recall: SELECT / BANK /
// PRESET boxes and the name; parameter pages: title box, PARAM tab, list with
// a cursor and a bar graph for the selected value).

import { GraphicLcd } from './components.ts';

export const LCD_W = 240;
export const LCD_H = 100;

/** Big title in the top-left corner and the dotted rule under it. */
function title(lcd: GraphicLcd, text: string): void {
  lcd.text(2, 2, text, { scale: 2 });
  lcd.dotted(0, LCD_W - 1, 19);
}

/** The SELECT / BANK / PRESET layout of the Recall page. */
export function presetPage(lcd: GraphicLcd, o: {
  title: string;
  leftLabel: string;
  left: (lcd: GraphicLcd, x: number, y: number, w: number, h: number) => void;
  bank: string;
  /** Label of the third BANK row (the card bank shown). */
  cardLabel: string;
  /** Field under the cursor: 0 = left box (SELECT), 1 = BANK, 2 = PRESET. Its label is inverted. */
  focus: number;
  number: number;
  name: string;
}): void {
  lcd.clear();
  title(lcd, o.title);
  const label = (x: number, w: number, t: string, f: number) => (o.focus === f ? lcd.inverse(x, 22, w, t) : lcd.text(x + 2, 23, t));
  label(0, 92, o.leftLabel, 0);
  label(96, 41, 'BANK:', 1);
  label(140, 99, 'PRESET:', 2);

  // Left box (SELECT grid on Recall).
  o.left(lcd, 2, 33, 92, 46);

  // BANK column: the editor only holds the User bank.
  lcd.frame(98, 33, 39, 46);
  ['ROM', 'USER', o.cardLabel].forEach((b, i) => {
    const y = 34 + i * 15;
    if (b === o.bank) lcd.inverse(99, y + 2, 37, b);
    else lcd.text(101, y + 3, b);
  });

  // PRESET box with the big number.
  lcd.frame(140, 33, 99, 46);
  lcd.frame(141, 34, 97, 44);
  lcd.text(232, 42, String(o.number), { scale: 4, right: true });

  lcd.text(2, 84, o.name, { scale: 2 });
}

/** SELECT grid: 3×3 cells, ALL selected (the editor doesn't decode the blocks yet). */
export function selectGrid(lcd: GraphicLcd, x: number, y: number, w: number, h: number): void {
  lcd.frame(x, y, w, h);
  const cw = Math.floor(w / 3), ch = Math.floor(h / 3);
  for (let i = 1; i < 3; i++) {
    lcd.fill(x + i * cw, y, 1, h);
    lcd.fill(x, y + i * ch, w, 1);
  }
  lcd.fill(x + 1, y + 1, cw - 1, ch - 1);
  lcd.text(x + 5, y + 4, 'ALL', { on: false });
}

/** Lines of small text in a box (used on the Store page). */
export function textBox(lines: string[]) {
  return (lcd: GraphicLcd, x: number, y: number, w: number, h: number) => {
    lcd.frame(x, y, w, h);
    lines.slice(0, 4).forEach((l, i) => lcd.text(x + 3, y + 3 + i * 11, l.slice(0, Math.floor((w - 4) / 6))));
  };
}

export interface ListRow {
  label: string;
  value?: string;
  header?: boolean;
}

/** Parameter page: title box, tab, scrolling list with ▶ cursor, bar graph on the right. */
export function paramPage(lcd: GraphicLcd, o: {
  title: string;
  tab: string;
  rows: ListRow[];
  cursor: number;
  barLabel: string;
  bar: number | null;
  barNote?: string;
}): void {
  lcd.clear();
  lcd.frame(0, 0, 168, 14);
  lcd.frame(1, 1, 166, 12);
  lcd.text(4, 4, o.title.slice(0, 26));
  lcd.fill(172, 0, 68, 14);
  lcd.text(206, 4, o.tab, { on: false, right: false, scale: 1 });
  lcd.dotted(0, LCD_W - 1, 17);

  const visible = 7;
  const top = Math.max(0, Math.min(o.rows.length - visible, o.cursor - 3));
  // Scrollbar
  lcd.frame(0, 20, 5, 79);
  const thumb = Math.max(6, Math.round((77 * visible) / Math.max(visible, o.rows.length)));
  const pos = o.rows.length > visible ? Math.round(((77 - thumb) * top) / (o.rows.length - visible)) : 0;
  lcd.fill(1, 21 + pos, 3, thumb);

  for (let r = 0; r < visible; r++) {
    const row = o.rows[top + r];
    if (!row) break;
    const y = 21 + r * 11;
    if (row.header) {
      lcd.inverse(14, y - 1, 140, row.label.slice(0, 22));
      continue;
    }
    if (top + r === o.cursor) lcd.text(8, y, '▶');
    lcd.text(15, y, row.label.slice(0, 13));
    if (row.value) lcd.text(154, y, row.value.slice(0, 9), { right: true });
  }

  // Bar graph for the selected value.
  const words = o.barLabel.split(' ');
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= 13) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  lines.slice(0, 2).forEach((l, i) => lcd.text(LCD_W - 2, 21 + i * 9, l, { right: true }));
  const bx = 196, by = 42, bw = 16, bh = 55;
  for (let t = 0; t < 5; t++) lcd.fill(bx - 6, by + Math.round((t * (bh - 1)) / 4), 3, 1);
  lcd.frame(bx, by, bw, bh);
  if (o.bar !== null) {
    const f = Math.max(0, Math.min(1, o.bar));
    const hgt = Math.round(f * (bh - 4));
    lcd.fill(bx + 2, by + bh - 2 - hgt, bw - 4, hgt);
  }
  if (o.barNote) lcd.text(LCD_W - 2, 90, o.barNote, { right: true });
}

/** Big title, a few lines of text, and an optional progress bar. */
export function infoPage(lcd: GraphicLcd, o: { title: string; lines: string[]; progress?: number; select?: number }): void {
  lcd.clear();
  title(lcd, o.title);
  o.lines.slice(0, 6).forEach((l, i) => {
    const y = 24 + i * 11;
    if (o.select === i) {
      lcd.text(2, y, '▶');
      lcd.inverse(10, y - 1, 228, l.slice(0, 37));
    } else lcd.text(10, y, l.slice(0, 38));
  });
  if (o.progress !== undefined) {
    lcd.frame(2, 86, 236, 11);
    lcd.fill(4, 88, Math.round(232 * Math.max(0, Math.min(1, o.progress))), 7);
  }
}

/** A message box over the current page. */
export function messageBox(lcd: GraphicLcd, text: string): void {
  const words = text.split(' ');
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= 34) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const shown = lines.slice(0, 3);
  const h = 10 + shown.length * 10;
  const y = Math.round((LCD_H - h) / 2);
  lcd.fill(12, y, 216, h);
  lcd.frame(14, y + 2, 212, h - 4, false);
  shown.forEach((l, i) => lcd.text(120 - GraphicLcd.measure(l) / 2, y + 6 + i * 10, l, { on: false }));
}

export interface MenuRow {
  label: string;
  value?: string;
  header?: boolean;
}

/**
 * List page with a big title and page tabs, as on the unit's I/O Setup and
 * Utility displays: tabs top right (the current one inverted), a dotted
 * rule, a scrolling list with ▶ cursor, inverted section headers and values
 * on the right.
 */
export function menuPage(lcd: GraphicLcd, o: { title: string; tabs: string[]; tab: number; rows: MenuRow[]; cursor: number }): void {
  lcd.clear();
  lcd.text(2, 2, o.title, { scale: 2 });
  let x = LCD_W;
  for (let i = o.tabs.length - 1; i >= 0; i--) {
    const w = GraphicLcd.measure(o.tabs[i]) + 6;
    x -= w;
    if (i === o.tab) {
      lcd.fill(x, 2, w, 12);
      lcd.text(x + 3, 5, o.tabs[i], { on: false });
    } else {
      lcd.frame(x, 2, w, 12);
      lcd.frame(x + 1, 3, w - 2, 10);
      lcd.text(x + 3, 5, o.tabs[i]);
    }
    x -= 3;
  }
  lcd.dotted(0, LCD_W - 1, 18);

  const visible = 7;
  const top = Math.max(0, Math.min(o.rows.length - visible, o.cursor - 3));
  lcd.frame(0, 21, 5, 78);
  const thumb = Math.max(6, Math.round((76 * visible) / Math.max(visible, o.rows.length)));
  const pos = o.rows.length > visible ? Math.round(((76 - thumb) * top) / (o.rows.length - visible)) : 0;
  lcd.fill(1, 22 + pos, 3, thumb);
  for (let r = 0; r < visible; r++) {
    const row = o.rows[top + r];
    if (!row) break;
    const y = 22 + r * 11;
    if (row.header) {
      lcd.inverse(14, y - 1, 225, row.label.slice(0, 37));
      continue;
    }
    if (top + r === o.cursor) lcd.text(8, y, '▶');
    const value = row.value ?? '';
    const room = Math.floor((LCD_W - 2 - 15 - GraphicLcd.measure(value) - 6) / 6);
    lcd.text(15, y, row.label.slice(0, Math.max(4, room)));
    if (value) lcd.text(LCD_W - 2, y, value.slice(0, 16), { right: true });
  }
}
