import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { buildMddUpstreamBaseline } from "@theforge/shared-types/mdd-upstream-sync-node";
import { MddUpstreamSyncService } from "./mdd-upstream-sync.service.js";

const MDD =
  "# Master Design Document\n\n## 1. Contexto\n\n" +
  "Contenido sustancial del alcance del microservicio de costos.\n".repeat(20);

describe("MddUpstreamSyncService.acceptBaseline", () => {
  it("pendingSync true → accept → pendingSync false sin mutar mddContent", async () => {
    const stageId = "stage-1";
    const projectId = "proj-1";
    const oldBaseline = buildMddUpstreamBaseline({
      dbgaContent: "dbga old",
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: MDD,
    });

    let storedBaseline: unknown = oldBaseline;
    let dbgaContent = "dbga new aligned";
    const mddContent = MDD;

    const prisma = {
      stage: {
        update: mock.fn(async ({ data }: { data: { mddUpstreamBaseline: unknown } }) => {
          storedBaseline = data.mddUpstreamBaseline;
          return { id: stageId };
        }),
      },
    };

    const projects = {
      findOne: mock.fn(async () => ({
        id: projectId,
        dbgaContent,
        phase0SummaryContent: "{}",
        stages: [
          {
            id: stageId,
            brdContent: "brd",
            phase0SummaryContent: "{}",
            mddContent,
            mddUpstreamBaseline: storedBaseline,
          },
        ],
      })),
    };

    const service = new MddUpstreamSyncService(
      prisma as never,
      projects as never,
    );

    const before = await service.analyze(projectId, stageId);
    assert.equal(before.pendingSync, true);

    const result = await service.acceptBaseline(projectId, stageId);
    assert.equal(result.mddLength, mddContent.length);
    assert.equal(result.syncStatus.pendingSync, false);
    assert.equal(result.analysis.pendingSync, false);
    assert.equal(prisma.stage.update.mock.callCount(), 1);

    const after = await service.analyze(projectId, stageId);
    assert.equal(after.pendingSync, false);
    assert.equal(mddContent, MDD);
  });

  it("rechaza accept sin MDD suficiente", async () => {
    const stageId = "stage-1";
    const projectId = "proj-1";
    const prisma = { stage: { update: mock.fn(async () => ({})) } };
    const projects = {
      findOne: mock.fn(async () => ({
        id: projectId,
        dbgaContent: "dbga",
        stages: [
          {
            id: stageId,
            brdContent: "brd",
            phase0SummaryContent: "{}",
            mddContent: "corto",
            mddUpstreamBaseline: null,
          },
        ],
      })),
    };
    const service = new MddUpstreamSyncService(prisma as never, projects as never);
    await assert.rejects(
      () => service.acceptBaseline(projectId, stageId),
      (err: unknown) => err instanceof BadRequestException,
    );
    assert.equal(prisma.stage.update.mock.callCount(), 0);
  });
});
