import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { registerTokenUsageRecorder } from "../../../ai/utils/token-usage-recorder.js";
import { runWithTokenUsageContext } from "../../token-usage/token-usage.context.js";
import { runWithLlmAbortSignal } from "../../utils/mdd-llm-retry.util.js";
import { runManagerLlmTurn } from "./manager-llm-turn.js";

const baseState = { managerRound: 0 } as never;

function run(llm: unknown, userMessage = "agrega una tabla de pagos al modelo", hasDraft = true) {
  return runManagerLlmTurn({ llm: llm as never, state: baseState, userMessage, hasBench: false, hasDraft });
}

describe("runManagerLlmTurn — camino invoke+parse (sin withStructuredOutput)", () => {
  it("JSON válido => decisión parseada; invoke lleva señal de abort (pasa por invokeLlmWithRetry)", async () => {
    let received: { signal?: AbortSignal } | undefined;
    const llm = {
      invoke: async (_m: unknown, opts?: { signal?: AbortSignal }) => {
        received = opts;
        return { content: '{"action":"delegate","target":"clarifier_only"}' };
      },
    };
    const out = await run(llm);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "clarifier_only");
    assert.ok(received?.signal instanceof AbortSignal, "invoke recibe AbortSignal (timeout/abort de invokeLlmWithRetry)");
    assert.equal(received?.signal?.aborted, false);
  });

  it("la señal externa (ALS) llega al invoke y aborta la llamada en vuelo", async () => {
    const ac = new AbortController();
    const llm = {
      invoke: (_m: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          setTimeout(() => ac.abort(), 10);
        }),
    };
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () => run(llm)),
      (err: Error) => err.name === "AbortError",
    );
  });

  it("inválido => reparación => válido (2 llamadas)", async () => {
    const calls: unknown[][] = [];
    const llm = {
      invoke: async (m: unknown[]) => {
        calls.push(m);
        return calls.length === 1
          ? { content: '{"action":"responder"}' }
          : { content: '{"action":"reply","reply":"Usa PostgreSQL."}' };
      },
    };
    const out = await run(llm, "¿qué base de datos usa?");
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.length, 3, "prompt + salida previa + petición de reparación");
    assert.equal(out.action, "reply");
    assert.equal(out.replyContent, "Usa PostgreSQL.");
  });

  it("dos inválidos => fallback 'delegar' (con borrador => sections), solo tras una reparación", async () => {
    let n = 0;
    const llm = {
      invoke: async () => {
        n += 1;
        return { content: "no sé" };
      },
    };
    const out = await run(llm);
    assert.equal(n, 2);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "sections");
  });

  it("sin borrador y dos inválidos => delegate full_pipeline", async () => {
    const llm = { invoke: async () => ({ content: "???" }) };
    const out = await run(llm, "hola", false);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "full_pipeline");
  });
});

