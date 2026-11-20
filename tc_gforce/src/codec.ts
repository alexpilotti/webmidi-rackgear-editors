// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// TypeScript wrapper around the AssemblyScript/WebAssembly G-Force block codec
// (assembly/index.ts, format in docs/SYSEX_FORMAT.md).

interface CodecExports {
  memory: WebAssembly.Memory;
  inPtr(): number;
  outPtr(): number;
  capacity(): number;
  isTc(len: number): number;
  headerCount(len: number): number;
  decodeBlock(len: number): number;
  encodeBlock(id: number, index: number): number;
  BLOCK_LEN: WebAssembly.Global;
  BLOCK_DATA: WebAssembly.Global;
}

export const HEADER_LEN = 9;
export const BLOCK_LEN = 137;
export const BLOCK_DATA = 64;
export const TYPE_HEADER = 0x10;
export const TYPE_BLOCK = 0x11;

const ERRORS: Record<number, string> = {
  [-1]: 'wrong message length',
  [-2]: 'not a TC Electronic message (F0 00 20 1F missing)',
  [-3]: 'unexpected message type',
  [-4]: 'invalid nibble',
  [-5]: 'checksum error',
  [-6]: 'missing F7 at end of message',
};

/** A decoded User bank dump. */
export interface Dump {
  /** SysEx device ID found in the messages. */
  id: number;
  /** The data blocks joined in order (64 bytes each). */
  stream: Uint8Array;
}

export interface Codec {
  /** True for a G-Force bank header message (`F0 00 20 1F id 10 nh nl F7`). */
  isHeader(m: Uint8Array): boolean;
  /** True for a G-Force bank data block message. */
  isBlock(m: Uint8Array): boolean;
  /** Block count announced by a header message (throws on error). */
  headerCount(m: Uint8Array): number;
  /** One block message -> 64 bytes (throws on error). */
  decodeBlock(m: Uint8Array): Uint8Array;
  /** Header + blocks -> stream (throws on error). */
  decodeDump(messages: Uint8Array[]): Dump;
  /** Stream (a multiple of 64 bytes) -> header + block messages. */
  encodeDump(stream: Uint8Array, id: number): Uint8Array[];
}

export const deviceId = (m: Uint8Array) => m[4];
export const blockIndex = (m: Uint8Array) => m[6];

export function codecFromInstance(instance: WebAssembly.Instance): Codec {
  const x = instance.exports as unknown as CodecExports;
  if (x.BLOCK_LEN.value !== BLOCK_LEN || x.BLOCK_DATA.value !== BLOCK_DATA) {
    throw new Error('codec: wasm/TS size mismatch');
  }
  const load = (data: Uint8Array) => {
    if (data.length > x.capacity()) throw new Error(`codec: input too large (${data.length} bytes)`);
    new Uint8Array(x.memory.buffer, x.inPtr(), data.length).set(data);
  };
  const out = (n: number) => new Uint8Array(x.memory.buffer, x.outPtr(), n).slice();
  const fail = (what: string, n: number): never => {
    throw new Error(`G-Force ${what}: ${ERRORS[n] ?? `error ${n}`}`);
  };
  const isTc = (m: Uint8Array) => m.length >= 6 && m[0] === 0xf0 && m[1] === 0x00 && m[2] === 0x20 && m[3] === 0x1f;

  const codec: Codec = {
    isHeader: (m) => isTc(m) && m.length === HEADER_LEN && m[5] === TYPE_HEADER,
    isBlock: (m) => isTc(m) && m[5] === TYPE_BLOCK,
    headerCount(m) {
      load(m);
      const n = x.headerCount(m.length);
      return n < 0 ? fail('header', n) : n;
    },
    decodeBlock(m) {
      load(m);
      const n = x.decodeBlock(m.length);
      return n < 0 ? fail(`block ${m.length > 6 ? m[6] : '?'}`, n) : out(n);
    },
    decodeDump(messages) {
      const sx = messages.filter((m) => isTc(m) && (m[5] === TYPE_HEADER || m[5] === TYPE_BLOCK));
      const hi = sx.findIndex((m) => codec.isHeader(m));
      if (hi < 0) throw new Error('No G-Force User bank header (F0 00 20 1F id 10 …) found');
      const head = sx[hi];
      const count = codec.headerCount(head);
      const blocks = sx.slice(hi + 1, hi + 1 + count);
      if (blocks.length < count) throw new Error(`G-Force dump incomplete: ${blocks.length} of ${count} blocks`);
      const stream = new Uint8Array(count * BLOCK_DATA);
      blocks.forEach((b, k) => {
        if (!codec.isBlock(b)) throw new Error(`G-Force dump: message ${k + 1} is not a data block`);
        if (blockIndex(b) !== (k & 0x7f)) throw new Error(`G-Force dump: block ${k} out of order (got ${blockIndex(b)})`);
        if (deviceId(b) !== deviceId(head)) throw new Error(`G-Force dump: block ${k} has another SysEx ID`);
        stream.set(codec.decodeBlock(b), k * BLOCK_DATA);
      });
      return { id: deviceId(head), stream };
    },
    encodeDump(stream, id) {
      if (stream.length % BLOCK_DATA) throw new Error(`codec: stream must be a multiple of ${BLOCK_DATA} bytes`);
      const count = stream.length / BLOCK_DATA;
      const msgs = [Uint8Array.of(0xf0, 0x00, 0x20, 0x1f, id & 0x7f, TYPE_HEADER, (count >> 7) & 0x7f, count & 0x7f, 0xf7)];
      for (let k = 0; k < count; k++) {
        load(stream.subarray(k * BLOCK_DATA, (k + 1) * BLOCK_DATA));
        msgs.push(out(x.encodeBlock(id, k)));
      }
      return msgs;
    },
  };
  return codec;
}

export async function loadCodec(url: string): Promise<Codec> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  return codecFromInstance(instance);
}

/** Split a byte stream (e.g. a .syx file) into individual F0..F7 messages. */
export function splitSysex(bytes: Uint8Array): Uint8Array[] {
  const msgs: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0xf0) start = i;
    else if (bytes[i] === 0xf7 && start >= 0) {
      msgs.push(bytes.slice(start, i + 1));
      start = -1;
    }
  }
  return msgs;
}

export function joinMessages(msgs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(msgs.reduce((n, m) => n + m.length, 0));
  let o = 0;
  for (const m of msgs) {
    out.set(m, o);
    o += m.length;
  }
  return out;
}
