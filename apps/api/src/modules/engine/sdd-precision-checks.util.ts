/**
 * Validadores deterministas de precisión SDD (cross-artifact).
 */

import {
  extractBlueprintPhases,
  extractMddCoreServices,
  extractMddTableColumns,
  extractOpenResearchGaps,
  extractResearchMandatories,
} from "./sdd-coverage-checklist.util.js";
import type { CrossArtifactCheckResult } from "./sdd-cross-artifact.util.js";
import {
  mddRequiresEventBrokerContracts,
  resolveMessagingBrokerFromMddSection2,
} from "./messaging-broker.util.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { isChatLlmPlatformScope } from "./mdd-platform-table-strip.util.js";

function substantial(s: string | null | undefined, min = 48): boolean {
  return typeof s === "string" && s.trim().length >= min;
}

function serviceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(engine|service|gateway|orchestrator)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mentionedInCorpus(token: string, corpus: string): boolean {
  const c = corpus.toLowerCase();
  const t = token.toLowerCase();
  if (c.includes(t)) return true;
  const slug = serviceSlug(token);
  if (slug.length > 2 && (c.includes(slug) || c.includes(`modules/${slug}`))) return true;
  const words = t.split(/\s+/).filter((w) => w.length > 3);
  const hits = words.filter((w) => c.includes(w));
  return hits.length >= Math.max(1, Math.ceil(words.length * 0.6));
}

/** Servicios MDD §2 deben aparecer en árbol modules/ de architecture. */
export function checkArchitectureVsMdd(
  mdd: string | null | undefined,
  architecture: string | null | undefined,
): CrossArtifactCheckResult {
  if (!substantial(mdd, 200) || !substantial(architecture)) {
    return { ok: true, gaps: [] };
  }
  const services = extractMddCoreServices(mdd!);
  const gaps: string[] = [];
  const arch = architecture!.toLowerCase();
  for (const svc of services) {
    if (!mentionedInCorpus(svc, arch)) {
      gaps.push(`[Architecture] Servicio core MDD §2 «${svc}» no aparece en vista de módulos`);
    }
  }
  return { ok: gaps.length === 0, gaps: gaps.slice(0, 12) };
}

/** Columnas UNIQUE/NOT NULL §3 deben tener task de migración. */
export function checkTasksEntityMigrations(
  mdd: string | null | undefined,
  tasks: string | null | undefined,
): CrossArtifactCheckResult {
  if (!substantial(mdd, 120) || !substantial(tasks, 24)) return { ok: true, gaps: [] };
  const cols = extractMddTableColumns(mdd!);
  const tasksLower = tasks!.toLowerCase();
  const gaps: string[] = [];
  for (const col of cols) {
    const hasCol = tasksLower.includes(col.column);
    const hasTable = tasksLower.includes(col.table);
    const hasMigrationKeyword =
      tasksLower.includes("migration") ||
      tasksLower.includes("typeorm") ||
      tasksLower.includes("prisma") ||
      tasksLower.includes("migrat");
    const mentionsEntity = hasCol || (hasTable && hasMigrationKeyword);
    const hasMigration = hasMigrationKeyword && mentionsEntity && (hasCol || hasTable);
    if (!hasMigration && (col.unique || col.notNull)) {
      gaps.push(
        `[Tasks] Falta task de migración para ${col.table}.${col.column} (${col.unique ? "UNIQUE" : ""}${col.notNull ? " NOT NULL" : ""})`.trim(),
      );
    }
  }
  return { ok: gaps.length === 0, gaps: gaps.slice(0, 12) };
}

/** Fases blueprint §7 deben reflejarse en tasks. */
export function checkTasksBlueprintPhases(
  blueprint: string | null | undefined,
  tasks: string | null | undefined,
): CrossArtifactCheckResult {
  if (!substantial(blueprint) || !substantial(tasks)) return { ok: true, gaps: [] };
  const phases = extractBlueprintPhases(blueprint!);
  if (phases.length === 0) return { ok: true, gaps: [] };
  const tasksLower = tasks!.toLowerCase();
  const gaps: string[] = [];
  for (const phase of phases) {
    const numMatch = phase.match(/fase\s+(\d+)/i);
    const num = numMatch?.[1];
    const covered =
      tasksLower.includes(phase.toLowerCase()) ||
      (num != null && (tasksLower.includes(`fase ${num}`) || tasksLower.includes(`phase ${num}`)));
    if (!covered) {
      gaps.push(`[Tasks] Blueprint ${phase} sin sección o checkpoint en tasks.md`);
    }
  }
  return { ok: gaps.length === 0, gaps: gaps.slice(0, 10) };
}

interface SchedulerSpec {
  source: string;
  time?: string;
  timezone?: string;
  days?: string;
}

