/**
 * @fileoverview Informes del eval de MDDs: persistencia de `summary.json`, `summary.md`, el MDD
 * generado y el score por caso; comparación entre dos corridas y resumen de una línea.
 * Puro salvo las escrituras de `writeEvalResults` y la lectura de `loadEvalSummary`.
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { MddEvalRunRecord, MddEvalSummary } from "./mdd-eval.types.js";

/** Delta numérico entre dos corridas; `delta = next - prev` (null si falta algún lado). */
export type EvalNumericDelta = {
  prev: number | null;
  next: number | null;
  delta: number | null;
};

export type EvalCaseComparison = {
  /** Clave de archivo del caso (ver `evalFileKeys`). */
  key: string;
  caseId: string;
  status: "matched" | "only-prev" | "only-next";
  rubric: EvalNumericDelta;
  auditor: EvalNumericDelta;
  durationMs: EvalNumericDelta;
  costUsd: EvalNumericDelta;
  passed: { prev: boolean | null; next: boolean | null };
};

export type EvalComparison = {
  cases: EvalCaseComparison[];
  aggregates: {
    passRate: EvalNumericDelta;
    avgRubric: EvalNumericDelta;
    avgDurationMs: EvalNumericDelta;
  };
  markdown: string;
};

export type WriteEvalResultsOutput = {
  /** Resumen tal como quedó escrito (con `markdownPath` en los casos que tienen MDD). */
  summary: MddEvalSummary;
  summaryJsonPath: string;
  summaryMdPath: string;
  /** Archivos escritos por caso: `<key>.md` (si hubo markdown) y `<key>.score.json`. */
  caseFiles: string[];
};

/**
 * Clave de archivo por registro: el `caseId` si aparece una vez; si se repite (p. ej. fixtures
 * good/bad del mismo caso en dry-run), `<caseId>-2`, `<caseId>-3`… en orden de aparición.
 */
export function evalFileKeys(records: readonly MddEvalRunRecord[]): string[] {
  const seen = new Map<string, number>();
  return records.map((record) => {
    const occurrence = (seen.get(record.caseId) ?? 0) + 1;
    seen.set(record.caseId, occurrence);
    return occurrence === 1 ? record.caseId : `${record.caseId}-${occurrence}`;
  });
}

/** Formatea milisegundos: "850 ms", "12.4 s", "4m 07s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatSignedDuration(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  return `${sign}${formatDuration(Math.abs(delta))}`;
}

function formatNumber(value: number | null | undefined, decimals = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

function formatSignedNumber(delta: number | null, decimals = 1): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(decimals)}`;
}

function formatCost(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "—";
}

/** Una línea legible con los agregados de la corrida. */
export function formatAggregatesLine(summary: MddEvalSummary): string {
  const a = summary.aggregates;
  const pct = Math.round(a.passRate * 100);
  return [
    `${a.passed}/${a.cases} aprobados (${pct}%)`,
    `rúbrica media ${formatNumber(a.avgRubric)}`,
    `auditor media ${formatNumber(a.avgAuditor)}`,
    `duración media ${formatDuration(a.avgDurationMs)}`,
    `coste ${formatCost(a.totalCostUsd)}`,
    `llamadas LLM ${a.totalLlmCalls ?? "—"}`,
  ].join(" · ");
}

function caseStatus(record: MddEvalRunRecord): string {
  return record.passed ? "PASS" : "FAIL";
}

function gateLabel(record: MddEvalRunRecord): string {
  if (record.gateOk === undefined) return "—";
  return record.gateOk ? "OK" : "KO";
}

function renderFailures(key: string, record: MddEvalRunRecord): string[] {
  const lines = [`### ${key} (${caseStatus(record)})`, ""];
  const items: string[] = [...record.rubric.failures];
  if (record.error) items.push(`error: ${record.error}`);
  if (record.failedStep) {
    items.push(`nodo fallido: ${record.failedStep.node}: ${record.failedStep.error}`);
  }
  for (const blocker of record.gateBlockers) items.push(`gate bloqueo: ${blocker}`);
  if (items.length === 0) {
    lines.push("- Sin fallos.", "");
    return lines;
  }
  for (const item of items) lines.push(`- ${item}`);
  lines.push("");
  return lines;
}

