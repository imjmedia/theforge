import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ProjectAccessGuard } from "./project-access.guard.js";
import { isProjectLevelForbidden, ProjectAccessService } from "./project-access.service.js";
import { ProjectAccessExempt, ProjectScoped } from "./project-scoped.decorator.js";
import { PROJECT_ACCESS_EXEMPT_KEY } from "./project-access.metadata.js";

type ProjectRow = { id: string; userId: string; visibility: string };

const PROJECTS: ProjectRow[] = [
  { id: "p-private", userId: "owner-1", visibility: "PRIVATE" },
  { id: "p-shared", userId: "owner-1", visibility: "SHARED" },
  { id: "p-other", userId: "owner-9", visibility: "PRIVATE" },
];
const STAGES = [
  { id: "s-1", projectId: "p-shared" },
  { id: "s-other", projectId: "p-other" },
];

const owner = { userId: "owner-1", email: "o@x.test", role: "developer" };
const intruder = { userId: "dev-2", email: "b@x.test", role: "developer" };
const admin = { userId: "admin-3", email: "a@x.test", role: "admin" };

class Dummy {
  @ProjectScoped("read") read() {}
  @ProjectScoped("contribute") contribute() {}
  @ProjectScoped("spend") spend() {}
  @ProjectScoped("manage") manage() {}
  @ProjectScoped({ level: "manage", allowAdmin: true }) manageAdmin() {}
  @ProjectScoped({ from: "query", key: "projectId", level: "spend", optional: true }) optionalQuery() {}
  @ProjectScoped({ from: "body", key: "projectId", level: "read" }) fromBody() {}
  @ProjectScoped({ level: "contribute", stage: { from: "body", key: "stageId", optional: true } }) withStage() {}
  @ProjectScoped([
    { from: "param", key: "id", level: "read" },
    { from: "body", key: "targetId", level: "contribute" },
  ])
  multi() {}
  @ProjectAccessExempt("Ruta sin proyecto") exempt() {}
  plain() {}
}

/** Scope en la clase; un handler con exención debe ganarle (H14). */
@ProjectScoped("spend")
class ScopedClass {
  inherited() {}
  @ProjectAccessExempt("autorizado en el handler por otro camino") exempted() {}
  @ProjectScoped("read") ownScope() {}
}

function setup() {
  const calls = { projectWhere: [] as unknown[], stageWhere: [] as unknown[] };
  const prisma = {
    project: {
      findUnique: async (args: { where: { id: string } }) => {
        calls.projectWhere.push(args.where);
        return PROJECTS.find((p) => p.id === args.where.id) ?? null;
      },
    },
    stage: {
      findFirst: async (args: { where: { id: string; projectId: string } }) => {
        calls.stageWhere.push(args.where);
        return STAGES.find((s) => s.id === args.where.id && s.projectId === args.where.projectId) ?? null;
      },
    },
  };
  const guard = new ProjectAccessGuard(new Reflector(), new ProjectAccessService(prisma as never));
  return { guard, calls };
}

type Req = {
  user?: { userId: string; email: string; role?: string };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  projectAccess?: unknown;
};

function ctxClass(handler: keyof ScopedClass, req: Req): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => ScopedClass.prototype[handler],
    getClass: () => ScopedClass,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function ctx(handler: keyof Dummy, req: Req, type = "http"): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => Dummy.prototype[handler],
    getClass: () => Dummy,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function rejectsLevel403(p: Promise<unknown>, level: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ForbiddenException, `esperaba 403, llegó ${String(e)}`);
    assert.ok(isProjectLevelForbidden(e));
    assert.deepEqual((e as ForbiddenException).getResponse(), {
      code: "PROJECT_LEVEL_FORBIDDEN",
      level,
      message: "Solo el dueño del proyecto puede ejecutar esta acción",
    });
    return true;
  });
}

async function rejects404(p: Promise<unknown>, message = "Project not found") {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    assert.equal((e as NotFoundException).message, message);
    return true;
  });
}

