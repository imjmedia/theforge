/**
 * Compact DBGA extract for Clarifier prompts — avoids dumping full benchmark text.
 * Never blind slice(0, N) as the only strategy: narrative head + structural signals.
 */

import type { DomainInventory } from "@theforge/shared-types";
import { formatDomainInventoryForPrompt } from "../../engine/domain-inventory.util.js";

/** Total DBGA brief budget (narrative + signals; inventory/stack are separate blocks). */
export const DEFAULT_CLARIFIER_DBGA_BRIEF_MAX_CHARS = 8_000;

/** Narrative head budget for objective/scope/out-of-scope H2s. */
const NARRATIVE_BUDGET_CHARS = 3_000;

/** Mid/end structural signals (headings + one-liners). */
const SIGNALS_BUDGET_CHARS = 2_500;

const NARRATIVE_H2_RE =
  /^(?:objetivo|objective|alcance|scope|contexto|context|fuera\s+de\s+alcance|out\s+of\s+scope|stakeholders?|usuarios?|criterios?\s+de\s+[ée]xito|success\s+criteria|problema|problem|visi[oó]n|resumen\s+ejecutivo)/i;

const SIGNAL_H_RE =
  /^(?:\d+\.?\s*)?(?:capacidad|capacidades|entidad|entidades|tabla|tablas|matriz|flujo|flujos|integraci[oó]n|api|endpoint|requisito|funcional|proceso|journey|user\s+story|historia|competidor|benchmark|stack|tecnolog)/i;

export type BuildClarifierDbgaBriefParams = {
  dbgaContent: string;
  /** When provided, included in returned meta (inventory is injected separately in the node). */
  inventory?: DomainInventory;
  maxChars?: number;
};

export type ClarifierDbgaBriefResult = {
  brief: string;
  briefChars: number;
  usedFullDbga: boolean;
  narrativeChars: number;
  signalsChars: number;
};

function extractH2Sections(md: string): Array<{ title: string; body: string; start: number }> {
  const sections: Array<{ title: string; body: string; start: number }> = [];
  const headingRe = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const headings: Array<{ title: string; start: number }> = [];
  while ((match = headingRe.exec(md)) !== null) {
    headings.push({ title: (match[1] ?? "").trim(), start: match.index });
  }
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const end = i + 1 < headings.length ? headings[i + 1]!.start : md.length;
    const body = md.slice(h.start, end).replace(/^##\s+.+$/m, "").trim();
    sections.push({ title: h.title, body, start: h.start });
  }
  return sections;
}

function extractH3Signals(md: string): Array<{ title: string; line: string }> {
  const signals: Array<{ title: string; line: string }> = [];
  const headingRe = /^###\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(md)) !== null) {
    const title = (match[1] ?? "").trim();
    if (!title || !SIGNAL_H_RE.test(title)) continue;
    const after = md.slice(match.index + match[0].length);
    const firstLine =
      after
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !/^#{1,6}\s/.test(l)) ?? "";
    const oneLiner = firstLine.replace(/\*\*/g, "").slice(0, 140).trim();
    signals.push({ title, line: oneLiner || "(ver DBGA)" });
  }
  return signals;
}

