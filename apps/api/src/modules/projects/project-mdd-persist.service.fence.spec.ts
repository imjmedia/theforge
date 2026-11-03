import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { runWithMddLeaseContext } from "../../common/mdd-lease-context.js";
import { runWithRequestUser } from "../../common/request-user.store.js";
import {
  MddWriteFencedError,
  ProjectMddPersistService,
} from "./project-mdd-persist.service.js";

type UpdateManyArgs = { where: unknown; data: Record<string, unknown> };
type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

const STAGE_ID = "stage-1";
const PROJECT_ID = "project-1";
const USER_ID = "user-1";
const LONG_MD =
  "# MDD de prueba\n\n## 1. Contexto\n\nDescripción suficientemente larga para pasar el filtro mínimo de persistencia.\n";

/** Prisma mock mínimo: registra cada escritura y responde `count` en updateMany. */
function makePrisma(updateManyCount: number, stageExists = true) {
  const updateManyCalls: UpdateManyArgs[] = [];
  const updateCalls: UpdateArgs[] = [];
  const stage = {
    id: STAGE_ID,
    ordinal: 1,
    mddContent: null,
    brdContent: null,
    domainInventory: null,
    shortTermContext: null,
    status: "DRAFT",
    precisionScore: 0,
    estimation: null,
  };
  const prisma = {
    project: {
      findFirst: async () => ({
        id: PROJECT_ID,
        userId: USER_ID,
        visibility: "PRIVATE",
        dbgaContent: null,
        specContent: null,
        infraContent: null,
        stages: [stage],
      }),
    },
    stage: {
      updateMany: async (args: UpdateManyArgs) => {
        updateManyCalls.push(args);
        return { count: updateManyCount };
      },
      update: async (args: UpdateArgs) => {
        updateCalls.push(args);
        return stage;
      },
      findUnique: async () => (stageExists ? { status: "DRAFT", precisionScore: 0, shortTermContext: null } : null),
    },
  };
  return { prisma, updateManyCalls, updateCalls };
}

function makeService(updateManyCount: number, stageExists = true) {
  const { prisma, updateManyCalls, updateCalls } = makePrisma(updateManyCount, stageExists);
  const changeLogCalls: unknown[][] = [];
  const changeLog = {
    log: async (...args: unknown[]) => {
      changeLogCalls.push(args);
    },
  };
  const pipelineCalls: unknown[] = [];
  const mddUpdatePipeline = {
    process: async (md: string) => {
      pipelineCalls.push(md);
      return {
        ok: true,
        sanitizedMdd: md,
        status: "DRAFT",
        precisionScore: 0,
        persistFormatted: true,
        sddGraph: undefined,
      };
    },
  };
  let semaphoreRefreshes = 0;
  const deliverableGate = {
    refreshStageSemaphoreFromProject: async () => {
      semaphoreRefreshes += 1;
    },
  };
  let estimationRecalcs = 0;
  const estimationRecalc = {
    recalcAndUpsert: async () => {
      estimationRecalcs += 1;
    },
  };
  const service = new ProjectMddPersistService(
    prisma as never,
    changeLog as never,
    mddUpdatePipeline as never,
    estimationRecalc as never,
    deliverableGate as never,
  );
  return {
    service,
    updateManyCalls,
    updateCalls,
    changeLogCalls,
    pipelineCalls,
    semaphoreRefreshes: () => semaphoreRefreshes,
    estimationRecalcs: () => estimationRecalcs,
  };
}

const EXPECTED_WHERE = {
  id: STAGE_ID,
  OR: [{ mddLeaseFence: null }, { mddLeaseFence: { lte: 7n } }],
};

describe("ProjectMddPersistService.claimMddWriteFence", () => {
  it("con count 1 no lanza y el where admite fence nulo o ≤ al del turno", async () => {
    const { service, updateManyCalls } = makeService(1);
    await service.claimMddWriteFence(STAGE_ID, 7);
    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(updateManyCalls[0].where, EXPECTED_WHERE);
    assert.deepEqual(updateManyCalls[0].data, { mddLeaseFence: 7n });
  });

  it("con count 0 lanza MddWriteFencedError con code, stageId y fence", async () => {
    const { service } = makeService(0);
    await assert.rejects(
      () => service.claimMddWriteFence(STAGE_ID, 7),
      (err: unknown) => {
        assert.ok(err instanceof MddWriteFencedError);
        assert.equal(err.code, "MDD_WRITE_FENCED");
        assert.equal(err.name, "MddWriteFencedError");
        assert.equal(err.stageId, STAGE_ID);
        assert.equal(err.fence, 7);
        return true;
      },
    );
  });
});

