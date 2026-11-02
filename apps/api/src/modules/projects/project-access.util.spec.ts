import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { requestUserStore } from "../../common/request-user.store.js";
import {
  loadAccessibleProjectWithStages,
  loadAccessibleProjectWithStagesAt,
} from "./project-access.util.js";

type ProjectRow = { id: string; userId: string; visibility: string; stages: unknown[] };

const PROJECTS: ProjectRow[] = [
  { id: "p-private", userId: "owner-1", visibility: "PRIVATE", stages: [] },
  { id: "p-shared", userId: "owner-1", visibility: "SHARED", stages: [] },
];

function createPrisma() {
  const calls: unknown[] = [];
  const prisma = {
    project: {
      findFirst: async (args: { where: { id: string } }) => {
        calls.push(args);
        return PROJECTS.find((p) => p.id === args.where.id) ?? null;
      },
    },
  };
  return { prisma: prisma as never, calls };
}

function asUser<T>(userId: string, role: string, fn: () => Promise<T>): Promise<T> {
  return requestUserStore.run({ userId, role }, fn);
}

async function rejectsNotFound(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException);
    assert.equal((e as NotFoundException).message, "Project not found");
    return true;
  });
}

describe("loadAccessibleProjectWithStages (nivel read)", () => {
  it("dueño accede a PRIVATE y SHARED", async () => {
    const { prisma } = createPrisma();
    const a = await asUser("owner-1", "developer", () => loadAccessibleProjectWithStages(prisma, "p-private"));
    const b = await asUser("owner-1", "developer", () => loadAccessibleProjectWithStages(prisma, "p-shared"));
    assert.equal(a.id, "p-private");
    assert.equal(b.id, "p-shared");
  });

  it("no dueño accede a SHARED", async () => {
    const { prisma } = createPrisma();
    const p = await asUser("dev-2", "developer", () => loadAccessibleProjectWithStages(prisma, "p-shared"));
    assert.equal(p.id, "p-shared");
  });

  it("no dueño en PRIVATE => 404, también admin (sin bypass)", async () => {
    const { prisma } = createPrisma();
    await rejectsNotFound(asUser("dev-2", "developer", () => loadAccessibleProjectWithStages(prisma, "p-private")));
    await rejectsNotFound(asUser("admin-3", "admin", () => loadAccessibleProjectWithStages(prisma, "p-private")));
  });

  it("proyecto inexistente => 404", async () => {
    const { prisma } = createPrisma();
    await rejectsNotFound(asUser("owner-1", "developer", () => loadAccessibleProjectWithStages(prisma, "nope")));
  });

  it("conserva el include de etapas con estimación y grupo", async () => {
    const { prisma, calls } = createPrisma();
    await asUser("owner-1", "developer", () => loadAccessibleProjectWithStages(prisma, "p-shared"));
    const include = (calls[0] as { include: Record<string, unknown> }).include;
    assert.deepEqual(Object.keys(include).sort(), ["group", "stages"]);
  });
});

describe("loadAccessibleProjectWithStagesAt", () => {
  it("contribute en SHARED ajeno => OK", async () => {
    const { prisma } = createPrisma();
    const p = await asUser("dev-2", "developer", () =>
      loadAccessibleProjectWithStagesAt(prisma, "p-shared", "contribute"),
    );
    assert.equal(p.id, "p-shared");
  });

  it("spend en SHARED ajeno => 404", async () => {
    const { prisma } = createPrisma();
    await rejectsNotFound(
      asUser("dev-2", "developer", () => loadAccessibleProjectWithStagesAt(prisma, "p-shared", "spend")),
    );
  });

  it("spend en SHARED propio => OK", async () => {
    const { prisma } = createPrisma();
    const p = await asUser("owner-1", "developer", () =>
      loadAccessibleProjectWithStagesAt(prisma, "p-shared", "spend"),
    );
    assert.equal(p.id, "p-shared");
  });

  it("manage en SHARED ajeno: solo admin con allowAdmin", async () => {
    const { prisma } = createPrisma();
    await rejectsNotFound(
      asUser("admin-3", "admin", () => loadAccessibleProjectWithStagesAt(prisma, "p-shared", "manage")),
    );
    const p = await asUser("admin-3", "admin", () =>
      loadAccessibleProjectWithStagesAt(prisma, "p-shared", "manage", { allowAdmin: true }),
    );
    assert.equal(p.id, "p-shared");
    await rejectsNotFound(
      asUser("admin-3", "admin", () =>
        loadAccessibleProjectWithStagesAt(prisma, "p-private", "manage", { allowAdmin: true }),
      ),
    );
  });
});
