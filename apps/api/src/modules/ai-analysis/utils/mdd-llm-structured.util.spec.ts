import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { z } from "zod";
import { describeJsonParseError, invokeLlmStructured } from "./mdd-llm-structured.util.js";
import { isLlmStreamingEnabled } from "./mdd-llm-timeout.util.js";

const schema = z.object({ score: z.number(), status: z.string() });

class FakeLlm {
  callCount = 0;
  received: Array<Array<{ content?: unknown }>> = [];
  constructor(private readonly responses: Array<unknown | (() => unknown)>) {}
  async invoke(messages: Array<{ content?: unknown }>): Promise<unknown> {
    this.callCount += 1;
    this.received.push(messages);
    const idx = Math.min(this.callCount - 1, this.responses.length - 1);
    const r = this.responses[idx];
    if (typeof r === "function") return (r as () => unknown)();
    return r;
  }
}

const base = { tag: "TestStructured", disableStreaming: true, backoffMs: [0, 0, 0], maxAttempts: 1 } as const;

describe("invokeLlmStructured", () => {
  it("JSON válido a la primera", async () => {
    const llm = new FakeLlm([{ content: '{"score": 90, "status": "APROBADO"}' }]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.value, { score: 90, status: "APROBADO" });
      assert.equal(res.attempts, 1);
    }
    assert.equal(llm.callCount, 1);
  });

  it("primer intento inválido, segundo válido: reparación con la ruta del campo", async () => {
    const llm = new FakeLlm([
      { content: '{"score": 90}' },
      { content: '{"score": 90, "status": "APROBADO"}' },
    ]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.attempts, 2);
    assert.equal(llm.callCount, 2);
    const repair = llm.received[1]!;
    assert.equal(repair.length, 2);
    const repairText = String(repair[1]!.content);
    assert.match(repairText, /status/);
    assert.match(repairText, /SOLO el JSON corregido/);
    assert.equal(String(repair[0]!.content), '{"score": 90}');
  });

  it("dos salidas inválidas: ok false invalid", async () => {
    const llm = new FakeLlm([{ content: '{"score": "x"}' }, { content: "no es json" }]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "invalid");
      assert.equal(res.attempts, 2);
      assert.equal(res.rawText, "no es json");
      assert.ok(res.lastError);
    }
    assert.equal(llm.callCount, 2);
  });

  it("repairAttempts 0 no repara", async () => {
    const llm = new FakeLlm([{ content: "{}" }]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema, repairAttempts: 0 });
    assert.equal(res.ok, false);
    assert.equal(llm.callCount, 1);
  });

  it("JSON dentro de fence con texto alrededor", async () => {
    const llm = new FakeLlm([
      { content: 'Aquí va el resultado:\n```json\n{"score": 70, "status": "RECHAZADO"}\n```\nEspero que sirva.' },
    ]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.value, { score: 70, status: "RECHAZADO" });
  });

  it("JSON embebido sin fence (objeto balanceado)", async () => {
    const llm = new FakeLlm([{ content: 'Resultado: {"score": 1, "status": "a {b}"} fin.' }]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.status, "a {b}");
  });

  it("abort: aborted sin segundo intento", async () => {
    const ac = new AbortController();
    const llm = new FakeLlm([
      () => {
        ac.abort();
        return { content: '{"score": 1}' };
      },
    ]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema, signal: ac.signal });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "aborted");
    assert.equal(llm.callCount, 1);
  });

  it("señal ya abortada: aborted sin llamar al LLM", async () => {
    const ac = new AbortController();
    ac.abort();
    const llm = new FakeLlm([{ content: "{}" }]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema, signal: ac.signal });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "aborted");
      assert.equal(res.attempts, 0);
    }
    assert.equal(llm.callCount, 0);
  });

  it("error de transporte: transport", async () => {
    const llm = new FakeLlm([
      () => {
        throw new Error("503 upstream");
      },
    ]);
    const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "transport");
      assert.equal(res.attempts, 1);
    }
    assert.equal(llm.callCount, 1);
  });
});

