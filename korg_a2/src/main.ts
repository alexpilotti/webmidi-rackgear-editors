// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

import './style.css';
import { App } from './app.ts';
import { loadCodec } from './codec.ts';

const root = document.getElementById('app')!;

loadCodec(`${import.meta.env.BASE_URL}a2codec.wasm`)
  .then((codec) => {
    const app = new App(root, codec);
    (window as unknown as { a2: App }).a2 = app; // handy for debugging
  })
  .catch((e: Error) => {
    root.textContent = `Failed to start: ${e.message}`;
    console.error(e);
  });