function extractSchedulerSpecs(label: string, content: string): SchedulerSpec[] {
  const specs: SchedulerSpec[] = [];
  const corpus = content;
  for (const m of corpus.matchAll(/(\d{1,2}:\d{2})\s*(CST|UTC|EST|PST|America\/[^\s,)]+)/gi)) {
    specs.push({ source: label, time: m[1], timezone: m[2] });
  }
  for (const m of corpus.matchAll(/cron[^\n]*?(\d{1,2}:\d{2}|22:00|08:00)[^\n]*/gi)) {
    specs.push({ source: label, time: m[1] });
  }
  const dayMatch = corpus.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes|monday|tuesday|thursday)[^\n]{0,40}(martes|jueves|tuesday|thursday)/gi);
  if (dayMatch) {
    for (const d of dayMatch) specs.push({ source: label, days: d.trim() });
  }
  if (/martes\s*\/\s*jueves|martes\/jueves/i.test(corpus)) {
    specs.push({ source: label, days: "martes/jueves" });
  }
  if (/lunes/i.test(corpus) && !/martes/i.test(corpus.slice(0, corpus.indexOf("lunes") + 20))) {
    specs.push({ source: label, days: "lunes" });
  }
  return specs;
}

/** Detecta conflictos de horario/timezone/días entre artefactos. */
export function checkSchedulerConsistency(
  mdd: string | null | undefined,
  logicFlows: string | null | undefined,
  userStories: string | null | undefined,
): CrossArtifactCheckResult {
  const parts: SchedulerSpec[] = [];
  if (mdd?.trim()) parts.push(...extractSchedulerSpecs("MDD", mdd));
  if (logicFlows?.trim()) parts.push(...extractSchedulerSpecs("logic-flows", logicFlows));
  if (userStories?.trim()) parts.push(...extractSchedulerSpecs("user-stories", userStories));

  const gaps: string[] = [];
  const times = new Set(parts.map((p) => `${p.time ?? ""}|${p.timezone ?? ""}`).filter((t) => t !== "|"));
  if (times.size > 1) {
    gaps.push(`[Scheduler] Horarios distintos: ${[...times].join(" vs ")}`);
  }
  const daySpecs = parts.filter((p) => p.days).map((p) => `${p.source}:${p.days}`);
  const hasMarJue = daySpecs.some((d) => /martes|jueves/i.test(d));
  const hasLunes = daySpecs.some((d) => /lunes|monday/i.test(d) && !/martes|jueves/i.test(d));
  if (hasMarJue && hasLunes) {
    gaps.push("[Scheduler] Conflicto de días: lunes vs martes/jueves entre artefactos");
  }
  const tzs = new Set(parts.map((p) => (p.timezone ?? "").toUpperCase()).filter(Boolean));
  if (tzs.has("CST") && tzs.has("UTC")) {
    gaps.push("[Scheduler] Conflicto timezone CST vs UTC — unificar en logic-flows § Scheduler canónico");
  }
  return { ok: gaps.length === 0, gaps };
}

/** Open gaps de research deben mencionarse en tasks o MDD §5. */
export function checkResearchGapsInTasks(
  phase0Summary: string | null | undefined,
  tasks: string | null | undefined,
  mdd: string | null | undefined,
): CrossArtifactCheckResult {
  const research = (phase0Summary ?? "").trim();
  if (!research) return { ok: true, gaps: [] };
  const openGaps = extractOpenResearchGaps(research);
  if (openGaps.length === 0) return { ok: true, gaps: [] };
  const corpus = `${tasks ?? ""}\n${mdd ?? ""}`.toLowerCase();
  const gaps: string[] = [];
  for (const g of openGaps) {
    const words = g.description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 4);
    const hits = words.filter((w) => corpus.includes(w));
    if (hits.length < Math.max(1, Math.ceil(words.length * 0.4))) {
      gaps.push(`[Research→Tasks] Open gap sin task: ${g.id} — ${g.description.slice(0, 80)}`);
    }
  }
  return { ok: gaps.length === 0, gaps: gaps.slice(0, 10) };
}

