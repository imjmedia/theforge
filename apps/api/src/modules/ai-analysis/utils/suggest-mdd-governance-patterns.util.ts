/**
 * @fileoverview Sugerencias de patrones de gobernanza según contexto.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  heuristicGovernancePatternIds,
  listGovernancePatternOptions,
  rankGovernancePatternCandidates,
} from "@theforge/shared-types/mdd-governance-patterns";
import { resolveGovernancePatternIncompatibilities } from "@theforge/shared-types/mdd-governance-pattern-compat";
import { extractFirstJsonObject, parseJsonOrThrow } from "./parse-json.js";
import { extractGovernancePatternDocContext } from "./suggest-mdd-governance-patterns-context.util.js";

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

const SHORTLIST_MIN = 18;
const SHORTLIST_MAX = 28;

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

/** Catálogo acotado para el LLM: candidatos rankeados + grupos arquitectónicos base. */
export function buildGovernancePatternShortlist(input: SuggestGovernancePatternsInput): string[] {
  const catalog = listGovernancePatternOptions();
  const byId = new Map(catalog.map((o) => [o.id, o]));
  const ranked = rankGovernancePatternCandidates(input, { limit: SHORTLIST_MAX });
  const ids = new Set<string>(ranked.map((c) => c.id));

  for (const o of catalog) {
    if (/PATRONES DE ARQUITECTURA GLOBAL/i.test(o.group)) ids.add(o.id);
  }

  const padGroups = [
    /PERSISTENCIA/i,
    /INTEGRACIÓN/i,
    /COMPORTAMIENTO/i,
    /ESTRUCTURALES/i,
  ];
  for (const groupRe of padGroups) {
    if (ids.size >= SHORTLIST_MIN) break;
    for (const o of catalog) {
      if (!groupRe.test(o.group)) continue;
      ids.add(o.id);
      if (ids.size >= SHORTLIST_MIN) break;
    }
  }

  return [...ids]
    .filter((id) => byId.has(id))
    .slice(0, SHORTLIST_MAX);
}

export function buildGovernancePatternSelectionPrompt(input: SuggestGovernancePatternsInput): string {
  const shortlistIds = buildGovernancePatternShortlist(input);
  const catalog = listGovernancePatternOptions();
  const byId = new Map(catalog.map((o) => [o.id, o]));
  const shortlist = shortlistIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((o) => ({ id: o!.id, label: o!.label, group: o!.group }));

  const ranked = rankGovernancePatternCandidates(input, { limit: 12 });
  const seedHints =
    ranked.length > 0
      ? ranked
          .map((c) => `- ${c.id} (score ${c.score}: ${c.reasons.slice(0, 2).join(", ")})`)
          .join("\n")
      : "(sin candidatos fuertes; infiere del contexto)";

  const docContext = extractGovernancePatternDocContext(input);

  return `Eres arquitecto de software. Preselecciona patrones del catálogo SSOT que encajan con el proyecto descrito.

Reglas de precisión:
- Devuelve SOLO ids del catálogo acotado (campo "id"), entre 4 y 10 patrones (máximo 12).
- Prioriza stack, integraciones, persistencia, despliegue y estilo arquitectónico **explícitos** en el contexto.
- NO marques patrones GoF creacionales (Abstract Factory, Builder, Factory Method, Prototype, Singleton) salvo evidencia explícita de construcción de familias/objetos en código.
- "estrategia de inversión" o reglas de negocio ≠ patrón Strategy GoF; Strategy solo si hay algoritmos intercambiables en runtime.
- "evento" en audit log ≠ Event-Driven Architecture salvo mensajería/colas/broker como núcleo del sistema.
- "query" SQL o consultas de dominio ≠ CQRS salvo modelos de lectura/escritura separados.
- Elige monolito modular **o** microservicios como estilo global principal, no ambos.
- No inventes ids fuera del catálogo acotado.

Candidatos preliminares (pistas deterministas; valida y descarta falsos positivos):
${seedHints}

Catálogo acotado (${shortlist.length} opciones — id, label, group):
${JSON.stringify(shortlist)}

Contexto del proyecto (extracto arquitectónico compacto):
${docContext || "(vacío)"}

Responde únicamente JSON: { "patternIds": string[], "rationale": string }`;
}

/** Sin documentos: respuesta vacía inmediata (no LLM). */
export function suggestGovernancePatternIdsWithoutDocs(
  input: SuggestGovernancePatternsInput,
): SuggestGovernancePatternsResult | null {
  if (hasSuggestableDocs(input)) return null;
  return {
    patternIds: [],
    rationale: "No hay documentos de Fase 0, Benchmark ni BRD para analizar.",
  };
}

export async function suggestGovernancePatternIds(
  llm: BaseChatModel,
  input: SuggestGovernancePatternsInput,
): Promise<SuggestGovernancePatternsResult> {
  const empty = suggestGovernancePatternIdsWithoutDocs(input);
  if (empty) return empty;

  const catalog = listGovernancePatternOptions();
  const validIds = new Set(buildGovernancePatternShortlist(input));
  const prompt = buildGovernancePatternSelectionPrompt(input);

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
        "Preselección heurística (ids inválidos o fuera del catálogo acotado).",
      );
    }
    return finalizeSuggestedIds(
      patternIds,
      parsed.rationale ?? "Preselección con IA a partir de Fase 0, Benchmark y BRD.",
    );
  } catch {
    return finalizeSuggestedIds(
      heuristicGovernancePatternIds(input),
      "Preselección heurística (error del modelo).",
    );
  }
}

/** @deprecated Alias interno; usar suggestGovernancePatternIdsWithoutDocs. */
export const suggestGovernancePatternIdsFast = suggestGovernancePatternIdsWithoutDocs;

export function buildGovernancePatternPromptStats(input: SuggestGovernancePatternsInput): {
  promptChars: number;
  shortlistSize: number;
  docContextChars: number;
  legacyCatalogChars: number;
} {
  const prompt = buildGovernancePatternSelectionPrompt(input);
  const docContext = extractGovernancePatternDocContext(input);
  const legacyCatalog = JSON.stringify(
    listGovernancePatternOptions().map((o) => ({
      id: o.id,
      label: o.label,
      group: o.group,
      affects: o.affects,
    })),
  ).slice(0, 24_000);
  return {
    promptChars: prompt.length,
    shortlistSize: buildGovernancePatternShortlist(input).length,
    docContextChars: docContext.length,
    legacyCatalogChars: legacyCatalog.length,
  };
}