function demoteHeadingsForSection1Embed(text: string): string {
  return (text ?? "")
    .replace(/^#### /gm, "##### ")
    .replace(/^### /gm, "#### ")
    .replace(/^## /gm, "### ");
}

function buildNarrativeHead(sections: Array<{ title: string; body: string }>, budget: number): string {
  const picked: string[] = [];
  let used = 0;
  for (const s of sections) {
    if (!NARRATIVE_H2_RE.test(s.title.replace(/^\d+\.?\s*/, ""))) continue;
    const block = `### ${s.title}\n\n${s.body}`.trim();
    if (used + block.length > budget && picked.length > 0) {
      const remaining = budget - used - 40;
      if (remaining > 200) {
        picked.push(`### ${s.title}\n\n${s.body.slice(0, remaining)}…`);
      }
      break;
    }
    picked.push(block);
    used += block.length + 2;
    if (used >= budget) break;
  }
  if (picked.length === 0 && sections.length > 0) {
    const first = sections[0]!;
    const block = `### ${first.title}\n\n${first.body}`.trim();
    return block.length <= budget ? block : block.slice(0, budget) + "…";
  }
  return picked.join("\n\n");
}

function buildStructuralSignals(
  sections: Array<{ title: string; body: string }>,
  h3Signals: Array<{ title: string; line: string }>,
  budget: number,
): string {
  const lines: string[] = ["**Señales estructurales DBGA (resumen):**"];
  let used = lines[0]!.length;

  for (const s of sections) {
    const title = s.title.replace(/^\d+\.?\s*/, "");
    if (!SIGNAL_H_RE.test(title)) continue;
    const firstLine =
      s.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    const oneLiner = `- **${title}:** ${firstLine.replace(/\*\*/g, "").slice(0, 120) || "(ver DBGA)"}`;
    if (used + oneLiner.length > budget) break;
    lines.push(oneLiner);
    used += oneLiner.length + 1;
  }

  for (const sig of h3Signals) {
    const oneLiner = `- **${sig.title}:** ${sig.line}`;
    if (used + oneLiner.length > budget) break;
    if (lines.some((l) => l.includes(sig.title))) continue;
    lines.push(oneLiner);
    used += oneLiner.length + 1;
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Builds a compact DBGA brief for Clarifier input.
 * Returns full DBGA when already under budget.
 */
export function buildClarifierDbgaBrief(params: BuildClarifierDbgaBriefParams): ClarifierDbgaBriefResult {
  const dbga = (params.dbgaContent ?? "").trim();
  const maxChars = params.maxChars ?? DEFAULT_CLARIFIER_DBGA_BRIEF_MAX_CHARS;

  if (!dbga) {
    return { brief: "", briefChars: 0, usedFullDbga: true, narrativeChars: 0, signalsChars: 0 };
  }

  if (dbga.length <= maxChars) {
    return {
      brief: dbga,
      briefChars: dbga.length,
      usedFullDbga: true,
      narrativeChars: dbga.length,
      signalsChars: 0,
    };
  }

  const sections = extractH2Sections(dbga);
  const h3Signals = extractH3Signals(dbga);
  const narrative = buildNarrativeHead(sections, NARRATIVE_BUDGET_CHARS);
  const signals = buildStructuralSignals(sections, h3Signals, SIGNALS_BUDGET_CHARS);

  const parts = [
    "**DBGA (extracto — fidelidad al benchmark; inventario de dominio aparte):**",
    narrative,
    signals,
  ].filter(Boolean);

  let brief = parts.join("\n\n").trim();
  if (brief.length > maxChars) {
    brief = brief.slice(0, maxChars) + "\n…[DBGA extracto truncado]";
  }

  return {
    brief,
    briefChars: brief.length,
    usedFullDbga: false,
    narrativeChars: narrative.length,
    signalsChars: signals.length,
  };
}

/** Inventory block sized for Clarifier (KMS-scale). */
export function formatClarifierDomainInventory(inventory: DomainInventory): string {
  return formatDomainInventoryForPrompt(inventory, 4_800);
}

/**
 * Source text for §1 hydration when LLM draft is insubstantial.
 * Prefers clarifiedScope; falls back to DBGA brief (not blind slice).
 */
export function buildDbgaHydrationSource(params: {
  clarifiedScope: string;
  dbgaContent: string;
  minScopeLen?: number;
  maxHydrationChars?: number;
}): string {
  const scope = (params.clarifiedScope ?? "").trim();
  const minScopeLen = params.minScopeLen ?? 200;
  const maxChars = params.maxHydrationChars ?? 12_000;

  if (scope.length >= minScopeLen) {
    return scope.length <= maxChars ? scope : scope.slice(0, maxChars);
  }

  const { brief } = buildClarifierDbgaBrief({
    dbgaContent: params.dbgaContent,
    maxChars: Math.min(maxChars, DEFAULT_CLARIFIER_DBGA_BRIEF_MAX_CHARS),
  });
  const fallback = brief || (params.dbgaContent ?? "").trim();
  const normalized = demoteHeadingsForSection1Embed(fallback);
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);
}
