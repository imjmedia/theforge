import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractLlmText,
  extractLlmToolCalls,
  invokeLlmWithRetry,
  getActiveLlmAbortSignal,
  llmResponseHasUsableToolCalls,
  runWithLlmAbortSignal,
} from "./mdd-llm-retry.util.js";

class FakeLlm {
  /** Cola de respuestas a devolver en orden; si se agota, repite la última. */
  constructor(public responses: unknown[]) {}
  callCount = 0;
  async invoke(_messages: unknown[]): Promise<unknown> {
    this.callCount += 1;
    const idx = Math.min(this.callCount - 1, this.responses.length - 1);
    return this.responses[idx];
  }
}

describe("extractLlmText", () => {
  it("string content", () => {
    assert.equal(extractLlmText({ content: "hola" }), "hola");
  });
  it("array of content blocks (text + ignore)", () => {
    assert.equal(extractLlmText({ content: [{ text: "a" }, { text: "b" }, { ignore: true }] }), "ab");
  });
  it("empty / null / undefined", () => {
    assert.equal(extractLlmText(null), "");
    assert.equal(extractLlmText(undefined), "");
    assert.equal(extractLlmText({ content: "" }), "");
    assert.equal(extractLlmText({ content: [] }), "");
  });
  it("plain string passes through", () => {
    assert.equal(extractLlmText("foo"), "foo");
  });

  it("content blocks with type text", () => {
    assert.equal(extractLlmText({ content: [{ type: "text", text: "hola" }] }), "hola");
  });
});

describe("extractLlmToolCalls", () => {
  it("lee tool_calls en raíz AIMessage", () => {
    const calls = extractLlmToolCalls({
      content: "",
      tool_calls: [{ id: "tc1", name: "validate_mdd_structure", args: { draft: "x" } }],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "validate_mdd_structure");
  });

  it("lee tool_calls en additional_kwargs (OpenAI-compat)", () => {
    const calls = extractLlmToolCalls({
      content: "",
      additional_kwargs: {
        tool_calls: [
          {
            id: "tc2",
            function: { name: "validate_sql_syntax", arguments: "{}" },
          },
        ],
      },
    });
    assert.equal(calls[0]?.name, "validate_sql_syntax");
  });

  it("llmResponseHasUsableToolCalls con content vacío", () => {
    assert.equal(
      llmResponseHasUsableToolCalls({
        content: "",
        tool_calls: [{ name: "x", args: {} }],
      }),
      true,
    );
  });
});

describe("invokeLlmWithRetry", () => {
  it("devuelve la respuesta en el primer intento si es válida", async () => {
    const llm = new FakeLlm([{ content: "primera válida" }]);
    const r = await invokeLlmWithRetry(llm as never, [], { tag: "test" });
    assert.equal(extractLlmText(r), "primera válida");
    assert.equal(llm.callCount, 1);
  });

  it("reintenta cuando la respuesta está vacía y termina con la válida", async () => {
    const llm = new FakeLlm([
      { content: "" },
      { content: "" },
      { content: "recuperada en 3" },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 0, 0],
    });
    assert.equal(extractLlmText(r), "recuperada en 3");
    assert.equal(llm.callCount, 3);
  });

  it("devuelve null si todos los intentos fallan", async () => {
    const llm = new FakeLlm([{ content: "" }, { content: "   " }, { content: "" }]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 0, 0],
    });
    assert.equal(r, null);
    assert.equal(llm.callCount, 3);
  });

  it("atrapa excepciones y reintenta", async () => {
    const llm = new FakeLlm([
      { invoke: () => Promise.reject(new Error("429 rate limit")) },
      { content: "ok en retry" },
    ]);
    // override invoke to throw on first call
    llm.invoke = (async () => {
      llm.callCount += 1;
      if (llm.callCount === 1) throw new Error("429 rate limit");
      return { content: "ok en retry" };
    }) as never;
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 2,
      backoffMs: [0, 0],
    });
    assert.equal(extractLlmText(r), "ok en retry");
  });

  it("respeta el validador personalizado", async () => {
    const llm = new FakeLlm([
      { content: "placeholder" },
      { content: "sustancial con substance > 50 chars" },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 2,
      backoffMs: [0, 0],
      isResponseValid: (t) => t.length > 20,
    });
    assert.ok(extractLlmText(r).includes("sustancial"));
    assert.equal(llm.callCount, 2);
  });

  it("acepta tool_calls sin content cuando acceptToolCallsWithoutContent", async () => {
    const llm = new FakeLlm([
      { content: "", tool_calls: [{ name: "probe", args: {} }] },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      acceptToolCallsWithoutContent: true,
      isResponseValid: (t) => t.trim().length > 0,
    });
    assert.equal(llmResponseHasUsableToolCalls(r), true);
    assert.equal(llm.callCount, 1);
  });
});

describe("invokeLlmWithRetry — abort signal", () => {
  it("no reintenta si la señal ya está abortada (lanza AbortError sin llamar al LLM)", async () => {
    const llm = new FakeLlm([{ content: "nunca" }]);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], { tag: "test", signal: ac.signal, backoffMs: [0, 0, 0] }),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(llm.callCount, 0);
  });

  it("aborta durante la llamada y detiene los reintentos restantes", async () => {
    const ac = new AbortController();
    let calls = 0;
    const llm = {
      invoke: async (_m: unknown, opts?: { signal?: AbortSignal }) => {
        calls += 1;
        // Simula una llamada larga que respeta la señal del retry util.
        await new Promise<void>((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
          setTimeout(() => ac.abort(), 10);
        });
        return { content: "x" };
      },
    };
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], {
        tag: "test",
        signal: ac.signal,
        maxAttempts: 3,
        backoffMs: [0, 0, 0],
        disableStreaming: true,
      }),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(calls, 1);
  });

  it("corta el backoff entre intentos al abortar", async () => {
    const ac = new AbortController();
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        setTimeout(() => ac.abort(), 20);
        return { content: "" }; // inválido → pasa a backoff largo
      },
    };
    const t0 = Date.now();
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], {
        tag: "test",
        signal: ac.signal,
        maxAttempts: 3,
        backoffMs: [0, 30_000, 30_000],
        disableStreaming: true,
      }),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(calls, 1);
    assert.ok(Date.now() - t0 < 5_000, "el backoff de 30s debió cortarse");
  });

  it("usa la señal activa de AsyncLocalStorage cuando no se pasa options.signal", async () => {
    const ac = new AbortController();
    const llm = new FakeLlm([{ content: "nunca" }]);
    ac.abort();
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () =>
        invokeLlmWithRetry(llm as never, [], { tag: "test", backoffMs: [0] }),
      ),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(llm.callCount, 0);
    assert.equal(getActiveLlmAbortSignal(), undefined);
  });

  it("streaming: la señal externa interrumpe el stream y lanza AbortError", async () => {
    const ac = new AbortController();
    let calls = 0;
    const llm = {
      invoke: async () => ({ content: "x" }),
      stream: async function* () {
        calls += 1;
        yield { content: "a" };
        await new Promise<void>((r) => setTimeout(r, 30));
        ac.abort();
        yield { content: "b" };
        yield { content: "c" };
      },
    };
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], { tag: "test", signal: ac.signal, maxAttempts: 3, backoffMs: [0, 0, 0] }),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(calls, 1);
  });
});
