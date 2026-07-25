import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  suggestGovernancePatternIdsFast,
} from "./suggest-mdd-governance-patterns.util.js";

describe("suggest-mdd-governance-patterns.util", () => {
  it("suggestGovernancePatternIdsFast responde sin LLM con documentos típicos", () => {
    const result = suggestGovernancePatternIdsFast({
      dbgaContent: "API NestJS, PostgreSQL con Prisma, cola BullMQ y frontend React.",
      phase0SummaryContent: "Benchmark: monolito modular en Docker.",
      brdContent: "Integración Stripe vía webhooks.",
    });
    assert.ok(result);
    assert.ok(result.patternIds.length >= 2);
    assert.match(result.rationale ?? "", /rápida/i);
  });

  it("suggestGovernancePatternIdsFast devuelve vacío sin documentos", () => {
    const result = suggestGovernancePatternIdsFast({
      dbgaContent: "",
      phase0SummaryContent: "",
      brdContent: "",
    });
    assert.ok(result);
    assert.deepEqual(result.patternIds, []);
  });
});
