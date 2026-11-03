/**
 * Tests del runner del eval de MDDs con dependencias falsas (sin Nest, sin LLM).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MddEvalCase, MddEvalScore } from "./mdd-eval.types.js";
import {
  buildEvalDbgaContent,
  buildEvalSummary,
  computeEvalAggregates,
  runEvalCase,
  runEvalSuite,
  type EvalStreamEvent,
  type EvalTokenUsage,
  type MddEvalRunnerDeps,
} from "./mdd-eval-runner.js";

function makeCase(id: string, overrides: Partial<MddEvalCase> = {}): MddEvalCase {
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

function rubric(total: number, passed: boolean): MddEvalScore {
  return { total, passed, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: passed ? [] : ["hueco"] };
}

type Scenario = {
  events?: EvalStreamEvent[];
  /** Si se indica, el generador nunca termina tras los eventos. */
  hang?: boolean;
  throwOnCreate?: boolean;
  throwOnScore?: boolean;
  throwOnDelete?: boolean;
  rubricPassed?: boolean;
  onSignal?: (signal: AbortSignal) => void;
};

function makeDeps(scenario: Scenario = {}) {
  const deleted: string[] = [];
  const scored: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const deps: MddEvalRunnerDeps = {
    async createTempProject(evalCase) {
      if (scenario.throwOnCreate) throw new Error("no hay usuario");
      return { projectId: `p-${evalCase.id}`, stageId: `s-${evalCase.id}` };
    },
    async deleteTempProject(projectId) {
      if (scenario.throwOnDelete) throw new Error("db caída");
      deleted.push(projectId);
    },
    async *generate(_dbg, _projectId, _stageId, signal) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        scenario.onSignal?.(signal);
        await new Promise((resolve) => setTimeout(resolve, 5));
        for (const event of scenario.events ?? []) yield event;
        if (scenario.hang) await new Promise(() => undefined);
      } finally {
        inFlight -= 1;
      }
    },
    async getTokenUsage() {
      return { llmCalls: 3, promptTokens: 100, completionTokens: 50, costUsd: 0.02 };
    },
    score(markdown) {
      if (scenario.throwOnScore) throw new Error("rúbrica pendiente");
      scored.push(markdown);
      return rubric(markdown.length > 0 ? 90 : 0, scenario.rubricPassed ?? true);
    },
    now: () => Date.now(),
  };
  return { deps, deleted, scored, maxInFlight: () => maxInFlight };
}

const PROGRESS: EvalStreamEvent = { type: "progress", agent: "manager", message: "planificando" };
const GOOD_DONE: EvalStreamEvent = {
  type: "done",
  markdown: "# MDD\n\n## 1. Contexto\n" + "texto ".repeat(40),
  precision: 90,
  auditorScore: 90,
  auditorRan: true,
  status: "green",
  deliveryGate: { ok: true, score: 90, blockers: [], warnings: ["aviso"] },
  auditTrail: ["paso 1"],
};

describe("buildEvalDbgaContent", () => {
  it("sin dbga usa el brief como idea del usuario", () => {
    assert.match(buildEvalDbgaContent(makeCase("a-case")), /^Idea del usuario:\n/);
  });

  it("con dbga antepone el benchmark y conserva el brief completo", () => {
    const c = makeCase("a-case", { dbga: "DBGA de referencia" });
    const out = buildEvalDbgaContent(c);
    assert.ok(out.startsWith("DBGA de referencia\n\n"));
    assert.ok(out.includes(`Idea del usuario:\n${c.brief}`));
  });
});

