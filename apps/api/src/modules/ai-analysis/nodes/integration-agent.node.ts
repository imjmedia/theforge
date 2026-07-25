/**
 * @fileoverview Integración de handoff-spec con IntegrationAgent.
 */

/**
 * IntegrationAgent — redactor node (Plan-then-Execute).
 *
 * NOTE: this is NOT a LangGraph StateGraph node. The handoff-spec.md is a *separate*
 * deliverable (not part of the MDD draft), so the agent runs as a dedicated redactor
 * invoked by `IntegrationAgentService` (on user "Sincronizar Especificación de Handoff"
 * or via the Manager intent hook). It keeps the `*.node.ts` naming for consistency with
 * the agent catalog and lives in `ai-analysis/nodes` per the agent module convention.
 *
 * Governance ("Regla de Oro"): the agent ONLY structures and technically deepens the
 * NEW-LEG handoff items already registered by the user. It never invents items.
 */

import type { IntegrationHandoffItem } from "@theforge/shared-types";
import type { LLMProvider } from "../../ai/interfaces/llm-provider.interface.js";
import { INTEGRATION_AGENT_PROMPT } from "../../ai/prompts/integration-agent-prompt.js";
import type { TheForgeService } from "../../theforge/theforge.service.js";

/** Evidence gathered from AriadneSpecs (the legacy knowledge graph) for one handoff item. */
export interface HandoffItemEvidence {
  newLegId: string;
  /** Candidate symbols/nodes the agent probed in the graph. */
  probedSymbols: string[];
  /** Concatenated tool output (validate_before_edit / get_contract_specs / semantic_search). */
  evidence: string;
}

export interface IntegrationAgentInput {
  llm: LLMProvider;
  /** Null when TheForge MCP is not configured or the project is not legacy-linked. */
  theforge: TheForgeService | null;
  /** Stored TheForge project id for the LEGACY repo (resolves to graph project internally). */
  theforgeProjectId?: string | null;
  items: IntegrationHandoffItem[];
  legacyProjectName: string;
  newProjectName?: string | null;
  /** MDD §3 (data model) excerpt for the active stage. */
  mddSection3?: string;
  /** MDD §4 (API / contracts) excerpt for the active stage. */
  mddSection4?: string;
  /**
   * NEW project's API contracts (and §4 excerpt) where the proposed endpoints are defined.
   * The redactor must cite the exact method+path from here instead of writing "el endpoint del microservicio".
   */
  newApiContext?: string;
  /** AS-IS legacy context block (optional). */
  asIsContext?: string;
}

export interface IntegrationAgentResult {
  markdown: string;
  evidence: HandoffItemEvidence[];
  /** Items that produced no graph evidence (flagged for manual verification in the doc). */
  itemsWithoutEvidence: string[];
}

const MAX_ITEMS_PROBED = 12;
const MAX_SYMBOLS_PER_ITEM = 2;
const MAX_EVIDENCE_CHARS_PER_ITEM = 3600;
const MAX_ASK_CODEBASE_CHARS = 1800;
const MAX_SEMANTIC_CHARS = 1200;
const MAX_VALIDATE_CHARS = 1200;

