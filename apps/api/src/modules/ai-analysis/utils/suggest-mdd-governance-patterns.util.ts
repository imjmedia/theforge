/**
 * @fileoverview Sugerencias de patrones de gobernanza según contexto.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  heuristicGovernancePatternIds,
  listGovernancePatternOptions,
} from "@theforge/shared-types/mdd-governance-patterns";
import { resolveGovernancePatternIncompatibilities } from "@theforge/shared-types/mdd-governance-pattern-compat";
import { extractFirstJsonObject, parseJsonOrThrow } from "./parse-json.js";

const responseSchema = z.object({
  patternIds: z.array(z.string()),
  rationale: z.string().optional(),
});

export type SuggestGovernancePatternsInput = {
  dbgaContent: string;
  phase0SummaryContent: string;
  brdContent: string;
};

export type SuggestGovernancePatternsResult = {
  patternIds: string[];
  rationale?: string;
};

const FAST_PATH_MIN_PATTERNS = 2;
const SLICE = 12_000;

function finalizeSuggestedIds(
  patternIds: string[],
  rationale?: string,
): SuggestGovernancePatternsResult {
  const resolved = resolveGovernancePatternIncompatibilities(new Set(patternIds));
  const suffix =
    resolved.corrections.length > 0
      ? ` Se ajustaron ${resolved.corrections.length} incompatibilidad(es) en la preselección.`
      : "";
  const base = rationale?.trim() ?? "";
  return {
    patternIds: [...resolved.correctedIds],
    rationale: base ? `${base}${suffix}` : suffix.trim() || undefined,
  };
}

function hasSuggestableDocs(input: SuggestGovernancePatternsInput): boolean {
  return (
    input.dbgaContent.trim().length > 0 ||
    input.phase0SummaryContent.trim().length > 0 ||
    input.brdContent.trim().length > 0
  );
}

/** Respuesta inmediata sin LLM cuando la heurística es suficiente. */
export function suggestGovernancePatternIdsFast(
  input: SuggestGovernancePatternsInput,
): SuggestGovernancePatternsResult | null {
  if (!hasSuggestableDocs(input)) {
    return {
      patternIds: [],
      rationale: "No hay documentos de Fase 0, Benchmark ni BRD para analizar.",
    };
  }

  const heuristic = heuristicGovernancePatternIds(input);
  if (heuristic.length < FAST_PATH_MIN_PATTERNS) return null;

  return finalizeSuggestedIds(
    heuristic,
    "Preselección rápida desde Fase 0, Benchmark y BRD.",
  );
}

export async function suggestGovernancePatternIds(
  llm: BaseChatModel,
  input: SuggestGovernancePatternsInput,
): Promise<SuggestGovernancePatternsResult> {
  const fast = suggestGovernancePatternIdsFast(input);
  if (fast) return fast;

  const catalog = listGovernancePatternOptions();
  const validIds = new Set(catalog.map((o) => o.id));

  const catalogJson = JSON.stringify(
    catalog.map((o) => ({ id: o.id, label: o.label, group: o.group, affects: o.affects })),
  );

  const prompt = `Eres arquitecto de software. A partir de los documentos del proyecto (Fase 0 / DBGA, resumen de benchmark y BRD), preselecciona los patrones de desarrollo del catálogo que mejor encajan.

Reglas:
- Devuelve SOLO ids del catálogo (campo "id"), entre 3 y 12 patrones salvo proyecto trivial (mínimo 1).
- Prioriza coherencia con stack, integración, persistencia y estilo arquitectónico descritos.
- No inventes ids.

Catálogo (id, label, group, affects):
${catalogJson.slice(0, 24_000)}

### DBGA / Fase 0
${input.dbgaContent.slice(0, SLICE) || "(vacío)"}

### Resumen Benchmark / Paso 0
${input.phase0SummaryContent.slice(0, 4000) || "(vacío)"}

### BRD
${input.brdContent.slice(0, SLICE) || "(vacío)"}

Responde únicamente JSON: { "patternIds": string[], "rationale": string }`;

  try {
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const text = typeof response.content === "string" ? response.content : "";
    const jsonStr = extractFirstJsonObject(text);
    if (!jsonStr) {
      return finalizeSuggestedIds(
        heuristicGovernancePatternIds(input),
        "Preselección heurística (sin JSON del modelo).",
      );
    }
    const parsed = parseJsonOrThrow(jsonStr, responseSchema);
    const patternIds = parsed.patternIds.filter((id) => validIds.has(id));
    if (patternIds.length === 0) {
      return finalizeSuggestedIds(
        heuristicGovernancePatternIds(input),
        "Preselección heurística (ids inválidos del modelo).",
      );
    }
    return finalizeSuggestedIds(patternIds, parsed.rationale);
  } catch {
    return finalizeSuggestedIds(
      heuristicGovernancePatternIds(input),
      "Preselección heurística (error del modelo).",
    );
  }
}
