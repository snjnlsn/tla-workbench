import {readFileSync} from 'node:fs';

const binary = readFileSync(new URL('../../dist/checker.wasm', import.meta.url));
const {instance: {exports: wasm}} = await WebAssembly.instantiate(binary);

export function check(source, options = {}) {
  const bytes = Buffer.from(JSON.stringify({source, ...options}));
  const ptr = wasm.reserve(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  const size = wasm.run(ptr, bytes.length);
  return JSON.parse(Buffer.from(wasm.memory.buffer, wasm.output(), size).toString());
}
