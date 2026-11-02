import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { requestUserStore } from "../request-user.store.js";
import { isProjectAccessDenied, isProjectLevelForbidden, ProjectAccessService } from "./project-access.service.js";

type ProjectRow = { id: string; userId: string; visibility: string };

function createService(opts: { projects?: ProjectRow[]; stages?: { id: string; projectId: string }[] } = {}) {
  const projects = opts.projects ?? [];
  const stages = opts.stages ?? [];
  const calls = { projectWhere: [] as unknown[], stageWhere: [] as unknown[], findManyArgs: [] as unknown[] };
  const prisma = {
    project: {
      findMany: async (args: {
        where: { id: { in: string[] }; OR: Array<{ userId?: string; visibility?: string }> };
      }) => {
        calls.findManyArgs.push(args);
        return projects
          .filter(
            (p) =>
              args.where.id.in.includes(p.id) &&
              args.where.OR.some((c) => c.userId === p.userId || c.visibility === p.visibility),
          )
          .map((p) => ({ id: p.id }));
      },
      findUnique: async (args: { where: { id: string } }) => {
        calls.projectWhere.push(args.where);
        return projects.find((p) => p.id === args.where.id) ?? null;
      },
    },
    stage: {
      findFirst: async (args: { where: { id: string; projectId: string } }) => {
        calls.stageWhere.push(args.where);
        return stages.find((s) => s.id === args.where.id && s.projectId === args.where.projectId) ?? null;
      },
    },
  };
  return { service: new ProjectAccessService(prisma as never), calls };
}

const owner = { userId: "owner-1", role: "developer" };
const other = { userId: "dev-2", role: "developer" };
const admin = { userId: "admin-3", role: "admin" };

const PROJECTS: ProjectRow[] = [
  { id: "p-private", userId: "owner-1", visibility: "PRIVATE" },
  { id: "p-shared", userId: "owner-1", visibility: "SHARED" },
];

async function rejectsNotFound(p: Promise<unknown>, message: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException);
    assert.equal((e as NotFoundException).message, message);
    return true;
  });
}

async function rejectsLevelForbidden(p: Promise<unknown>, level: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ForbiddenException, `esperaba 403, llegó ${String(e)}`);
    assert.deepEqual((e as ForbiddenException).getResponse(), {
      code: "PROJECT_LEVEL_FORBIDDEN",
      level,
      message: "Solo el dueño del proyecto puede ejecutar esta acción",
    });
    return true;
  });
}

describe("ProjectAccessService.assertProject", () => {
  it("proyecto inexistente => 404", async () => {
    const { service } = createService({ projects: PROJECTS });
    await rejectsNotFound(service.assertProject(owner, "nope", "read"), "Project not found");
  });

  it("PRIVATE ajeno => 404 con el mismo mensaje que inexistente", async () => {
    const { service } = createService({ projects: PROJECTS });
    await rejectsNotFound(service.assertProject(other, "p-private", "read"), "Project not found");
    await rejectsNotFound(service.assertProject(admin, "p-private", "read", { allowAdmin: true }), "Project not found");
  });

  it("dueño obtiene isOwner=true en PRIVATE", async () => {
    const { service } = createService({ projects: PROJECTS });
    const res = await service.assertProject(owner, "p-private", "spend");
    assert.deepEqual(res, { id: "p-private", userId: "owner-1", visibility: "PRIVATE", isOwner: true });
  });

  it("SHARED ajeno: read OK (isOwner=false) y spend => 403 PROJECT_LEVEL_FORBIDDEN", async () => {
    const { service } = createService({ projects: PROJECTS });
    const res = await service.assertProject(other, "p-shared", "read");
    assert.equal(res.isOwner, false);
    assert.equal(res.visibility, "SHARED");
    await rejectsLevelForbidden(service.assertProject(other, "p-shared", "spend"), "spend");
    await rejectsLevelForbidden(service.assertProject(other, "p-shared", "manage"), "manage");
  });

  it("PRIVATE ajeno pidiendo spend o manage => 404, no 403", async () => {
    const { service } = createService({ projects: PROJECTS });
    await rejectsNotFound(service.assertProject(other, "p-private", "spend"), "Project not found");
    await rejectsNotFound(service.assertProject(other, "p-private", "manage"), "Project not found");
  });

  it("isProjectLevelForbidden / isProjectAccessDenied distinguen el 403 de nivel de otros errores", async () => {
    const { service } = createService({ projects: PROJECTS });
    const err = await service.assertProject(other, "p-shared", "spend").catch((e: unknown) => e);
    assert.equal(isProjectLevelForbidden(err), true);
    assert.equal(isProjectAccessDenied(err), true);
    assert.equal(isProjectLevelForbidden(new ForbiddenException("otro")), false);
    assert.equal(isProjectAccessDenied(new ForbiddenException("otro")), false);
    assert.equal(isProjectAccessDenied(new NotFoundException()), true);
    assert.equal(isProjectAccessDenied(new Error("x")), false);
  });

  it("manage sobre SHARED ajeno: solo admin con allowAdmin (sin allowAdmin => 403 de nivel)", async () => {
    const { service } = createService({ projects: PROJECTS });
    await rejectsLevelForbidden(service.assertProject(admin, "p-shared", "manage"), "manage");
    const res = await service.assertProject(admin, "p-shared", "manage", { allowAdmin: true });
    assert.equal(res.id, "p-shared");
  });

  it("recorta espacios del id", async () => {
    const { service, calls } = createService({ projects: PROJECTS });
    const res = await service.assertProject(owner, "  p-shared \n", "read");
    assert.equal(res.id, "p-shared");
    assert.deepEqual(calls.projectWhere, [{ id: "p-shared" }]);
  });

  it("id vacío o solo espacios => 404 sin consultar la BD", async () => {
    const { service, calls } = createService({ projects: PROJECTS });
    await rejectsNotFound(service.assertProject(owner, "", "read"), "Project not found");
    await rejectsNotFound(service.assertProject(owner, "   ", "read"), "Project not found");
    assert.equal(calls.projectWhere.length, 0);
  });
});