describe("ProjectMddPersistService.persistMddFromBackgroundJob con fence", () => {
  it("con fence y count 0 lanza y no registra change-log, snapshot ni semáforo", async () => {
    const h = makeService(0);
    await assert.rejects(
      () =>
        runWithRequestUser(USER_ID, () =>
          h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, {
            stageId: STAGE_ID,
            finalize: true,
            fence: 7,
          }),
        ),
      MddWriteFencedError,
    );
    assert.equal(h.updateManyCalls.length, 1);
    assert.equal(h.updateCalls.length, 0, "no debe haber stage.update (ni snapshot)");
    assert.equal(h.changeLogCalls.length, 0);
    assert.equal(h.semaphoreRefreshes(), 0);
    assert.equal(h.estimationRecalcs(), 0);
  });

  it("con fence y count 1 escribe con updateMany condicionado y registra change-log", async () => {
    const h = makeService(1);
    await runWithRequestUser(USER_ID, () =>
      h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, {
        stageId: STAGE_ID,
        finalize: true,
        fence: 7,
      }),
    );
    assert.equal(h.updateManyCalls.length, 1);
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.ok("mddContent" in h.updateManyCalls[0].data);
    assert.equal(h.changeLogCalls.length, 1);
    assert.equal(h.semaphoreRefreshes(), 1);
    assert.equal(h.estimationRecalcs(), 1);
  });

  it("sin fence usa stage.update como antes y no toca updateMany", async () => {
    const h = makeService(0);
    await runWithRequestUser(USER_ID, () =>
      h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, {
        stageId: STAGE_ID,
        finalize: true,
      }),
    );
    assert.equal(h.updateManyCalls.length, 0);
    const mddWrite = h.updateCalls.find((c) => "mddContent" in c.data);
    assert.ok(mddWrite, "debe existir un stage.update con mddContent");
    assert.deepEqual(mddWrite.where, { id: STAGE_ID });
    assert.equal(h.changeLogCalls.length, 1);
  });
});

describe("ProjectMddPersistService: count 0 sin fence mayor (B2)", () => {
  it("claimMddWriteFence con la etapa inexistente lanza NotFoundException, no MddWriteFencedError", async () => {
    const { service } = makeService(0, false);
    await assert.rejects(
      () => service.claimMddWriteFence(STAGE_ID, 7),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundException);
        assert.equal(err.message, "Etapa no encontrada");
        assert.equal(err instanceof MddWriteFencedError, false);
        return true;
      },
    );
  });

  it("con fence y la etapa inexistente, la escritura del MDD lanza NotFoundException y no escribe", async () => {
    const h = makeService(0, false);
    await assert.rejects(
      () =>
        runWithRequestUser(USER_ID, () =>
          h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, {
            stageId: STAGE_ID,
            finalize: true,
            fence: 7,
          }),
        ),
      NotFoundException,
    );
    assert.equal(h.changeLogCalls.length, 0);
  });
});