describe("runManagerLlmTurn — withStructuredOutput strict", () => {
  const structuredArgs = {
    action: "delegate",
    reply: "",
    target: "full_pipeline",
    sections: [],
    memorySearchQuery: "",
  };

  it("conserva structured output y su invoke lleva señal de abort", async () => {
    let received: { signal?: AbortSignal } | undefined;
    let config: unknown;
    const llm = {
      invoke: async () => {
        throw new Error("no debe usarse el invoke plano");
      },
      withStructuredOutput: (_schema: unknown, cfg: unknown) => {
        config = cfg;
        return {
          invoke: async (_m: unknown, opts?: { signal?: AbortSignal }) => {
            received = opts;
            return structuredArgs;
          },
        };
      },
    };
    const out = await run(llm);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "full_pipeline");
    assert.deepEqual(config, { method: "function_calling", strict: true, includeRaw: true });
    assert.ok(received?.signal instanceof AbortSignal);
  });

  it("includeRaw: lee `parsed` y registra uso real con la identidad y el modelo real del llm base", async () => {
    const events: Array<Record<string, unknown>> = [];
    const estimates: Array<Record<string, unknown>> = [];
    registerTokenUsageRecorder({
      recordAsync: (e) => void events.push(e as unknown as Record<string, unknown>),
      recordEstimatedAsync: (e) => void estimates.push(e as unknown as Record<string, unknown>),
    });
    try {
      const llm = {
        providerId: "openrouter",
        modelId: "m/base",
        invoke: async () => {
          throw new Error("no debe usarse el invoke plano");
        },
        withStructuredOutput: () => ({
          invoke: async () => ({
            raw: {
              content: "",
              usage_metadata: { input_tokens: 321, output_tokens: 45, total_tokens: 366 },
              response_metadata: { chained_model: "m/real" },
            },
            parsed: structuredArgs,
          }),
        }),
      };
      const out = await runWithTokenUsageContext(
        { projectId: "p1", documentField: "mddContent", context: "initial", node: "manager" },
        () => run(llm),
      );
      assert.equal(out.action, "delegate");
      assert.equal(out.delegateTarget, "full_pipeline");
      assert.equal(estimates.length, 0, "no es una estimación");
      assert.equal(events.length, 1);
      assert.equal(events[0]!.providerId, "openrouter");
      assert.equal(events[0]!.modelId, "m/base");
      assert.equal(events[0]!.modelActual, "m/real");
      assert.equal(events[0]!.promptTokens, 321);
      assert.equal(events[0]!.completionTokens, 45);
      assert.equal(events[0]!.estimated, false);
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)["__theforgeTokenUsageRecorder"];
    }
  });

  it("includeRaw con parsed nulo (parseo fallido) => cae a invoke+parse", async () => {
    const llm = {
      invoke: async () => ({ content: '{"action":"delegate","target":"clarifier_only"}' }),
      withStructuredOutput: () => ({
        invoke: async () => ({ raw: { content: "" }, parsed: null, parsing_error: new Error("x") }),
      }),
    };
    const out = await run(llm);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "clarifier_only");
  });

  it("falla del structured => cae a invoke+parse con reparación", async () => {
    const llm = {
      invoke: async () => ({ content: '{"action":"delegate","target":"full_pipeline"}' }),
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("422 schema");
        },
      }),
    };
    const out = await run(llm);
    assert.equal(out.action, "delegate");
    assert.equal(out.delegateTarget, "full_pipeline");
  });

  it("abort durante structured => AbortError (no cae al fallback)", async () => {
    const ac = new AbortController();
    ac.abort();
    const llm = {
      invoke: async () => ({ content: '{"action":"reply","reply":"x"}' }),
      withStructuredOutput: () => ({ invoke: async () => structuredArgs }),
    };
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () => run(llm)),
      (err: Error) => err.name === "AbortError",
    );
  });
});

describe("runManagerLlmTurn — presupuesto del turno (LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS)", () => {
  const ENV = "LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS";

  function setBudget(value: string): () => void {
    const prev = process.env[ENV];
    process.env[ENV] = value;
    return () => {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    };
  }

  it("structured output: el timeout de la llamada se acota al presupuesto (30 s, no los 120 s por defecto)", async () => {
    let signal: AbortSignal | undefined;
    const llm = {
      // Tras agotar el structured output, el camino invoke+parse responde al instante.
      invoke: async () => ({ content: '{"action":"reply","reply":"ok"}' }),
      withStructuredOutput: () => ({
        invoke: (_m: unknown, opts: { signal: AbortSignal }) => {
          signal = opts.signal;
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
          });
        },
      }),
    };
    const restoreEnv = setBudget("30000");
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = run(llm);
      assert.ok(signal, "la llamada structured ya armó su señal de abort");
      mock.timers.tick(29_999);
      assert.equal(signal.aborted, false);
      mock.timers.tick(1);
      assert.equal(signal.aborted, true, "el abort llega exactamente al presupuesto");
      const out = await pending;
      assert.equal(out.action, "reply");
    } finally {
      mock.timers.reset();
      restoreEnv();
    }
  });

  it("invoke+parse: presupuesto agotado con la llamada colgada => delegate por defecto y log 'presupuesto agotado'", async () => {
    const logs: string[] = [];
    const llm = {
      invoke: (_m: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
        }),
    };
    const restoreEnv = setBudget("30000");
    const logSpy = mock.method(console, "log", (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = run(llm);
      mock.timers.tick(30_000);
      const out = await pending;
      assert.equal(out.action, "delegate");
      assert.equal(out.delegateTarget, "sections");
      assert.ok(logs.some((l) => /presupuesto agotado/.test(l)), "el log distingue el agotamiento del presupuesto");
    } finally {
      mock.timers.reset();
      logSpy.mock.restore();
      restoreEnv();
    }
  });
});