describe("runEvalCase", () => {
  it("consume progress y done: aprueba y registra métricas de tokens y auditor", async () => {
    const { deps, deleted, scored } = makeDeps({ events: [PROGRESS, { type: "draft", markdown: "borrador" }, GOOD_DONE] });
    const record = await runEvalCase(deps, makeCase("ecommerce-ok"), { timeoutMs: 5_000 });
    assert.equal(record.caseId, "ecommerce-ok");
    assert.equal(record.passed, true);
    assert.equal(record.error, undefined);
    assert.equal(record.auditorScore, 90);
    assert.equal(record.precision, 90);
    assert.equal(record.status, "green");
    assert.equal(record.gateOk, true);
    assert.deepEqual(record.gateWarnings, ["aviso"]);
    assert.deepEqual(record.auditTrail, ["paso 1"]);
    assert.equal(record.llmCalls, 3);
    assert.equal(record.promptTokens, 100);
    assert.equal(record.costUsd, 0.02);
    assert.equal(record.markdownLen, (GOOD_DONE as { markdown: string }).markdown.length);
    assert.equal(record.rubric.total, 90);
    assert.ok(record.durationMs >= 0);
    assert.deepEqual(deleted, ["p-ecommerce-ok"]);
    assert.equal(scored.length, 1);
  });

  it("Auditor con salida inválida: el motivo llega al registro sin nota", async () => {
    const done = {
      ...GOOD_DONE,
      auditorOutcome: "unavailable",
      auditorUnavailableReason: "invalid",
    } as EvalStreamEvent;
    const { deps } = makeDeps({ events: [done] });
    const record = await runEvalCase(deps, makeCase("ecommerce-invalid"), { timeoutMs: 5_000 });
    assert.equal(record.auditorOutcome, "unavailable");
    assert.equal(record.auditorUnavailableReason, "invalid");
    assert.equal(record.auditorScore, undefined);
  });

  it("falla si el Auditor queda por debajo del umbral del caso", async () => {
    const { deps } = makeDeps({ events: [{ ...GOOD_DONE, auditorScore: 80 } as EvalStreamEvent] });
    const record = await runEvalCase(deps, makeCase("ecommerce-audit"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.equal(record.error, undefined);
    assert.equal(record.rubric.passed, true);
  });

  it("auditorScore sale de done.auditorScore, nunca del porcentaje del semáforo (precision)", async () => {
    const done = { ...GOOD_DONE, precision: 99, auditorScore: 70, auditorRan: true } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-auditor-src"), { timeoutMs: 5_000 });
    assert.equal(record.auditorScore, 70);
    assert.equal(record.precision, 99);
    assert.equal(record.passed, false, "70 < 85: el umbral se aplica al score del Auditor");
  });

  it("sin Auditor (auditorRan=false) no hay auditorScore aunque haya precision, y no se exige umbral", async () => {
    const done = { ...GOOD_DONE, precision: 40, auditorScore: 40, auditorRan: false } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-no-auditor"), { timeoutMs: 5_000 });
    assert.equal(record.auditorScore, undefined);
    assert.equal(record.precision, 40);
    assert.equal(record.passed, true);
  });

  it("Auditor no disponible: sin auditorScore (aunque llegue uno), sin umbral, con marca en el auditTrail", async () => {
    const done = {
      ...GOOD_DONE,
      precision: 55,
      auditorScore: 0,
      auditorRan: true,
      auditorOutcome: "unavailable",
    } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-auditor-down"), { timeoutMs: 5_000 });
    assert.equal(record.auditorScore, undefined);
    assert.equal(record.auditorOutcome, "unavailable");
    assert.equal(record.passed, true, "sin nota no se exige umbral del Auditor");
    assert.ok(record.auditTrail.includes("Auditor no disponible"));
  });

  it("auditorOutcome scored conserva la nota y se anota en el registro", async () => {
    const done = { ...GOOD_DONE, auditorScore: 88, auditorOutcome: "scored" } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-auditor-scored"), { timeoutMs: 5_000 });
    assert.equal(record.auditorScore, 88);
    assert.equal(record.auditorOutcome, "scored");
    assert.ok(!record.auditTrail.includes("Auditor no disponible"));
  });

  it("no exige auditor cuando el Auditor no corrió (failedStep)", async () => {
    const done: EvalStreamEvent = {
      ...GOOD_DONE,
      precision: undefined,
      failedStep: { node: "writer", error: "boom" },
    } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-failedstep"), { timeoutMs: 5_000 });
    assert.equal(record.auditorScore, undefined);
    assert.deepEqual(record.failedStep, { node: "writer", error: "boom" });
    assert.equal(record.passed, true);
  });

  it("falla si el gate de entrega no está ok", async () => {
    const done = { ...GOOD_DONE, deliveryGate: { ok: false, score: 40, blockers: ["sin §3"], warnings: [] } } as EvalStreamEvent;
    const record = await runEvalCase(makeDeps({ events: [done] }).deps, makeCase("ecommerce-gate"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.deepEqual(record.gateBlockers, ["sin §3"]);
  });

  it("falla si la rúbrica no pasa", async () => {
    const record = await runEvalCase(makeDeps({ events: [GOOD_DONE], rubricPassed: false }).deps, makeCase("ecommerce-rubric"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.equal(record.rubric.passed, false);
  });

  it("un evento error del generador va a record.error con passed=false y borra el proyecto", async () => {
    const { deps, deleted } = makeDeps({
      events: [PROGRESS, { type: "draft", markdown: "parcial" }, { type: "error", message: "LLM sin cuota" }],
    });
    const record = await runEvalCase(deps, makeCase("ecommerce-err"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.equal(record.error, "LLM sin cuota");
    assert.equal(record.rubric.total, 90, "el borrador parcial se puntúa para diagnóstico");
    assert.deepEqual(deleted, ["p-ecommerce-err"]);
  });

  it("un evento blocked falla con su código", async () => {
    const record = await runEvalCase(
      makeDeps({ events: [{ type: "blocked", code: "INSUFFICIENT_DBGA", message: "idea pobre" }] }).deps,
      makeCase("ecommerce-blocked"),
      { timeoutMs: 5_000 },
    );
    assert.equal(record.passed, false);
    assert.equal(record.error, "INSUFFICIENT_DBGA: idea pobre");
  });

  it("un generador que termina sin done ni error falla", async () => {
    const record = await runEvalCase(makeDeps({ events: [PROGRESS] }).deps, makeCase("ecommerce-silent"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.match(record.error ?? "", /sin evento done/);
  });

  it("timeout: un generador que nunca termina aborta, falla y borra el proyecto", async () => {
    let receivedSignal: AbortSignal | undefined;
    const { deps, deleted } = makeDeps({
      events: [PROGRESS],
      hang: true,
      onSignal: (signal) => {
        receivedSignal = signal;
      },
    });
    const startedAt = Date.now();
    const record = await runEvalCase(deps, makeCase("ecommerce-timeout"), { timeoutMs: 50 });
    const elapsed = Date.now() - startedAt;
    assert.equal(record.passed, false);
    assert.match(record.error ?? "", /timeout tras 50 ms/);
    assert.ok(elapsed < 2_000, `el caso no debe colgarse (tardó ${elapsed} ms)`);
    assert.equal(receivedSignal?.aborted, true);
    assert.deepEqual(deleted, ["p-ecommerce-timeout"]);
  });

  it("si falla la creación del proyecto temporal no se intenta borrar nada", async () => {
    const { deps, deleted } = makeDeps({ throwOnCreate: true });
    const record = await runEvalCase(deps, makeCase("ecommerce-nocreate"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.equal(record.error, "no hay usuario");
    assert.deepEqual(deleted, []);
  });

  it("keep conserva el proyecto temporal y lo anota", async () => {
    const { deps, deleted } = makeDeps({ events: [GOOD_DONE] });
    const record = await runEvalCase(deps, makeCase("ecommerce-keep"), { timeoutMs: 5_000, keep: true });
    assert.deepEqual(deleted, []);
    assert.ok(record.auditTrail.some((line) => line.includes("p-ecommerce-keep")));
  });

  it("un fallo al borrar no cambia el veredicto del caso", async () => {
    const { deps } = makeDeps({ events: [GOOD_DONE], throwOnDelete: true });
    const record = await runEvalCase(deps, makeCase("ecommerce-nodelete"), { timeoutMs: 5_000 });
    assert.equal(record.passed, true);
    assert.ok(record.auditTrail.some((line) => line.includes("no se pudo borrar")));
  });

  it("si la rúbrica lanza, el caso falla con error y no lanza el runner", async () => {
    const record = await runEvalCase(makeDeps({ events: [GOOD_DONE], throwOnScore: true }).deps, makeCase("ecommerce-score"), { timeoutMs: 5_000 });
    assert.equal(record.passed, false);
    assert.match(record.error ?? "", /rúbrica/);
  });
});

describe("runEvalSuite", () => {
  it("respeta la concurrencia y devuelve los registros ordenados por caseId", async () => {
    const { deps, maxInFlight } = makeDeps({ events: [GOOD_DONE] });
    const cases = [makeCase("c-case"), makeCase("a-case"), makeCase("b-case"), makeCase("d-case")];
    const summary = await runEvalSuite(
      deps,
      cases,
      { concurrency: 2, timeoutMs: 5_000, runId: "run-1", gitSha: "abc1234", args: { mode: "test" } },
    );
    assert.deepEqual(summary.cases.map((c) => c.caseId), ["a-case", "b-case", "c-case", "d-case"]);
    assert.equal(maxInFlight(), 2, "debe llegar a usar 2 casos en paralelo, sin más");
    assert.equal(summary.runId, "run-1");
    assert.equal(summary.gitSha, "abc1234");
    assert.deepEqual(summary.args, { mode: "test" });
    assert.equal(summary.aggregates.cases, 4);
    assert.equal(summary.aggregates.passed, 4);
    assert.equal(summary.aggregates.passRate, 1);
    assert.ok(summary.startedAt <= summary.finishedAt);
  });

  it("invoca onCaseDone por caso con su markdown", async () => {
    const { deps } = makeDeps({ events: [GOOD_DONE] });
    const seen: string[] = [];
    await runEvalSuite(deps, [makeCase("x-case"), makeCase("y-case")], { concurrency: 1, timeoutMs: 5_000, runId: "r" }, (record, markdown) => {
      seen.push(`${record.caseId}:${markdown.length > 0}`);
    });
    assert.deepEqual(seen.sort(), ["x-case:true", "y-case:true"]);
  });

  it("concurrencia fuera de rango se acota a 1..3", async () => {
    const { deps, maxInFlight } = makeDeps({ events: [GOOD_DONE] });
    await runEvalSuite(deps, [makeCase("e-case"), makeCase("f-case")], { concurrency: 99, timeoutMs: 5_000, runId: "r", gitSha: "x" });
    assert.equal(maxInFlight(), 2, "solo 2 casos, así que nunca más de 2 a la vez");
  });

  it("con un caso fallido el resumen sigue completo", async () => {
    const { deps } = makeDeps({ events: [{ type: "error", message: "boom" }] });
    const summary = await runEvalSuite(deps, [makeCase("g-case")], { concurrency: 1, timeoutMs: 5_000, runId: "r", gitSha: "x" });
    assert.equal(summary.aggregates.passed, 0);
    assert.equal(summary.cases[0].error, "boom");
  });
});

describe("computeEvalAggregates", () => {
  it("promedios, totales nulos cuando no hay datos y tasa como fracción", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true),
    };
    const agg = computeEvalAggregates([
      { ...base, durationMs: 1000, passed: true, auditorScore: 90, costUsd: 0.5, llmCalls: 2 },
      { ...base, caseId: "b", durationMs: 3000, passed: false, rubric: rubric(60, false) },
    ]);
    assert.equal(agg.cases, 2);
    assert.equal(agg.passed, 1);
    assert.equal(agg.passRate, 0.5);
    assert.equal(agg.avgRubric, 70);
    assert.equal(agg.avgAuditor, 90);
    assert.equal(agg.avgDurationMs, 2000);
    assert.equal(agg.totalCostUsd, 0.5);
    assert.equal(agg.totalLlmCalls, 2);

    const empty = computeEvalAggregates([]);
    assert.equal(empty.passRate, 0);
    assert.equal(empty.avgAuditor, null);
    assert.equal(empty.totalCostUsd, null);
    assert.equal(empty.totalLlmCalls, null);
  });

  it("Auditor no disponible: no entra en la media del Auditor y se cuenta aparte", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true), durationMs: 1000, passed: true,
    };
    const agg = computeEvalAggregates([
      { ...base, caseId: "a", auditorScore: 90, auditorOutcome: "scored" },
      { ...base, caseId: "b", auditorScore: 80, auditorOutcome: "scored" },
      // Un score residual en un caso `unavailable` tampoco debe contar.
      { ...base, caseId: "c", auditorScore: 0, auditorOutcome: "unavailable" },
      { ...base, caseId: "d", auditorOutcome: "unavailable" },
      { ...base, caseId: "e", auditorScore: 70, auditorOutcome: "scored" },
      { ...base, caseId: "f", auditorScore: 100, auditorOutcome: "scored" },
      { ...base, caseId: "g", auditorScore: 90, auditorOutcome: "scored" },
      { ...base, caseId: "h", auditorScore: 90, auditorOutcome: "scored" },
      { ...base, caseId: "i", auditorScore: 90, auditorOutcome: "scored" },
      { ...base, caseId: "j", auditorScore: 90, auditorOutcome: "scored" },
    ]);
    assert.equal(agg.auditorUnavailableCount, 2);
    assert.equal(agg.avgAuditor, 87.5); // 8 casos `scored`: (90+80+70+100+90*4)/8
    assert.equal(agg.infraDegraded, false, "2/10 = 20 % exacto no supera el umbral");
  });

  it("infra degradada cuando el Auditor cae en más del 20 % de los casos", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true), durationMs: 1000, passed: true,
    };
    const agg = computeEvalAggregates([
      { ...base, caseId: "a", auditorScore: 90, auditorOutcome: "scored" },
      { ...base, caseId: "b", auditorOutcome: "unavailable" },
      { ...base, caseId: "c", auditorOutcome: "unavailable" },
      { ...base, caseId: "d", auditorScore: 90, auditorOutcome: "scored" },
    ]);
    assert.equal(agg.auditorUnavailableCount, 2);
    assert.equal(agg.infraDegraded, true);
    assert.equal(agg.avgAuditor, 90);

    const none = computeEvalAggregates([{ ...base, auditorScore: 90 }]);
    assert.equal(none.auditorUnavailableCount, 0);
    assert.equal(none.infraDegraded, false);
  });

  it("salidas inválidas (invalid) se cuentan aparte y no degradan la infra; transport y deadline sí", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true), durationMs: 1000, passed: true,
    };
    const invalidOnly = computeEvalAggregates([
      { ...base, caseId: "a", auditorOutcome: "unavailable", auditorUnavailableReason: "invalid" },
      { ...base, caseId: "b", auditorOutcome: "unavailable", auditorUnavailableReason: "invalid" },
      { ...base, caseId: "c", auditorScore: 90, auditorOutcome: "scored" },
    ]);
    assert.equal(invalidOnly.auditorUnavailableCount, 2);
    assert.equal(invalidOnly.auditorInvalidCount, 2);
    assert.equal(invalidOnly.infraDegraded, false, "la calidad del modelo no marca la corrida como infra degradada");

    const infra = computeEvalAggregates([
      { ...base, caseId: "a", auditorOutcome: "unavailable", auditorUnavailableReason: "transport" },
      { ...base, caseId: "b", auditorOutcome: "unavailable", auditorUnavailableReason: "deadline" },
      { ...base, caseId: "c", auditorScore: 90, auditorOutcome: "scored" },
    ]);
    assert.equal(infra.auditorInvalidCount, 0);
    assert.equal(infra.infraDegraded, true, "2/3 caídos por transporte o presupuesto superan el 20 %");
  });

  it("sin ningún caso con uso medido los totales de coste y llamadas son null, no 0", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true), durationMs: 1000, passed: true,
    };
    const agg = computeEvalAggregates([
      { ...base, caseId: "a" },
      { ...base, caseId: "b", llmCalls: 0, costUsd: 0, promptTokens: 0, completionTokens: 0 },
    ]);
    assert.equal(agg.totalCostUsd, null, "sin uso no hay coste medido");
    assert.equal(agg.totalLlmCalls, null, "llmCalls 0 (registros antiguos) cuenta como sin uso");
  });

  it("con uso mixto suma solo los casos con uso y el resto no aporta", () => {
    const base = {
      caseId: "a", complexity: "LOW" as const, startedAt: "", markdownLen: 1, gateBlockers: [], gateWarnings: [],
      auditTrail: [], rubric: rubric(80, true), durationMs: 1000, passed: true,
    };
    const agg = computeEvalAggregates([
      { ...base, caseId: "con-uso-1", llmCalls: 2, costUsd: 0.5 },
      { ...base, caseId: "sin-uso" },
      { ...base, caseId: "con-uso-2", llmCalls: 3, costUsd: 0.25 },
    ]);
    assert.equal(agg.totalLlmCalls, 5);
    assert.equal(agg.totalCostUsd, 0.75);
  });
});

