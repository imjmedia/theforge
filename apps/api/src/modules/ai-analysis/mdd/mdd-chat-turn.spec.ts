import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiAnalysisService, type MddChatJobEvent } from "../ai-analysis.service.js";
import { ThreadBusyError, ThreadRunLockService } from "../checkpoint/thread-run-lock.service.js";
import type { MddJobData } from "./mdd-queue.service.js";

type Stubbed = {
  threadLock: ThreadRunLockService;
  prisma: { agentStateCheckpoint: { findFirst: () => Promise<{ mddStageId: string } | null> } };
  resolveMddLockStageId: () => Promise<string>;
  streamMddAnalysisWithManager: (...args: unknown[]) => AsyncGenerator<MddChatJobEvent>;
  streamMddResume: (...args: unknown[]) => AsyncGenerator<MddChatJobEvent>;
};

function makeService(events: MddChatJobEvent[], opts: { checkpoint?: boolean; lock?: ThreadRunLockService } = {}) {
  const svc = Object.create(AiAnalysisService.prototype) as unknown as Stubbed;
  svc.threadLock = opts.lock ?? new ThreadRunLockService();
  svc.prisma = {
    agentStateCheckpoint: {
      findFirst: async () => (opts.checkpoint === false ? null : { mddStageId: "stage-1" }),
    },
  };
  svc.resolveMddLockStageId = async () => "stage-1";
  const gen = async function* (): AsyncGenerator<MddChatJobEvent> {
    for (const e of events) yield e;
  };
  svc.streamMddAnalysisWithManager = gen;
  svc.streamMddResume = gen;
  return svc as unknown as AiAnalysisService;
}

const managerData: MddJobData = { mode: "manager", projectId: "p1", initialMessage: "hola" };
const resumeData: MddJobData = { mode: "resume", projectId: "p1", threadId: "th-1", userMessage: "sí" };

describe("AiAnalysisService.runMddChatTurn", () => {
  it("interrupt completa el job con status waiting_user + threadId y relaya todos los eventos", async () => {
    const seen: string[] = [];
    const svc = makeService([
      { type: "progress", agent: "Manager", message: "pensando" },
      { type: "draft", markdown: "# d" },
      { type: "interrupt", threadId: "th-9", questions: ["¿Alcance?"], reply: "r" },
    ]);
    const result = await svc.runMddChatTurn(managerData, { onEvent: (e) => void seen.push(e.type) });
    assert.deepEqual(seen, ["progress", "draft", "interrupt"]);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "interrupt");
    assert.equal(result.status, "waiting_user");
    assert.equal(result.threadId, "th-9");
    assert.deepEqual(result.interrupt?.questions, ["¿Alcance?"]);
  });

  it("done completa el job con mddLength; resume usa el stage del checkpoint", async () => {
    const svc = makeService([{ type: "done", markdown: "# final doc", persistedOnServer: true }]);
    const result = await svc.runMddChatTurn(resumeData, {});
    assert.equal(result.outcome, "done");
    assert.equal(result.mddLength, "# final doc".length);
    assert.equal(result.stageId, "stage-1");
    assert.equal(result.status, undefined);
  });

  it("un evento error NO lanza (no hay reintento BullMQ): ok=false con mensaje y código", async () => {
    const svc = makeService([{ type: "error", message: "fallo del turno", code: "X" }]);
    const result = await svc.runMddChatTurn(managerData, {});
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "error");
    assert.equal(result.error, "fallo del turno");
    assert.equal(result.errorCode, "X");
  });

  it("hilo ocupado: lanza ThreadBusyError sin ejecutar el stream", async () => {
    const lock = new ThreadRunLockService();
    const lease = await lock.acquire("p1:stage-1", { renewEveryMs: 0 });
    assert.ok(lease);
    let streamed = false;
    const svc = makeService([{ type: "done", markdown: "# x" }], { lock });
    (svc as unknown as Stubbed).streamMddAnalysisWithManager = async function* () {
      streamed = true;
      yield { type: "done", markdown: "# x" } as MddChatJobEvent;
    };
    await assert.rejects(() => svc.runMddChatTurn(managerData, {}), ThreadBusyError);
    assert.equal(streamed, false);
    await lease.release();
  });

  it("cancelación: error durante abort se relaya como CANCELLED y el job falla", async () => {
    const abort = new AbortController();
    abort.abort();
    const seen: MddChatJobEvent[] = [];
    const svc = makeService([{ type: "error", message: "aborted" }]);
    await assert.rejects(
      () => svc.runMddChatTurn(managerData, { signal: abort.signal, onEvent: (e) => void seen.push(e) }),
      /Cancelado por el usuario/,
    );
    assert.equal(seen[0]?.type, "error");
    assert.equal((seen[0] as { code?: string }).code, "CANCELLED");
  });

  it("resume sin threadId es un error de payload", async () => {
    const svc = makeService([]);
    await assert.rejects(() => svc.runMddChatTurn({ mode: "resume", projectId: "p1" }, {}), /threadId/);
  });

  it("resume sin checkpoint no toma lock y deja que el stream responda su error", async () => {
    const svc = makeService([{ type: "error", message: "No hay checkpoint para este hilo." }], { checkpoint: false });
    const result = await svc.runMddChatTurn(resumeData, {});
    assert.equal(result.outcome, "error");
  });
});
