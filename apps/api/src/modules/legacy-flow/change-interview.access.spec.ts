/**
 * La sesión de entrevista (Map en memoria) queda ligada al proyecto de la ruta:
 * un `sessionId` de otro proyecto, o inexistente, responde 404 igual.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ChangeInterviewService } from "./change-interview.service.js";
import type { InterviewState } from "./change-interview.types.js";

function makeService() {
  const aiCalls: string[] = [];
  const updates: unknown[] = [];
  const prisma = {
    stage: {
      findUnique: async () => ({ legacyChangeState: null }),
      findFirst: async () => ({ id: "st1", legacyChangeState: null }),
      update: async (args: unknown) => {
        updates.push(args);
        return {};
      },
    },
  };
  const ai = {
    generateResponse: async (prompt: string) => {
      aiCalls.push(prompt);
      return "Pregunta de seguimiento";
    },
  };
  const svc = new ChangeInterviewService(
    prisma as never,
    ai as never,
    { findOne: async () => ({ theforgeProjectId: null }) } as never,
    {} as never,
  );
  return { svc, aiCalls, updates };
}

function seed(svc: ChangeInterviewService, id: string, projectId: string, extra: Partial<InterviewState> = {}) {
  const sessions = (svc as unknown as { sessions: Map<string, InterviewState> }).sessions;
  sessions.set(id, {
    sessionId: id,
    projectId,
    description: "cambio",
    messages: [],
    status: "in_progress",
    navigationMapSnapshot: null,
    relevantRoutes: [],
    affectedComponents: [],
    changeScope: null,
    ...extra,
  });
}

async function rejects404(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    assert.equal((e as NotFoundException).message, "Session not found");
    return true;
  });
}

describe("ChangeInterviewService: la sesión pertenece al proyecto", () => {
  it("startInterview crea una sesión que solo responde en su proyecto", async () => {
    const { svc } = makeService();
    const { sessionId } = await svc.startInterview("p1", "Agregar filtro", undefined);
    assert.equal((await svc.getStatus("p1", sessionId)).status, "in_progress");
    await rejects404(svc.getStatus("p2", sessionId));
  });

  it("getStatus de otro proyecto o inexistente => mismo 404", async () => {
    const { svc } = makeService();
    seed(svc, "int_a", "p1");
    assert.equal((await svc.getStatus("p1", "int_a")).status, "in_progress");
    await rejects404(svc.getStatus("p2", "int_a"));
    await rejects404(svc.getStatus("p1", "int_nope"));
  });

  it("continueChat de otro proyecto => 404 y no llama al LLM ni toca el historial", async () => {
    const { svc, aiCalls } = makeService();
    seed(svc, "int_a", "p1");
    await rejects404(svc.continueChat("p2", "int_a", "hola"));
    assert.equal(aiCalls.length, 0);
    assert.equal((await svc.getStatus("p1", "int_a")).messages.length, 0);
  });

  it("continueChat del mismo proyecto funciona", async () => {
    const { svc, aiCalls } = makeService();
    seed(svc, "int_a", "p1");
    const out = await svc.continueChat("p1", "int_a", "hola");
    assert.equal(aiCalls.length, 1);
    assert.equal(out.messages.length, 2);
  });

  it("confirmScope de otro proyecto => 404 y no persiste", async () => {
    const { svc, updates } = makeService();
    seed(svc, "int_a", "p1", {
      status: "pending_confirmation",
      changeScope: { description: "x" } as never,
    });
    await rejects404(svc.confirmScope("p2", "int_a"));
    assert.equal(updates.length, 0);
    assert.equal((await svc.getStatus("p1", "int_a")).status, "pending_confirmation");
  });

  it("cancelInterview de otro proyecto => 404 y la sesión sigue activa; del propio la cancela", async () => {
    const { svc } = makeService();
    seed(svc, "int_a", "p1");
    await rejects404(svc.cancelInterview("p2", "int_a"));
    assert.equal((await svc.getStatus("p1", "int_a")).status, "in_progress");
    await svc.cancelInterview("p1", "int_a");
    assert.equal((await svc.getStatus("p1", "int_a")).status, "cancelled");
  });
});
