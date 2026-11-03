/**
 * O14: telemetría por llamada de `invokeLlmWithRetry` (latencia, intentos, resultado, modelo real,
 * estimaciones en abort/timeout/error) contra el recorder real con un servicio falso.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerTokenUsageRecorder } from "../../ai/utils/token-usage-recorder.js";
import { runWithTokenUsageContext } from "../token-usage/token-usage.context.js";
import { deriveLlmIdentity, invokeLlmWithRetry } from "./mdd-llm-retry.util.js";
import { DeadlineExceededError } from "./mdd-llm-structured.util.js";
import { HumanMessage } from "@langchain/core/messages";

const GLOBAL_KEY = "__theforgeTokenUsageRecorder";
const payload = { projectId: "p1", documentField: "mddContent", context: "initial", node: "auditor", jobId: "j1" };
type Row = Record<string, unknown>;

let events: Row[] = [];
let estimates: Row[] = [];
beforeEach(() => {
  events = [];
  estimates = [];
  registerTokenUsageRecorder({
    recordAsync: (e) => void events.push(e as unknown as Row),
    recordEstimatedAsync: (e) => void estimates.push(e as unknown as Row),
  });
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
});

/** Reloj determinista: cada lectura avanza 25 ms. */
const fakeClock = () => {
  let t = 1_000;
  return () => (t += 25);
};
const noWait = async (): Promise<void> => undefined;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const msgs = [new HumanMessage("a".repeat(400))];
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };

const run = <T>(fn: () => Promise<T>) => runWithTokenUsageContext(payload, fn) as Promise<T>;

