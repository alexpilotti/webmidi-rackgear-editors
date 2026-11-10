// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// TypeScript wrapper around the AssemblyScript/WebAssembly JMP-1 dump codec
// (assembly/index.ts, format in docs/SYSEX_FORMAT.md).

interface CodecExports {
  memory: WebAssembly.Memory;
  inPtr(): number;
  outPtr(): number;
  capacity(): number;
  lastErrorBlock(): number;
  isJmp1(len: number): number;
  decode(len: number): number;
  encode(): number;
  STREAM_LEN: WebAssembly.Global;
  MESSAGE_LEN: WebAssembly.Global;
}

export const STREAM_LEN = 1280;
export const MESSAGE_LEN = 1316;
export const HEADER = [0xf0, 0x00, 0x20, 0x16, 0x01] as const;

const ERRORS: Record<number, string> = {
  [-1]: `wrong length (expected ${MESSAGE_LEN} bytes)`,
  [-2]: 'not a JMP-1 dump (header F0 00 20 16 01 missing)',
  [-3]: 'block marker missing',
  [-4]: 'blocks out of order',
  [-5]: 'checksum error',
  [-6]: 'invalid data byte',
  [-7]: 'missing F7 at end of message',
};

export interface Codec {
  /** Whole SysEx message -> 1280-byte data stream (throws on error). */
  decode(message: Uint8Array): Uint8Array;
  /** 1280-byte data stream -> whole SysEx message (1316 bytes). */
  encode(stream: Uint8Array): Uint8Array;
  isJmp1(message: Uint8Array): boolean;
}

export function codecFromInstance(instance: WebAssembly.Instance): Codec {
  const x = instance.exports as unknown as CodecExports;
  if (x.STREAM_LEN.value !== STREAM_LEN || x.MESSAGE_LEN.value !== MESSAGE_LEN) {
    throw new Error('codec: wasm/TS size mismatch');
  }
  const load = (data: Uint8Array) => {
    if (data.length > x.capacity()) throw new Error(`codec: input too large (${data.length} bytes)`);
    new Uint8Array(x.memory.buffer, x.inPtr(), data.length).set(data);
  };
  const out = (n: number) => new Uint8Array(x.memory.buffer, x.outPtr(), n).slice();

  return {
    decode(message) {
      load(message);
      const n = x.decode(message.length);
      if (n < 0) {
        const b = x.lastErrorBlock();
        throw new Error(`JMP-1 dump: ${ERRORS[n] ?? `error ${n}`}${b ? ` in block ${b - 1}` : ''}`);
      }
      return out(n);
    },
    encode(stream) {
      if (stream.length !== STREAM_LEN) throw new Error(`codec: stream must be ${STREAM_LEN} bytes`);
      load(stream);
      return out(x.encode());
    },
    isJmp1(message) {
      load(message.subarray(0, Math.min(message.length, 8)));
      return x.isJmp1(message.length) === 1;
    },
  };
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
