import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ProjectAccessService } from "../../common/access/project-access.service.js";
import { assertJobAccess, JOB_NOT_FOUND_MESSAGE } from "./job-access.util.js";

type ProjectRow = { id: string; userId: string; visibility: string };

const PROJECTS: ProjectRow[] = [
  { id: "p-a", userId: "user-a", visibility: "PRIVATE" },
  { id: "p-shared", userId: "user-a", visibility: "SHARED" },
  { id: "p-b", userId: "user-b", visibility: "PRIVATE" },
];

/** Servicio real de acceso con Prisma mock y el actor de la petición fijado. */
function setup(actor: { userId: string; role: string }) {
  const prisma = {
    project: { findUnique: async (args: { where: { id: string } }) => PROJECTS.find((p) => p.id === args.where.id) ?? null },
    stage: { findFirst: async () => null },
  };
  const access = new ProjectAccessService(prisma as never);
  access.actorFromRequest = () => actor;
  return access;
}

const userA = { userId: "user-a", role: "developer" };
const userB = { userId: "user-b", role: "developer" };
const adminC = { userId: "admin-c", role: "admin" };

async function assertNotFound(promise: Promise<unknown>) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof NotFoundException, "debe ser NotFoundException (nunca 403)");
    assert.equal(err.message, JOB_NOT_FOUND_MESSAGE);
    return true;
  });
}

describe("assertJobAccess", () => {
  it("ref null responde 404 'Job no encontrado'", async () => {
    await assertNotFound(assertJobAccess(setup(userA), null, "read"));
    await assertNotFound(assertJobAccess(setup(userA), null, "cancel"));
  });

  it("B no puede leer ni cancelar un job privado de A: 404", async () => {
    const ref = { projectId: "p-a", userId: "user-a" };
    await assertNotFound(assertJobAccess(setup(userB), ref, "read"));
    await assertNotFound(assertJobAccess(setup(userB), ref, "cancel"));
  });

  it("el dueño lee y cancela su job", async () => {
    const ref = { projectId: "p-a", userId: "user-a" };
    assert.deepEqual(await assertJobAccess(setup(userA), ref, "read"), ref);
    assert.deepEqual(await assertJobAccess(setup(userA), ref, "cancel"), ref);
  });

  it("un proyecto SHARED permite leer a B, pero B no cancela un job de A", async () => {
    const ref = { projectId: "p-shared", userId: "user-a" };
    assert.deepEqual(await assertJobAccess(setup(userB), ref, "read"), ref);
    await assertNotFound(assertJobAccess(setup(userB), ref, "cancel"));
  });

  it("quien encoló el job puede cancelarlo aunque no sea dueño (SHARED)", async () => {
    const ref = { projectId: "p-shared", userId: "user-b" };
    assert.deepEqual(await assertJobAccess(setup(userB), ref, "cancel"), ref);
  });

  it("quien encoló el job lo cancela aunque ya no pueda ver el proyecto", async () => {
    const ref = { projectId: "p-a", userId: "user-b" };
    assert.deepEqual(await assertJobAccess(setup(userB), ref, "cancel"), ref);
  });

  it("un admin cancela en proyecto SHARED ajeno pero no en uno PRIVATE ajeno", async () => {
    const shared = { projectId: "p-shared", userId: "user-a" };
    assert.deepEqual(await assertJobAccess(setup(adminC), shared, "cancel"), shared);
    const priv = { projectId: "p-a", userId: "user-a" };
    await assertNotFound(assertJobAccess(setup(adminC), priv, "cancel"));
    await assertNotFound(assertJobAccess(setup(adminC), priv, "read"));
  });

  it("job antiguo sin userId: solo cancela quien tenga manage", async () => {
    const ref = { projectId: "p-shared", userId: null };
    assert.deepEqual(await assertJobAccess(setup(userA), ref, "cancel"), ref);
    await assertNotFound(assertJobAccess(setup(userB), ref, "cancel"));
  });

  it("un job de otro proyecto que el de la ruta responde 404", async () => {
    const ref = { projectId: "p-b", userId: "user-a" };
    await assertNotFound(assertJobAccess(setup(userB), ref, "read", "p-a"));
    await assertNotFound(assertJobAccess(setup(userA), { projectId: "p-a", userId: "user-a" }, "cancel", "p-shared"));
  });

  it("con el mismo projectId de la ruta autoriza (ids recortados)", async () => {
    const ref = { projectId: "p-a", userId: "user-a" };
    assert.deepEqual(await assertJobAccess(setup(userA), ref, "read", " p-a "), ref);
  });

  it("proyecto inexistente: 404 'Job no encontrado' y no 'Project not found'", async () => {
    await assertNotFound(assertJobAccess(setup(userA), { projectId: "p-x", userId: "user-a" }, "read"));
  });

  it("los errores que no son 404 se propagan", async () => {
    const access = setup(userA);
    access.assertProject = async () => {
      throw new Error("db caída");
    };
    await assert.rejects(assertJobAccess(access, { projectId: "p-a", userId: "user-b" }, "read"), /db caída/);
  });
});