/** Renderiza `summary.md`: cabecera, tabla por caso, agregados y lista de fallos por caso. */
export function renderEvalSummaryMarkdown(summary: MddEvalSummary): string {
  const keys = evalFileKeys(summary.cases);
  const lines: string[] = [
    `# Eval MDD · ${summary.runId}`,
    "",
    `- Inicio: ${summary.startedAt} · Fin: ${summary.finishedAt}`,
    `- Commit: ${summary.gitSha ?? "—"}`,
    `- Resumen: ${formatAggregatesLine(summary)}`,
    "",
    "| caso | complejidad | rúbrica | auditor | gate | % | duración | coste | estado |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  summary.cases.forEach((record, index) => {
    lines.push(
      `| ${keys[index]} | ${record.complexity} | ${formatNumber(record.rubric.total)} | ${formatNumber(record.auditorScore, 0)} | ${gateLabel(record)} | ${formatNumber(record.precision, 0)} | ${formatDuration(record.durationMs)} | ${formatCost(record.costUsd)} | ${caseStatus(record)} |`,
    );
  });
  lines.push("", "## Fallos", "");
  if (summary.cases.length === 0) lines.push("Sin casos.", "");
  summary.cases.forEach((record, index) => {
    lines.push(...renderFailures(keys[index], record));
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Escribe en `outDir`: `summary.json`, `summary.md`, y por caso `<key>.md` (MDD generado, si hay)
 * y `<key>.score.json`. `markdownByCase` se indexa por clave de archivo (`evalFileKeys`).
 */
export async function writeEvalResults(
  summary: MddEvalSummary,
  outDir: string,
  markdownByCase: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): Promise<WriteEvalResultsOutput> {
  await mkdir(outDir, { recursive: true });
  const keys = evalFileKeys(summary.cases);
  const lookup = (key: string): string | undefined =>
    markdownByCase instanceof Map
      ? markdownByCase.get(key)
      : (markdownByCase as Readonly<Record<string, string>>)[key];

  const caseFiles: string[] = [];
  const cases: MddEvalRunRecord[] = [];
  for (let index = 0; index < summary.cases.length; index += 1) {
    const record = summary.cases[index];
    const key = keys[index];
    const markdown = lookup(key);
    let written: MddEvalRunRecord = record;
    if (markdown && markdown.trim()) {
      const mdName = `${key}.md`;
      await writeFile(path.join(outDir, mdName), markdown, "utf8");
      caseFiles.push(mdName);
      written = { ...record, markdownPath: mdName };
    }
    const scoreName = `${key}.score.json`;
    await writeFile(
      path.join(outDir, scoreName),
      `${JSON.stringify({ caseId: record.caseId, passed: record.passed, rubric: record.rubric }, null, 2)}\n`,
      "utf8",
    );
    caseFiles.push(scoreName);
    cases.push(written);
  }

  const written: MddEvalSummary = { ...summary, cases };
  const summaryJsonPath = path.join(outDir, "summary.json");
  const summaryMdPath = path.join(outDir, "summary.md");
  await writeFile(summaryJsonPath, `${JSON.stringify(written, null, 2)}\n`, "utf8");
  await writeFile(summaryMdPath, renderEvalSummaryMarkdown(written), "utf8");
  return { summary: written, summaryJsonPath, summaryMdPath, caseFiles };
}

/** Lee y valida (forma mínima) un `summary.json` de una corrida previa. */
export function loadEvalSummary(file: string): MddEvalSummary {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { cases?: unknown }).cases) ||
    !(parsed as { aggregates?: unknown }).aggregates
  ) {
    throw new Error(`no es un summary.json de eval MDD: ${file}`);
  }
  return parsed as MddEvalSummary;
}

function numericDelta(prev: number | null | undefined, next: number | null | undefined): EvalNumericDelta {
  const p = typeof prev === "number" ? prev : null;
  const n = typeof next === "number" ? next : null;
  return {
    prev: p,
    next: n,
    delta: p === null || n === null ? null : roundDelta(n - p),
  };
}

