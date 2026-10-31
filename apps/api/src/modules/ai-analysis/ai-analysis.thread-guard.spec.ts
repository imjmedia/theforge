import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AiAnalysisService, type MddStreamRunOptions } from "./ai-analysis.service.js";
import { ThreadRunLockService } from "./checkpoint/thread-run-lock.service.js";
import { getActiveLlmAbortSignal } from "./utils/mdd-llm-stream-invoke.util.js";

type AnyEvent = { type: string; code?: string; message?: string; markdown?: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function createService(): { service: AiAnalysisService; internals: Record<string, unknown> } {
  const prisma = {
    project: { findUnique: async () => null },
    agentStateCheckpoint: { findFirst: async () => ({ mddStageId: "stage-1" }) },
  };
  // Constructor: prisma + 13 dependencias sin uso en estos tests + threadLock (+ createDbgaGraphFn opcional).
  const unusedDeps = Array.from({ length: 13 }, () => ({}) as never) as [never];
  const service = new AiAnalysisService(prisma as never, ...unusedDeps, new ThreadRunLockService() as never);
  return { service, internals: service as unknown as Record<string, unknown> };
}

async function drain(gen: AsyncGenerator<AnyEvent>): Promise<AnyEvent[]> {
  const out: AnyEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("AiAnalysisService lease por hilo + persistencia + abort en streams MDD", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("un segundo turno sobre el mismo hilo recibe THREAD_BUSY y tras terminar el primero vuelve a poder correr", async () => {
    const { service, internals } = createService();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    internals.runMddPipelineStream = async function* (_d: string, _p: string, stageId: string) {
      yield { type: "progress", agent: "a", message: "m" };
      if (stageId === "stage-1") await gate;
      yield { type: "done", markdown: "# MDD" };
    };

    const first = service.streamMddAnalysis("dbga", "proj-1", "stage-1");
    const firstEvents: AnyEvent[] = [];
    const firstRun = (async () => {
      for await (const e of first) firstEvents.push(e as AnyEvent);
    })();
    await sleep(20); // el primero ya tomó el lease y está bloqueado en `gate`

    const busy = await drain(service.streamMddAnalysis("dbga", "proj-1", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(busy.length, 1);
    assert.equal(busy[0]!.type, "error");
    assert.equal(busy[0]!.code, "THREAD_BUSY");
    assert.match(busy[0]!.message ?? "", /turno en curso/i);

    // otro hilo (otra etapa) no se bloquea
    const otherStage = await drain(service.streamMddAnalysis("dbga", "proj-1", "stage-2") as AsyncGenerator<AnyEvent>);
    assert.equal(otherStage.at(-1)?.type, "done");

    release();
    await firstRun;
    assert.equal(firstEvents.at(-1)?.type, "done");

    const again = await drain(service.streamMddAnalysis("dbga", "proj-1", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(again.at(-1)?.type, "done");
  });

  it("libera el lease aunque el consumidor corte el stream (cliente desconectado)", async () => {
    const { service, internals } = createService();
    internals.runMddPipelineStream = async function* () {
      for (let i = 0; i < 50; i += 1) yield { type: "progress", agent: "a", message: String(i) };
    };
    const gen = service.streamMddAnalysis("dbga", "proj-2", "stage-1");
    await gen.next();
    await gen.return(undefined);
    const again = await drain(service.streamMddAnalysis("dbga", "proj-2", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(again.some((e) => e.code === "THREAD_BUSY"), false);
  });

  it("la señal del turno llega al generador interno vía contexto LLM (sin tocar los nodos)", async () => {
    const { service, internals } = createService();
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    let passedToInner: AbortSignal | undefined;
    internals.runMddPipelineStream = async function* (
      _d: string,
      _p: string,
      _s: string,
      _c: string,
      signal: AbortSignal | undefined,
    ) {
      passedToInner = signal;
      await sleep(5);
      seen = getActiveLlmAbortSignal();
      yield { type: "done", markdown: "# MDD" };
    };
    await drain(
      service.streamMddAnalysis("dbga", "proj-3", "stage-1", undefined, { signal: ac.signal }) as AsyncGenerator<AnyEvent>,
    );
    assert.equal(seen, ac.signal);
    assert.equal(passedToInner, ac.signal);
  });

  it("manager: persiste el markdown final ANTES de emitir done (y solo si persistOnDone no es false)", async () => {
    const { service, internals } = createService();
    const order: string[] = [];
    const persisted: Array<{ md: string; finalize: boolean }> = [];
    internals.createMddStreamPersister = async () => ({
      persist: async (md: string, finalize: boolean) => {
        order.push("persist");
        persisted.push({ md, finalize });
        return true;
      },
      lastLen: () => 0,
    });
    internals.runMddManagerStream = async function* () {
      yield { type: "progress", agent: "a", message: "m" };
      yield { type: "done", markdown: "# Master Design Document\n\n## 1. Contexto\n\ncontenido suficiente para persistir" };
    };

    const events: AnyEvent[] = [];
    for await (const e of service.streamMddAnalysisWithManager("", "proj-4", "hola", "borrador", "stage-1")) {
      if (e.type === "done") order.push("done");
      events.push(e as AnyEvent);
    }
    assert.deepEqual(order, ["persist", "done"]);
    assert.equal(persisted[0]!.finalize, true);
    assert.match(persisted[0]!.md, /Master Design Document/);

    // el job desactiva persistOnDone (persiste él mismo)
    persisted.length = 0;
    const opts: MddStreamRunOptions = { persistOnDone: false };
    await drain(service.streamMddAnalysisWithManager("", "proj-4", "hola", undefined, "stage-1", undefined, opts) as AsyncGenerator<AnyEvent>);
    assert.equal(persisted.length, 0);
  });

  it("si el persist final falla (delivery gate) se conserva como borrador y el stream sigue emitiendo done", async () => {
    const { service, internals } = createService();
    const calls: boolean[] = [];
    internals.createMddStreamPersister = async () => ({
      persist: async (_md: string, finalize: boolean) => {
        calls.push(finalize);
        if (finalize) throw new Error("MDD_DELIVERY_GATE");
        return true;
      },
      lastLen: () => 0,
    });
    internals.runMddResumeStream = async function* () {
      yield { type: "done", markdown: "# Master Design Document\n\n## 1. Contexto\n\ncontenido suficiente para persistir" };
    };
    const events = await drain(
      service.streamMddResume("proj-5", "thread-1", "sigue", undefined) as AsyncGenerator<AnyEvent>,
    );
    assert.deepEqual(calls, [true, false]);
    assert.equal(events.at(-1)?.type, "done");
  });

  it("readThreadCheckpointMemory: hilo con memoria devuelve valores; hilo nuevo o error devuelven null", async () => {
    const { internals } = createService();
    const read = (internals.readThreadCheckpointMemory as (g: unknown, c: unknown) => Promise<unknown>).bind(internals);
    const cfg = { configurable: { thread_id: "t" } };
    const withScore = { values: { auditorScore: 72, mddDraft: "" } };
    const withDraft = { values: { auditorScore: 0, mddDraft: "# MDD con contenido" } };
    const withAnswers = { values: { userInputAccumulated: "Usuario: usa Postgres" } };
    const fresh = { values: { auditorScore: 0, mddDraft: "", userInputAccumulated: "" } };
    assert.deepEqual(await read({ getState: async () => withScore }, cfg), withScore.values);
    assert.deepEqual(await read({ getState: async () => withDraft }, cfg), withDraft.values);
    assert.deepEqual(await read({ getState: async () => withAnswers }, cfg), withAnswers.values);
    assert.equal(await read({ getState: async () => fresh }, cfg), null);
    assert.equal(await read({ getState: async () => ({ values: undefined }) }, cfg), null);
    assert.equal(
      await read({ getState: async () => { throw new Error("no checkpoint"); } }, cfg),
      null,
    );
  });
});
