const engine = fetch("./checker.wasm").then(async response => {
  if (!response.ok) throw Error("Could not load the checker");
  return (await WebAssembly.instantiate(await response.arrayBuffer())).instance.exports;
});
self.onmessage = async ({data}) => {
  try {
    const wasm = await engine;
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const ptr = wasm.reserve(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    const size = wasm.run(ptr, bytes.length);
    const result = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output(), size));
    self.postMessage(JSON.parse(result));
  } catch (error) {
    self.postMessage({status:"error", error:error.message});
  }
};