function roundDelta(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareRecords(
  key: string,
  caseId: string,
  status: EvalCaseComparison["status"],
  prev: MddEvalRunRecord | undefined,
  next: MddEvalRunRecord | undefined,
): EvalCaseComparison {
  return {
    key,
    caseId,
    status,
    rubric: numericDelta(prev?.rubric.total, next?.rubric.total),
    auditor: numericDelta(prev?.auditorScore, next?.auditorScore),
    durationMs: numericDelta(prev?.durationMs, next?.durationMs),
    costUsd: numericDelta(prev?.costUsd, next?.costUsd),
    passed: { prev: prev ? prev.passed : null, next: next ? next.passed : null },
  };
}

/**
 * Compara dos corridas caso a caso (emparejados por `evalFileKeys`). Delta positivo en rúbrica o
 * auditor es mejora; delta positivo en duración o coste es más lento o más caro.
 */
export function compareSummaries(prev: MddEvalSummary, next: MddEvalSummary): EvalComparison {
  const prevKeys = evalFileKeys(prev.cases);
  const nextKeys = evalFileKeys(next.cases);
  const prevByKey = new Map(prevKeys.map((key, index) => [key, prev.cases[index]] as const));
  const nextByKey = new Map(nextKeys.map((key, index) => [key, next.cases[index]] as const));

  const cases: EvalCaseComparison[] = [];
  nextKeys.forEach((key, index) => {
    const nextRecord = next.cases[index];
    const prevRecord = prevByKey.get(key);
    cases.push(
      compareRecords(
        key,
        nextRecord.caseId,
        prevRecord ? "matched" : "only-next",
        prevRecord,
        nextRecord,
      ),
    );
  });
  prevKeys.forEach((key, index) => {
    if (nextByKey.has(key)) return;
    cases.push(compareRecords(key, prev.cases[index].caseId, "only-prev", prev.cases[index], undefined));
  });
  cases.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const aggregates = {
    passRate: numericDelta(prev.aggregates.passRate, next.aggregates.passRate),
    avgRubric: numericDelta(prev.aggregates.avgRubric, next.aggregates.avgRubric),
    avgDurationMs: numericDelta(prev.aggregates.avgDurationMs, next.aggregates.avgDurationMs),
  };

  const lines: string[] = [
    `# Comparación · ${prev.runId} → ${next.runId}`,
    "",
    `- Previa: ${formatAggregatesLine(prev)}`,
    `- Nueva: ${formatAggregatesLine(next)}`,
    `- Δ aprobados: ${formatSignedNumber(
      aggregates.passRate.delta === null ? null : roundDelta(aggregates.passRate.delta * 100),
      0,
    )} pp · Δ rúbrica media: ${formatSignedNumber(aggregates.avgRubric.delta)} · Δ duración media: ${
      aggregates.avgDurationMs.delta === null ? "—" : formatSignedDuration(aggregates.avgDurationMs.delta)
    }`,
    "",
    "| caso | rúbrica (prev → next, Δ) | auditor (Δ) | duración (Δ) | estado (prev → next) |",
    "|---|---|---|---|---|",
  ];
  for (const row of cases) {
    const estado = `${row.passed.prev === null ? "—" : row.passed.prev ? "PASS" : "FAIL"} → ${
      row.passed.next === null ? "—" : row.passed.next ? "PASS" : "FAIL"
    }`;
    const rubric = `${formatNumber(row.rubric.prev)} → ${formatNumber(row.rubric.next)} (${formatSignedNumber(row.rubric.delta)})`;
    const auditor = `${formatNumber(row.auditor.prev, 0)} → ${formatNumber(row.auditor.next, 0)} (${formatSignedNumber(row.auditor.delta, 0)})`;
    const duration =
      row.durationMs.delta === null
        ? `${formatDuration(row.durationMs.prev ?? NaN)} → ${formatDuration(row.durationMs.next ?? NaN)}`
        : `${formatDuration(row.durationMs.prev ?? NaN)} → ${formatDuration(row.durationMs.next ?? NaN)} (${formatSignedDuration(row.durationMs.delta)})`;
    const label = row.status === "matched" ? row.key : `${row.key} (${row.status === "only-prev" ? "solo en previa" : "solo en nueva"})`;
    lines.push(`| ${label} | ${rubric} | ${auditor} | ${duration} | ${estado} |`);
  }
  lines.push("");

  return { cases, aggregates, markdown: `${lines.join("\n")}\n` };
}
