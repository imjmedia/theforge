/**
 * @fileoverview F3 — Tras architect_critic OK: api_contracts ∥ security ∥ integration.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { MDDStateType } from "../state/index.js";
import { getMddDraftSummary } from "../utils/mdd-sanitize.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import { mergePostCriticParallelResults } from "../utils/mdd-tail-parallel.util.js";
import { draftHasSubstantialSection4 } from "../utils/mdd-section-preserve.util.js";
import { runApiContractsArchitectWithChunks } from "../utils/mdd-api-contracts-chunk.runner.js";
import { createMddIntegrationNode } from "./mdd-integration.node.js";
import { createMddSecurityNode } from "./mdd-security.node.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:PostCriticParallel] ${msg}`, ...args);

export type MddPostCriticParallelNodeOptions = {
  apiContractsFn: (state: MDDStateType) => Promise<Partial<MDDStateType>>;
  /** Chunks §4 >0: modelo rápido (F6) si está configurado. */
  apiContractsChunkFn?: (
    chunkIndex: number,
    state: MDDStateType,
  ) => Promise<Partial<MDDStateType>>;
};

/**
 * Ejecuta §4 + §6 + §7 en paralelo tras critic (HIGH).
 * Security/integration devuelven solo slices; el merge evita colisión de mddDraft.
 */
export function createMddPostCriticParallelNode(
  structuralLlm: BaseChatModel,
  opts: MddPostCriticParallelNodeOptions,
) {
  const tailOpts = { sliceOnly: true, trimmedTailContext: true } as const;
  const securityFn = createMddSecurityNode(structuralLlm, tailOpts);
  const integrationFn = createMddIntegrationNode(structuralLlm, tailOpts);

  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const startedAt = Date.now();
    LOG("entry parallel mddDraftLen=%s", (state.mddDraft ?? "").length);

    const [apiResult, secResult, intResult] = await Promise.all([
      runApiContractsArchitectWithChunks(state, opts.apiContractsFn, {
        chunkFn: opts.apiContractsChunkFn,
      }),
      securityFn(state),
      integrationFn(state),
    ]);

    const merged = mergePostCriticParallelResults(state, apiResult, secResult, intResult);
    const finalDraft = merged.mddDraft ?? state.mddDraft ?? "";
    const sum = getMddDraftSummary(finalDraft);
    logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, 0, finalDraft.length), { parallel: true });
    LOG(
      "ok parallel §4+§6+§7 draftLen=%s §4=%s §6=%s §7=%s",
      sum.length,
      draftHasSubstantialSection4(finalDraft) ? "✓" : "✗",
      /##\s+(?:6\.\s*)?Seguridad\b/i.test(finalDraft) ? "✓" : "✗",
      /##\s+(?:7\.\s*)?(?:Infraestructura|Integración)\b/i.test(finalDraft) ? "✓" : "✗",
    );
    return merged;
  };
}
