import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { describe, it } from "node:test";
import assert from "node:assert";
import { invokeLlmStreamingWithIdleTimeout, supportsStreaming } from "./mdd-llm-stream-invoke.util.js";
import { extractLlmText, extractLlmToolCalls, invokeLlmWithRetry } from "./mdd-llm-retry.util.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MESSAGES = [new HumanMessage("hola")];

class StreamingLlm {
  invokeCount = 0;
  streamCount = 0;
  constructor(
    private readonly parts: string[],
    private readonly opts: { gapMs?: number; failStream?: boolean; invokeResult?: unknown } = {},
  ) {}

  async invoke(): Promise<unknown> {
    this.invokeCount += 1;
    return this.opts.invokeResult ?? new AIMessageChunk({ content: this.parts.join("") });
  }

  async stream(_messages: unknown[], _options?: unknown): Promise<AsyncIterable<unknown>> {
    this.streamCount += 1;
    if (this.opts.failStream) throw new Error("streaming not supported by provider");
    const { parts, opts } = this;
    return (async function* () {
      for (const part of parts) {
        if (opts.gapMs) await sleep(opts.gapMs);
        yield new AIMessageChunk({ content: part });
      }
    })();
  }
}

describe("supportsStreaming", () => {
  it("detecta runnables con .stream", () => {
    assert.strictEqual(supportsStreaming(new StreamingLlm(["a"])), true);
    assert.strictEqual(supportsStreaming({ invoke: async () => null }), false);
    assert.strictEqual(supportsStreaming(null), false);
  });
});

describe("invokeLlmStreamingWithIdleTimeout", () => {
  it("agrega los chunks en un único mensaje", async () => {
    const llm = new StreamingLlm(["Hola ", "mundo", "!"]);
    const result = await invokeLlmStreamingWithIdleTimeout(llm, MESSAGES, { tag: "T" });
    assert.strictEqual(extractLlmText(result.response), "Hola mundo!");
    assert.strictEqual(result.chunks, 3);
    assert.notStrictEqual(result.firstChunkMs, null);
  });

  it("no aborta una generación larga mientras sigan llegando chunks", async () => {
    // 6 chunks × 40ms = 240ms total, por encima del idle de 120ms pero sin pausa larga.
    const llm = new StreamingLlm(["a", "b", "c", "d", "e", "f"], { gapMs: 40 });
    const result = await invokeLlmStreamingWithIdleTimeout(llm, MESSAGES, {
      tag: "T",
      idleTimeoutMs: 120,
    });
    assert.strictEqual(extractLlmText(result.response), "abcdef");
    assert.ok(result.totalMs > 120);
  });

  it("aborta cuando el proveedor deja de emitir", async () => {
    const llm = new StreamingLlm(["a", "b"], { gapMs: 200 });
    await assert.rejects(
      () => invokeLlmStreamingWithIdleTimeout(llm, MESSAGES, { tag: "T", idleTimeoutMs: 50 }),
      /abortado por inactividad/,
    );
  });

  it("aborta al superar el tope duro aunque fluyan chunks", async () => {
    const llm = new StreamingLlm(Array.from({ length: 50 }, () => "x"), { gapMs: 20 });
    await assert.rejects(
      () =>
        invokeLlmStreamingWithIdleTimeout(llm, MESSAGES, {
          tag: "T",
          idleTimeoutMs: 5_000,
          hardTimeoutMs: 80,
        }),
      /tope duro/,
    );
  });

  it("propaga tool_calls agregados desde los chunks", async () => {
    const llm = {
      invoke: async () => null,
      stream: async () =>
        (async function* () {
          yield new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: "buscar", args: '{"q":', id: "1", index: 0, type: "tool_call_chunk" }],
          });
          yield new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: undefined, args: '"forge"}', id: undefined, index: 0, type: "tool_call_chunk" }],
          });
        })(),
    };
    const result = await invokeLlmStreamingWithIdleTimeout(llm, MESSAGES, { tag: "T" });
    const calls = extractLlmToolCalls(result.response);
    assert.strictEqual((calls).length, 1);
    assert.strictEqual(calls[0]?.name, "buscar");
    assert.deepStrictEqual(calls[0]?.args, { q: "forge" });
  });
});

describe("invokeLlmWithRetry + streaming", () => {
  it("usa streaming cuando el runnable lo soporta", async () => {
    const llm = new StreamingLlm(["texto ", "generado"]);
    const response = await invokeLlmWithRetry(llm as never, MESSAGES, { tag: "T" });
    assert.strictEqual(extractLlmText(response), "texto generado");
    assert.strictEqual(llm.streamCount, 1);
    assert.strictEqual(llm.invokeCount, 0);
  });

  it("degrada a invoke sin consumir intentos si el proveedor rechaza streaming", async () => {
    const llm = new StreamingLlm(["ignorado"], {
      failStream: true,
      invokeResult: new AIMessageChunk({ content: "por invoke" }),
    });
    const warn = console.warn;
    console.warn = () => {};
    const response = await invokeLlmWithRetry(llm as never, MESSAGES, { tag: "T" });
    console.warn = warn;
    assert.strictEqual(extractLlmText(response), "por invoke");
    assert.strictEqual(llm.invokeCount, 1);
  });

  it("respeta disableStreaming", async () => {
    const llm = new StreamingLlm(["x"], { invokeResult: new AIMessageChunk({ content: "no-stream" }) });
    const response = await invokeLlmWithRetry(llm as never, MESSAGES, {
      tag: "T",
      disableStreaming: true,
    });
    assert.strictEqual(extractLlmText(response), "no-stream");
    assert.strictEqual(llm.streamCount, 0);
  });
});
