// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Thin TypeScript wrapper around the AssemblyScript/WebAssembly 7-in-8 codec
// (see assembly/index.ts).

interface CodecExports {
  memory: WebAssembly.Memory;
  inPtr(): number;
  outPtr(): number;
  capacity(): number;
  packedLength(len: number): number;
  unpackedLength(len: number): number;
  pack(len: number): number;
  unpack(len: number): number;
  isSevenBitClean(len: number): number;
}

export interface Codec {
  /** 8-bit data -> 7-bit MIDI data (Korg 7-in-8). */
  pack(data: Uint8Array): Uint8Array;
  /** 7-bit MIDI data -> 8-bit data. */
  unpack(data: Uint8Array): Uint8Array;
  packedLength(len: number): number;
  unpackedLength(len: number): number;
}

export function codecFromInstance(instance: WebAssembly.Instance): Codec {
  const x = instance.exports as unknown as CodecExports;
  const cap = x.capacity();

  const run = (fn: (len: number) => number, data: Uint8Array): Uint8Array => {
    if (data.length > cap) throw new Error(`codec: input too large (${data.length} > ${cap})`);
    new Uint8Array(x.memory.buffer, x.inPtr(), data.length).set(data);
    const n = fn(data.length);
    if (n < 0) throw new Error('codec: buffer overflow');
    return new Uint8Array(x.memory.buffer, x.outPtr(), n).slice();
  };

  return {
    pack: (d) => run(x.pack, d),
    unpack: (d) => run(x.unpack, d),
    packedLength: (n) => x.packedLength(n),
    unpackedLength: (n) => x.unpackedLength(n),
  };
}

export async function loadCodec(url: string): Promise<Codec> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  return codecFromInstance(instance);
}
