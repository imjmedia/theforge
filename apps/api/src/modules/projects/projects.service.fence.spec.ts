import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ProjectsService } from "./projects.service.js";

type Stage = { id: string; ordinal: number; workflowStatus: string };
type Claim = { stageId: string; fence: number };

/**
 * Construye `ProjectsService` con prisma y `ProjectMddPersistService` mock; el resto de dependencias (14 en total,
 * por posición) no se usa en `claimMddWriteFence` y va como `{}`.
 */
function makeService(project: { stages: Stage[] } | null) {
  const findUniqueCalls: unknown[] = [];
  const claims: Claim[] = [];
  const prisma = {
    project: {
      findUnique: async (args: unknown) => {
        findUniqueCalls.push(args);
        return project;
      },
    },
  };
  const mddPersist = {
    claimMddWriteFence: async (stageId: string, fence: number) => {
      claims.push({ stageId, fence });
    },
  };
  const deps: unknown[] = [prisma, mddPersist, ...Array.from({ length: 12 }, () => ({}))];
  const service = new ProjectsService(...(deps as unknown as ConstructorParameters<typeof ProjectsService>));
  return { service, findUniqueCalls, claims };
}

const STAGES: Stage[] = [
  { id: "stage-1", ordinal: 1, workflowStatus: "COMPLETED" },
  { id: "stage-2", ordinal: 2, workflowStatus: "ACTIVE" },
  { id: "stage-3", ordinal: 3, workflowStatus: "DRAFT" },
];

describe("ProjectsService.claimMddWriteFence (ADR 0004)", () => {
  it("con stageId dado delega directo en la persistencia, sin consultar el proyecto", async () => {
    const { service, findUniqueCalls, claims } = makeService({ stages: STAGES });
    await service.claimMddWriteFence("proj-1", "stage-3", 42);
    assert.deepEqual(claims, [{ stageId: "stage-3", fence: 42 }]);
    assert.equal(findUniqueCalls.length, 0);
  });

  it("con stageId vacío (solo espacios) resuelve la etapa primaria y delega en ella", async () => {
    const { service, findUniqueCalls, claims } = makeService({ stages: STAGES });
    await service.claimMddWriteFence("proj-1", "   ", 42);
    assert.equal(findUniqueCalls.length, 1);
    assert.deepEqual(claims, [{ stageId: "stage-2", fence: 42 }], "la ACTIVE es la primaria");
  });

  it("con stageId null resuelve la etapa primaria (pickPrimaryStage) y delega en ella", async () => {
    const { service, findUniqueCalls, claims } = makeService({ stages: STAGES });
    await service.claimMddWriteFence("proj-1", null, 7);
    assert.equal(findUniqueCalls.length, 1);
    assert.deepEqual(claims, [{ stageId: "stage-2", fence: 7 }]);
  });

  it("proyecto sin etapas: lanza BadRequestException", async () => {
    const { service, claims } = makeService({ stages: [] });
    await assert.rejects(
      () => service.claimMddWriteFence("proj-1", null, 42),
      BadRequestException,
    );
    assert.equal(claims.length, 0);
  });

  it("proyecto inexistente: lanza BadRequestException", async () => {
    const { service, claims } = makeService(null);
    await assert.rejects(
      () => service.claimMddWriteFence("proj-missing", null, 42),
      BadRequestException,
    );
    assert.equal(claims.length, 0);
  });
});
