/**
 * `GET /projects/generation-summary?ids=`: una sola query de lectura (`filterReadable`), sin recorte
 * silencioso (H12). Más de `MAX_GENERATION_SUMMARY_IDS` ids => 400.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ProjectAccessService } from "../../common/access/project-access.service.js";
import { requestUserStore } from "../../common/request-user.store.js";
import { MAX_GENERATION_SUMMARY_IDS, ProjectsController } from "./projects.controller.js";

function makeController() {
  const calls = { findMany: 0, findUnique: 0, summaries: [] as string[][] };
  const rows = [
    { id: "p-own", userId: "user-a", visibility: "PRIVATE" },
    { id: "p-shared", userId: "user-b", visibility: "SHARED" },
    { id: "p-hidden", userId: "user-b", visibility: "PRIVATE" },
  ];
  const prisma = {
    project: {
      findUnique: async () => {
        calls.findUnique++;
        return null;
      },
      findMany: async (args: { where: { id: { in: string[] }; OR: Array<{ userId?: string; visibility?: string }> } }) => {
        calls.findMany++;
        return rows
          .filter((r) => args.where.id.in.includes(r.id) && args.where.OR.some((c) => c.userId === r.userId || c.visibility === r.visibility))
          .map((r) => ({ id: r.id }));
      },
    },
  };
  const controller = Object.create(ProjectsController.prototype) as ProjectsController;
  Object.assign(controller, {
    access: new ProjectAccessService(prisma as never),
    generationGuard: {
      getDashboardSummaries: (ids: string[]) => {
        calls.summaries.push(ids);
        return Object.fromEntries(ids.map((id) => [id, { busy: false }]));
      },
    },
  });
  return { controller, calls };
}

const asUserA = <T>(fn: () => Promise<T>) => requestUserStore.run({ userId: "user-a", role: "developer" }, fn);

describe("GET /projects/generation-summary", () => {
  it("filtra por lectura con una sola query y sin findUnique por id", async () => {
    const { controller, calls } = makeController();
    await asUserA(() => controller.generationSummary("p-own, p-shared,p-hidden,nope,p-own"));
    assert.equal(calls.findMany, 1);
    assert.equal(calls.findUnique, 0);
    assert.deepEqual(calls.summaries, [["p-own", "p-shared"]]);
  });

  it("sin ids => resumen vacío sin consultar la BD", async () => {
    const { controller, calls } = makeController();
    await asUserA(() => controller.generationSummary(undefined));
    assert.equal(calls.findMany, 0);
    assert.deepEqual(calls.summaries, [[]]);
  });

  it("no recorta en silencio: más de MAX ids => 400", async () => {
    const { controller, calls } = makeController();
    const many = Array.from({ length: MAX_GENERATION_SUMMARY_IDS + 1 }, (_, i) => `id-${i}`).join(",");
    await assert.rejects(
      asUserA(() => controller.generationSummary(many)),
      (e: unknown) => e instanceof BadRequestException,
    );
    assert.equal(calls.findMany, 0);
  });

  it("exactamente MAX ids es válido", async () => {
    const { controller, calls } = makeController();
    const exact = Array.from({ length: MAX_GENERATION_SUMMARY_IDS }, (_, i) => `id-${i}`).join(",");
    await asUserA(() => controller.generationSummary(exact));
    assert.equal(calls.findMany, 1);
  });
});
