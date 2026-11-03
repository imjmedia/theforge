import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractLlmText,
  extractLlmToolCalls,
  invokeLlmWithRetry,
  getActiveLlmAbortSignal,
  llmResponseHasUsableToolCalls,
  runWithLlmAbortSignal,
  LlmOutputTruncatedError,
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

describe("invokeLlmWithRetry — política por tipo de error", () => {
  /** LLM que lanza `errors[i]` en la llamada i+1 (o responde ok tras agotarlos). */
  function failingLlm(errors: unknown[], okAfter = true) {
    const llm = {
      callCount: 0,
      invoke: async (): Promise<unknown> => {
        llm.callCount += 1;
        const e = errors[llm.callCount - 1];
        if (e !== undefined) throw e;
        if (okAfter) return { content: "ok" };
        return { content: "" };
      },
    };
    return llm;
  }
  const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), { status }, extra);
  /** Espera inyectada: registra los ms pedidos sin dormir. */
  const recorder = () => {
    const waits: number[] = [];
    return { waits, waitFn: async (ms: number) => void waits.push(ms) };
  };

  it("401 -> sin segundo intento y devuelve null", async () => {
    const llm = failingLlm([httpError(401, "401 invalid x-api-key")]);
    const { waits, waitFn } = recorder();
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 1500, 4000],
      disableStreaming: true,
      waitFn,
    });
    assert.equal(r, null);
    assert.equal(llm.callCount, 1);
    assert.deepEqual(waits, []);
  });

  it("400 de contexto excedido -> sin reintento", async () => {
    const llm = failingLlm([httpError(400, "prompt is too long: 300000 tokens")]);
    const r = await invokeLlmWithRetry(llm as never, [], { tag: "test", backoffMs: [0, 0, 0], disableStreaming: true });
    assert.equal(r, null);
    assert.equal(llm.callCount, 1);
  });

  it("429 con retry-after: 2 -> espera 2000 ms (no el backoff) y recupera", async () => {
    const llm = failingLlm([httpError(429, "429 rate limit", { headers: { "retry-after": "2" } })]);
    const { waits, waitFn } = recorder();
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 1500, 4000],
      disableStreaming: true,
      waitFn,
    });
    assert.equal(extractLlmText(r), "ok");
    assert.equal(llm.callCount, 2);
    assert.deepEqual(waits, [2000]);
  });

  it("429 sin retry-after -> usa el backoff normal (con jitter)", async () => {
    const llm = failingLlm([httpError(429, "429 rate limit")]);
    const { waits, waitFn } = recorder();
    await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      backoffMs: [0, 1000, 4000],
      disableStreaming: true,
      waitFn,
      random: () => 0.5, // jitter neutro
    });
    assert.deepEqual(waits, [1000]);
  });

  it("429 con retry-after que no cabe en hardTimeoutMs -> corta con null", async () => {
    const llm = failingLlm([httpError(429, "429", { headers: { "retry-after": "20" } })]);
    const { waits, waitFn } = recorder();
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      backoffMs: [0, 0, 0],
      hardTimeoutMs: 5_000,
      disableStreaming: true,
      waitFn,
    });
    assert.equal(r, null);
    assert.equal(llm.callCount, 1);
    assert.deepEqual(waits, []);
  });

  it("500 -> reintenta con jitter ±20 % dentro de rango", async () => {
    for (const [rnd, expected] of [
      [0, 800],
      [0.5, 1000],
      [0.999999, 1200],
    ] as const) {
      const llm = failingLlm([httpError(500, "500 Internal Server Error")]);
      const { waits, waitFn } = recorder();
      const r = await invokeLlmWithRetry(llm as never, [], {
        tag: "test",
        backoffMs: [0, 1000, 4000],
        disableStreaming: true,
        waitFn,
        random: () => rnd,
      });
      assert.equal(extractLlmText(r), "ok");
      assert.equal(llm.callCount, 2);
      assert.equal(waits.length, 1);
      assert.ok(Math.abs((waits[0] ?? 0) - expected) <= 1, `jitter ${rnd}: ${waits[0]} vs ${expected}`);
    }
  });

  it("jitter real (Math.random) queda en [0.8x, 1.2x]", async () => {
    for (let i = 0; i < 20; i += 1) {
      const llm = failingLlm([httpError(502, "Bad Gateway")]);
      const { waits, waitFn } = recorder();
      await invokeLlmWithRetry(llm as never, [], { tag: "test", backoffMs: [0, 1000], maxAttempts: 2, disableStreaming: true, waitFn });
      assert.ok((waits[0] ?? 0) >= 800 && (waits[0] ?? 0) <= 1200, String(waits[0]));
    }
  });

  it("error desconocido sigue reintentando (comportamiento histórico)", async () => {
    const llm = failingLlm([new Error("algo raro"), new Error("otra vez")]);
    const r = await invokeLlmWithRetry(llm as never, [], { tag: "test", maxAttempts: 3, backoffMs: [0, 0, 0], disableStreaming: true });
    assert.equal(extractLlmText(r), "ok");
    assert.equal(llm.callCount, 3);
  });

  it("abort externo -> lanza AbortError sin reintento ni espera", async () => {
    const ac = new AbortController();
    const llm = {
      callCount: 0,
      invoke: async () => {
        llm.callCount += 1;
        ac.abort();
        throw httpError(500, "500 tras cancelar");
      },
    };
    const { waits, waitFn } = recorder();
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], { tag: "test", signal: ac.signal, backoffMs: [0, 100, 100], disableStreaming: true, waitFn }),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(llm.callCount, 1);
    assert.deepEqual(waits, []);
  });

  it("streaming: un 401 en .stream() no degrada ni gasta un segundo intento", async () => {
    let streamCalls = 0;
    let invokeCalls = 0;
    const llm = {
      invoke: async () => {
        invokeCalls += 1;
        return { content: "ok" };
      },
      stream: async () => {
        streamCalls += 1;
        throw httpError(401, "401 unauthorized");
      },
    };
    const r = await invokeLlmWithRetry(llm as never, [], { tag: "test", backoffMs: [0, 0, 0] });
    assert.equal(r, null);
    assert.equal(streamCalls, 1);
    assert.equal(invokeCalls, 0);
  });
});

describe("invokeLlmWithRetry — truncado por límite de tokens", () => {
  it("reintenta una vez con continuación y devuelve la segunda respuesta", async () => {
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) {
          return { content: "parte A", response_metadata: { finish_reason: "length" } };
        }
        return { content: "parte B", response_metadata: { finish_reason: "stop" } };
      },
    };
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      disableStreaming: true,
      backoffMs: [0],
      maxAttempts: 2,
    });
    assert.equal(calls, 2);
    assert.equal(extractLlmText(r), "parte B");
  });

  it("lanza LlmOutputTruncatedError si la continuación sigue truncada", async () => {
    const llm = {
      invoke: async () => ({ content: "x", response_metadata: { finish_reason: "length" } }),
    };
    await assert.rejects(
      invokeLlmWithRetry(llm as never, [], {
        tag: "test",
        disableStreaming: true,
        backoffMs: [0],
        maxAttempts: 3,
      }),
      (err: unknown) => err instanceof LlmOutputTruncatedError,
    );
  });
});