describe("JSON no parseable — no filtra la salida del LLM", () => {
  it("describeJsonParseError: solo tipo y posición, una línea y <= 120 chars", () => {
    let caught: unknown;
    try {
      JSON.parse('{"a": SECRETO-DEL-USUARIO\nsegunda línea}');
    } catch (e) {
      caught = e;
    }
    const msg = describeJsonParseError(caught);
    assert.match(msg, /^JSON no parseable \(SyntaxError/);
    assert.ok(!msg.includes("SECRETO"), msg);
    assert.ok(!msg.includes("\n"));
    assert.ok(msg.length <= 120);
  });

  it("lastError y logs de un JSON roto no contienen fragmentos de la salida", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
    try {
      const llm = new FakeLlm([{ content: '{"score": TOKEN-PRIVADO-123, "status": "x"}' }]);
      const res = await invokeLlmStructured({ ...base, llm: llm as never, messages: [], schema, repairAttempts: 0 });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.ok(!(res.lastError ?? "").includes("TOKEN-PRIVADO"), res.lastError);
        assert.ok((res.lastError ?? "").length <= 120);
      }
    } finally {
      console.warn = orig;
    }
    assert.ok(warns.length > 0);
    for (const w of warns) assert.ok(!w.includes("TOKEN-PRIVADO"), w);
  });
});

// ---------------------------------------------------------------------------
// Presupuesto total (deadlineMs): reloj y temporizador controlados por el test.
// ---------------------------------------------------------------------------

function deadlineHarness() {
  let t = 0;
  const armed: Array<{ fn: () => void; ms: number; handle: object }> = [];
  const cleared: unknown[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    armed,
    cleared,
    setTimer: (fn: () => void, ms: number) => {
      const handle = {};
      armed.push({ fn, ms, handle });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      cleared.push(handle);
    },
  };
}

/** LLM falso con un paso por llamada (el último se repite); cada paso recibe la señal del intento. */
class StepLlm {
  calls = 0;
  constructor(private readonly steps: Array<(signal: AbortSignal) => unknown>) {}
  async invoke(_messages: unknown, opts?: { signal?: AbortSignal }): Promise<unknown> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    this.calls += 1;
    return step(opts?.signal ?? new AbortController().signal);
  }
}

const invalidOut = () => ({ content: '{"score": 1}' });
const validOut = { content: '{"score": 1, "status": "ok"}' };

