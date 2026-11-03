/**
 * Tests de la función pura de agregación de token usage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTokenUsageRows,
  TokenUsageService,
  type RawTokenUsageRow,
} from "./token-usage.service.js";

const t0 = new Date("2026-07-24T10:00:00Z");
const t1 = new Date("2026-07-24T10:05:00Z");
const t2 = new Date("2026-07-24T10:10:00Z");

describe("aggregateTokenUsageRows", () => {
  it("devuelve summary vacío para input vacío", () => {
    const summary = aggregateTokenUsageRows("p1", []);
    assert.equal(summary.projectId, "p1");
    assert.equal(summary.totalTokens, 0);
    assert.equal(summary.documents.length, 0);
    assert.equal(summary.mxnPerUsd, 20);
  });

  it("suma tokens y coste de una sola fila", () => {
    const rows: RawTokenUsageRow[] = [
      {
        projectId: "p1",
        stageId: null,
        documentField: "mddContent",
        context: "initial",
        node: "software_architect",
        providerId: "openai",
        modelId: "gpt-4o",
        promptTokens: 1_000,
        completionTokens: 500,
        totalTokens: 1_500,
        costUsd: 0.0075,
        costMxn: 0.15,
        jobId: "j1",
        createdAt: t0,
      },
    ];
    const summary = aggregateTokenUsageRows("p1", rows);
    assert.equal(summary.totalTokens, 1_500);
    assert.equal(summary.totalCostUsd, 0.0075);
    assert.equal(summary.totalCostMxn, 0.15);
    assert.equal(summary.documents.length, 1);
    const doc = summary.documents[0]!;
    assert.equal(doc.documentField, "mddContent");
    assert.equal(doc.generations, 1);
    assert.equal(doc.byModel.length, 1);
    assert.equal(doc.byModel[0]?.calls, 1);
  });

  it("agrupa múltiples generaciones del mismo documento", () => {
    const rows: RawTokenUsageRow[] = [
      {
        projectId: "p1",
        stageId: null,
        documentField: "specContent",
        context: "initial",
        node: null,
        providerId: "openai",
        modelId: "gpt-4o",
        promptTokens: 2_000,
        completionTokens: 1_000,
        totalTokens: 3_000,
        costUsd: 0.015,
        costMxn: 0.30,
        jobId: "j1",
        createdAt: t0,
      },
      {
        projectId: "p1",
        stageId: null,
        documentField: "specContent",
        context: "regenerate",
        node: null,
        providerId: "openai",
        modelId: "gpt-4o",
        promptTokens: 1_000,
        completionTokens: 500,
        totalTokens: 1_500,
        costUsd: 0.0075,
        costMxn: 0.15,
        jobId: "j2",
        createdAt: t1,
      },
    ];
    const summary = aggregateTokenUsageRows("p1", rows);
    assert.equal(summary.documents.length, 1);
    const doc = summary.documents[0]!;
    assert.equal(doc.documentField, "specContent");
    assert.equal(doc.generations, 2);
    assert.equal(doc.totalTokens, 4_500);
    assert.equal(Number(doc.totalCostUsd.toFixed(4)), 0.0225);
    assert.equal(Number(doc.totalCostMxn.toFixed(4)), 0.45);
    assert.equal(doc.firstAt.getTime(), t0.getTime());
    assert.equal(doc.lastAt.getTime(), t1.getTime());
  });

  it("separa por modelo cuando un documento usa varios", () => {
    const rows: RawTokenUsageRow[] = [
      {
        projectId: "p1",
        stageId: null,
        documentField: "mddContent",
        context: "initial",
        node: "software_architect",
        providerId: "openai",
        modelId: "gpt-4o",
        promptTokens: 1_000,
        completionTokens: 500,
        totalTokens: 1_500,
        costUsd: 0.0075,
        costMxn: 0.15,
        jobId: null,
        createdAt: t0,
      },
      {
        projectId: "p1",
        stageId: null,
        documentField: "mddContent",
        context: "initial",
        node: "auditor",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        costUsd: 0.000195,
        costMxn: 0.0039,
        jobId: null,
        createdAt: t1,
      },
    ];
    const summary = aggregateTokenUsageRows("p1", rows);
    const doc = summary.documents[0]!;
    assert.equal(doc.generations, 2);
    assert.equal(doc.byModel.length, 2);
    const gpt4o = doc.byModel.find((m) => m.modelId === "gpt-4o");
    const mini = doc.byModel.find((m) => m.modelId === "gpt-4o-mini");
    assert.ok(gpt4o);
    assert.ok(mini);
    assert.equal(gpt4o?.calls, 1);
    assert.equal(mini?.calls, 1);
  });

  it("documentos quedan ordenados alfabéticamente", () => {
    const rows: RawTokenUsageRow[] = [
      baseRow("mddContent", t0),
      baseRow("architectureContent", t1),
      baseRow("specContent", t2),
    ];
    const summary = aggregateTokenUsageRows("p1", rows);
    assert.deepEqual(
      summary.documents.map((d) => d.documentField),
      ["architectureContent", "mddContent", "specContent"],
    );
  });

  it("acepta un mxnPerUsd custom", () => {
    const rows: RawTokenUsageRow[] = [baseRow("mddContent", t0)];
    const summary = aggregateTokenUsageRows("p1", rows, 17.5);
    assert.equal(summary.mxnPerUsd, 17.5);
  });
});

function baseRow(documentField: string, createdAt: Date): RawTokenUsageRow {
  return {
    projectId: "p1",
    stageId: null,
    documentField,
    context: "initial",
    node: null,
    providerId: "openai",
    modelId: "gpt-4o",
    promptTokens: 1_000,
    completionTokens: 500,
    totalTokens: 1_500,
    costUsd: 0.0075,
    costMxn: 0.15,
    jobId: null,
    createdAt,
  };
}

describe("TokenUsageService (telemetría por llamada)", () => {
  type Created = Record<string, unknown>;

  function build(opts?: { failCreate?: boolean }) {
    const created: Created[] = [];
    const prisma = {
      tokenUsage: {
        create: async ({ data }: { data: Created }) => {
          if (opts?.failCreate) throw new Error("db caída");
          created.push(data);
          return data;
        },
      },
    };
    const fxRate = { usdToMxn: async (usd: number) => usd * 20, getMxnPerUsd: async () => 20 };
    const service = new TokenUsageService(prisma as never, fxRate as never);
    return { service, created };
  }

  const base = {
    projectId: "p1",
    documentField: "mddContent",
    context: "initial" as const,
    providerId: "openai",
    modelId: "gpt-4o",
  };

  it("record escribe las columnas de telemetría cuando vienen", async () => {
    const { service, created } = build();
    await service.record({
      ...base,
      node: "auditor",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      latencyMs: 1234,
      attempts: 2,
      outcome: "ok",
      estimated: false,
      modelActual: "gpt-4o-mini",
    });
    assert.equal(created.length, 1);
    const row = created[0]!;
    assert.equal(row.latencyMs, 1234);
    assert.equal(row.attempts, 2);
    assert.equal(row.outcome, "ok");
    assert.equal(row.estimated, false);
    assert.equal(row.modelActual, "gpt-4o-mini");
    assert.equal(row.costKnown, true);
    assert.equal(row.node, "auditor");
  });

  it("record deja NULL las columnas ausentes y marca costKnown=false sin tarifa", async () => {
    const { service, created } = build();
    await service.record({
      ...base,
      modelId: "modelo-sin-tarifa-xyz",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      capability: "scoped_high",
    });
    const row = created[0]!;
    assert.equal(row.latencyMs, null);
    assert.equal(row.attempts, null);
    assert.equal(row.outcome, null);
    assert.equal(row.estimated, null);
    assert.equal(row.modelActual, null);
    assert.equal(row.costKnown, false);
    assert.equal(row.costUsd, 0);
    assert.equal(row.node, "scoped_high");
  });

  it("recordEstimated convierte chars/4 en tokens y marca estimated", async () => {
    const { service, created } = build();
    await service.recordEstimated({
      ...base,
      inputChars: 4001,
      outputChars: 100,
      outcome: "abort",
      latencyMs: 90_000,
      attempts: 1,
    });
    const row = created[0]!;
    assert.equal(row.promptTokens, 1001);
    assert.equal(row.completionTokens, 25);
    assert.equal(row.totalTokens, 1026);
    assert.equal(row.estimated, true);
    assert.equal(row.outcome, "abort");
    assert.equal(row.costKnown, true);
    assert.equal(row.latencyMs, 90_000);
  });

  it("recordEstimated marca costKnown=false si el modelo no tiene tarifa", async () => {
    const { service, created } = build();
    await service.recordEstimated({
      ...base,
      modelId: "modelo-sin-tarifa-xyz",
      inputChars: 8,
      outputChars: 0,
      outcome: "timeout",
    });
    const row = created[0]!;
    assert.equal(row.promptTokens, 2);
    assert.equal(row.completionTokens, 0);
    assert.equal(row.costKnown, false);
    assert.equal(row.estimated, true);
  });

  it("tarifa con el modelo real (modelActual) y conserva modelId configurado", async () => {
    const { service, created } = build();
    // El configurado no tiene tarifa; el que respondió (fallback) sí: el coste sale del real.
    await service.record({
      ...base,
      modelId: "modelo-sin-tarifa-xyz",
      modelActual: "gpt-4o",
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    });
    const row = created[0]!;
    assert.equal(row.modelId, "modelo-sin-tarifa-xyz");
    assert.equal(row.modelActual, "gpt-4o");
    assert.equal(row.costUsd, 2.5);
    assert.equal(row.costKnown, true);
  });

  it("skipCost: coste 0 y costKnown=false aunque el modelo tenga tarifa", async () => {
    const { service, created } = build();
    await service.recordEstimated({
      ...base,
      inputChars: 0,
      outputChars: 0,
      outcome: "error",
      skipCost: true,
    });
    const row = created[0]!;
    assert.equal(row.costUsd, 0);
    assert.equal(row.costKnown, false);
    assert.equal(row.estimated, true);
    assert.equal(row.outcome, "error");
  });

  it("un fallo de escritura incrementa failedWrites y no lanza", async () => {
    const { service } = build({ failCreate: true });
    assert.equal(service.failedWrites, 0);
    await assert.doesNotReject(
      service.record({ ...base, promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
    );
    await assert.doesNotReject(
      service.recordEstimated({ ...base, inputChars: 4, outputChars: 4, outcome: "error" }),
    );
    assert.equal(service.failedWrites, 2);
    const health = service.getTelemetryHealth();
    assert.equal(health.failedWrites, 2);
    assert.equal(health.lastError, "db caída");
    assert.ok(health.lastErrorAt instanceof Date);
  });
});

describe("aggregateTokenUsageRows (contadores de llamadas)", () => {
  const ok: RawTokenUsageRow = {
    ...baseRow("mddContent", t0),
    outcome: "ok",
    costKnown: true,
    estimated: false,
    costUsd: 0.0075,
    costMxn: 0.15,
  };
  // Llamada fallida con skipCost: sin tokens ni coste; costKnown false por el skipCost.
  const errorSkip: RawTokenUsageRow = {
    ...baseRow("mddContent", t1),
    outcome: "error",
    costKnown: false,
    estimated: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costMxn: 0,
  };
  // Timeout estimada (chars/4) con tarifa conocida.
  const timeoutEstimated: RawTokenUsageRow = {
    ...baseRow("mddContent", t2),
    outcome: "timeout",
    costKnown: true,
    estimated: true,
    promptTokens: 300,
    completionTokens: 20,
    totalTokens: 320,
    costUsd: 0.0012,
    costMxn: 0.024,
  };

  it("calls/generations cuentan todas las filas; failedCalls, estimatedCalls y costUnknown son aditivos", () => {
    const summary = aggregateTokenUsageRows("p1", [ok, errorSkip, timeoutEstimated]);
    const doc = summary.documents[0]!;
    assert.equal(doc.generations, 3);
    assert.equal(doc.failedCalls, 2);
    assert.equal(doc.estimatedCalls, 1);
    assert.equal(doc.costUnknown, false);

    assert.equal(doc.byModel.length, 1);
    const entry = doc.byModel[0]!;
    assert.equal(entry.calls, 3);
    assert.equal(entry.failedCalls, 2);
    assert.equal(entry.estimatedCalls, 1);
    assert.equal(entry.costUnknown, false);
    assert.equal(entry.totalTokens, 1_500 + 0 + 320);
  });

  it("costUnknown: true si una fila con tokens > 0 no tiene tarifa; la fila skipCost no cuenta", () => {
    const sinTarifa: RawTokenUsageRow = {
      ...baseRow("mddContent", t2),
      modelId: "modelo-sin-tarifa-xyz",
      outcome: "ok",
      costKnown: false,
      costUsd: 0,
      costMxn: 0,
    };
    const doc = aggregateTokenUsageRows("p1", [ok, errorSkip, sinTarifa]).documents[0]!;
    assert.equal(doc.costUnknown, true);
    const sinTarifaEntry = doc.byModel.find((m) => m.modelId === "modelo-sin-tarifa-xyz");
    const gpt4oEntry = doc.byModel.find((m) => m.modelId === "gpt-4o");
    assert.equal(sinTarifaEntry?.costUnknown, true);
    assert.equal(gpt4oEntry?.costUnknown, false);
  });

  it("una fila sin outcome y sin tarifa no cuenta como fallida", () => {
    const antigua: RawTokenUsageRow = { ...baseRow("mddContent", t0), outcome: null, costKnown: false };
    const doc = aggregateTokenUsageRows("p1", [antigua]).documents[0]!;
    assert.equal(doc.failedCalls, 0);
    assert.equal(doc.estimatedCalls, 0);
    assert.equal(doc.costUnknown, true);
  });
});
