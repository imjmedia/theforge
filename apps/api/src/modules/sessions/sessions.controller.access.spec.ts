/**
 * Autorización por proyecto de las rutas `sessions/:id*` (H1 y H7): el id es de sesión, así que cada handler
 * resuelve el proyecto de la sesión y exige nivel sobre él con `ProjectAccessService`.
 * - chat y mensajes con imágenes: `spend` (gastan el LLM del dueño).
 * - mensajes sin imágenes y PATCH context: `contribute`; lectura: `read`.
 * - Si el proyecto pasó a PRIVATE, el antiguo colaborador recibe 404 en todo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectAccessService } from "../../common/access/project-access.service.js";
import { requestUserStore } from "../../common/request-user.store.js";
import { SessionsController } from "./sessions.controller.js";

type ProjectRow = { id: string; userId: string; visibility: string };

function makeController(projects: ProjectRow[]) {
  // Sesiones: s-collab-shared la creó el colaborador en un SHARED del dueño; s-collab-private ya está en PRIVATE.
  const sessions: Record<string, { userId: string; projectId: string }> = {
    "s-owner": { userId: "owner", projectId: "p-shared" },
    "s-collab-shared": { userId: "collab", projectId: "p-shared" },
    "s-collab-private": { userId: "collab", projectId: "p-private" },
  };
  const prisma = {
    project: { findUnique: async (args: { where: { id: string } }) => projects.find((p) => p.id === args.where.id) ?? null },
    stage: { findFirst: async () => null },
  };
  const calls = { chat: [] as string[], findOne: [] as string[], append: [] as unknown[], context: [] as string[] };
  const sessionsService = {
    getSessionProjectId: async (id: string) => {
      const row = sessions[id];
      const userId = requestUserStore.getStore()?.userId;
      if (!row || row.userId !== userId) throw new NotFoundException("Session not found");
      return row.projectId;
    },
    findOne: async (id: string) => {
      calls.findOne.push(id);
      return { id, ...sessions[id] };
    },
    appendMessage: async (id: string, body: unknown) => {
      calls.append.push({ id, body });
      return { id };
    },
    updateContextStep: async (id: string, step: string) => {
      calls.context.push(`${id}:${step}`);
      return { id };
    },
  };
  const orchestrator = {
    chatBySessionId: async (id: string) => {
      calls.chat.push(id);
      return { session: { id } };
    },
  };
  const controller = new SessionsController(
    sessionsService as never,
    orchestrator as never,
    new ProjectAccessService(prisma as never),
  );
  return { controller, calls };
}

const PROJECTS: ProjectRow[] = [
  { id: "p-shared", userId: "owner", visibility: "SHARED" },
  { id: "p-private", userId: "owner", visibility: "PRIVATE" },
];

const as = <T>(userId: string, fn: () => Promise<T>) => requestUserStore.run({ userId, role: "developer" }, fn);

async function rejectsLevel403(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ForbiddenException, `esperaba 403, llegó ${String(e)}`);
    assert.equal((e as ForbiddenException).getResponse()["code" as never], "PROJECT_LEVEL_FORBIDDEN");
    return true;
  });
}

async function rejects404(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    return true;
  });
}

describe("POST /sessions/:id/chat exige spend (H1)", () => {
  it("el colaborador de un SHARED no gasta el LLM del dueño: 403 y no llega al orquestador", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await rejectsLevel403(as("collab", () => controller.chat("s-collab-shared", { message: "hola" })));
    assert.deepEqual(calls.chat, []);
  });

  it("el dueño chatea en su sesión", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await as("owner", () => controller.chat("s-owner", { message: "hola" }));
    assert.deepEqual(calls.chat, ["s-owner"]);
  });

  it("sesión ajena o inexistente: 404 antes de cualquier otra cosa (aunque el body sea inválido)", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await rejects404(as("collab", () => controller.chat("s-owner", {})));
    await rejects404(as("collab", () => controller.chat("nope", { message: "x" })));
    assert.deepEqual(calls.chat, []);
  });
});

describe("POST /sessions/:id/messages (H1)", () => {
  const img = { mimeType: "image/png", base64: "AAAA" };

  it("con imágenes (visión LLM) el colaborador recibe 403 PROJECT_LEVEL_FORBIDDEN", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await rejectsLevel403(
      as("collab", () => controller.appendMessage("s-collab-shared", { role: "user", content: "mira", images: [img] })),
    );
    assert.deepEqual(calls.append, []);
  });

  it("sin imágenes basta contribute: el colaborador escribe en su sesión de un SHARED", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await as("collab", () => controller.appendMessage("s-collab-shared", { role: "user", content: "hola" }));
    assert.equal(calls.append.length, 1);
  });

  it("el dueño puede adjuntar imágenes", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await as("owner", () => controller.appendMessage("s-owner", { role: "user", content: "mira", images: [img] }));
    assert.equal(calls.append.length, 1);
  });
});

describe("rutas de lectura/escritura sin LLM tras pasar el proyecto a PRIVATE (H7)", () => {
  it("el antiguo colaborador recibe 404 en GET :id, POST messages y PATCH context", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await rejects404(as("collab", () => controller.findOne("s-collab-private")));
    await rejects404(as("collab", () => controller.appendMessage("s-collab-private", { role: "user", content: "x" })));
    await rejects404(as("collab", () => controller.updateContextStep("s-collab-private", { contextStep: "MDD" })));
    assert.deepEqual(calls.findOne, []);
    assert.deepEqual(calls.append, []);
    assert.deepEqual(calls.context, []);
  });

  it("también 404 en chat (el proyecto PRIVATE no revela existencia con 403)", async () => {
    const { controller } = makeController(PROJECTS);
    await rejects404(as("collab", () => controller.chat("s-collab-private", { message: "x" })));
  });

  it("mientras el proyecto es SHARED el colaborador lee y actualiza el contexto de su sesión", async () => {
    const { controller, calls } = makeController(PROJECTS);
    await as("collab", () => controller.findOne("s-collab-shared"));
    await as("collab", () => controller.updateContextStep("s-collab-shared", { contextStep: "MDD" }));
    assert.deepEqual(calls.findOne, ["s-collab-shared"]);
    assert.deepEqual(calls.context, ["s-collab-shared:MDD"]);
  });

  it("el dueño conserva el acceso a sus sesiones aunque el proyecto sea PRIVATE", async () => {
    const projects: ProjectRow[] = [{ id: "p-shared", userId: "owner", visibility: "PRIVATE" }];
    const { controller, calls } = makeController(projects);
    await as("owner", () => controller.findOne("s-owner"));
    assert.deepEqual(calls.findOne, ["s-owner"]);
  });
});
