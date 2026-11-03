/**
 * Tests del recorder transversal de uso de tokens: `modelActual` desde `chained_model`,
 * `estimated: false` en uso real y estimación en abort.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractChainedModel,
  recordTokenUsageFromContext,
  recordUsageEstimateOnAbort,
  registerTokenUsageRecorder,
} from "./token-usage-recorder.js";
import { runWithTokenUsageContext } from "../../ai-analysis/token-usage/token-usage.context.js";

const GLOBAL_KEY = "__theforgeTokenUsageRecorder";

describe("token-usage-recorder", () => {
  const events: Array<Record<string, unknown>> = [];
  const estimates: Array<Record<string, unknown>> = [];

  function install() {
    events.length = 0;
    estimates.length = 0;
    registerTokenUsageRecorder({
      recordAsync: (e) => void events.push(e as unknown as Record<string, unknown>),
      recordEstimatedAsync: (e) => void estimates.push(e as unknown as Record<string, unknown>),
    });
  }

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  });

  const payload = {
    projectId: "p1",
    documentField: "mddContent",
    context: "initial",
    node: "auditor",
    jobId: "j1",
  };

  it("extractChainedModel solo acepta strings no vacíos", () => {
    assert.equal(extractChainedModel({ chained_model: "m/dos" }), "m/dos");
    assert.equal(extractChainedModel({ chained_model: "  " }), null);
    assert.equal(extractChainedModel({ chained_model_index: 1 }), null);
    assert.equal(extractChainedModel(undefined), null);
  });

  it("uso real: modelActual desde chained_model y estimated=false", () => {
    install();
    runWithTokenUsageContext(payload, () => {
      recordTokenUsageFromContext("openrouter", "m/uno", 10, 5, 15, {
        responseMetadata: { chained_model: "m/dos", chained_model_index: 1 },
        latencyMs: 800,
        attempts: 2,
      });
    });
    assert.equal(events.length, 1);
    const e = events[0]!;
    assert.equal(e.modelActual, "m/dos");
    assert.equal(e.estimated, false);
    assert.equal(e.outcome, "ok");
    assert.equal(e.latencyMs, 800);
    assert.equal(e.attempts, 2);
    assert.equal(e.node, "auditor");
  });

  it("uso real sin chained_model deja modelActual en null", () => {
    install();
    runWithTokenUsageContext(payload, () => {
      recordTokenUsageFromContext("openai", "gpt-4o", 1, 1, 2);
    });
    assert.equal(events[0]!.modelActual, null);
    assert.equal(events[0]!.estimated, false);
  });

  it("recordUsageEstimateOnAbort propaga skipCost solo cuando se pide", () => {
    install();
    runWithTokenUsageContext(payload, () => {
      recordUsageEstimateOnAbort(null, {
        providerId: "openai",
        modelId: "gpt-4o",
        inputText: "",
        outputText: "",
        outcome: "error",
        skipCost: true,
      });
      recordUsageEstimateOnAbort(null, {
        providerId: "openai",
        modelId: "gpt-4o",
        inputText: "abc",
        outputText: "",
        outcome: "timeout",
      });
    });
    assert.equal(estimates[0]!.skipCost, true);
    assert.equal(estimates[1]!.skipCost, undefined);
  });

  it("sin contexto activo no registra nada", () => {
    install();
    recordTokenUsageFromContext("openai", "gpt-4o", 1, 1, 2);
    assert.equal(events.length, 0);
  });

  it("recordUsageEstimateOnAbort pasa chars del texto y el outcome", () => {
    install();
    runWithTokenUsageContext(payload, () => {
      recordUsageEstimateOnAbort(null, {
        providerId: "openai",
        modelId: "gpt-4o",
        inputText: "a".repeat(40),
        outputText: "b".repeat(8),
        outcome: "timeout",
        latencyMs: 5000,
      });
    });
    assert.equal(estimates.length, 1);
    const e = estimates[0]!;
    assert.equal(e.inputChars, 40);
    assert.equal(e.outputChars, 8);
    assert.equal(e.outcome, "timeout");
    assert.equal(e.latencyMs, 5000);
    assert.equal(e.projectId, "p1");
  });

  it("recordUsageEstimateOnAbort es no-op sin recorder y no lanza", () => {
    assert.doesNotThrow(() =>
      recordUsageEstimateOnAbort(
        { ...payload },
        { providerId: "x", modelId: "y", inputText: "a", outputText: "", outcome: "abort" },
      ),
    );
  });
});