describe("runManagerLlmTurn — un único presupuesto por turno (reloj inyectado)", () => {
  const ENV = "LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS";
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  function setBudget(value: string): () => void {
    const prev = process.env[ENV];
    process.env[ENV] = value;
    return () => {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    };
  }

  function runAt(llm: unknown, now: () => number) {
    return runManagerLlmTurn({
      llm: llm as never,
      state: baseState,
      userMessage: "agrega una tabla de pagos al modelo",
      hasBench: false,
      hasDraft: true,
      now,
    });
  }

  it("el structured que consume 40 s de 60 deja al invoke+parse solo los 20 s restantes", async () => {
    let clock = 0;
    const holder: { signal?: AbortSignal } = {};
    const llm = {
      invoke: (_m: unknown, opts: { signal: AbortSignal }) => {
        holder.signal = opts.signal;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
        });
      },
      withStructuredOutput: () => ({
        invoke: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              clock = 40_000;
              reject(new Error("422 schema"));
            }, 40_000);
          }),
      }),
    };
    const restoreEnv = setBudget("60000");
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = runAt(llm, () => clock);
      await flush();
      assert.equal(holder.signal, undefined, "el structured todavía no ha terminado");
      mock.timers.tick(40_000);
      await flush();
      assert.ok(holder.signal, "el invoke+parse arranca tras el fallo del structured");
      assert.equal(holder.signal.aborted, false);
      mock.timers.tick(19_999);
      assert.equal(holder.signal.aborted, false, "a los 59,999 s todavía queda presupuesto");
      mock.timers.tick(1);
      assert.equal(holder.signal.aborted, true, "el turno se corta a los 60 s en total, no a 40 + 60");
      const out = await pending;
      assert.equal(out.action, "delegate");
    } finally {
      mock.timers.reset();
      restoreEnv();
    }
  });

  it("presupuesto del turno menor de 15 s: no invoca y delega con motivo 'presupuesto del turno agotado'", async () => {
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        return { content: '{"action":"reply","reply":"x"}' };
      },
      withStructuredOutput: () => ({
        invoke: async () => {
          calls += 1;
          return { action: "reply", reply: "x", target: "clarifier_only", sections: [], memorySearchQuery: "" };
        },
      }),
    };
    const restoreEnv = setBudget("10000");
    const logs: string[] = [];
    const logSpy = mock.method(console, "log", (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    try {
      const out = await runAt(llm, () => 0);
      assert.equal(calls, 0, "ninguna llamada al LLM");
      assert.equal(out.action, "delegate");
      assert.equal(out.delegateTarget, "sections");
      assert.ok(logs.some((l) => /presupuesto del turno agotado/.test(l)), "el log distingue el motivo");
    } finally {
      logSpy.mock.restore();
      restoreEnv();
    }
  });
});

describe("runManagerLlmTurn — salida structured inválida se traza como invalid", () => {
  it("includeRaw con parsed nulo: la traza de la llamada structured queda como invalid, no ok", async () => {
    const llm = {
      invoke: async () => ({ content: '{"action":"delegate","target":"clarifier_only"}' }),
      withStructuredOutput: () => ({
        invoke: async () => ({ raw: { content: "" }, parsed: null }),
      }),
    };
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const out = await runWithTokenUsageContext(
        { projectId: "p1", documentField: "mddContent", context: "initial", node: "manager" },
        () => run(llm),
      );
      assert.equal(out.delegateTarget, "clarifier_only");
    } finally {
      console.log = orig;
    }
    const calls = lines
      .filter((l) => l.startsWith("[MDD:LlmCall] "))
      .map((l) => JSON.parse(l.slice("[MDD:LlmCall] ".length)) as Record<string, unknown>);
    assert.equal(calls.length, 2, "structured + invoke+parse");
    assert.equal(calls[0]!.outcome, "invalid");
    assert.equal(calls[1]!.outcome, "ok");
  });
});

