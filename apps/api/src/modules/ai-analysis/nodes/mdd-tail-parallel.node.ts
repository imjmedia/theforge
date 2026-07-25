/**
 * @fileoverview Nodo tail-parallel — ejecuta procesamiento paralelo final.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { MDDStateType } from "../state/index.js";
import { getMddDraftSummary } from "../utils/mdd-sanitize.js";
import { mergeTailParallelResults } from "../utils/mdd-tail-parallel.util.js";
import { createMddIntegrationNode } from "./mdd-integration.node.js";
import { createMddSection5Node } from "./mdd-section5.node.js";
import { createMddSecurityNode } from "./mdd-security.node.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:TailParallel] ${msg}`, ...args);

/**
 * Ejecuta §5, §6 y §7 en paralelo tras Software Architect (§2–§4).
 * Reemplaza la secuencia SA(§5) → security_integration(§6∥§7) en pasada completa.
 */
export function createMddTailParallelNode(section5Llm: BaseChatModel, structuralLlm: BaseChatModel) {
  const section5Fn = createMddSection5Node(section5Llm);
  const securityFn = createMddSecurityNode(structuralLlm);
  const integrationFn = createMddIntegrationNode(structuralLlm);

  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("entry parallel mddDraftLen=%s", (state.mddDraft ?? "").length);

    const [s5Result, secResult, intResult] = await Promise.all([
      section5Fn(state),
      securityFn(state),
      integrationFn(state),
    ]);

    const merged = mergeTailParallelResults(state, s5Result, secResult, intResult);
    const finalDraft = merged.mddDraft ?? state.mddDraft ?? "";
    const sum = getMddDraftSummary(finalDraft);
    LOG(
      "ok parallel done finalDraftLen=%s §5=%s §6=%s §7=%s",
      sum.length,
      /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i.test(finalDraft) ? "✓" : "✗",
      /##\s+(?:6\.\s*)?Seguridad\b/i.test(finalDraft) ? "✓" : "✗",
      /##\s+(?:7\.\s*)?(?:Infraestructura|Integración)\b/i.test(finalDraft) ? "✓" : "✗",
    );
    return merged;
  };
}
