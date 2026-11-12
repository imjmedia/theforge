/**
 * Paso 5b / 8b: fachada vivo y GET/POST sin escritura de etapa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../estimation.service.js";
import { buildSemaphoreInputsFromLoaded } from "../semaphore-inputs.factory.js";
import { ConformanceService } from "../../../engine/conformance.service.js";
import type { AuditorGaps, PlanningDocumentFields } from "../estimation.types.js";

const FIXTURES = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../eval/mdd/fixtures",
);

const DOC_100 = "x".repeat(100);

function makeService(): EstimationService {
  return new EstimationService({} as never);
}

function loadGoodEcommerce(): string {
  return readFileSync(path.join(FIXTURES, "good-ecommerce-tienda-basica.md"), "utf8");
}

function auditor(score: number): AuditorGaps {
  return {
    status: score >= 85 ? "APROBADO" : "RECHAZADO",
    score,
    critical_gaps: [],
    syntax_errors: [],
    infrastructure_ready: true,
  };
}

describe("estimation-semaphore (P5b)", () => {
  it("CL-01: MDD vacío → rojo", () => {
    const m = makeService().calculateLiveMetrics("", {
      complexity: "HIGH",
      projectId: "synthetic",
    });
    assert.equal(m.status, "red");
    assert.ok(m.semaphore.headline < 85);
  });

  it("CL-03: MDD+BRD+Spec pre-cascada → verde con nota de derivados", () => {
    const mdd = loadGoodEcommerce();
    const docs: PlanningDocumentFields = {
      mddContent: mdd,
      brdContent: DOC_100,
      specContent: DOC_100,
    };
    const m = makeService().calculateLiveMetrics(mdd, {
      complexity: "HIGH",
      projectId: "synthetic",
      documents: docs,
      auditorGaps: auditor(100),
      semaphoreSource: "stream",
    });
    assert.ok(m.semaphore.headline === 100);
    assert.ok(m.status === "green" || m.status === "yellow", `status=${m.status} reasons=${m.semaphore.reasons.join(";")}`);
    assert.ok(m.semaphore.notes.some((n) => /entregables/i.test(n)));
  });

  it("CL-04: Auditor 95 → titular 95 auditor", () => {
    const mdd = loadGoodEcommerce();
    const m = makeService().calculateLiveMetrics(mdd, {
      complexity: "HIGH",
      projectId: "synthetic",
      auditorGaps: auditor(95),
    });
    assert.equal(m.semaphore.headlineSource, "auditor");
    assert.equal(m.semaphore.headline, 95);
    assert.equal(m.auditorScore, 95);
  });

  it("CL-19: blocker con persisted → rojo", () => {
    const mdd = loadGoodEcommerce();
    const m = makeService().calculateLiveMetrics(mdd, {
      complexity: "HIGH",
      projectId: "p-gate",
      documents: { mddContent: mdd, brdContent: "" },
      semaphoreSource: "persisted",
    });
    assert.equal(m.status, "red");
    assert.ok(m.semaphore.reasons.length >= 1);
  });

  it("RF-06: pre_cascade sin derivados → reasons sin Conformidad", () => {
    const mdd = loadGoodEcommerce();
    const m = makeService().calculateLiveMetrics(mdd, {
      complexity: "HIGH",
      projectId: "synthetic",
      documents: { mddContent: mdd, brdContent: DOC_100, specContent: DOC_100 },
      auditorGaps: auditor(100),
      semaphoreSource: "stream",
    });
    assert.equal(m.semaphore.derivativesState, "none");
    assert.ok(!m.semaphore.reasons.some((r) => /^Conformidad/i.test(r)));
  });

  it("expone semaphore con alias status/precision", () => {
    const m = makeService().calculateLiveMetrics(loadGoodEcommerce(), {
      complexity: "HIGH",
      projectId: "synthetic",
    });
    assert.equal(m.status, m.semaphore.status);
    assert.equal(m.precision, m.semaphore.integral ?? m.semaphore.headline);
  });
});

const MDD_MIN = `## 1. Contexto y alcance

Portal interno de gestión con roles y auditoría para el equipo operativo.

## 2. Arquitectura y Stack

Backend NestJS con PostgreSQL y frontend React.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL
);
\`\`\`

## 4. Contratos de API

POST /api/requests con payload JSON y respuesta 201.

## 5. Lógica y Edge Cases

Dado un usuario autenticado, cuando crea una solicitud, entonces se persiste.

## 6. Seguridad

Autenticación con tokens y autorización por roles.

## 7. Infraestructura

Dockerfile con FROM node:20.
`;

describe("estimation-semaphore (P8b GET/POST)", () => {
  function makePrismaForGetPost(opts?: { staleHash?: string }) {
    const stageWrites: unknown[] = [];
    const conformance = new ConformanceService();
    const liveHash = buildSemaphoreInputsFromLoaded(conformance, {
      projectId: "p1",
      stageId: "s1",
      content: MDD_MIN,
      source: "persisted",
      complexity: "HIGH",
    }).inputsHash;
    return {
      prisma: {
        project: {
          findUnique: async () => ({
            complexity: "HIGH",
            projectType: "NEW",
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
            uxUiGuideContent: null,
            hasUxTeam: false,
            approach: null,
          }),
        },
        stage: {
          findUnique: async () => ({
            id: "s1",
            brdContent: opts?.staleHash ? "BRD distinto al sync" : null,
            mddContent: MDD_MIN,
            designSpec: null,
            architectureGraph: null,
            architectureGraphSourceHash: null,
            shortTermContext: opts?.staleHash
              ? { semaphoreSync: { inputsHash: "hash-viejo-no-coincide" } }
              : { semaphoreSync: { inputsHash: liveHash } },
          }),
          update: async (args: unknown) => {
            stageWrites.push(args);
            return {};
          },
          updateMany: async (args: unknown) => {
            stageWrites.push(args);
            return { count: 0 };
          },
        },
      },
      stageWrites,
      liveHash,
    };
  }

  it("RF-12 / CL-28: GET (getLiveMetricsForProject) no llama stage.update ni updateMany", async () => {
    const { prisma, stageWrites } = makePrismaForGetPost();
    const svc = new EstimationService(prisma as never);
    const r = await svc.getLiveMetricsForProject("p1", undefined, "s1");
    assert.ok(r.semaphore);
    assert.equal(stageWrites.length, 0);
  });

  it("RF-12: POST (override mddContent) no escribe etapa", async () => {
    const { prisma, stageWrites } = makePrismaForGetPost();
    const svc = new EstimationService(prisma as never);
    await svc.getLiveMetricsForProject("p1", MDD_MIN + "\nBorrador del editor.", "s1");
    assert.equal(stageWrites.length, 0);
  });

  it("RF-22: persistedStale cuando inputsHash persistido difiere del vivo", async () => {
    const { prisma } = makePrismaForGetPost({ staleHash: "x" });
    const svc = new EstimationService(prisma as never);
    const r = await svc.getLiveMetricsForProject("p1", undefined, "s1");
    assert.equal(r.persistedStale, true);
  });
});
