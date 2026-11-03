/**
 * Tests del AsyncLocalStorage que propaga el contexto de telemetría de tokens.
 * Verifica runWithTokenUsageContext y withTokenUsageContextPatch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTokenUsageOutcome,
  getActiveTokenUsageContext,
  runWithTokenUsageContext,
  withTokenUsageContextPatch,
} from "./token-usage.context.js";

describe("token-usage.context", () => {
  it("devuelve null fuera de un contexto activo", () => {
    const ctx = getActiveTokenUsageContext();
    assert.equal(ctx, null);
  });

  it("propaga el contexto dentro de runWithTokenUsageContext", async () => {
    const payload = {
      projectId: "p1",
      stageId: "s1",
      documentField: "mddContent",
      context: "initial",
    };
    const observed = await runWithTokenUsageContext(payload, async () => {
      return getActiveTokenUsageContext();
    });
    assert.deepEqual(observed, payload);
  });

  it("propaga a través de awaits", async () => {
    const payload = {
      projectId: "p2",
      documentField: "specContent",
      context: "regenerate",
    };
    const result = await runWithTokenUsageContext(payload, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getActiveTokenUsageContext();
    });
    assert.deepEqual(result, payload);
  });

  it("restaura null al salir del contexto", async () => {
    await runWithTokenUsageContext(
      { projectId: "p3", documentField: "chat", context: "chat" },
      async () => {
        assert.ok(getActiveTokenUsageContext());
      },
    );
    assert.equal(getActiveTokenUsageContext(), null);
  });

  it("withTokenUsageContextPatch sólo aplica patch si hay contexto activo", async () => {
    const outside = await withTokenUsageContextPatch(
      { node: "auditor" },
      () => getActiveTokenUsageContext(),
    );
    assert.equal(outside, null);

    const inside = await runWithTokenUsageContext(
      { projectId: "p4", documentField: "mddContent", context: "initial" },
      async () =>
        withTokenUsageContextPatch({ node: "auditor" }, () =>
          getActiveTokenUsageContext(),
        ),
    );
    assert.equal(inside?.projectId, "p4");
    assert.equal(inside?.node, "auditor");
    assert.equal(inside?.documentField, "mddContent");
  });
});

describe("token-usage.context (telemetría)", () => {
  it("withTokenUsageContextPatch acepta campos de telemetría y conserva el resto", async () => {
    const payload = { projectId: "p1", documentField: "mddContent", context: "initial" };
    const observed = await runWithTokenUsageContext(payload, () =>
      withTokenUsageContextPatch(
        {
          node: "auditor",
          capability: "scoped_high",
          latencyMs: 10,
          attempts: 2,
          outcome: "timeout",
          costKnown: false,
          estimated: true,
          modelActual: "m/dos",
        },
        async () => getActiveTokenUsageContext(),
      ),
    );
    assert.equal(observed?.projectId, "p1");
    assert.equal(observed?.node, "auditor");
    assert.equal(observed?.capability, "scoped_high");
    assert.equal(observed?.outcome, "timeout");
    assert.equal(observed?.estimated, true);
    assert.equal(observed?.modelActual, "m/dos");
  });
});

describe("classifyTokenUsageOutcome", () => {
  it("ok e invalid son medidas; error, timeout y abort son fallidas", () => {
    assert.equal(classifyTokenUsageOutcome({ outcome: "ok" }), "measured");
    assert.equal(classifyTokenUsageOutcome({ outcome: "invalid" }), "measured");
    assert.equal(classifyTokenUsageOutcome({ outcome: "error" }), "failed");
    assert.equal(classifyTokenUsageOutcome({ outcome: "timeout" }), "failed");
    assert.equal(classifyTokenUsageOutcome({ outcome: "abort" }), "failed");
  });

  it("sin outcome: medida si costKnown !== false; unknown si costKnown === false", () => {
    assert.equal(classifyTokenUsageOutcome({}), "measured");
    assert.equal(classifyTokenUsageOutcome({ outcome: null }), "measured");
    assert.equal(classifyTokenUsageOutcome({ outcome: null, costKnown: true }), "measured");
    assert.equal(classifyTokenUsageOutcome({ outcome: null, costKnown: null }), "measured");
    assert.equal(classifyTokenUsageOutcome({ costKnown: false }), "unknown");
    assert.equal(classifyTokenUsageOutcome({ outcome: null, costKnown: false }), "unknown");
  });

  it("el outcome manda sobre costKnown cuando viene", () => {
    assert.equal(classifyTokenUsageOutcome({ outcome: "error", costKnown: true }), "failed");
    assert.equal(classifyTokenUsageOutcome({ outcome: "ok", costKnown: false }), "measured");
  });
});
