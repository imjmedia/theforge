import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BaseMessage } from "@langchain/core/messages";
import { createMddDataModelPatchNode } from "./mdd-data-model-patch.node.js";
import type { MDDStateType } from "../state/index.js";

/** LLM falso: cuenta invocaciones para verificar que el no-op no gasta llamada alguna. */
class CountingFakeLlm {
  invokeCount = 0;
  constructor(private readonly response: string) {}
  async invoke(_messages: BaseMessage[]): Promise<unknown> {
    this.invokeCount += 1;
    return { content: this.response };
  }
}

const DRAFT_WITH_AUDIT_LOG = [
  "# Master Design Document",
  "",
  "## 3. Modelo de Datos",
  "",
  "```sql",
  "CREATE TABLE audit_log (id UUID PRIMARY KEY, action TEXT);",
  "CREATE TABLE keys (id UUID PRIMARY KEY);",
  "```",
].join("\n");

function baseState(overrides: Partial<MDDStateType>): MDDStateType {
  return {
    mddDraft: DRAFT_WITH_AUDIT_LOG,
    ...overrides,
  } as MDDStateType;
}

describe("createMddDataModelPatchNode — job KMS: Critic falso positivo audit_logs", () => {
  it("no invoca el LLM cuando la tabla 'faltante' ya existe (singular/plural)", async () => {
    const llm = new CountingFakeLlm("CREATE TABLE audit_logs (id UUID PRIMARY KEY);");
    const node = createMddDataModelPatchNode(llm as never);
    const result = await node(
      baseState({ architectCriticFeedback: "Falta tabla en el DDL: audit_logs" }),
    );
    assert.equal(llm.invokeCount, 0);
    assert.equal(result.architectCriticFeedback, undefined);
    assert.equal(result.architectCriticPhase, "after_section3");
    // No debe haber tocado el draft (no se devuelve mddDraft en el no-op).
    assert.equal("mddDraft" in result, false);
  });

  it("sí invoca el LLM cuando la tabla realmente falta", async () => {
    const llm = new CountingFakeLlm("CREATE TABLE certificates (id UUID PRIMARY KEY);");
    const node = createMddDataModelPatchNode(llm as never);
    const result = await node(
      baseState({ architectCriticFeedback: "Falta tabla en el DDL: certificates" }),
    );
    assert.equal(llm.invokeCount, 1);
    assert.ok(result.mddDraft?.includes("CREATE TABLE certificates"));
  });

  it("noop cuando no hay gaps parseables", async () => {
    const llm = new CountingFakeLlm("irrelevante");
    const node = createMddDataModelPatchNode(llm as never);
    const result = await node(baseState({ architectCriticFeedback: "rediseñar diagrama ER" }));
    assert.equal(llm.invokeCount, 0);
    assert.deepEqual(result, {});
  });
});
