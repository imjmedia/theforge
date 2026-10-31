import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../estimation.service.js";
import { hashMddDraft } from "../mdd-draft-hash.util.js";
import type { AuditorGaps } from "../estimation.types.js";

const MDD = `## 1. Contexto y alcance

Portal interno de gestión de solicitudes con roles, auditoría y notificaciones para el equipo operativo.

## 2. Arquitectura y Stack

Backend NestJS (Node.js) con PostgreSQL y frontend React.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
\`\`\`

## 4. Contratos de API

POST /api/requests con payload JSON { "title": "x" } y respuesta 201.

## 5. Lógica y Edge Cases

Dado un usuario autenticado, cuando crea una solicitud, entonces se persiste. Edge cases: idempotencia en reintentos.

## 6. Seguridad

Autenticación con tokens, autorización por roles (RBAC) y cifrado en tránsito.

## 7. Infraestructura

Dockerfile con FROM node:20 y docker compose.
`;

const GAPS: AuditorGaps = {
  score: 95,
  status: "APROBADO",
  critical_gaps: [],
  syntax_errors: [],
  infrastructure_ready: true,
};

function makePrisma(stageMdd: string | null = MDD, snapshot?: Record<string, unknown>) {
  return {
    project: {
      findUnique: async () => ({
        complexity: "HIGH",
        specContent: null,
        dbgaContent: null,
        architectureContent: null,
        useCasesContent: null,
        userStoriesContent: null,
        blueprintContent: null,
        apiContractsContent: null,
        logicFlowsContent: null,
        infraContent: null,
        tasksContent: null,
        stages: stageMdd == null ? [] : [{ id: "s1", ordinal: 1, workflowStatus: "ACTIVE", mddContent: stageMdd }],
      }),
    },
    stage: {
      findUnique: async () => ({
        id: "s1",
        brdContent: null,
        mddContent: stageMdd,
        shortTermContext: snapshot ? { mddAuditSnapshot: snapshot } : null,
      }),
      update: async () => ({}),
    },
  };
}

function makeService(prisma = makePrisma()): EstimationService {
  return new EstimationService(prisma as never);
}