/** RabbitMQ/Kafka en blueprint/plan debe tener eventos documentados (respeta broker primario §2). */
export function checkEventContractsCoverage(
  mdd: string | null | undefined,
  blueprint: string | null | undefined,
  logicFlows: string | null | undefined,
  tasks: string | null | undefined,
): CrossArtifactCheckResult {
  const bp = (blueprint ?? "").toLowerCase();
  if (!/rabbitmq|event-driven|outbox/i.test(bp)) return { ok: true, gaps: [] };

  const broker = resolveMessagingBrokerFromMddSection2(mdd ?? "");
  if (broker === "bull") return { ok: true, gaps: [] };
  if (!mddRequiresEventBrokerContracts(mdd ?? "") && broker !== "unknown") {
    return { ok: true, gaps: [] };
  }

  const gaps: string[] = [];
  const lf = (logicFlows ?? "").toLowerCase();
  const tk = (tasks ?? "").toLowerCase();
  if (!/rabbitmq|kafka|evento|event\.|publisher|consumer/i.test(lf)) {
    gaps.push("[Events] Blueprint menciona RabbitMQ/EDA pero logic-flows no documenta eventos");
  }
  if (!/rabbitmq|kafka|publisher|consumer|event-bus/i.test(tk)) {
    gaps.push("[Events] Falta task publisher/consumer RabbitMQ en tasks.md");
  }
  return { ok: gaps.length === 0, gaps };
}

/** REST/export/metadata JSON — no exige anexo Zod de salida LLM. */
const GENERIC_JSON_MENTION =
  /\b(?:export(?:a(?:r|ción)?|ar)|descarg(?:a(?:r|ción)?|ar))\s+(?:a\s+|en\s+)?json\b|\brespuesta\s+json\b(?![^\n]{0,48}\b(?:llm|modelo|ia)\b)|\b(?:audit|auditor[ií]a|bit[aá]cora)[^\n]{0,48}\bjson\b|\bjson\b[^\n]{0,60}\b(?:metadata|documento|api|endpoint|servicio|auditor)\b|\bmetadata\s+json\b|\bapplication\/json\b|\bopenapi\b/i;

/** UC exigen schema Zod cuando el flujo documenta salida JSON estructurada del LLM/modelo. */
const LLM_STRUCTURED_JSON_SIGNAL =
  /\b(?:salida|respuesta|output)\s+(?:json\s+)?(?:del\s+)?(?:llm|modelo|ia)\b|\b(?:llm|ia\s+generativa|modelo\s+(?:de\s+lenguaje|llm|ia)|agente\s+ia)\b[^\n]{0,160}\b(?:json\s+estructurad|schema\s+zod|json\s+schema|respuesta\s+estructurada|output\s+del\s+modelo)\b|\b(?:json\s+estructurad|schema\s+zod|json\s+schema|respuesta\s+estructurada|output\s+del\s+modelo)\b[^\n]{0,160}\b(?:llm|ia|modelo|few-shot|zod)\b|\boutput\s+del\s+modelo\b|\bsalida\s+json\s+del\s+llm\b|\bsustancia\s+econ[oó]mica\b|\bjustificaci[oó]n\s+t[eé]cnica\b|\brecomendaci[oó]n(?:es)?\s+(?:del\s+)?(?:llm|ia|modelo)\b/i;

const MDD_LLM_STRUCTURED_OUTPUT_SCOPE =
  /\b(llm|ia\s+generativa|modelo\s+(?:de\s+lenguaje|llm|ia)|\brag\b|retrieval[\s-]augmented|agente\s+ia|orquestador\s+llm|json\s+schema|salida\s+estructurada|structured\s+output|recomendaci[oó]n(?:es)?\s+(?:llm|ia|del\s+modelo))\b/i;

function resolveLlmStructuredOutputScope(mdd: string | null | undefined): boolean | null {
  if (mdd == null || !mdd.trim()) return null;
  const s1 = extractSectionByNumber(mdd, 1);
  const s2 = extractSectionByNumber(mdd, 2);
  const corpus = `${s1}\n${s2}`.trim();
  if (!corpus) return null;
  if (isChatLlmPlatformScope(corpus)) return true;
  return MDD_LLM_STRUCTURED_OUTPUT_SCOPE.test(corpus);
}

function useCasesRequireLlmJsonSchema(useCases: string): boolean {
  if (!LLM_STRUCTURED_JSON_SIGNAL.test(useCases)) return false;
  const withoutGenericJson = useCases.replace(GENERIC_JSON_MENTION, "");
  return LLM_STRUCTURED_JSON_SIGNAL.test(withoutGenericJson);
}

/** UC con salida JSON estructurada del LLM deben incluir schema Zod. */
export function checkLlmJsonSchemas(
  useCases: string | null | undefined,
  tasks: string | null | undefined,
  mdd?: string | null,
): CrossArtifactCheckResult {
  if (!substantial(useCases)) return { ok: true, gaps: [] };
  const scope = resolveLlmStructuredOutputScope(mdd);
  if (scope === false) return { ok: true, gaps: [] };
  const uc = useCases!;
  if (!useCasesRequireLlmJsonSchema(uc)) return { ok: true, gaps: [] };
  const gaps: string[] = [];
  const hasZod = /zod|z\.object|schema zod/i.test(uc) || /zod|z\.object/i.test(tasks ?? "");
  if (!hasZod) {
    gaps.push("[LLM JSON] Casos de uso mencionan JSON estructurado pero falta anexo Schema Zod");
  }
  return { ok: gaps.length === 0, gaps };
}