describe("invokeLlmWithRetry — telemetría por llamada", () => {
  it("éxito en el 2º intento: attempts=2, latencyMs>0, outcome ok y modelActual del mensaje final", async () => {
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw httpError(500, "500 boom");
        return { content: "texto", usage_metadata: usage, response_metadata: { chained_model: "m/fallback" } };
      },
    };
    const r = await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", disableStreaming: true, waitFn: noWait, now: fakeClock(), backoffMs: [0, 0, 0],
      }),
    );
    assert.ok(r);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.attempts, 2);
    assert.ok((events[0]!.latencyMs as number) > 0);
    assert.equal(events[0]!.outcome, "ok");
    assert.equal(events[0]!.modelActual, "m/fallback");
    assert.equal(events[0]!.promptTokens, 100);
    assert.equal(events[0]!.estimated, false);
    // El 500 transitorio no consumió tokens: no genera fila estimada.
    assert.equal(estimates.length, 0);
  });

  it("respuesta que no valida registra su uso real como invalid y el reintento como ok", async () => {
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        return { content: calls === 1 ? "" : "ok", usage_metadata: usage };
      },
    };
    await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", disableStreaming: true, waitFn: noWait, now: fakeClock(), backoffMs: [0, 0, 0],
      }),
    );
    assert.deepEqual(events.map((e) => [e.attempts, e.outcome]), [[1, "invalid"], [2, "ok"]]);
  });

  it("sin usage_metadata registra una estimación marcada con outcome ok", async () => {
    const llm = { invoke: async () => ({ content: "x".repeat(40) }) };
    await run(() =>
      invokeLlmWithRetry(llm as never, msgs, { tag: "T", disableStreaming: true, now: fakeClock() }),
    );
    assert.equal(events.length, 0);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "ok");
    assert.equal(estimates[0]!.inputChars, 400);
    assert.equal(estimates[0]!.outputChars, 40);
    assert.equal(estimates[0]!.attempts, 1);
  });

  it("abort externo con texto parcial: estima entrada + parcial con outcome abort", async () => {
    const ac = new AbortController();
    const llm = {
      invoke: async () => ({ content: "x" }),
      stream: async function* () {
        yield { content: "parcial-12345" };
        await new Promise<void>((r) => setTimeout(r, 20));
        ac.abort();
        yield { content: "b" };
      },
    };
    await assert.rejects(
      run(() => invokeLlmWithRetry(llm as never, msgs, { tag: "T", signal: ac.signal, now: fakeClock() })),
      (e: Error) => e.name === "AbortError",
    );
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "abort");
    assert.equal(estimates[0]!.inputChars, 400);
    assert.equal(estimates[0]!.outputChars, "parcial-12345".length);
    assert.equal(estimates[0]!.attempts, 1);
    assert.ok((estimates[0]!.latencyMs as number) > 0);
  });

  it("timeout por inactividad con parcial: outcome timeout, parcial estimado y reintento posterior ok", async () => {
    let streams = 0;
    const llm = {
      invoke: async () => ({ content: "ok", usage_metadata: usage }),
      stream: (_m: unknown, opts?: { signal?: AbortSignal }) => {
        streams += 1;
        if (streams === 1) {
          return (async function* () {
            yield { content: "abc" };
            // Se cuelga hasta que el timeout de inactividad aborta la señal.
            await new Promise<void>((_, reject) =>
              opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
            );
          })();
        }
        return (async function* () {
          yield { content: "listo", usage_metadata: usage };
        })();
      },
    };
    await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", idleTimeoutMs: 30, waitFn: noWait, backoffMs: [0, 0, 0], now: fakeClock(),
      }),
    );
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "timeout");
    assert.equal(estimates[0]!.outputChars, 3);
    assert.equal(estimates[0]!.attempts, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.attempts, 2);
  });

  it("no_retry (401) registra outcome error SIN coste: tokens 0 y skipCost (el proveedor no facturó)", async () => {
    const llm = { invoke: async () => { throw httpError(401, "401 invalid x-api-key"); } };
    const r = await run(() =>
      invokeLlmWithRetry(llm as never, msgs, { tag: "T", disableStreaming: true, now: fakeClock() }),
    );
    assert.equal(r, null);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "error");
    assert.equal(estimates[0]!.inputChars, 0, "no se estima todo el prompt");
    assert.equal(estimates[0]!.outputChars, 0);
    assert.equal(estimates[0]!.skipCost, true);
    assert.equal(estimates[0]!.attempts, 1);
  });

  it("retry_after sin presupuesto registra error sin coste (skipCost)", async () => {
    const llm = {
      invoke: async () => {
        throw Object.assign(new Error("429 rate limited"), { status: 429, headers: { "retry-after": "60" } });
      },
    };
    const r = await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", disableStreaming: true, hardTimeoutMs: 1_000, waitFn: noWait, backoffMs: [0, 0, 0], now: fakeClock(),
      }),
    );
    assert.equal(r, null);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "error");
    assert.equal(estimates[0]!.inputChars, 0);
    assert.equal(estimates[0]!.skipCost, true);
  });

  it("timeout sí conserva la estimación con coste (sin skipCost) aunque no haya parcial", async () => {
    const llm = {
      invoke: (_m: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_, reject) =>
          opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }),
        ),
    };
    await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", disableStreaming: true, timeoutMs: 20, maxAttempts: 1, now: fakeClock(),
      }),
    );
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "timeout");
    assert.equal(estimates[0]!.inputChars, 400);
    assert.equal(estimates[0]!.skipCost, undefined);
  });

  it("identityOverride + salida { raw, parsed }: registra el uso real de raw con la identidad del llm base", async () => {
    const runnable = {
      invoke: async () => ({
        raw: {
          content: "",
          usage_metadata: usage,
          response_metadata: { chained_model: "m/real" },
        },
        parsed: { ok: true },
      }),
    };
    await run(() =>
      invokeLlmWithRetry(runnable as never, msgs, {
        tag: "Manager",
        disableStreaming: true,
        isResponseValid: () => true,
        identityOverride: { providerId: "openrouter", modelId: "m/base" },
        now: fakeClock(),
      }),
    );
    assert.equal(estimates.length, 0, "no cae a estimación");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.providerId, "openrouter");
    assert.equal(events[0]!.modelId, "m/base", "modelId = modelo configurado");
    assert.equal(events[0]!.modelActual, "m/real", "modelActual = modelo que respondió");
    assert.equal(events[0]!.promptTokens, 100);
    assert.equal(events[0]!.completionTokens, 20);
    assert.equal(events[0]!.estimated, false);
  });

  it("agotamiento por errores transitorios registra un solo error al final", async () => {
    const llm = { invoke: async () => { throw httpError(503, "503 unavailable"); } };
    const r = await run(() =>
      invokeLlmWithRetry(llm as never, msgs, {
        tag: "T", disableStreaming: true, maxAttempts: 2, waitFn: noWait, backoffMs: [0, 0], now: fakeClock(),
      }),
    );
    assert.equal(r, null);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "error");
    assert.equal(estimates[0]!.attempts, 2);
  });

  it("sin contexto de telemetría no registra nada ni lanza", async () => {
    const llm = { invoke: async () => ({ content: "ok", usage_metadata: usage }) };
    const r = await invokeLlmWithRetry(llm as never, msgs, { tag: "T", disableStreaming: true });
    assert.ok(r);
    assert.equal(events.length + estimates.length, 0);
  });

  it("emite una línea [MDD:LlmCall] JSON sin volcar el prompt", async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const llm = { invoke: async () => ({ content: "ok", usage_metadata: usage }) };
      await run(() =>
        invokeLlmWithRetry(llm as never, msgs, { tag: "Auditor", disableStreaming: true, now: fakeClock() }),
      );
    } finally {
      console.log = orig;
    }
    const line = lines.find((l) => l.startsWith("[MDD:LlmCall] "));
    assert.ok(line, "debe existir la línea [MDD:LlmCall]");
    const j = JSON.parse(line.slice("[MDD:LlmCall] ".length)) as Record<string, unknown>;
    assert.equal(j.node, "auditor");
    assert.equal(j.tag, "Auditor");
    assert.equal(j.outcome, "ok");
    assert.equal(j.attempts, 1);
    assert.equal(j.promptTokens, 100);
    assert.equal(j.completionTokens, 20);
    assert.ok(!line.includes("aaaa"));
  });
});