describe("ProjectAccessGuard: matriz IDOR", () => {
  const levels = ["read", "contribute", "spend", "manage"] as const;

  it("usuario B contra PRIVATE de A => 404 en todos los niveles", async () => {
    const { guard } = setup();
    for (const level of levels) {
      await rejects404(guard.canActivate(ctx(level, { user: intruder, params: { id: "p-private" } })));
    }
  });

  it("usuario B contra SHARED de A => read y contribute OK, spend y manage 403 PROJECT_LEVEL_FORBIDDEN", async () => {
    const { guard } = setup();
    for (const level of ["read", "contribute"] as const) {
      assert.equal(await guard.canActivate(ctx(level, { user: intruder, params: { id: "p-shared" } })), true);
    }
    for (const level of ["spend", "manage"] as const) {
      await rejectsLevel403(guard.canActivate(ctx(level, { user: intruder, params: { id: "p-shared" } })), level);
    }
  });

  it("usuario B contra PRIVATE de A pidiendo spend o manage => 404 (no revela existencia)", async () => {
    const { guard } = setup();
    for (const level of ["spend", "manage"] as const) {
      await rejects404(guard.canActivate(ctx(level, { user: intruder, params: { id: "p-private" } })));
    }
  });

  it("dueño OK en todos los niveles", async () => {
    const { guard } = setup();
    for (const id of ["p-private", "p-shared"]) {
      for (const level of levels) {
        assert.equal(await guard.canActivate(ctx(level, { user: owner, params: { id } })), true);
      }
    }
  });

  it("admin con allowAdmin obtiene manage sobre SHARED ajeno, pero no sobre PRIVATE", async () => {
    const { guard } = setup();
    assert.equal(await guard.canActivate(ctx("manageAdmin", { user: admin, params: { id: "p-shared" } })), true);
    await rejects404(guard.canActivate(ctx("manageAdmin", { user: admin, params: { id: "p-private" } })));
    await rejectsLevel403(guard.canActivate(ctx("manage", { user: admin, params: { id: "p-shared" } })), "manage");
  });

  it("proyecto inexistente => 404", async () => {
    const { guard } = setup();
    await rejects404(guard.canActivate(ctx("read", { user: owner, params: { id: "nope" } })));
  });
});

describe("ProjectAccessGuard: lectura del id", () => {
  it("id ausente sin optional => 404 sin consultar la BD", async () => {
    const { guard, calls } = setup();
    await rejects404(guard.canActivate(ctx("read", { user: owner, params: {} })));
    assert.equal(calls.projectWhere.length, 0);
  });

  it("optional ausente o vacío => pasa sin consultar ni dejar projectAccess", async () => {
    const { guard, calls } = setup();
    const req1: Req = { user: intruder, query: {} };
    assert.equal(await guard.canActivate(ctx("optionalQuery", req1)), true);
    const req2: Req = { user: intruder, query: { projectId: "   " } };
    assert.equal(await guard.canActivate(ctx("optionalQuery", req2)), true);
    assert.equal(calls.projectWhere.length, 0);
    assert.equal(req1.projectAccess, undefined);
  });

  it("optional presente se evalúa (spend ajeno en SHARED => 403 de nivel)", async () => {
    const { guard } = setup();
    await rejectsLevel403(
      guard.canActivate(ctx("optionalQuery", { user: intruder, query: { projectId: "p-shared" } })),
      "spend",
    );
  });

  it("valor no string (array en query) se trata como ausente", async () => {
    const { guard } = setup();
    assert.equal(
      await guard.canActivate(ctx("optionalQuery", { user: owner, query: { projectId: ["p-shared"] } })),
      true,
    );
  });

  it("recorta espacios del id", async () => {
    const { guard, calls } = setup();
    const req: Req = { user: owner, params: { id: "  p-shared  " } };
    assert.equal(await guard.canActivate(ctx("read", req)), true);
    assert.deepEqual(calls.projectWhere, [{ id: "p-shared" }]);
  });

  it("from:body lee el body parseado", async () => {
    const { guard } = setup();
    assert.equal(await guard.canActivate(ctx("fromBody", { user: owner, body: { projectId: "p-private" } })), true);
    await rejects404(guard.canActivate(ctx("fromBody", { user: intruder, body: { projectId: "p-private" } })));
  });

  it("from:body en multipart (body-parser deja req.body = {}) => 400 por la cabecera content-type", async () => {
    const { guard } = setup();
    for (const contentType of ["multipart/form-data; boundary=abc", "Multipart/Form-Data; boundary=abc"]) {
      await assert.rejects(
        guard.canActivate(ctx("fromBody", { user: owner, body: {}, headers: { "content-type": contentType } })),
        (e: unknown) => {
          assert.ok(e instanceof BadRequestException);
          assert.match((e as BadRequestException).message, /multipart/);
          return true;
        },
      );
    }
  });

  it("from:body con body vacío y content-type JSON => 404 normal, no 400", async () => {
    const { guard } = setup();
    await rejects404(
      guard.canActivate(ctx("fromBody", { user: owner, body: {}, headers: { "content-type": "application/json" } })),
    );
  });
});

