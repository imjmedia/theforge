/**
 * @fileoverview Compacta DBGA / Fase 0 / BRD para el prompt LLM del wizard SSOT.
 */

import { BUILTIN_EXTERNAL_INTEGRATIONS, peelDocumentBodyForPersist } from "@theforge/shared-types";
import type { SuggestGovernancePatternsInput } from "./suggest-mdd-governance-patterns.util.js";

const RELEVANT_HEADING_RE =
  /arquitectura|stack|integraci|persisten|infra|multi[- ]tenant|tenant|redis|websocket|llm|batch|gateway|api|datos|seguridad|resilien|cola|microservicio|monolito|despliegue|orquestador|tiempo real|real[- ]time|backend|frontend|capas|dominio|middleware|mensajer/i;

const KEYWORD_LINE_RE =
  /\b(nestjs|postgres|prisma|redis|websocket|socket\.io|multi[- ]tenant|microservicio|monolito|docker|kubernetes|rabbitmq|bullmq|kafka|jwt|oauth|stripe|langgraph|langchain|llm|graphql|grpc|cqrs|event sourcing|outbox|saga|circuit breaker|api gateway|repository|hexagonal|clean architecture|angular|vue|next\.js)\b/i;

const MAX_PHASE0_CHARS = 5_000;
const MAX_SECTION_CHARS = 2_500;
const MAX_KEYWORD_SNIPPET_CHARS = 1_200;
const MAX_TOTAL_DOC_CHARS = 7_500;

function stripDocStamp(md: string): string {
  return peelDocumentBodyForPersist((md ?? "").trim());
}

/** Extrae secciones ## relevantes y líneas con keywords de stack/arquitectura. */
export function extractGovernancePatternDocContext(input: SuggestGovernancePatternsInput): string {
  const parts: string[] = [];

  const phase0 = stripDocStamp(input.phase0SummaryContent);
  if (phase0) {
    parts.push(
      "### Resumen Fase 0 / Benchmark\n" + phase0.slice(0, MAX_PHASE0_CHARS),
    );
  }

  for (const [label, raw] of [
    ["DBGA / Fase 0", input.dbgaContent],
    ["BRD", input.brdContent],
  ] as const) {
    const body = stripDocStamp(raw);
    if (!body) continue;

    const sections = body.split(/^##\s+/m).filter(Boolean);
    for (const section of sections) {
      const headingLine = section.split("\n")[0]?.trim() ?? "";
      if (!RELEVANT_HEADING_RE.test(headingLine)) continue;
      parts.push(`### ${label} — ${headingLine}\n${section.slice(headingLine.length).trim().slice(0, MAX_SECTION_CHARS)}`);
    }

    const keywordLines = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 20 && KEYWORD_LINE_RE.test(line));
    if (keywordLines.length > 0) {
      parts.push(
        `### ${label} — señales técnicas\n${keywordLines.slice(0, 12).join("\n").slice(0, MAX_KEYWORD_SNIPPET_CHARS)}`,
      );
    }

    const mermaidBlocks = [...body.matchAll(/```mermaid[\s\S]*?```/gi)].map((m) => m[0]);
    if (mermaidBlocks.length > 0) {
      parts.push(
        `### ${label} — diagramas\n${mermaidBlocks.slice(0, 2).join("\n\n").slice(0, MAX_SECTION_CHARS)}`,
      );
    }
  }

  const corpus = [input.dbgaContent, input.phase0SummaryContent, input.brdContent].join("\n");
  const integrations = BUILTIN_EXTERNAL_INTEGRATIONS.filter((sig) =>
    new RegExp(sig.scopePattern, "i").test(corpus),
  ).map((sig) => `- ${sig.label} (${sig.id})`);
  if (integrations.length > 0) {
    parts.push(`### Integraciones detectadas en alcance\n${integrations.join("\n")}`);
  }

  return parts.join("\n\n").slice(0, MAX_TOTAL_DOC_CHARS);
}

export function estimateGovernancePatternPromptChars(prompt: string): number {
  return prompt.length;
}
