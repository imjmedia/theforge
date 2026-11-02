/**
 * @fileoverview Ejecuta api_contracts con fan-out F2 cuando §3 tiene muchas tablas.
 */

import type { MDDStateType } from "../state/index.js";
import { mergeMddStructured } from "./mdd-merge-structured.js";
import { draftHasPersistableSection4 } from "./mdd-section-preserve.util.js";
import {
  apiContractsChunkPromptBlock,
  mergeApiContractsChunkBodies,
  normalizeEndpointHeadingsForChunkMerge,
  planApiContractsChunksFromDraft,
  shouldUseApiContractsChunkParallel,
} from "./mdd-api-contracts-chunk.util.js";
import { extractContratosSectionBody } from "./mdd-sanitize.js";
import { CONTRATOS_HAS_ENDPOINTS } from "./mdd-sanitize/contratos-format.js";
import {
  mergeApiContractsBodyIntoDraft,
  repairMergeBaselineBeforeApiContractsMerge,
} from "./mdd-api-contracts-merge.util.js";

const ENDPOINT_HEADING_LINE_RE = /^###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+/gm;

/**
 * Cuerpo §4 de un chunk. Normaliza primero las variantes de heading de endpoint
 * (`#### GET`, `**GET /ruta**`, tablas GFM…) para que no se descarte en silencio.
 */
function extractContratosChunkBody(resultDraft: string): string | null {
  const normalized = normalizeEndpointHeadingsForChunkMerge(resultDraft).trim();
  const fromSection = extractContratosSectionBody(normalized);
  if (fromSection) return fromSection;
  if (normalized.length >= 80 && CONTRATOS_HAS_ENDPOINTS.test(normalized)) return normalized;
  return null;
}

function contarEndpointHeadings(body: string | null): number {
  if (!body) return 0;
  return (body.match(ENDPOINT_HEADING_LINE_RE) ?? []).length;
}

export type ApiContractsArchitectFn = (state: MDDStateType) => Promise<Partial<MDDStateType>>;

export type ApiContractsChunkFn = (
  chunkIndex: number,
  state: MDDStateType,
) => Promise<Partial<MDDStateType>>;

/**
 * Delega en `baseFn` o fan-out paralelo por chunks de tablas §3 (F2).
 * Si tras los chunks no queda §4 persistible, reintenta una vez con `baseFn` sin chunking.
 */
export async function runApiContractsArchitectWithChunks(
  state: MDDStateType,
  baseFn: ApiContractsArchitectFn,
  opts?: { chunkFn?: ApiContractsChunkFn },
): Promise<Partial<MDDStateType>> {
  const draft = repairMergeBaselineBeforeApiContractsMerge((state.mddDraft ?? "").trim());
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
      return resolveChunkFn(index)({ ...state, mddDraft: draft, currentStepGoal: mergedGoal });
    }),
  );

  const bodies: string[] = [];
  let mergedStructured = state.mddStructured;
  for (let index = 0; index < chunkResults.length; index++) {
    const result = chunkResults[index] ?? {};
    const resultDraft = (result.mddDraft ?? draft).trim();
    const body = extractContratosChunkBody(resultDraft);
    console.log(
      "[MDD:ApiContractsChunks] chunk %s/%s resultLen=%s cuerpo§4=%s endpoints=%s",
      index + 1,
      chunks.length,
      resultDraft.length,
      body ? "sí" : "no",
      contarEndpointHeadings(body),
    );
    if (body) {
      bodies.push(body);
    } else {
      console.warn(
        "[MDD:ApiContractsChunks] chunk %s/%s sin cuerpo §4 reconocible: %s",
        index + 1,
        chunks.length,
        resultDraft.slice(0, 200).replace(/\s*\n\s*/g, " "),
      );
    }
    if (result.mddStructured) {
      mergedStructured = mergeMddStructured(mergedStructured, result.mddStructured, resultDraft);
    }
  }

  const mergedSection4 = mergeApiContractsChunkBodies(bodies);
  const mddDraft = mergeApiContractsBodyIntoDraft(draft, mergedSection4);

  if (bodies.length === 0 || !draftHasPersistableSection4(mddDraft)) {
    console.warn("[MDD:ApiContractsChunks] §4 no persistible tras chunks; reintento sin chunking");
    try {
      // baseFn devuelve un borrador completo (mismo contrato que la ruta sin chunks), se usa tal cual.
      const fallback = await baseFn({ ...state, mddDraft: draft });
      const fallbackDraft = (fallback.mddDraft ?? "").trim();
      if (fallbackDraft && draftHasPersistableSection4(fallbackDraft)) {
        const fallbackStructured = fallback.mddStructured
          ? mergeMddStructured(mergedStructured, fallback.mddStructured, fallbackDraft)
          : mergedStructured;
        return {
          ...fallback,
          mddDraft: fallbackDraft,
          ...(fallbackStructured ? { mddStructured: fallbackStructured } : {}),
        };
      }
    } catch (err) {
      console.warn(
        "[MDD:ApiContractsChunks] reintento sin chunking falló; se conserva el resultado de chunks: %s",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    mddDraft,
    ...(mergedStructured ? { mddStructured: mergedStructured } : {}),
  };
}
