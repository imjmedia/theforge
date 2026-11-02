/**
 * `GET /ai-analysis/phase0/state/:threadId`: hilo inexistente y hilo de otro proyecto responden igual (404),
 * para no revelar qué hilos existen (H13).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { AiAnalysisController } from "./ai-analysis.controller.js";

function makeController() {
  const phase0Interview = {
    getState: (threadId: string) =>
      threadId === "t-1"
        ? { projectId: "p-1", status: "asking", preguntasRealizadas: 1, maxPreguntas: 5, borrador: "b", gaps: [] }
        : undefined,
  };
  const controller = Object.create(AiAnalysisController.prototype) as AiAnalysisController;
  (controller as unknown as { phase0Interview: unknown }).phase0Interview = phase0Interview;
  return controller;
}

async function rejects404(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    assert.equal((e as NotFoundException).message, "Thread no encontrado");
    return true;
  });
}

describe("GET phase0/state/:threadId", () => {
  it("hilo del proyecto: devuelve el estado", async () => {
    const res = await makeController().getPhase0State("t-1", " p-1 ");
    assert.equal(res.status, "asking");
    assert.equal(res.maxPreguntas, 5);
  });

  it("hilo inexistente => 404 (antes 400)", async () => {
    await rejects404(makeController().getPhase0State("nope", "p-1"));
  });

  it("hilo de otro proyecto => 404 con el mismo mensaje que el inexistente", async () => {
    await rejects404(makeController().getPhase0State("t-1", "p-2"));
    await rejects404(makeController().getPhase0State("t-1", undefined as never));
  });
});
