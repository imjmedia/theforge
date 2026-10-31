/**
 * Fixtures compartidos por los specs de la capa web del eval de MDDs (sin Nest, sin LLM).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { computeEvalAggregates } from "./mdd-eval-runner.js";
import type { EvalStreamEvent, MddEvalRunnerDeps } from "./mdd-eval-runner.js";
import type { MddEvalCase, MddEvalRunRecord, MddEvalScore, MddEvalSummary } from "./mdd-eval.types.js";

export function tempDir(prefix = "mdd-eval-web-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function makeEvalCase(id: string, overrides: Partial<MddEvalCase> = {}): MddEvalCase {
  return {
    id,
    title: `Caso ${id}`,
    domain: "ecommerce",
    complexity: "MEDIUM",
    brief: "Tienda en línea con catálogo, carrito y pedidos. ".repeat(6),
    expect: {
      entities: ["products", "orders", "users"],
      entitySynonyms: {},
      capabilities: [
        { name: "Catálogo", endpointHints: ["/products"] },
        { name: "Pedidos", endpointHints: ["/orders"] },
      ],
      security: ["jwt"],
      infra: ["docker"],
      forbidden: [],
      mustMentionInContext: [],
    },
    thresholds: { minRubric: 80, minAuditor: 85 },
    ...overrides,
  };
}

export function makeScore(total: number, passed: boolean): MddEvalScore {
  return {
    total,
    passed,
    dimensions: [{ key: "structure", score: total, weight: 15, details: ["ok"] }],
    forbiddenHits: [],
    forbiddenPenalty: 0,
    failures: passed ? [] : ["hueco"],
  };
}

export function makeRecord(caseId: string, overrides: Partial<MddEvalRunRecord> = {}): MddEvalRunRecord {
  const passed = overrides.passed ?? true;
  return {
    caseId,
    complexity: "MEDIUM",
    startedAt: "2026-10-30T10:00:00.000Z",
    durationMs: 1234,
    markdownLen: 500,
    auditorScore: 90,
    precision: 90,
    status: "green",
    gateOk: true,
    gateBlockers: [],
    gateWarnings: [],
    auditTrail: [],
    llmCalls: 4,
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 0.02,
    rubric: makeScore(passed ? 92 : 40, passed),
    passed,
    ...overrides,
  };
}

export function makeSummary(runId: string, records: MddEvalRunRecord[], overrides: Partial<MddEvalSummary> = {}): MddEvalSummary {
  return {
    runId,
    startedAt: "2026-10-30T10:00:00.000Z",
    finishedAt: "2026-10-30T10:05:00.000Z",
    gitSha: "abc1234",
    args: { mode: "real", concurrency: 1, keep: false },
    cases: records,
    aggregates: computeEvalAggregates(records),
    ...overrides,
  };
}

export const GOOD_DONE: EvalStreamEvent = {
  type: "done",
  markdown: "# MDD\n\n## 1. Contexto\n" + "texto ".repeat(40),
  precision: 90,
  status: "green",
  deliveryGate: { ok: true, score: 90, blockers: [], warnings: [] },
  auditTrail: [],
};

export type FakeDepsOptions = {
  /** Eventos por caso (por defecto: progress + done). */
  events?: EvalStreamEvent[];
  /** Si true, el generador queda colgado tras el progress hasta que se aborte. */
  hang?: boolean;
  /** ms entre eventos. */
  delayMs?: number;
};

export function makeFakeDeps(options: FakeDepsOptions = {}) {
  const created: string[] = [];
  const deleted: string[] = [];
  const deps: MddEvalRunnerDeps = {
    async createTempProject(evalCase) {
      created.push(evalCase.id);
      return { projectId: `p-${evalCase.id}`, stageId: `s-${evalCase.id}` };
    },
    async deleteTempProject(projectId) {
      deleted.push(projectId);
    },
    async *generate(_dbga, projectId, _stage, signal) {
      yield { type: "progress", agent: "manager", message: "planificando" };
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      if (options.hang) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      for (const event of options.events ?? [GOOD_DONE]) yield event;
      void projectId;
    },
    async getTokenUsage() {
      return { llmCalls: 2, promptTokens: 10, completionTokens: 5, costUsd: 0.01 };
    },
    score: (markdown) => makeScore(markdown.length > 0 ? 90 : 0, markdown.length > 0),
    now: () => Date.now(),
  };
  return { deps, created, deleted };
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Carpeta temporal de casos (JSON válidos con el schema real) para los specs del servicio/cola. */
export function writeCasesDir(ids: string[]): string {
  const dir = path.join(tempDir("mdd-eval-cases-"), "cases");
  mkdirSync(dir, { recursive: true });
  for (const id of ids) {
    writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(makeEvalCase(id), null, 2));
  }
  return dir;
}
