import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readNdjsonStream, readSseStream, withSyntheticSseTerminal } from "./http-stream.js";

function bytes(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("http-stream: NDJSON", () => {
  it("reensambla líneas partidas entre chunks", async () => {
    const body = bytes(['{"type":"a"}\n{"type":"b', '","x":1}\n']);
    const out: string[] = [];
    for await (const o of readNdjsonStream(body)) out.push(String(o.type));
    assert.deepEqual(out, ["a", "b"]);
  });
});

describe("http-stream: SSE", () => {
  it("parsea bloques event/data", async () => {
    const body = bytes([
      "event: chunk\ndata: {\"content\":\"hi\"}\n\n",
      "event: done\ndata: {\"ok\":true}\n\n",
    ]);
    const out: string[] = [];
    for await (const ev of readSseStream(body)) out.push(`${ev.event}:${ev.dataStr}`);
    assert.deepEqual(out, ['chunk:{"content":"hi"}', 'done:{"ok":true}']);
  });

  it("withSyntheticSseTerminal emite error si no hubo terminal", async () => {
    async function* onlyChunk() {
      yield { event: "chunk", dataStr: "{}" };
    }
    const out: string[] = [];
    for await (const ev of withSyntheticSseTerminal(onlyChunk())) out.push(ev.event);
    assert.deepEqual(out, ["chunk", "error"]);
  });
});