describe("ProjectAccessGuard: etapas", () => {
  it("etapa del mismo proyecto => OK", async () => {
    const { guard } = setup();
    const req: Req = { user: owner, params: { id: "p-shared" }, body: { stageId: " s-1 " } };
    assert.equal(await guard.canActivate(ctx("withStage", req)), true);
  });

  it("etapa de otro proyecto => 404 Etapa no encontrada", async () => {
    const { guard } = setup();
    await rejects404(
      guard.canActivate(ctx("withStage", { user: owner, params: { id: "p-shared" }, body: { stageId: "s-other" } })),
      "Etapa no encontrada",
    );
  });

  it("stage optional ausente => pasa sin consultar etapas", async () => {
    const { guard, calls } = setup();
    assert.equal(await guard.canActivate(ctx("withStage", { user: owner, params: { id: "p-shared" }, body: {} })), true);
    assert.equal(calls.stageWhere.length, 0);
  });
});

describe("ProjectAccessGuard: metadata, usuario y resultado", () => {
  it("sin metadata => pasa sin tocar la BD", async () => {
    const { guard, calls } = setup();
    assert.equal(await guard.canActivate(ctx("plain", {})), true);
    assert.equal(await guard.canActivate(ctx("exempt", {})), true);
    assert.equal(calls.projectWhere.length, 0);
  });

  it("contexto no http => pasa", async () => {
    const { guard } = setup();
    assert.equal(await guard.canActivate(ctx("read", {}, "rpc")), true);
  });

  it("sin req.user => 403", async () => {
    const { guard } = setup();
    await assert.rejects(guard.canActivate(ctx("read", { params: { id: "p-shared" } })), (e: unknown) => {
      assert.ok(e instanceof ForbiddenException);
      return true;
    });
  });

  it("rol ausente cae a developer (sin bypass de admin)", async () => {
    const { guard } = setup();
    await rejectsLevel403(
      guard.canActivate(
        ctx("manageAdmin", { user: { userId: "admin-3", email: "a@x.test" }, params: { id: "p-shared" } }),
      ),
      "manage",
    );
  });

  it("un spec deja req.projectAccess como objeto", async () => {
    const { guard } = setup();
    const req: Req = { user: intruder, params: { id: "p-shared" } };
    await guard.canActivate(ctx("read", req));
    assert.deepEqual(req.projectAccess, {
      id: "p-shared",
      userId: "owner-1",
      visibility: "SHARED",
      isOwner: false,
    });
  });

  it("array de specs evalúa todos y deja un array en req.projectAccess", async () => {
    const { guard } = setup();
    const req: Req = { user: owner, params: { id: "p-private" }, body: { targetId: "p-shared" } };
    assert.equal(await guard.canActivate(ctx("multi", req)), true);
    assert.deepEqual(
      (req.projectAccess as { id: string }[]).map((p) => p.id),
      ["p-private", "p-shared"],
    );
  });

  it("array de specs: falla si cualquiera niega el acceso", async () => {
    const { guard } = setup();
    await rejects404(
      guard.canActivate(ctx("multi", { user: intruder, params: { id: "p-shared" }, body: { targetId: "p-private" } })),
    );
    await rejects404(
      guard.canActivate(ctx("multi", { user: intruder, params: { id: "p-private" }, body: { targetId: "p-shared" } })),
    );
  });
});

describe("ProjectAccessGuard: @ProjectScoped de clase y exención de handler (H14)", () => {
  it("handler sin decoradores hereda el scope de la clase", async () => {
    const { guard } = setup();
    await rejectsLevel403(guard.canActivate(ctxClass("inherited", { user: intruder, params: { id: "p-shared" } })), "spend");
  });

  it("@ProjectAccessExempt en el handler gana sobre el @ProjectScoped de la clase", async () => {
    const { guard, calls } = setup();
    assert.equal(await guard.canActivate(ctxClass("exempted", { user: intruder, params: { id: "p-private" } })), true);
    assert.equal(calls.projectWhere.length, 0);
  });

  it("@ProjectScoped en el handler gana sobre el de la clase", async () => {
    const { guard } = setup();
    assert.equal(await guard.canActivate(ctxClass("ownScope", { user: intruder, params: { id: "p-shared" } })), true);
  });
});

describe("ProjectAccessExempt", () => {
  it("guarda el motivo como metadata", () => {
    const reason = new Reflector().get<string>(PROJECT_ACCESS_EXEMPT_KEY, Dummy.prototype.exempt);
    assert.equal(reason, "Ruta sin proyecto");
  });
});
