/**
 * O14: el pase scoped que corta el stream antes del chunk `usage_metadata` registra una
 * estimación marcada (outcome ok); con usage real registra latencia/intento/modelo real.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { registerTokenUsageRecorder } from "../../ai/utils/token-usage-recorder.js";
import { runWithTokenUsageContext } from "../token-usage/token-usage.context.js";
import { runWithLlmAbortSignal } from "./mdd-llm-retry.util.js";
import { invokeScopedArchitectLlmWithHeadingCap } from "./mdd-scoped-stream.util.js";

const GLOBAL_KEY = "__theforgeTokenUsageRecorder";
const payload = { projectId: "p1", documentField: "mddContent", context: "initial", node: "software_architect", jobId: "j1" };
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

const msgs = [new HumanMessage("hola".repeat(10))];

describe("invokeScopedArchitectLlmWithHeadingCap — telemetría", () => {
  it("corte por scope sin usage_metadata: estimación marcada con outcome ok", async () => {
    const llm = {
      invoke: async () => ({ content: "no" }),
      stream: async function* () {
        yield new AIMessageChunk({ content: "## 4. Contratos\n\nGET /x\n\n" });
        yield new AIMessageChunk({ content: "## 5. Lógica\n\ncortar aquí" });
        yield new AIMessageChunk({ content: "nunca", usage_metadata: { input_tokens: 9, output_tokens: 9, total_tokens: 18 } });
      },
    };
    const res = await runWithTokenUsageContext(payload, () =>
      invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" }),
    );
    assert.ok(res);
    assert.equal(events.length, 0);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "ok");
    assert.equal(estimates[0]!.inputChars, 40);
    assert.equal(estimates[0]!.attempts, 1);
    assert.equal(typeof estimates[0]!.latencyMs, "number");
    assert.ok((estimates[0]!.outputChars as number) > 0);
  });

  it("con usage real registra latencia, intento, outcome ok y modelActual del primer chunk", async () => {
    const first = new AIMessageChunk({ content: "## 3. Datos\n\nSQL", response_metadata: { chained_model: "m/real" } });
    const last = new AIMessageChunk({ content: "", usage_metadata: { input_tokens: 50, output_tokens: 10, total_tokens: 60 } });
    const llm = {
      invoke: async () => ({ content: "no" }),
      stream: async function* () {
        yield first;
        yield last;
      },
    };
    await runWithTokenUsageContext(payload, () =>
      invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" }),
    );
    assert.equal(estimates.length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.outcome, "ok");
    assert.equal(events[0]!.attempts, 1);
    assert.equal(typeof events[0]!.latencyMs, "number");
    assert.equal(events[0]!.modelActual, "m/real");
    assert.equal(events[0]!.estimated, false);
  });

  it("cancelar el turno (ALS) corta el stream, registra abort y lanza AbortError sin fallback", async () => {
    const ac = new AbortController();
    let invokeCalls = 0;
    let streamSignal: AbortSignal | undefined;
    const llm = {
      invoke: async () => {
        invokeCalls += 1;
        return { content: "no debe llamarse" };
      },
      stream: (_m: unknown, opts?: { signal?: AbortSignal }) => {
        streamSignal = opts?.signal;
        return (async function* () {
          yield new AIMessageChunk({ content: "## 4. parcial" });
          setTimeout(() => ac.abort(), 10);
          await new Promise<void>(() => undefined);
        })();
      },
    };
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () =>
        runWithTokenUsageContext(payload, () =>
          invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T", idleTimeoutMs: 5_000 }),
        ),
      ),
      (e: Error) => e.name === "AbortError",
    );
    assert.equal(invokeCalls, 0, "no hay fallback a invoke");
    assert.equal(streamSignal?.aborted, true, "la señal llega al proveedor");
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0]!.outcome, "abort");
    assert.equal(estimates[0]!.outputChars, "## 4. parcial".length);
    assert.equal(estimates[0]!.skipCost, undefined);
  });

  it("señal ya abortada: AbortError sin llamar al proveedor", async () => {
    const ac = new AbortController();
    ac.abort();
    let streams = 0;
    const llm = { invoke: async () => ({ content: "x" }), stream: () => { streams += 1; return (async function* () { /* vacío */ })(); } };
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () => invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" })),
      (e: Error) => e.name === "AbortError",
    );
    assert.equal(streams, 0);
    assert.equal(estimates.length, 0);
  });

  it("timeout por inactividad con parcial estima outcome timeout", async () => {
    const llm = {
      invoke: async () => ({ content: "## 4. Contratos\n\nvía invoke" }),
      stream: async function* () {
        yield new AIMessageChunk({ content: "## 4. parcial" });
        await new Promise<void>(() => undefined);
      },
    };
    await runWithTokenUsageContext(payload, () =>
      invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T", idleTimeoutMs: 30 }),
    );
    const t = estimates.find((e) => e.outcome === "timeout");
    assert.ok(t);
    assert.equal(t.outputChars, "## 4. parcial".length);
  });
});