/** PascalCase / camelCase identifiers and back-tick / quoted symbols from free text. */
export function extractCandidateSymbols(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  const quoted = text.match(/[`"']([A-Za-z_][\w.]{2,60})[`"']/g);
  if (quoted) {
    for (const q of quoted) {
      const inner = q.slice(1, -1).trim();
      if (inner) found.add(inner);
    }
  }

  const pascal = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g);
  if (pascal) pascal.forEach((n) => found.add(n));

  const suffixed = text.match(
    /\b[A-Za-z][A-Za-z0-9]*(?:Controller|Service|Component|Repository|Entity|Model|Dto|Endpoint|Schema|Table|Field|Module|Resolver|Handler)\b/g,
  );
  if (suffixed) suffixed.forEach((n) => found.add(n));

  return [...found].slice(0, MAX_SYMBOLS_PER_ITEM);
}

const KEYWORD_STOPWORDS = new Set([
  "para",
  "desde",
  "como",
  "cada",
  "este",
  "esta",
  "esto",
  "debe",
  "deben",
  "sobre",
  "entre",
  "donde",
  "cuando",
  "todos",
  "todas",
  "asociados",
  "asociadas",
  "nuevo",
  "nueva",
  "visualizacion",
  "configuracion",
]);

/**
 * Domain keywords for `semantic_search`: snake_case identifiers (e.g. `medio_costo`, `catalogo_costos`),
 * API path segments, and significant nouns. Complements `extractCandidateSymbols` (PascalCase only),
 * which misses data-model tokens that matter for §3 (¿existe la tabla X?).
 */
export function extractDomainKeywords(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  const snake = text.match(/\b[a-z][a-z0-9]+_[a-z0-9_]+\b/g);
  if (snake) snake.forEach((s) => found.add(s));

  const pathSegments = text.match(/\/[a-z][a-z0-9-]{2,}(?:\/[a-z0-9{}-]+)*/gi);
  if (pathSegments) {
    for (const p of pathSegments) {
      p.split("/")
        .map((seg) => seg.replace(/[{}]/g, "").trim())
        .filter((seg) => seg.length >= 3 && !/^v\d+$/i.test(seg) && seg !== "api")
        .forEach((seg) => found.add(seg));
    }
  }

  const words = text.toLowerCase().match(/\b[a-záéíóúñ][a-záéíóúñ0-9]{4,}\b/gi);
  if (words) {
    for (const w of words) {
      const lw = w.toLowerCase();
      if (!KEYWORD_STOPWORDS.has(lw)) found.add(lw);
    }
  }

  return [...found].slice(0, 8);
}

/** Targeted ask_codebase question to ground §3 (model) and §4 (API) impact for one item. */
export function buildItemQuestion(item: IntegrationHandoffItem, legacyProjectName: string): string {
  return [
    `En el sistema legacy "${legacyProjectName}", analiza el impacto técnico de este requerimiento propuesto por el equipo nuevo:`,
    `"${item.title}". ${item.description}`,
    "Responde con evidencia del código y el modelo de datos indexados:",
    "1) ¿Qué tablas, columnas o relaciones EXISTENTES están implicadas? ¿Ya existe una relación/tabla para esto o hay que crearla?",
    "2) ¿Qué endpoints, servicios o contratos actuales se ven afectados o deben crearse?",
    "3) ¿Qué archivos/símbolos concretos son los puntos de integración?",
    "Si algo NO existe en el código indexado, dilo explícitamente en lugar de suponerlo.",
  ].join("\n");
}

/**
 * EXECUTE phase: probe the legacy graph for the real technical impact of one item, combining
 * several AriadneSpecs tools so the redactor can ground §3/§4 instead of guessing:
 * - `ask_codebase`: natural-language Q&A (best for "¿existe la tabla/relación X?").
 * - `semantic_search`: domain keywords incl. snake_case table-like tokens.
 * - `validate_before_edit`: per PascalCase symbol detected in the item text.
 * All tools run in parallel and failures degrade gracefully (empty evidence → flagged in the doc).
 */
async function gatherEvidenceForItem(
  item: IntegrationHandoffItem,
  theforge: TheForgeService,
  theforgeProjectId: string,
  legacyProjectName: string,
): Promise<HandoffItemEvidence> {
  const itemText = `${item.title}\n${item.description}`;
  const symbols = extractCandidateSymbols(itemText);
  const keywords = extractDomainKeywords(itemText);

  const askPromise = (async () => {
    try {
      const out = await theforge.askCodebase(buildItemQuestion(item, legacyProjectName), theforgeProjectId);
      const t = out?.trim();
      return t ? `#### ask_codebase\n${t.slice(0, MAX_ASK_CODEBASE_CHARS)}` : "";
    } catch {
      return "";
    }
  })();

  const semanticPromise = (async () => {
    try {
      const query = (keywords.length ? keywords.join(" ") : `${item.title} ${item.description}`).slice(0, 240);
      const out = await theforge.semanticSearch(query, theforgeProjectId, 6);
      const t = out?.trim();
      return t ? `#### semantic_search (${keywords.join(", ") || "—"})\n${t.slice(0, MAX_SEMANTIC_CHARS)}` : "";
    } catch {
      return "";
    }
  })();

  const validatePromises = symbols.map(async (symbol) => {
    try {
      const out = await theforge.validateBeforeEdit(symbol, theforgeProjectId);
      const t = out?.trim();
      return t ? `#### validate_before_edit(${symbol})\n${t.slice(0, MAX_VALIDATE_CHARS)}` : "";
    } catch {
      return "";
    }
  });

  const results = await Promise.all([askPromise, semanticPromise, ...validatePromises]);
  const evidence = results.filter(Boolean).join("\n\n").slice(0, MAX_EVIDENCE_CHARS_PER_ITEM);
  return { newLegId: item.id, probedSymbols: [...symbols, ...keywords], evidence };
}

function renderItemBlock(item: IntegrationHandoffItem, ev: HandoffItemEvidence | undefined): string {
  const lines: string[] = [];
  lines.push(`### ${item.id} — ${item.title}`);
  lines.push(`- **Propuesta (NEW):** ${item.description}`);
  if (item.actor) lines.push(`- **Actor:** ${item.actor}`);
  if (item.acceptanceCriteria?.length) {
    lines.push(`- **Criterios de aceptación (propuestos):**`);
    item.acceptanceCriteria.forEach((c) => lines.push(`  - ${c}`));
  }
  if (item.legacyStoryId) lines.push(`- **Historia legacy enlazada:** ${item.legacyStoryId}`);
  if (ev?.evidence?.trim()) {
    lines.push(`- **Evidencia AriadneSpecs** (símbolos: ${ev.probedSymbols.join(", ") || "—"}):`);
    lines.push("");
    lines.push(ev.evidence.trim());
  } else {
    lines.push(`- **Evidencia AriadneSpecs:** Sin evidencia en el grafo — requiere verificación manual.`);
  }
  return lines.join("\n");
}

/** Builds the context block appended below the system prompt for the LLM redactor. */
export function buildIntegrationAgentContext(
  input: IntegrationAgentInput,
  evidence: HandoffItemEvidence[],
): string {
  const evByItem = new Map(evidence.map((e) => [e.newLegId, e]));
  const sections: string[] = [];

  sections.push(`## PROYECTOS`);
  sections.push(`- LEGACY (destino): ${input.legacyProjectName}`);
  if (input.newProjectName) sections.push(`- NEW (origen de las propuestas): ${input.newProjectName}`);

  if (input.mddSection3?.trim()) {
    sections.push(`## MDD §3 — Modelo de Datos (etapa activa)\n${input.mddSection3.trim()}`);
  }
  if (input.mddSection4?.trim()) {
    sections.push(`## MDD §4 — API / Contratos (etapa activa)\n${input.mddSection4.trim()}`);
  }
  if (input.newApiContext?.trim()) {
    sections.push(
      `## CONTRATOS DE API DEL PROYECTO NEW (fuente de endpoints — cita el método y ruta EXACTOS)\n${input.newApiContext.trim()}`,
    );
  }
  if (input.asIsContext?.trim()) {
    sections.push(`## Contexto AS-IS del legacy\n${input.asIsContext.trim()}`);
  }

  sections.push(`## MATRIZ DE TRAZABILIDAD — Items NEW-LEG (alcance cerrado, NO inventar)`);
  for (const item of input.items) {
    sections.push(renderItemBlock(item, evByItem.get(item.id)));
  }

  sections.push(
    `## INSTRUCCIÓN\nRedacta el documento \`handoff-spec.md\` siguiendo el formato definido arriba. Usa exclusivamente los ${input.items.length} item(s) listados y su evidencia. No agregues items nuevos.`,
  );

  return sections.join("\n\n");
}

/**
 * PLAN → EXECUTE → SYNTHESIZE. Returns the handoff-spec markdown.
 * When there are no items, returns a minimal placeholder (governance: nothing to structure).
 */
export async function runIntegrationAgent(input: IntegrationAgentInput): Promise<IntegrationAgentResult> {
  const items = input.items.slice(0, MAX_ITEMS_PROBED);

  if (items.length === 0) {
    return {
      markdown: `# Handoff Spec — ${input.legacyProjectName}\n\n> No hay items NEW-LEG registrados en la pestaña de Integración para esta etapa. El IntegrationAgent no crea items por su cuenta: registra los cambios propuestos en la Matriz de Trazabilidad y vuelve a sincronizar.`,
      evidence: [],
      itemsWithoutEvidence: [],
    };
  }

  // EXECUTE: gather graph evidence per item (only when the MCP is configured).
  let evidence: HandoffItemEvidence[] = [];
  const canProbe = !!input.theforge?.isConfigured() && !!input.theforgeProjectId?.trim();
  if (canProbe) {
    const tfPid = input.theforgeProjectId!.trim();
    evidence = await Promise.all(
      items.map((item) => gatherEvidenceForItem(item, input.theforge!, tfPid, input.legacyProjectName)),
    );
  }

  const itemsWithoutEvidence = items
    .filter((item) => !evidence.find((e) => e.newLegId === item.id)?.evidence?.trim())
    .map((item) => item.id);

  // SYNTHESIZE: LLM redactor with the closed-scope context.
  const context = buildIntegrationAgentContext({ ...input, items }, evidence);
  const raw = await input.llm.generateResponse(context, [], {
    systemPrompt: INTEGRATION_AGENT_PROMPT,
  });

  return {
    markdown: (raw ?? "").trim(),
    evidence,
    itemsWithoutEvidence,
  };
}
