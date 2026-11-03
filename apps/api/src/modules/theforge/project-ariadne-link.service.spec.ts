/**
 * `resolve` solo considera proyectos propios del solicitante o SHARED (no filtra proyectos PRIVATE ajenos).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { requestUserStore } from "../../common/request-user.store.js";
import { ProjectAriadneLinkService } from "./project-ariadne-link.service.js";

type Where = Record<string, unknown>;

const REPO_ID = "550e8400-e29b-41d4-a716-446655440001";

function makeService() {
  const calls = { links: [] as Where[], projects: [] as Where[] };
  const prisma = {
    projectAriadneLink: {
      findMany: async (args: { where: Where }) => {
        calls.links.push(args.where);
        return [];
      },
    },
    project: {
      findMany: async (args: { where: Where }) => {
        calls.projects.push(args.where);
        return [];
      },
    },
    stage: { findMany: async () => [] },
  };
  return { svc: new ProjectAriadneLinkService(prisma as never), calls };
}

const visible = (actor: string) => ({ OR: [{ userId: actor }, { visibility: "SHARED" }] });

describe("ProjectAriadneLinkService.resolve: filtro por propietario o SHARED", () => {
  it("ambas consultas filtran por userId del solicitante o visibility SHARED", async () => {
    const { svc, calls } = makeService();
    await requestUserStore.run({ userId: "u-7", role: "developer" }, async () => {
      await assert.rejects(svc.resolve({ ariadneRepositoryId: REPO_ID }), (e: unknown) => {
        assert.equal((e as { getStatus?: () => number }).getStatus?.(), 404);
        return true;
      });
    });
    assert.deepEqual(calls.links, [{ project: { archivedAt: null, ...visible("u-7") } }]);
    assert.deepEqual(calls.projects, [{ archivedAt: null, theforgeProjectId: { not: null }, ...visible("u-7") }]);
  });

  it("un admin recibe el mismo filtro (sin bypass)", async () => {
    const { svc, calls } = makeService();
    await requestUserStore.run({ userId: "adm-1", role: "admin" }, async () => {
      await svc.resolve({ ariadneRepositoryId: REPO_ID }).catch(() => undefined);
    });
    assert.deepEqual(calls.projects[0]?.OR, [{ userId: "adm-1" }, { visibility: "SHARED" }]);
  });

  it("sin contexto de usuario => 403 y no consulta la BD", async () => {
    const { svc, calls } = makeService();
    await assert.rejects(svc.resolve({ ariadneRepositoryId: REPO_ID }), ForbiddenException);
    assert.equal(calls.links.length + calls.projects.length, 0);
  });
});