describe("uso de tokens del caso", () => {
  /** Dependencias con registro del orden de llamadas y de las pausas de reintento. */
  function withCallLog(scenario: Scenario, usage: (call: number) => EvalTokenUsage) {
    const { deps, deleted } = makeDeps(scenario);
    const calls: string[] = [];
    const sleeps: number[] = [];
    let usageCalls = 0;
    const logged: MddEvalRunnerDeps = {
      ...deps,
      async getTokenUsage() {
        usageCalls += 1;
        calls.push("usage");
        return usage(usageCalls);
      },
      async deleteTempProject(projectId) {
        calls.push("delete");
        await deps.deleteTempProject(projectId);
      },
      async sleep(ms) {
        sleeps.push(ms);
      },
    };
    return { deps: logged, calls, sleeps, deleted, usageCalls: () => usageCalls };
  }

  it("lee el uso antes de borrar el proyecto temporal", async () => {
    const { deps, calls, deleted } = withCallLog({ events: [GOOD_DONE] }, () => ({ llmCalls: 3 }));
    await runEvalCase(deps, makeCase("ecommerce-order"), { timeoutMs: 5_000 });
    assert.deepEqual(calls, ["usage", "delete"]);
    assert.deepEqual(deleted, ["p-ecommerce-order"]);
  });

  it("reintenta la lectura si aún no hay generaciones registradas", async () => {
    const { deps, calls, sleeps } = withCallLog({ events: [GOOD_DONE] }, (call) =>
      call < 3 ? { llmCalls: 0 } : { llmCalls: 5, promptTokens: 1000, completionTokens: 500, costUsd: 0.1 },
    );
    const record = await runEvalCase(deps, makeCase("ecommerce-retry"), { timeoutMs: 5_000 });
    assert.equal(record.llmCalls, 5);
    assert.equal(record.costUsd, 0.1);
    assert.deepEqual(sleeps, [1_000, 1_000]);
    assert.deepEqual(calls, ["usage", "usage", "usage", "delete"]);
  });

  it("tras 3 reintentos sin filas: coste y tokens quedan no medidos (undefined, no 0) y el caso no falla", async () => {
    const { deps, sleeps, usageCalls } = withCallLog({ events: [GOOD_DONE] }, () => ({ llmCalls: 0 }));
    const record = await runEvalCase(deps, makeCase("ecommerce-nousage"), { timeoutMs: 5_000 });
    assert.equal(usageCalls(), 4, "1 lectura + 3 reintentos");
    assert.deepEqual(sleeps, [1_000, 1_000, 1_000]);
    assert.equal(record.llmCalls, undefined);
    assert.equal(record.promptTokens, undefined);
    assert.equal(record.completionTokens, undefined);
    assert.equal(record.costUsd, undefined);
    assert.ok(
      record.auditTrail.some((line) =>
        line.includes(
          "harness: TokenUsage sin filas para el proyecto temporal → coste y tokens no medidos (verifica que theforge-worker corre el commit con el contexto de tokens del eval; gitSha del resumen)",
        ),
      ),
    );
    assert.equal(record.passed, true);
  });

  it("un fallo al leer el uso deja los campos no medidos y lo anota", async () => {
    const { deps } = makeDeps({ events: [GOOD_DONE] });
    const record = await runEvalCase(
      {
        ...deps,
        async getTokenUsage() {
          throw new Error("tabla caída");
        },
        async sleep() {},
      },
      makeCase("ecommerce-usage-error"),
      { timeoutMs: 5_000 },
    );
    assert.equal(record.llmCalls, undefined);
    assert.equal(record.costUsd, undefined);
    assert.ok(record.auditTrail.some((line) => line.includes("harness: sin uso de tokens: tabla caída")));
    assert.equal(record.passed, true);
  });

  it("solo llamadas fallidas (p. ej. 401): el caso NO queda medido, failedLlmCalls = N y coste no medido", async () => {
    const { deps, sleeps } = withCallLog({ events: [GOOD_DONE] }, () => ({
      llmCalls: 0,
      failedLlmCalls: 4,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    }));
    const record = await runEvalCase(deps, makeCase("ecommerce-401"), { timeoutMs: 5_000 });
    assert.equal(record.llmCalls, undefined);
    assert.equal(record.failedLlmCalls, 4);
    assert.equal(record.promptTokens, undefined);
    assert.equal(record.completionTokens, undefined);
    assert.equal(record.costUsd, undefined);
    assert.deepEqual(sleeps, [1_000, 1_000, 1_000], "reintenta por si aún llegan filas medidas");
    assert.ok(record.auditTrail.some((line) => line.includes("4 llamadas fallidas sin coste")));
    const summary = buildEvalSummary({
      runId: "r-fallidas",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      records: [record],
    });
    assert.equal(summary.aggregates.totalCostUsd, null);
    assert.equal(summary.aggregates.totalLlmCalls, null);
    assert.equal(summary.aggregates.totalFailedLlmCalls, 4);
  });

  it("mezcla de llamadas ok y fallidas: se miden las ok, se anotan las fallidas y el resumen las suma", async () => {
    const { deps } = withCallLog({ events: [GOOD_DONE] }, () => ({
      llmCalls: 5,
      failedLlmCalls: 2,
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: 0.1,
    }));
    const record = await runEvalCase(deps, makeCase("ecommerce-mix"), { timeoutMs: 5_000 });
    assert.equal(record.llmCalls, 5);
    assert.equal(record.failedLlmCalls, 2);
    assert.equal(record.costUsd, 0.1);
    assert.ok(record.auditTrail.some((line) => line.includes("2 llamadas fallidas sin coste")));
    const agg = computeEvalAggregates([record]);
    assert.equal(agg.totalLlmCalls, 5);
    assert.equal(agg.totalCostUsd, 0.1);
    assert.equal(agg.totalFailedLlmCalls, 2);
  });

  it("en el resumen, un suite sin uso medido da totales null en los agregados", async () => {
    const { deps } = makeDeps({ events: [GOOD_DONE] });
    const sinUso = {
      ...deps,
      async getTokenUsage() {
        return { llmCalls: 0 };
      },
      async sleep() {},
    };
    const summary = await runEvalSuite(sinUso, [makeCase("h-case"), makeCase("i-case")], {
      concurrency: 2,
      timeoutMs: 5_000,
      runId: "r-sin-uso",
      gitSha: "x",
    });
    assert.equal(summary.aggregates.totalCostUsd, null);
    assert.equal(summary.aggregates.totalLlmCalls, null);
    assert.equal(summary.aggregates.passed, 2);
  });
});