describe("runManagerLlmTurn — presupuesto del turno en la búsqueda de herramientas (ronda acotada)", () => {
  const ENV = "LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS";
  // Tools reales del registro (SDD) sin dependencias invocadas: basta con que existan para entrar en la ronda.
  const toolDeps = { projects: {}, theforge: { isConfigured: () => false }, ai: {} } as never;
  const searchState = { managerRound: 0, projectId: "proj-1" } as never;
  const searchStructured = {
    action: "search_memory",
    reply: "",
    target: "clarifier_only",
    sections: [],
    memorySearchQuery: "auth con MFA",
  };

  function setBudget(value: string): () => void {
    const prev = process.env[ENV];
    process.env[ENV] = value;
    return () => {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    };
  }

  function captureLogs() {
    const logs: string[] = [];
    const spy = mock.method(console, "log", (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    return { logs, restore: () => spy.mock.restore() };
  }

  it("sin holgura para la ronda: no liga ni invoca tools y el turno delega con motivo 'presupuesto del turno agotado'", async () => {
    let clock = 0;
    let toolsTouched = 0;
    const llm = {
      invoke: async () => {
        throw new Error("no debe usarse el invoke plano");
      },
      bindTools: () => {
        toolsTouched += 1;
        return { invoke: async () => ({ content: "no debe usarse" }) };
      },
      withStructuredOutput: () => ({
        invoke: async () => {
          // El structured output de la primera vuelta consume 50 s de 60 s: quedan 10 s, menos que la holgura.
          clock = 50_000;
          return searchStructured;
        },
      }),
    };
    const restoreEnv = setBudget("60000");
    const cap = captureLogs();
    try {
      const out = await runManagerLlmTurn({
        llm: llm as never,
        toolDeps,
        state: searchState,
        userMessage: "agrega una tabla de pagos al modelo",
        hasBench: false,
        hasDraft: true,
        now: () => clock,
      });
      assert.equal(toolsTouched, 0, "la ronda no liga ni invoca el LLM con tools");
      assert.equal(out.action, "delegate");
      assert.equal(out.delegateTarget, "sections");
      assert.ok(cap.logs.some((l) => /presupuesto del turno agotado/.test(l)), "el log indica el agotamiento del presupuesto");
    } finally {
      cap.restore();
      restoreEnv();
    }
  });

  it("dos vueltas: la ronda consume el resto del presupuesto y la segunda vuelta no invoca; el turno delega", async () => {
    let clock = 0;
    let structuredCalls = 0;
    let toolInvokes = 0;
    const llm = {
      invoke: async () => {
        throw new Error("no debe usarse el invoke plano");
      },
      bindTools: () => ({
        invoke: async () => {
          toolInvokes += 1;
          // La ronda tarda 30 s: al volver quedan 10 s, por debajo de la holgura.
          clock = 50_000;
          return { content: "hallazgo: MFA ya existe" };
        },
      }),
      withStructuredOutput: () => ({
        invoke: async () => {
          structuredCalls += 1;
          // Primera vuelta: 20 s de 60 s (quedan 40 s, holgura suficiente para la ronda).
          clock = 20_000;
          return searchStructured;
        },
      }),
    };
    const restoreEnv = setBudget("60000");
    const cap = captureLogs();
    try {
      const out = await runManagerLlmTurn({
        llm: llm as never,
        toolDeps,
        state: searchState,
        userMessage: "agrega una tabla de pagos al modelo",
        hasBench: false,
        hasDraft: true,
        now: () => clock,
      });
      assert.equal(toolInvokes, 1, "la ronda invoca una vez con holgura");
      assert.equal(structuredCalls, 1, "la segunda vuelta no vuelve a invocar el structured output");
      assert.equal(out.action, "delegate");
      assert.equal(out.delegateTarget, "sections");
      assert.ok(cap.logs.some((l) => /presupuesto del turno agotado/.test(l)));
    } finally {
      cap.restore();
      restoreEnv();
    }
  });
});