/** Flujos watchlist/señal en logic-flows deben aparecer en pantallas. */
export function checkPantallasFlowCoverage(
  logicFlows: string | null | undefined,
  pantallas: string | null | undefined,
  userStories: string | null | undefined,
): CrossArtifactCheckResult {
  const lf = (logicFlows ?? "").toLowerCase();
  const gaps: string[] = [];
  const needsWatchlist =
    /watchlist/.test(lf) && (/señal|signal|recomendaci[oó]n/i.test(lf) || /alpha engine/i.test(lf));
  if (!needsWatchlist) return { ok: true, gaps: [] };
  const pan = (pantallas ?? "").toLowerCase();
  const us = (userStories ?? "").toLowerCase();
  const hasWatchlistRoute = /watchlist|gestion-de-watchlist/i.test(pan);
  const hasRecoRoute = /recomendaci[oó]n|generar-recomendacion/i.test(pan);
  if (!hasWatchlistRoute || !hasRecoRoute) {
    gaps.push("[Pantallas] Flujo watchlist→señales en logic-flows sin rutas/API vinculadas en pantallas.md");
  }
  if (!/watchlist/i.test(us) && !/watchlist/i.test(pan)) {
    gaps.push("[Pantallas] Watchlist no referenciada en pantallas ni historias");
  }
  return { ok: gaps.length === 0, gaps };
}

/** Mandatorios M* de research deben aparecer en API o tasks. */
export function checkResearchMandatoriesCoverage(
  phase0Summary: string | null | undefined,
  apiContracts: string | null | undefined,
  tasks: string | null | undefined,
): CrossArtifactCheckResult {
  const research = (phase0Summary ?? "").trim();
  if (!research) return { ok: true, gaps: [] };
  const mandatories = extractResearchMandatories(research);
  if (mandatories.length === 0) return { ok: true, gaps: [] };
  const corpus = `${apiContracts ?? ""}\n${tasks ?? ""}`.toLowerCase();
  const gaps: string[] = [];
  for (const m of mandatories) {
    const keywords = m
      .replace(/^M\d+:\s*/i, "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 3);
    const hits = keywords.filter((w) => corpus.includes(w));
    if (hits.length < 1) {
      gaps.push(`[Research M*] Mandatorio sin cobertura API/tasks: ${m.slice(0, 100)}`);
    }
  }
  return { ok: gaps.length === 0, gaps: gaps.slice(0, 8) };
}

export interface SddPrecisionCheckInput {
  mdd?: string | null;
  architecture?: string | null;
  blueprint?: string | null;
  tasks?: string | null;
  logicFlows?: string | null;
  userStories?: string | null;
  useCases?: string | null;
  apiContracts?: string | null;
  pantallas?: string | null;
  phase0Summary?: string | null;
}

/** Ejecuta todos los checks de precisión y devuelve gaps concatenados. */
export function collectSddPrecisionGaps(input: SddPrecisionCheckInput): string[] {
  const results = [
    checkArchitectureVsMdd(input.mdd, input.architecture),
    checkTasksEntityMigrations(input.mdd, input.tasks),
    checkTasksBlueprintPhases(input.blueprint, input.tasks),
    checkSchedulerConsistency(input.mdd, input.logicFlows, input.userStories),
    checkResearchGapsInTasks(input.phase0Summary, input.tasks, input.mdd),
    checkResearchMandatoriesCoverage(input.phase0Summary, input.apiContracts, input.tasks),
    checkEventContractsCoverage(input.mdd, input.blueprint, input.logicFlows, input.tasks),
    checkLlmJsonSchemas(input.useCases, input.tasks, input.mdd),
    checkPantallasFlowCoverage(input.logicFlows, input.pantallas, input.userStories),
  ];
  return results.flatMap((r) => r.gaps);
}

/** Gaps de precisión que disparan regeneración en post-pase W4. */
export function precisionGapsForPostPassRetry(gaps: string[]): {
  retryArchitecture: boolean;
  retryLogicFlows: boolean;
  retryApiContracts: boolean;
  retryTasks: boolean;
} {
  const joined = gaps.join("\n").toLowerCase();
  return {
    retryArchitecture: /\[architecture\]/i.test(joined),
    retryLogicFlows: /\[scheduler\]|\[events\]/i.test(joined),
    retryApiContracts: /\[research m\*\]/i.test(joined),
    retryTasks:
      /\[tasks\]|\[research→tasks\]|\[events\]|\[llm json\]/i.test(joined),
  };
}

export function formatPrecisionGapsFeedback(gaps: string[]): string {
  return gaps.slice(0, 20).join("\n");
}