describe("ProjectMddPersistService: fence del lease activo (contexto MDD)", () => {
  it("persistMddFromBackgroundJob sin fence explícito toma el fence del lease del contexto", async () => {
    const h = makeService(1);
    await runWithMddLeaseContext({ fence: 7, key: `${PROJECT_ID}:${STAGE_ID}` }, () =>
      runWithRequestUser(USER_ID, () =>
        h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, { stageId: STAGE_ID, finalize: true }),
      ),
    );
    assert.equal(h.updateManyCalls.length, 1, "la escritura va condicionada, no por stage.update");
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.equal(
      h.updateCalls.some((c) => "mddContent" in c.data),
      false,
      "ningún stage.update escribe mddContent (el snapshot del gate no cuenta)",
    );
  });

  it("persistMddFromPatch (formato) dentro del contexto usa el fence del lease", async () => {
    const h = makeService(1);
    await runWithMddLeaseContext({ fence: 7, key: `${PROJECT_ID}:${STAGE_ID}` }, () =>
      h.service.persistMddFromPatch({
        projectId: PROJECT_ID,
        stageId: STAGE_ID,
        mddMarkdown: LONG_MD,
        mergedForSemaphore: {} as never,
        stageBaseline: { status: "DRAFT" as never, precisionScore: 0 },
        patchFlags: { mddFormatOnly: true },
      }),
    );
    assert.equal(h.updateManyCalls.length, 1);
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.equal(h.updateCalls.length, 0);
  });

  it("el fence explícito de la opción gana al del contexto", async () => {
    const h = makeService(1);
    await runWithMddLeaseContext({ fence: 7, key: `${PROJECT_ID}:${STAGE_ID}` }, () =>
      runWithRequestUser(USER_ID, () =>
        h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, { stageId: STAGE_ID, finalize: true, fence: 9 }),
      ),
    );
    assert.deepEqual(h.updateManyCalls[0].where, {
      id: STAGE_ID,
      OR: [{ mddLeaseFence: null }, { mddLeaseFence: { lte: 9n } }],
    });
  });

  it("fuera de lease (PATCH web) sin fence la escritura sigue siendo stage.update", async () => {
    const h = makeService(0);
    await h.service.persistMddFromPatch({
      projectId: PROJECT_ID,
      stageId: STAGE_ID,
      mddMarkdown: LONG_MD,
      mergedForSemaphore: {} as never,
      stageBaseline: { status: "DRAFT" as never, precisionScore: 0 },
      patchFlags: { mddFormatOnly: true },
    });
    assert.equal(h.updateManyCalls.length, 0);
    assert.equal(h.updateCalls.length, 1);
    assert.deepEqual(h.updateCalls[0].where, { id: STAGE_ID });
  });
});

describe("ProjectMddPersistService.persistMddFromBackgroundJob con fence (borrador)", () => {
  it("borrador con fence y count 0 lanza y no registra change-log", async () => {
    const h = makeService(0);
    await assert.rejects(
      () =>
        runWithRequestUser(USER_ID, () =>
          h.service.persistMddFromBackgroundJob(PROJECT_ID, LONG_MD, {
            stageId: STAGE_ID,
            finalize: false,
            fence: 7,
          }),
        ),
      MddWriteFencedError,
    );
    assert.equal(h.updateManyCalls.length, 1);
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.equal(h.updateCalls.length, 0);
    assert.equal(h.changeLogCalls.length, 0);
  });
});

describe("ProjectMddPersistService.persistMddDeliveryGateSnapshot con fence", () => {
  const GATE = { ok: false, violations: [] } as never;

  it("con fence y count 0 no escribe ni lanza (snapshot auxiliar)", async () => {
    const h = makeService(0);
    await h.service.persistMddDeliveryGateSnapshot(STAGE_ID, GATE, 7);
    assert.equal(h.updateManyCalls.length, 1);
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.ok("shortTermContext" in h.updateManyCalls[0].data);
    assert.equal(h.updateCalls.length, 0);
  });

  it("con fence y count 1 escribe con updateMany condicionado", async () => {
    const h = makeService(1);
    await h.service.persistMddDeliveryGateSnapshot(STAGE_ID, GATE, 7);
    assert.equal(h.updateManyCalls.length, 1);
    assert.deepEqual(h.updateManyCalls[0].where, EXPECTED_WHERE);
    assert.equal(h.updateCalls.length, 0);
  });

  it("sin fence escribe con stage.update como antes", async () => {
    const h = makeService(0);
    await h.service.persistMddDeliveryGateSnapshot(STAGE_ID, GATE);
    assert.equal(h.updateManyCalls.length, 0);
    assert.equal(h.updateCalls.length, 1);
    assert.deepEqual(h.updateCalls[0].where, { id: STAGE_ID });
    assert.ok("shortTermContext" in h.updateCalls[0].data);
  });
});
