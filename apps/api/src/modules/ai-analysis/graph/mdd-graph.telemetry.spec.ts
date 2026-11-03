/**
 * O14: `wrapNodeTelemetry` ata cada nodo al contexto de tokens (`node` / `capability`)
 * sin romper cuando no hay contexto activo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getActiveTokenUsageContext,
  runWithTokenUsageContext,
} from "../token-usage/token-usage.context.js";
import { wrapNodeTelemetry } from "./mdd-graph.js";

const payload = {
  projectId: "p1",
  documentField: "mddContent",
  context: "initial",
  node: "otro",
  jobId: "j1",
};

describe("wrapNodeTelemetry", () => {
  it("el nodo ve `node` y `capability` en el contexto activo y el resto del payload intacto", async () => {
    let seen: ReturnType<typeof getActiveTokenUsageContext> = null;
    const wrapped = wrapNodeTelemetry("auditor", async () => {
      seen = getActiveTokenUsageContext();
      return { ok: true };
    });
    const out = await runWithTokenUsageContext(payload, () => wrapped());
    assert.deepEqual(out, { ok: true });
    assert.equal(seen!.node, "auditor");
    assert.equal(seen!.capability, "auditor");
    assert.equal(seen!.projectId, "p1");
    assert.equal(seen!.jobId, "j1");
  });

  it("respeta una capability explícita y reenvía todos los argumentos (state, config)", () => {
    let args: unknown[] = [];
    let cap: string | null | undefined;
    const wrapped = wrapNodeTelemetry(
      "stack_architect",
      (...a: unknown[]) => {
        args = a;
        cap = getActiveTokenUsageContext()?.capability;
        return "r";
      },
      "scoped_stack",
    );
    const out = runWithTokenUsageContext(payload, () => wrapped({ s: 1 }, { c: 2 }));
    assert.equal(out, "r");
    assert.deepEqual(args, [{ s: 1 }, { c: 2 }]);
    assert.equal(cap, "scoped_stack");
  });

  it("sin contexto activo no lanza y el nodo corre", async () => {
    let ran = false;
    let ctx: ReturnType<typeof getActiveTokenUsageContext> = null;
    const wrapped = wrapNodeTelemetry("clarifier", async () => {
      ran = true;
      ctx = getActiveTokenUsageContext();
      return {};
    });
    await wrapped();
    assert.equal(ran, true);
    assert.equal(ctx, null);
  });

  it("el contexto no se filtra fuera del nodo", async () => {
    const wrapped = wrapNodeTelemetry("auditor", async () => ({}));
    await runWithTokenUsageContext(payload, async () => {
      await wrapped();
      assert.equal(getActiveTokenUsageContext()?.node, "otro");
    });
  });
});
