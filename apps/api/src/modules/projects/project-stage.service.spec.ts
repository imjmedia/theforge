import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithRequestUser } from "../../common/request-user.store.js";
import { ProjectStageService } from "./project-stage.service.js";

const USER_ID = "user-1";
const PROJECT_ID = "project-1";

/** Etapa tal como la devuelve Prisma: incluye el fence interno del lease MDD (BigInt, ADR 0004). */
function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-1",
    projectId: PROJECT_ID,
    ordinal: 1,
    key: "stage_1",
    name: "Etapa 1",
    workflowStatus: "DRAFT",
    mddContent: null,
    status: "ROJO",
    precisionScore: 0,
    legacyChangeState: null,
    isLegacy: false,
    theforgeProjectId: null,
    mddLeaseFence: 42n,
    estimation: null,
    ...overrides,
  };
}

/** Prisma mínimo: proyecto del usuario con una etapa; las escrituras devuelven la etapa con su fence. */
function makeService() {
  const stage = stageRow();
  const project = {
    id: PROJECT_ID,
    userId: USER_ID,
    visibility: "PRIVATE",
    projectType: "STANDARD",
    infraContent: null,
    theforgeProjectId: null,
    group: null,
    stages: [stage],
  };
  const prisma = {
    project: {
      findFirst: async () => project,
      findUnique: async () => ({ userId: USER_ID }),
    },
    stage: {
      create: async () => stage,
      findFirst: async () => stage,
      findUnique: async () => stage,
      findMany: async () => [stage],
      update: async () => stage,
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  };
  const estimationRecalc = { recalcAndUpsert: async () => undefined };
  const changeLog = { log: async () => undefined };
  return new ProjectStageService(prisma as never, estimationRecalc as never, changeLog as never);
}

describe("ProjectStageService — el fence del lease MDD no sale en la API (ADR 0004)", () => {
  it("crear etapa: la respuesta no contiene mddLeaseFence y se puede serializar a JSON", async () => {
    const service = makeService();
    const out = await runWithRequestUser(USER_ID, () => service.createStage(PROJECT_ID, { activate: false }));
    assert.equal(out.stage.id, "stage-1");
    assert.equal("mddLeaseFence" in out.stage, false);
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  it("listar etapas: ninguna etapa de la respuesta contiene mddLeaseFence", async () => {
    const service = makeService();
    const out = await runWithRequestUser(USER_ID, () => service.listStages(PROJECT_ID));
    assert.equal(out.stages.length, 1);
    for (const stage of out.stages) {
      assert.equal("mddLeaseFence" in stage, false);
    }
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  it("editar etapa: la respuesta no contiene mddLeaseFence", async () => {
    const service = makeService();
    const out = await runWithRequestUser(USER_ID, () => service.patchStage(PROJECT_ID, "stage-1", { name: "Nueva" }));
    assert.equal(out.stage.id, "stage-1");
    assert.equal("mddLeaseFence" in out.stage, false);
  });

  it("transicionar etapa: la etapa de la respuesta no contiene mddLeaseFence", async () => {
    const service = makeService();
    const out = await runWithRequestUser(USER_ID, () => service.transitionStage(PROJECT_ID, "stage-1", { action: "archive" }));
    assert.equal(out.stage.id, "stage-1");
    assert.equal("mddLeaseFence" in out.stage, false);
    assert.equal(out.transition.action, "archive");
  });
});