describe("EstimationService: gaps del Auditor con override del editor", () => {
  it("usa los gaps cuando el hash normalizado del override coincide con el auditado", async () => {
    const svc = makeService();
    svc.setAuditorGaps("p1", GAPS, "s1", hashMddDraft(MDD));
    // Mismo contenido con espacios/saltos distintos (el editor re-serializa).
    const edited = `\n\n${MDD.replace(/\n\n/g, "\n\n\n")}   `;
    const r = await svc.getLiveMetricsForProject("p1", edited, "s1", { syncStage: false });
    assert.equal(r.mddQualitySource, "auditor");
    assert.equal(r.auditorScore, 95);
    assert.equal(r.mddQualityScore, 95);
  });

  it("cae a regex y lo marca cuando el override difiere del auditado", async () => {
    const svc = makeService();
    svc.setAuditorGaps("p1", GAPS, "s1", hashMddDraft(MDD));
    const r = await svc.getLiveMetricsForProject("p1", MDD + "\nCambio posterior del usuario.", "s1", {
      syncStage: false,
    });
    assert.equal(r.mddQualitySource, "regex");
    assert.equal(r.auditorScore, undefined);
  });

  it("gaps sin hash se atan al contenido del servidor: aplican si el override es ese contenido", async () => {
    const svc = makeService();
    svc.setAuditorGaps("p1", GAPS, "s1");
    const same = await svc.getLiveMetricsForProject("p1", MDD, "s1", { syncStage: false });
    assert.equal(same.mddQualitySource, "auditor");
    const other = await svc.getLiveMetricsForProject("p1", MDD + "\nOtra línea.", "s1", { syncStage: false });
    assert.equal(other.mddQualitySource, "regex");
  });

  it("el snapshot persistido con auditedDraftHash se usa si coincide el override", async () => {
    const svc = makeService(
      makePrisma(MDD, { auditorGaps: GAPS, auditedDraftHash: hashMddDraft(MDD), updatedAt: "2026-01-01" }),
    );
    const ok = await svc.getLiveMetricsForProject("p1", MDD, "s1", { syncStage: false });
    assert.equal(ok.mddQualitySource, "auditor");
    const stale = await svc.getLiveMetricsForProject("p1", MDD + " extra", "s1", { syncStage: false });
    assert.equal(stale.mddQualitySource, "regex");
  });

  it("no cruza etapas: gaps registrados sin etapa no aplican a una consulta con stageId", async () => {
    const svc = makeService();
    svc.setAuditorGaps("p1", GAPS, undefined, hashMddDraft(MDD));
    const r = await svc.getLiveMetricsForProject("p1", MDD, "s1", { syncStage: false });
    assert.equal(r.mddQualitySource, "regex");
  });

  it("el re-registro del mismo gaps durante el stream conserva el hash original (draft cambia -> regex)", async () => {
    const svc = makeService(makePrisma(null));
    svc.setLiveDraft("p1", MDD, "s1");
    svc.setAuditorGaps("p1", GAPS, "s1");
    const drifted = MDD + "\nSección ampliada por el Executor.";
    svc.setLiveDraft("p1", drifted, "s1");
    svc.setAuditorGaps("p1", { ...GAPS }, "s1");
    const r = await svc.getLiveMetricsForProject("p1", drifted, "s1", { syncStage: false });
    assert.equal(r.mddQualitySource, "regex");
    const original = await svc.getLiveMetricsForProject("p1", MDD, "s1", { syncStage: false });
    assert.equal(original.mddQualitySource, "auditor");
  });

  it("dropAuditorGapsIfContentChanged / rebindAuditorGapsToPersistedContent", async () => {
    const svc = makeService();
    svc.setAuditorGaps("p1", GAPS, "s1", hashMddDraft(MDD));
    svc.rebindAuditorGapsToPersistedContent("p1", "s1", MDD + "\n<!-- formato -->");
    const rebound = await svc.getLiveMetricsForProject("p1", MDD + "\n<!-- formato -->", "s1", { syncStage: false });
    assert.equal(rebound.mddQualitySource, "auditor");
    svc.dropAuditorGapsIfContentChanged("p1", "s1", MDD + "\notra cosa");
    const dropped = await svc.getLiveMetricsForProject("p1", MDD + "\n<!-- formato -->", "s1", { syncStage: false });
    assert.equal(dropped.mddQualitySource, "regex");
  });

  it("MDD perfecto con Auditor 95: titular 95 y semáforo verde aunque el integral (docs vacíos) sea bajo", () => {
    const svc = makeService();
    const r = svc.calculateLiveMetrics(MDD, {
      auditorGaps: GAPS,
      complexity: "HIGH",
      documents: { mddContent: MDD },
    });
    assert.equal(r.mddQualitySource, "auditor");
    assert.equal(r.auditorScore, 95);
    assert.ok(r.precision < 90, `integral=${r.precision}`);
    assert.equal(r.status, "green");
  });

  it("sin gaps del Auditor: mddQualitySource regex y sin auditorScore", () => {
    const r = makeService().calculateLiveMetrics(MDD, { complexity: "HIGH", documents: { mddContent: MDD } });
    assert.equal(r.mddQualitySource, "regex");
    assert.equal(r.auditorScore, undefined);
  });
});

describe("EstimationService: complejidad desde Prisma", () => {
  it("ensureProjectComplexity carga Project.complexity y alimenta calculateLiveMetrics", async () => {
    const prisma = makePrisma();
    prisma.project.findUnique = (async () => ({ complexity: "LOW" })) as never;
    const svc = makeService(prisma);
    assert.equal(await svc.ensureProjectComplexity("p9", null), "LOW");
    const r = svc.calculateLiveMetrics(MDD, { projectId: "p9", stageId: null });
    assert.ok(r.precision >= 0);
  });
});
