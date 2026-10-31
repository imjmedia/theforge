import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ndjsonLinesWithHeartbeat } from "./ndjson-stream.util.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const formatError = (err: unknown) => ({ message: err instanceof Error ? err.message : String(err) });

async function collect(gen: AsyncGenerator<string>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for await (const line of gen) out.push(JSON.parse(line) as Record<string, unknown>);
  return out;
}

describe("ndjsonLinesWithHeartbeat", () => {
  it("emite heartbeats mientras un nodo silencioso tarda y conserva los eventos reales", async () => {
    async function* source() {
      yield { type: "progress", agent: "a", message: "m" };
      await sleep(120);
      yield { type: "done", markdown: "# x" };
    }
    const events = await collect(
      ndjsonLinesWithHeartbeat(source(), { tag: "t", heartbeatMs: 25, formatError }),
    );
    const types = events.map((e) => e.type);
    assert.equal(types[0], "progress");
    assert.equal(types.at(-1), "done");
    assert.ok(types.filter((t) => t === "heartbeat").length >= 2, `heartbeats: ${types.join(",")}`);
  });

  it("convierte errores del generador en un evento error final", async () => {
    async function* source() {
      yield { type: "progress", agent: "a", message: "m" };
      throw new Error("boom");
    }
    const events = await collect(
      ndjsonLinesWithHeartbeat(source(), { tag: "t", heartbeatMs: 1_000, formatError }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["progress", "error"],
    );
    assert.equal(events[1]!.message, "boom");
  });

  it("al cerrar el consumidor cierra el generador origen (libera el lease del servicio)", async () => {
    let closed = false;
    async function* source() {
      try {
        for (let i = 0; i < 100; i += 1) yield { type: "progress", agent: "a", message: String(i) };
      } finally {
        closed = true;
      }
    }
    const gen = ndjsonLinesWithHeartbeat(source(), { tag: "t", heartbeatMs: 1_000, formatError });
    await gen.next();
    await gen.return(undefined);
    await sleep(10);
    assert.equal(closed, true);
  });
});
