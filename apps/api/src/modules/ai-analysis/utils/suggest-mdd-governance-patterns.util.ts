/**
 * @fileoverview Sugerencias de patrones de gobernanza según contexto.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { listGovernancePatternOptions } from "@theforge/shared-types/mdd-governance-patterns";
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

const SLICE = 12_000;

function heuristicPatternIds(input: SuggestGovernancePatternsInput): string[] {
  const blob = `${input.dbgaContent}\n${input.phase0SummaryContent}\n${input.brdContent}`.toLowerCase();
  const opts = listGovernancePatternOptions();
  const hits = new Set<string>();
  for (const o of opts) {
    const tokens = o.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 4);
    if (tokens.some((t) => blob.includes(t))) hits.add(o.id);
  }
  if (hits.size === 0 && /microservicio|microservice/.test(blob)) {
    const ms = opts.find((o) => o.label.toLowerCase().includes("microservicio"));
    if (ms) hits.add(ms.id);
  }
  if (hits.size === 0 && /hexagonal|ports?\s*&\s*adapters?/.test(blob)) {
    const hx = opts.find((o) => o.label.toLowerCase().includes("hexagonal"));
    if (hx) hits.add(hx.id);
  }
  if (hits.size === 0 && /monolito|monolith/.test(blob)) {
    const mo = opts.find((o) => o.label.toLowerCase().includes("monolito"));
    if (mo) hits.add(mo.id);
  }
  if (hits.size === 0) {
    const repo = opts.find((o) => o.id === "repository");
    if (repo) hits.add(repo.id);
  }
  return [...hits].slice(0, 12);
}

export async function suggestGovernancePatternIds(
  llm: BaseChatModel,
  input: SuggestGovernancePatternsInput,
): Promise<SuggestGovernancePatternsResult> {
  const catalog = listGovernancePatternOptions();
  const validIds = new Set(catalog.map((o) => o.id));
  const hasDocs =
    input.dbgaContent.trim().length > 0 ||
    input.phase0SummaryContent.trim().length > 0 ||
    input.brdContent.trim().length > 0;

  if (!hasDocs) {
    return { patternIds: [], rationale: "No hay documentos de Fase 0, Benchmark ni BRD para analizar." };
  }

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
        heuristicPatternIds(input),
        "Preselección heurística (sin JSON del modelo).",
      );
    }
    const parsed = parseJsonOrThrow(jsonStr, responseSchema);
    const patternIds = parsed.patternIds.filter((id) => validIds.has(id));
    if (patternIds.length === 0) {
      return finalizeSuggestedIds(
        heuristicPatternIds(input),
        "Preselección heurística (ids inválidos del modelo).",
      );
    }
    return finalizeSuggestedIds(patternIds, parsed.rationale);
  } catch {
    return finalizeSuggestedIds(
      heuristicPatternIds(input),
      "Preselección heurística (error del modelo).",
    );
  }
}