describe("ProjectAccessService.filterReadable", () => {
  const ALL: ProjectRow[] = [
    ...PROJECTS,
    { id: "p-other", userId: "owner-9", visibility: "PRIVATE" },
    { id: "p-other-shared", userId: "owner-9", visibility: "SHARED" },
  ];

  it("una sola query y deja solo los legibles, en el orden recibido y sin duplicados", async () => {
    const { service, calls } = createService({ projects: ALL });
    const res = await service.filterReadable(owner, ["p-other-shared", "p-other", "p-private", "nope", " p-shared ", "p-private"]);
    assert.deepEqual(res, ["p-other-shared", "p-private", "p-shared"]);
    assert.equal(calls.findManyArgs.length, 1);
    assert.deepEqual(calls.findManyArgs[0], {
      where: {
        id: { in: ["p-other-shared", "p-other", "p-private", "nope", "p-shared"] },
        OR: [{ userId: "owner-1" }, { visibility: "SHARED" }],
      },
      select: { id: true },
    });
    assert.equal(calls.projectWhere.length, 0, "no usa findUnique por id");
  });

  it("no dueño: solo SHARED", async () => {
    const { service } = createService({ projects: ALL });
    assert.deepEqual(await service.filterReadable(other, ["p-private", "p-shared", "p-other"]), ["p-shared"]);
  });

  it("lista vacía, ids vacíos o actor sin userId => [] sin consultar la BD", async () => {
    const { service, calls } = createService({ projects: ALL });
    assert.deepEqual(await service.filterReadable(owner, []), []);
    assert.deepEqual(await service.filterReadable(owner, ["", "   "]), []);
    assert.deepEqual(await service.filterReadable({ userId: "", role: "developer" }, ["p-shared"]), []);
    assert.equal(calls.findManyArgs.length, 0);
  });
});

describe("ProjectAccessService.assertStageInProject", () => {
  const stages = [{ id: "s-1", projectId: "p-shared" }];

  it("etapa del proyecto => OK", async () => {
    const { service } = createService({ stages });
    await service.assertStageInProject("p-shared", "s-1");
  });

  it("etapa de otro proyecto => 404", async () => {
    const { service } = createService({ stages });
    await rejectsNotFound(service.assertStageInProject("p-private", "s-1"), "Etapa no encontrada");
  });

  it("recorta ids y trata vacío como no encontrado", async () => {
    const { service, calls } = createService({ stages });
    await service.assertStageInProject(" p-shared ", " s-1 ");
    assert.deepEqual(calls.stageWhere, [{ id: "s-1", projectId: "p-shared" }]);
    await rejectsNotFound(service.assertStageInProject("p-shared", " "), "Etapa no encontrada");
    await rejectsNotFound(service.assertStageInProject("", "s-1"), "Etapa no encontrada");
    assert.equal(calls.stageWhere.length, 1);
  });
});

describe("ProjectAccessService.actorFromRequest", () => {
  it("lee userId y role del contexto de la petición", () => {
    const { service } = createService();
    const actor = requestUserStore.run({ userId: "u-9", role: "admin" }, () => service.actorFromRequest());
    assert.deepEqual(actor, { userId: "u-9", role: "admin" });
  });
});
