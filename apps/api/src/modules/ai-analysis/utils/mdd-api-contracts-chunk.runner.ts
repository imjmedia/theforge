/**
 * @fileoverview Ejecuta api_contracts con fan-out F2 cuando §3 tiene muchas tablas.
 */

import type { MDDStateType } from "../state/index.js";
import { mergeMddStructured } from "./mdd-merge-structured.js";
import {
  apiContractsChunkPromptBlock,
  mergeApiContractsBodyIntoDraft,
  mergeApiContractsChunkBodies,
  planApiContractsChunksFromDraft,
  shouldUseApiContractsChunkParallel,
} from "./mdd-api-contracts-chunk.util.js";
import { extractContratosSectionBody } from "./mdd-sanitize.js";

export type ApiContractsArchitectFn = (state: MDDStateType) => Promise<Partial<MDDStateType>>;

export type ApiContractsChunkFn = (
  chunkIndex: number,
  state: MDDStateType,
) => Promise<Partial<MDDStateType>>;

/**
 * Delega en `baseFn` o fan-out paralelo por chunks de tablas §3 (F2).
 */
export async function runApiContractsArchitectWithChunks(
  state: MDDStateType,
  baseFn: ApiContractsArchitectFn,
  opts?: { chunkFn?: ApiContractsChunkFn },
): Promise<Partial<MDDStateType>> {
  const draft = (state.mddDraft ?? "").trim();
  if (!shouldUseApiContractsChunkParallel(draft)) {
    return baseFn(state);
  }

  const { chunks } = planApiContractsChunksFromDraft(draft);
  const resolveChunkFn = (index: number): ApiContractsArchitectFn => {
    if (index === 0 || !opts?.chunkFn) return baseFn;
    return (chunkState) => opts.chunkFn!(index, chunkState);
  };
  const chunkResults = await Promise.all(
    chunks.map((chunk, index) => {
      const chunkGoal = apiContractsChunkPromptBlock(chunk, chunks.length);
      const priorGoal = state.currentStepGoal?.trim();
      const mergedGoal = priorGoal ? `${priorGoal}\n\n${chunkGoal}` : chunkGoal;
      return resolveChunkFn(index)({ ...state, currentStepGoal: mergedGoal });
    }),
  );

  const bodies: string[] = [];
  let mergedStructured = state.mddStructured;
  for (const result of chunkResults) {
    const resultDraft = (result.mddDraft ?? draft).trim();
    const body = extractContratosSectionBody(resultDraft);
    if (body) bodies.push(body);
    if (result.mddStructured) {
      mergedStructured = mergeMddStructured(mergedStructured, result.mddStructured, resultDraft);
    }
  }

  const mergedSection4 = mergeApiContractsChunkBodies(bodies);
  const mddDraft = mergeApiContractsBodyIntoDraft(draft, mergedSection4);

  return {
    mddDraft,
    ...(mergedStructured ? { mddStructured: mergedStructured } : {}),
  };
}