describe("deriveLlmIdentity — modelo configurado vs real", () => {
  const llm = { providerId: "openrouter", modelId: "m/primary" };
  it("devuelve siempre el modelo configurado", () => {
    assert.deepEqual(deriveLlmIdentity(llm as never), { providerId: "openrouter", modelId: "m/primary" });
  });
  it("con chained_model en la respuesta, modelId sigue siendo el configurado y el real va en modelActual", async () => {
    const llmFallback = {
      ...llm,
      invoke: async () => ({ content: "t", usage_metadata: usage, response_metadata: { chained_model: "m/fallback" } }),
    };
    await run(() => invokeLlmWithRetry(llmFallback as never, msgs, { tag: "T", disableStreaming: true, now: fakeClock() }));
    assert.equal(events[0]!.modelId, "m/primary");
    assert.equal(events[0]!.modelActual, "m/fallback");
  });
});

describe("invokeLlmWithRetry — abort por presupuesto del nodo (DeadlineExceededError)", () => {
  it("abort con motivo DeadlineExceededError registra outcome timeout, no abort", async () => {
    const ac = new AbortController();
    const llm = {
      invoke: (_m: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
          ac.abort(new DeadlineExceededError("T", 30_000));
        }),
    };
    await assert.rejects(
      run(() =>
        invokeLlmWithRetry(llm as never, msgs, {
          tag: "T", disableStreaming: true, signal: ac.signal, now: fakeClock(),
        }),
      ),
      (e: Error) => e.name === "AbortError",
    );
    assert.equal(events.length, 0);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "timeout");
    assert.equal(estimates[0]!.attempts, 1);
  });
});

describe("invokeLlmWithRetry — cancelación durante el backoff", () => {
  it("abort en la espera entre intentos: la traza registra outcome abort, no el del intento anterior", async () => {
    const ac = new AbortController();
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        throw httpError(500, "500 boom");
      },
    };
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      await assert.rejects(
        run(() =>
          invokeLlmWithRetry(llm as never, msgs, {
            tag: "T",
            disableStreaming: true,
            signal: ac.signal,
            now: fakeClock(),
            backoffMs: [0, 5_000],
            waitFn: async () => {
              ac.abort();
              throw Object.assign(new Error("aborted"), { name: "AbortError" });
            },
          }),
        ),
        (e: Error) => e.name === "AbortError",
      );
    } finally {
      console.log = orig;
    }
    assert.equal(calls, 1);
    const line = lines.find((l) => l.startsWith("[MDD:LlmCall] "));
    assert.ok(line, "debe existir la línea [MDD:LlmCall]");
    const j = JSON.parse(line.slice("[MDD:LlmCall] ".length)) as Record<string, unknown>;
    assert.equal(j.outcome, "abort", "no debe quedar el 'error' del intento anterior");
    assert.equal(j.attempts, 1);
  });
});