describe("invokeLlmStructured — presupuesto total (deadlineMs)", () => {
  it("(a) sin presupuesto para reparar: reason invalid (calidad, no presupuesto) tras el primer intento inválido", async () => {
    const h = deadlineHarness();
    const llm = new StepLlm([
      () => {
        h.advance(20_000);
        return invalidOut();
      },
    ]);
    const res = await invokeLlmStructured({
      ...base, llm: llm as never, messages: [], schema,
      deadlineMs: 30_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "invalid");
      assert.equal(res.attempts, 1);
      assert.match(res.lastError ?? "", /sin presupuesto para reparar/);
    }
    assert.equal(llm.calls, 1);
  });

  it("(b) presupuesto holgado: la reparación se ejecuta y responde ok", async () => {
    const h = deadlineHarness();
    const llm = new StepLlm([
      () => {
        h.advance(20_000);
        return invalidOut();
      },
      () => {
        h.advance(5_000);
        return validOut;
      },
    ]);
    const res = await invokeLlmStructured({
      ...base, llm: llm as never, messages: [], schema,
      deadlineMs: 300_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.attempts, 2);
    assert.equal(llm.calls, 2);
  });

  it("(c) cancelación externa durante el intento: aborted, no deadline", async () => {
    const h = deadlineHarness();
    const ac = new AbortController();
    const llm = new StepLlm([
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
          ac.abort();
        }),
    ]);
    const res = await invokeLlmStructured({
      ...base, llm: llm as never, messages: [], schema, signal: ac.signal,
      deadlineMs: 300_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "aborted");
    assert.equal(llm.calls, 1);
  });

  it("(d) el temporizador del presupuesto se limpia tanto en éxito como en fallo", async () => {
    const okHarness = deadlineHarness();
    const okLlm = new StepLlm([() => validOut]);
    await invokeLlmStructured({
      ...base, llm: okLlm as never, messages: [], schema,
      deadlineMs: 300_000, now: okHarness.now, setTimer: okHarness.setTimer, clearTimer: okHarness.clearTimer,
    });
    assert.equal(okHarness.armed.length, 1);
    assert.equal(okHarness.cleared.length, 1);
    assert.equal(okHarness.cleared[0], okHarness.armed[0]!.handle);

    const failHarness = deadlineHarness();
    const failLlm = new StepLlm([
      () => {
        failHarness.advance(20_000);
        return invalidOut();
      },
    ]);
    const res = await invokeLlmStructured({
      ...base, llm: failLlm as never, messages: [], schema,
      deadlineMs: 30_000, now: failHarness.now, setTimer: failHarness.setTimer, clearTimer: failHarness.clearTimer,
    });
    assert.equal(res.ok, false);
    assert.equal(failHarness.cleared.length, 1);
    assert.equal(failHarness.cleared[0], failHarness.armed[0]!.handle);
  });

  it("(e) en la reparación, el tope duro del intento es igual al presupuesto restante", { skip: !isLlmStreamingEnabled() && "streaming desactivado por LANGGRAPH_LLM_STREAMING" }, async () => {
    // El tope duro lo arma mdd-llm-stream-invoke con setTimeout global: se controla con mock.timers.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const h = deadlineHarness();
      const signals: AbortSignal[] = [];
      let calls = 0;
      const llm = {
        invoke: async () => {
          throw new Error("no debe usarse: el caso ejercita el camino de streaming");
        },
        stream: (_messages: unknown, opts: { signal: AbortSignal }) => {
          calls += 1;
          if (calls === 1) {
            return (async function* () {
              h.advance(20_000);
              yield { content: '{"score": 1}' };
            })();
          }
          signals.push(opts.signal);
          return (async function* () {
            await new Promise<void>((_, reject) =>
              opts.signal.addEventListener("abort", () => reject(new Error("stream cortado")), { once: true }),
            );
          })();
        },
      };
      const pending = invokeLlmStructured({
        tag: "TestStructured", backoffMs: [0, 0, 0], maxAttempts: 1,
        llm: llm as never, messages: [], schema,
        deadlineMs: 60_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
      });
      const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
      for (let i = 0; signals.length === 0 && i < 100; i += 1) await flush();
      assert.equal(signals.length, 1);
      let elapsed = 0;
      while (!signals[0]!.aborted && elapsed < 120_000) {
        mock.timers.tick(1_000);
        elapsed += 1_000;
        await flush();
      }
      const res = await pending;
      // Presupuesto 60 s - 20 s consumidos por el primer intento = 40 s de tope duro para la reparación.
      assert.equal(elapsed, 40_000);
      assert.equal(res.ok, false);
      assert.equal(calls, 2);
    } finally {
      mock.timers.reset();
    }
  });

  it("(f) el presupuesto agota a mitad del intento: aborta con DeadlineExceededError y devuelve deadline", async () => {
    const h = deadlineHarness();
    let inFlightAborted = false;
    const llm = new StepLlm([
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              inFlightAborted = true;
              reject(new Error("fetch aborted"));
            },
            { once: true },
          );
          h.armed[0]!.fn();
        }),
    ]);
    const res = await invokeLlmStructured({
      ...base, llm: llm as never, messages: [], schema,
      deadlineMs: 300_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "deadline");
      assert.equal(res.attempts, 1);
    }
    // El intento en vuelo se aborta por la señal combinada; el motivo DeadlineExceededError se verifica en
    // mdd-llm-retry.util.telemetry.spec.ts (la señal externa de invokeLlmWithRetry lleva el motivo).
    assert.ok(inFlightAborted);
    assert.equal(llm.calls, 1);
    assert.equal(h.cleared.length, 1);
  });

  it("(g) presupuesto menor que el mínimo por intento: no invoca al LLM", async () => {
    const h = deadlineHarness();
    const llm = new StepLlm([() => validOut]);
    const res = await invokeLlmStructured({
      ...base, llm: llm as never, messages: [], schema,
      deadlineMs: 10_000, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, "deadline");
      assert.equal(res.attempts, 0);
    }
    assert.equal(llm.calls, 0);
  });
});
