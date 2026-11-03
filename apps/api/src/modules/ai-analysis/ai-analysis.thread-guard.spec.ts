import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AiAnalysisService,
  MddPersistBlockedError,
  type MddStreamRunOptions,
} from "./ai-analysis.service.js";
import { MddWriteFencedError } from "../projects/index.js";
import {
  ThreadBusyError,
  ThreadLeaseLostError,
  ThreadLockUnavailableError,
  ThreadRunLockService,
  mddThreadLockKey,
  type ThreadRunLease,
} from "./checkpoint/thread-run-lock.service.js";
import { getActiveLlmAbortSignal } from "./utils/mdd-llm-stream-invoke.util.js";
import { getActiveMddLeaseFence } from "../../common/mdd-lease-context.js";

type AnyEvent = { type: string; code?: string; message?: string; markdown?: string; persistedOnServer?: boolean };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function createService(threadLock?: unknown): { service: AiAnalysisService; internals: Record<string, unknown> } {
  // Proyecto existente: la etapa del hilo se resuelve (si no, `resolveMddThread` falla cerrado con LOCK_UNAVAILABLE).
  const prisma = {
    project: { findUnique: async () => ({ id: "proj", stages: [] }) },
    agentStateCheckpoint: { findFirst: async () => ({ mddStageId: "stage-1" }) },
  };
  // Supervisor: la etapa del hilo es la pista del cliente (o "stage-1").
  const agentSupervisor = {
    resolveRouteFromProject: async (_p: unknown, hint?: string | null) => ({ stageId: hint?.trim() || "stage-1" }),
  };
  // Claim del fence (ADR 0004) vía `projects`: por defecto la etapa acepta el fence; los tests lo cambian con `claimsOf`.
  const projects = { claimMddWriteFence: async () => undefined };
  // Constructor: prisma + 13 dependencias sin uso en estos tests (la 5.ª, índice 4, es `projects`; la 7.ª, índice 6, el supervisor) + threadLock.
  const deps: unknown[] = Array.from({ length: 13 }, () => ({}));
  deps[4] = projects;
  deps[6] = agentSupervisor;
  const service = new AiAnalysisService(prisma as never, ...(deps as [never]), (threadLock ?? new ThreadRunLockService()) as never);
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
    // La señal efectiva combina la del turno (cliente) con la del lease: abortar la del cliente la aborta.
    assert.ok(seen && passedToInner);
    assert.equal(seen, passedToInner);
    assert.equal(seen.aborted, false);
    ac.abort();
    assert.equal(seen.aborted, true);
  });

  it("manager: persiste el markdown final ANTES de emitir done (y solo si persistOnDone no es false)", async () => {
    const { service, internals } = createService();
    const order: string[] = [];
    const persisted: Array<{ md: string; finalize: boolean }> = [];
    internals.createMddStreamPersister = async () => ({
      persist: async (md: string, finalize: boolean) => {
        order.push("persist");
        persisted.push({ md, finalize });
        return { ok: true };
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
        return { ok: true };
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
    assert.equal(events.at(-1)?.persistedOnServer, true);
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

const MD = "# Master Design Document\n\n## 1. Contexto\n\ncontenido suficiente para persistir";

type FakeLease = ThreadRunLease & { lose: () => void; released: () => boolean };

/** Lease controlable: `lose()` lo marca como perdido y aborta su señal con `ThreadLeaseLostError`. */
function fakeLease(key = "proj:stage-1", fence = 1): FakeLease {
  const ac = new AbortController();
  let held = true;
  let released = false;
  return {
    key,
    fence,
    signal: ac.signal,
    isHeld: () => held,
    release: async () => {
      released = true;
    },
    lose: () => {
      held = false;
      ac.abort(new ThreadLeaseLostError(key));
    },
    released: () => released,
  };
}

function lockReturning(lease: ThreadRunLease | null): unknown {
  return { acquire: async () => lease };
}

describe("AiAnalysisService: lock que falla cerrado, lease perdido y suelo anti-wipe en streams MDD", () => {
  const persisterReturning = (
    internals: Record<string, unknown>,
    result: unknown,
    calls: Array<{ md: string; finalize: boolean }> = [],
  ) => {
    internals.createMddStreamPersister = async () => ({
      persist: async (md: string, finalize: boolean) => {
        calls.push({ md, finalize });
        return result;
      },
      lastLen: () => 0,
      hasStoredDocument: () => true,
    });
    return calls;
  };
  const managerInner = (internals: Record<string, unknown>) => {
    internals.runMddManagerStream = async function* () {
      yield { type: "progress", agent: "a", message: "m" };
      yield { type: "done", markdown: MD };
    };
  };
  const runManager = (service: AiAnalysisService) =>
    drain(service.streamMddAnalysisWithManager("", "proj", "hola", "borrador", "stage-1") as AsyncGenerator<AnyEvent>);

  it("(a) acquire lanza ThreadLockUnavailableError: error LOCK_UNAVAILABLE y el stream termina sin correr el turno", async () => {
    const lock = {
      acquire: async () => {
        throw new ThreadLockUnavailableError("proj:stage-1", new Error("Redis caído"));
      },
    };
    const { service, internals } = createService(lock);
    let innerRan = false;
    internals.runMddManagerStream = async function* () {
      innerRan = true;
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "error");
    assert.equal(events[0]!.code, "LOCK_UNAVAILABLE");
    assert.equal(innerRan, false);
  });

  it("(a2) un error que no es de lock sí se propaga", async () => {
    const { service } = createService({
      acquire: async () => {
        throw new Error("otro fallo");
      },
    });
    await assert.rejects(runManager(service), /otro fallo/);
  });

  it("(b) lease perdido antes del persist: error LEASE_LOST, sin persist y sin done", async () => {
    const lease = fakeLease();
    const { service, internals } = createService(lockReturning(lease));
    const calls = persisterReturning(internals, { ok: true });
    internals.runMddManagerStream = async function* () {
      yield { type: "progress", agent: "a", message: "m" };
      lease.lose(); // otro turno tomó el hilo antes de que este termine
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.code, "LEASE_LOST");
    assert.equal(events.some((e) => e.type === "done"), false);
    assert.equal(calls.length, 0);
    assert.equal(lease.released(), true);
  });

  it("(b2) el persistidor real no escribe si el lease ya no se tiene (lease_lost)", async () => {
    const { service, internals } = createService();
    const writes: string[] = [];
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async (_p: string, md: string) => void writes.push(md) };
    let held = true;
    const create = internals.createMddPersister as (a: unknown) => {
      persist: (md: string, f: boolean) => Promise<unknown>;
    };
    const persister = create.call(service, {
      projectId: "proj",
      label: "t",
      lockedPatternIds: new Set<string>(),
      storedBaselineLen: 0,
      isLeaseHeld: () => held,
    });
    assert.deepEqual(await persister.persist(MD, true), { ok: true });
    held = false;
    assert.deepEqual(await persister.persist(`${MD} cambiado`, true), { ok: false, reason: "lease_lost" });
    assert.equal(writes.length, 1);
  });

  it("(c) persist con floor: blocked MDD_PERSIST_FLOOR, sin done ni persistedOnServer", async () => {
    const { service, internals } = createService();
    persisterReturning(internals, { ok: false, reason: "floor" });
    managerInner(internals);
    const events = await runManager(service);
    const last = events.at(-1)!;
    assert.equal(last.type, "blocked");
    assert.equal(last.code, "MDD_PERSIST_FLOOR");
    assert.match(last.message ?? "", /más corto/i);
    assert.equal(events.some((e) => e.type === "done"), false);
    assert.equal(events.some((e) => e.persistedOnServer === true), false);
  });

  it("(c2) persist too_short: blocked MDD_PERSIST_TOO_SHORT; un done sin contenido tampoco se da por guardado", async () => {
    const { service, internals } = createService();
    persisterReturning(internals, { ok: false, reason: "too_short" });
    managerInner(internals);
    const events = await runManager(service);
    assert.equal(events.at(-1)?.type, "blocked");
    assert.equal(events.at(-1)?.code, "MDD_PERSIST_TOO_SHORT");

    internals.runMddManagerStream = async function* () {
      yield { type: "done", markdown: "(Sin contenido generado.)" };
    };
    const empty = await runManager(service);
    assert.equal(empty.at(-1)?.code, "MDD_PERSIST_TOO_SHORT");
  });

  it("(c3) el persistidor real aplica el suelo anti-wipe también al cierre del stream y no escribe", async () => {
    const { service, internals } = createService();
    const writes: string[] = [];
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async (_p: string, md: string) => void writes.push(md) };
    const create = internals.createMddPersister as (a: unknown) => {
      persist: (md: string, f: boolean) => Promise<unknown>;
    };
    const persister = create.call(service, {
      projectId: "proj",
      label: "t",
      lockedPatternIds: new Set<string>(),
      storedBaselineLen: 10_000,
      enforceFloorOnFinalize: true,
    });
    assert.deepEqual(await persister.persist(MD, true), { ok: false, reason: "floor" });
    assert.equal(writes.length, 0);
  });

  it("(d) persist ok: done con persistedOnServer true; unchanged también; write_failed no lo marca", async () => {
    const { service, internals } = createService();
    managerInner(internals);
    const calls = persisterReturning(internals, { ok: true });
    const ok = await runManager(service);
    assert.equal(ok.at(-1)?.type, "done");
    assert.equal(ok.at(-1)?.persistedOnServer, true);
    assert.equal(calls[0]!.finalize, true);

    persisterReturning(internals, { ok: false, reason: "unchanged" });
    const unchanged = await runManager(service);
    assert.equal(unchanged.at(-1)?.type, "done");
    assert.equal(unchanged.at(-1)?.persistedOnServer, true);

    internals.createMddStreamPersister = async () => ({
      persist: async () => {
        throw new Error("BD caída");
      },
      lastLen: () => 0,
    });
    const failed = await runManager(service);
    assert.equal(failed.at(-1)?.type, "done");
    assert.equal(failed.at(-1)?.persistedOnServer, undefined);
  });

  it("(e) la señal del lease llega al contexto LLM y a la señal del generador interno; perderlo termina en LEASE_LOST", async () => {
    const lease = fakeLease();
    const { service, internals } = createService(lockReturning(lease));
    let seen: AbortSignal | undefined;
    let passedToInner: AbortSignal | undefined;
    let abortedAfterLoss: boolean | undefined;
    internals.runMddPipelineStream = async function* (
      _d: string,
      _p: string,
      _s: string,
      _c: string,
      signal: AbortSignal | undefined,
    ) {
      passedToInner = signal;
      seen = getActiveLlmAbortSignal();
      assert.equal(seen?.aborted, false);
      lease.lose();
      abortedAfterLoss = seen?.aborted;
      yield { type: "progress", agent: "a", message: "m" };
    };
    const events = await drain(service.streamMddAnalysis("dbga", "proj", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(abortedAfterLoss, true);
    assert.equal(passedToInner, seen);
    assert.equal(events.at(-1)?.code, "LEASE_LOST");
  });

  it("(e2) un aborto del generador por pérdida del lease se reporta como LEASE_LOST (no como excepción)", async () => {
    const lease = fakeLease();
    const { service, internals } = createService(lockReturning(lease));
    internals.runMddPipelineStream = async function* () {
      yield { type: "progress", agent: "a", message: "m" };
      lease.lose();
      throw new Error("This operation was aborted");
    };
    const events = await drain(service.streamMddAnalysis("dbga", "proj", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.code, "LEASE_LOST");
  });

  it("job (modo section, bajo lease): un cierre que el suelo anti-wipe descarta lanza MddPersistBlockedError", async () => {
    const { service, internals } = createService();
    const writes: string[] = [];
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async (_p: string, md: string) => void writes.push(md) };
    internals.resolveLockedPatternIdsForMddJob = async () => ({
      lockedPatternIds: [],
      stageMddContent: "x".repeat(10_000),
      stageId: "stage-1",
    });
    internals.streamMddRegenerateSection = async function* () {
      yield { type: "done", markdown: MD };
    };
    const run = service.runMddGenerationJob(
      { mode: "section", projectId: "proj", stageId: "stage-1", section: 2 } as never,
      () => undefined,
    );
    await assert.rejects(run, (err: unknown) => {
      assert.ok(err instanceof MddPersistBlockedError);
      assert.equal(err.code, "MDD_PERSIST_FLOOR");
      return true;
    });
    assert.equal(writes.length, 0);
  });
});

describe("AiAnalysisService: H12, resultado vacío sin documento previo en un proyecto nuevo", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  const placeholderInner = (internals: Record<string, unknown>) => {
    internals.runMddManagerStream = async function* () {
      yield { type: "done", markdown: "(Sin contenido generado.)" };
    };
  };
  const run = (service: AiAnalysisService) =>
    drain(service.streamMddAnalysisWithManager("", "proj", "hola", undefined, "stage-1") as AsyncGenerator<AnyEvent>);

  it("sin documento guardado y placeholder: done sin persistedOnServer (no blocked, no se escribe nada)", async () => {
    const { service, internals } = createService();
    const writes: string[] = [];
    // persist real: el placeholder es too_short; el stub solo aporta hasStoredDocument() = false
    internals.createMddStreamPersister = async () => ({
      persist: async (md: string) => {
        writes.push(md);
        return { ok: false, reason: "too_short" };
      },
      lastLen: () => 0,
      hasStoredDocument: () => false,
    });
    placeholderInner(internals);
    const events = await run(service);
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(events.at(-1)?.persistedOnServer, undefined);
    assert.ok(!events.some((e) => e.type === "blocked"));
  });

  it("con documento guardado el placeholder sigue emitiendo blocked MDD_PERSIST_TOO_SHORT", async () => {
    const { service, internals } = createService();
    internals.createMddStreamPersister = async () => ({
      persist: async () => ({ ok: false, reason: "too_short" }),
      lastLen: () => 0,
      hasStoredDocument: () => true,
    });
    placeholderInner(internals);
    const events = await run(service);
    assert.equal(events.at(-1)?.type, "blocked");
    assert.equal(events.at(-1)?.code, "MDD_PERSIST_TOO_SHORT");
  });

  it("createMddPersister.hasStoredDocument: baseline > 0 o algo ya escrito por el persistidor", async () => {
    const { service, internals } = createService();
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async () => undefined };
    const create = internals.createMddPersister as (a: unknown) => {
      persist: (md: string, f: boolean) => Promise<unknown>;
      hasStoredDocument: () => boolean;
    };
    const base = { projectId: "proj", label: "t", lockedPatternIds: new Set<string>() };
    assert.equal(create.call(service, { ...base, storedBaselineLen: 500 }).hasStoredDocument(), true);
    const nuevo = create.call(service, { ...base, storedBaselineLen: 0 });
    assert.equal(nuevo.hasStoredDocument(), false);
    assert.deepEqual(await nuevo.persist(MD, true), { ok: true });
    assert.equal(nuevo.hasStoredDocument(), true);
  });
});

describe("AiAnalysisService.runMddGenerationJob: lease y corrección de patrones incompatibles", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  const OLD_BODY = "# Master Design Document\n\n## 1. Contexto\n\nVERSION-VIEJA del contenido guardado al iniciar el job";
  const NEW_BODY = "# Master Design Document\n\n## 1. Contexto\n\nVERSION-VIGENTE guardada por otro turno del mismo hilo";
  /** `microservicios` + `monolito-modular` son incompatibles (regla del wizard SSOT): fuerza una corrección. */
  const INCOMPATIBLE = () => new Set(["microservicios", "monolito-modular"]);

  /** Servicio con dobles: lecturas sucesivas de la etapa y escrituras registradas con el estado del lease. */
  function setup(opts: { lockedPatternIds?: () => Set<string>; lock?: unknown } = {}) {
    const { service, internals } = createService(opts.lock);
    const writes: Array<{ md: string; leaseHeld: boolean }> = [];
    const lock = internals.threadLock as ThreadRunLockService;
    internals.projects = {
      ...(internals.projects as object),
      persistMddFromBackgroundJob: async (_p: string, md: string) => {
        writes.push({ md, leaseHeld: lock.isHeldInContext?.(mddThreadLockKey("proj", "stage-1")) ?? false });
      },
    };
    let reads = 0;
    internals.resolveLockedPatternIdsForMddJob = async () => {
      reads++;
      return {
        lockedPatternIds: (opts.lockedPatternIds ?? INCOMPATIBLE)(),
        stageMddContent: reads === 1 ? OLD_BODY : NEW_BODY,
        stageId: "stage-1",
      };
    };
    internals.finalizeMddJobUpstreamBaseline = async (_p: string, _s: string, r: unknown) => r;
    internals.estimationService = { clearLiveDraft: () => undefined };
    return { service, internals, writes, reads: () => reads };
  }

  it("pipeline: la corrección se escribe DENTRO del lease y con el contenido vigente (no el leído al inicio)", async () => {
    const { service, internals, writes } = setup();
    internals.streamMddAnalysis = async function* () {
      yield { type: "done", markdown: MD };
    };
    await service.runMddGenerationJob(
      { mode: "pipeline", projectId: "proj", stageId: "stage-1" } as never,
      () => undefined,
    );
    assert.ok(writes.length >= 2, "corrección + cierre");
    assert.match(writes[0]!.md, /VERSION-VIGENTE/);
    assert.doesNotMatch(writes[0]!.md, /VERSION-VIEJA/);
    assert.equal(writes[0]!.leaseHeld, true, "la corrección corre bajo el lease del hilo");
  });

  it("pipeline: si el lease ya se perdió al corregir, no se escribe y el job lanza ThreadLeaseLostError", async () => {
    const lease = fakeLease("proj:stage-1");
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals, writes } = setup({ lock });
    const resolveOnce = internals.resolveLockedPatternIdsForMddJob as () => Promise<unknown>;
    let calls = 0;
    internals.resolveLockedPatternIdsForMddJob = async () => {
      if (++calls === 2) lease.lose(); // el lease se pierde justo antes de la corrección
      return resolveOnce();
    };
    internals.streamMddAnalysis = async function* () {
      throw new Error("el stream no debe arrancar");
    };
    await assert.rejects(
      service.runMddGenerationJob({ mode: "pipeline", projectId: "proj", stageId: "stage-1" } as never, () => undefined),
      ThreadLeaseLostError,
    );
    assert.equal(writes.length, 0);
  });

  it("(a) chat en cola (runMddChatTurn, manager): la corrección se escribe bajo el lease ANTES de abrir el stream del turno", async () => {
    const { service, internals, writes } = setup();
    // El chat no lee antes: la única lectura es la de la corrección, y ya devuelve el contenido vigente.
    internals.resolveLockedPatternIdsForMddJob = async () => ({
      lockedPatternIds: INCOMPATIBLE(),
      stageMddContent: NEW_BODY,
      stageId: "stage-1",
    });
    const order: string[] = [];
    const projects = internals.projects as { persistMddFromBackgroundJob: (...a: unknown[]) => Promise<void> };
    const baseWrite = projects.persistMddFromBackgroundJob;
    projects.persistMddFromBackgroundJob = async (...a: unknown[]) => {
      order.push("correccion");
      return baseWrite(...a);
    };
    internals.streamMddAnalysisWithManager = async function* () {
      order.push("stream");
      yield { type: "done", markdown: MD };
    };
    const result = await service.runMddChatTurn({ mode: "manager", projectId: "proj", stageId: "stage-1", dbgaContent: "dbga" } as never);
    assert.equal(result.outcome, "done");
    assert.deepEqual(order, ["correccion", "stream"]);
    assert.equal(writes.length, 1, "solo la corrección: el done del turno lo persiste el stream (aquí simulado)");
    assert.equal(writes[0]!.leaseHeld, true, "la corrección corre bajo el lease del hilo");
    assert.match(writes[0]!.md, /VERSION-VIGENTE/);
    assert.doesNotMatch(writes[0]!.md, /VERSION-VIEJA/);
  });

  it("(b) chat en cola sin patrones incompatibles: no escribe la corrección ni relee el contenido de más", async () => {
    const { service, internals, writes, reads } = setup({ lockedPatternIds: () => new Set(["monolito-modular"]) });
    internals.streamMddAnalysisWithManager = async function* () {
      yield { type: "done", markdown: MD };
    };
    const result = await service.runMddChatTurn({ mode: "manager", projectId: "proj", stageId: "stage-1" } as never);
    assert.equal(result.outcome, "done");
    assert.equal(writes.length, 0, "no hay corrección que escribir");
    assert.equal(reads(), 1, "una sola lectura: la del propio chequeo");
  });

  it("section (bajo lease): conserva la corrección de patrones y la escribe con el lease del hilo", async () => {
    const { service, internals, writes } = setup();
    internals.streamMddRegenerateSection = async function* () {
      yield { type: "done", markdown: MD };
    };
    await service.runMddGenerationJob(
      { mode: "section", projectId: "proj", stageId: "stage-1", section: 2 } as never,
      () => undefined,
    );
    assert.match(writes[0]!.md, /VERSION-VIGENTE/);
    assert.equal(writes[0]!.leaseHeld, true, "section corre completo bajo el lease del hilo");
  });

  it("(c) section (bajo lease): si el stream emite error con el lease perdido, el job lanza ThreadLeaseLostError (no un Error genérico)", async () => {
    const lease = fakeLease("proj:stage-1");
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals, writes } = setup({ lock, lockedPatternIds: () => new Set<string>() });
    internals.streamMddRegenerateSection = async function* () {
      yield { type: "progress", agent: "a", message: "m" };
      lease.lose();
      yield { type: "error", message: "fallo consecuencia de la pérdida" };
    };
    await assert.rejects(
      service.runMddGenerationJob({ mode: "section", projectId: "proj", stageId: "stage-1", section: 2 } as never, () => undefined),
      (err: unknown) => {
        assert.ok(err instanceof ThreadLeaseLostError);
        assert.equal((err as ThreadLeaseLostError).code, "LEASE_LOST");
        return true;
      },
    );
    assert.equal(writes.length, 0, "con el lease perdido no se persiste");
  });

  it("(c2) section (bajo lease vigente): un error del stream sigue siendo un Error genérico con su mensaje", async () => {
    const lease = fakeLease("proj:stage-1");
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals } = setup({ lock, lockedPatternIds: () => new Set<string>() });
    internals.streamMddRegenerateSection = async function* () {
      yield { type: "error", message: "fallo del LLM" };
    };
    await assert.rejects(
      service.runMddGenerationJob({ mode: "section", projectId: "proj", stageId: "stage-1", section: 2 } as never, () => undefined),
      (err: unknown) => {
        assert.ok(!(err instanceof ThreadLeaseLostError));
        assert.equal((err as Error).message, "fallo del LLM");
        return true;
      },
    );
  });

  it("sin patrones incompatibles no hay escritura de corrección ni lecturas extra del contenido", async () => {
    const { service, internals, writes, reads } = setup({ lockedPatternIds: () => new Set(["monolito-modular"]) });
    internals.streamMddAnalysis = async function* () {
      yield { type: "done", markdown: MD };
    };
    await service.runMddGenerationJob({ mode: "pipeline", projectId: "proj", stageId: "stage-1" } as never, () => undefined);
    assert.equal(reads(), 1);
    assert.equal(writes.length, 1, "solo el cierre del job");
  });

  for (const type of ["draft", "done"] as const) {
    it(`pipeline: lease_lost en el persist de un evento ${type} lanza ThreadLeaseLostError (no se descarta en silencio)`, async () => {
      const lease = fakeLease("proj:stage-1");
      const lock = {
        acquire: async () => lease,
        runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
      };
      const { service, internals, writes } = setup({ lock, lockedPatternIds: () => new Set<string>() });
      internals.streamMddAnalysis = async function* () {
        yield { type: "progress", agent: "a", message: "m" };
        lease.lose();
        yield { type, markdown: MD };
      };
      await assert.rejects(
        service.runMddGenerationJob({ mode: "pipeline", projectId: "proj", stageId: "stage-1" } as never, () => undefined),
        (err: unknown) => {
          assert.ok(err instanceof ThreadLeaseLostError);
          assert.equal((err as ThreadLeaseLostError).code, "LEASE_LOST");
          return true;
        },
      );
      assert.equal(writes.length, 0, "no se escribió nada con el lease perdido");
    });
  }
});

describe("AiAnalysisService: etapa del hilo MDD única para lease y persistencia (resolveMddThread)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  type GuardedRunner = { runGuardedMddStream: (p: unknown) => AsyncGenerator<AnyEvent> };
  type ResumeStreamer = { streamMddResume: (...a: unknown[]) => AsyncGenerator<AnyEvent> };

  it("(a) la consulta de etapas falla: LOCK_UNAVAILABLE sin llamar a acquire y sin correr el turno", async () => {
    const acquired: string[] = [];
    const { service, internals } = createService({
      acquire: async (k: string) => {
        acquired.push(k);
        return fakeLease(k);
      },
    });
    (internals.prisma as { project: { findUnique: () => Promise<never> } }).project.findUnique = async () => {
      throw new Error("BD caída");
    };
    let innerRan = false;
    const events = await drain(
      (service as unknown as GuardedRunner).runGuardedMddStream({
        tag: "test",
        projectId: "proj",
        threadSource: { stageHint: "stage-1" },
        inner: async function* () {
          innerRan = true;
          yield { type: "done", markdown: MD };
        },
      }) as AsyncGenerator<AnyEvent>,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "error");
    assert.equal(events[0]!.code, "LOCK_UNAVAILABLE");
    assert.deepEqual(acquired, []);
    assert.equal(innerRan, false);
  });

  it("(b) resume y chat con el mismo cp.mddStageId producen la misma clave de lease", async () => {
    const keys: string[] = [];
    const lock = {
      acquire: async (k: string) => {
        keys.push(k);
        return fakeLease(k);
      },
      runExclusive: async (k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => {
        keys.push(k);
        return fn(new AbortController().signal, fakeLease(k));
      },
    };
    const { service, internals } = createService(lock);
    internals.createMddStreamPersister = async () => ({
      persist: async () => ({ ok: true }),
      lastLen: () => 0,
      hasStoredDocument: () => true,
    });
    internals.runMddResumeStream = async function* () {
      yield { type: "done", markdown: MD };
    };

    await drain((service as unknown as ResumeStreamer).streamMddResume("proj", "thread-1", "hola") as AsyncGenerator<AnyEvent>);
    const streamKey = keys.at(-1);
    keys.length = 0;

    const chat = await service.runMddChatTurn({
      mode: "resume",
      projectId: "proj",
      threadId: "thread-1",
      userMessage: "hola",
    } as never);
    assert.equal(chat.ok, true);
    assert.equal(streamKey, mddThreadLockKey("proj", "stage-1"));
    // runExclusive del chat y acquire del stream interno usan la misma clave (reentrante).
    assert.deepEqual(keys, [streamKey, streamKey]);
  });

  it("(c) el job persiste y lee con la etapa resuelta del hilo aunque data.stageId sea otra", async () => {
    const { service, internals } = createService();
    // El supervisor resuelve el hilo a "stage-1" aunque el cliente mande "stage-2".
    internals.agentSupervisor = { resolveRouteFromProject: async () => ({ stageId: "stage-1" }) };
    const persistStages: Array<string | undefined> = [];
    internals.projects = {
      ...(internals.projects as object),
      persistMddFromBackgroundJob: async (_p: string, _md: string, opts: { stageId?: string }) => {
        persistStages.push(opts.stageId);
      },
    };
    const readStages: Array<string | undefined> = [];
    internals.resolveLockedPatternIdsForMddJob = async (d: { stageId?: string }) => {
      readStages.push(d.stageId);
      return { lockedPatternIds: [], stageMddContent: "", stageId: d.stageId };
    };
    internals.finalizeMddJobUpstreamBaseline = async (_p: string, _s: string, r: unknown) => r;
    internals.estimationService = { clearLiveDraft: () => undefined };
    internals.streamMddRegenerateSection = async function* () {
      yield { type: "done", markdown: MD };
    };

    await service.runMddGenerationJob(
      { mode: "section", projectId: "proj", stageId: "stage-2", section: 2 } as never,
      () => undefined,
    );
    assert.ok(persistStages.length >= 1, "el job persiste al cerrar");
    assert.deepEqual([...new Set(persistStages)], ["stage-1"]);
    assert.deepEqual([...new Set(readStages)], ["stage-1"]);
  });
});

describe("AiAnalysisService.runMddGenerationJob: section, section-pipeline y upstream-sync corren bajo el lease del hilo", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  /** Dobles comunes: sin patrones incompatibles, etapa "stage-1" sin contenido previo, escrituras registradas. */
  function doubles(createService: () => { service: AiAnalysisService; internals: Record<string, unknown> }, lock?: unknown) {
    const { service, internals } = createService();
    const writes: string[] = [];
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async (_p: string, md: string) => void writes.push(md) };
    internals.resolveLockedPatternIdsForMddJob = async () => ({
      lockedPatternIds: new Set<string>(),
      stageMddContent: "",
      stageId: "stage-1",
    });
    internals.finalizeMddJobUpstreamBaseline = async (_p: string, _s: string, r: unknown) => r;
    internals.estimationService = { clearLiveDraft: () => undefined };
    return { service, internals, writes, lock };
  }

  it("(a) section con el hilo ocupado: el job rechaza con ThreadBusyError y no arranca el stream ni persiste", async () => {
    const { service, internals, writes } = doubles(() => createService());
    const lock = internals.threadLock as ThreadRunLockService;
    // Otro turno tiene el hilo "proj:stage-1" (no es el contexto del job, así que el lease no es reentrante).
    const other = await lock.acquire(mddThreadLockKey("proj", "stage-1"), { renewEveryMs: 0 });
    assert.ok(other, "el turno previo toma el lease");
    let streamed = false;
    internals.streamMddRegenerateSection = async function* () {
      streamed = true;
      yield { type: "done", markdown: MD };
    };
    try {
      await assert.rejects(
        service.runMddGenerationJob({ mode: "section", projectId: "proj", stageId: "stage-1", section: 2 } as never, () => undefined),
        (err: unknown) => {
          assert.ok(err instanceof ThreadBusyError);
          assert.equal((err as ThreadBusyError).code, "THREAD_BUSY");
          return true;
        },
      );
    } finally {
      await other!.release();
    }
    assert.equal(streamed, false, "el stream no arranca sin lease");
    assert.equal(writes.length, 0, "no se persiste nada");
  });

  it("(b) upstream-sync: si el lease se pierde durante el stream, el LLM ve esa señal abortada y no se persiste", async () => {
    const lease = fakeLease("proj:stage-1");
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals, writes } = doubles(() => createService(lock), lock);
    internals.mddUpstreamSync = {
      analyze: async () => ({}),
      normalizeSections: () => [2],
      buildSyncSummary: () => "cambio en DBGA",
      loadUpstreamDocuments: async () => ({ dbgaContent: "dbga", stageId: "stage-1" }),
      captureBaseline: async () => undefined,
    };
    let seen: AbortSignal | undefined;
    let abortedBeforeLoss: boolean | undefined;
    internals.runMddUpstreamSyncStream = async function* () {
      // Nodo stub: lee la señal LLM activa en el paso, después pierde el lease y completa el resultado.
      seen = getActiveLlmAbortSignal();
      abortedBeforeLoss = seen?.aborted;
      lease.lose();
      yield { type: "done", markdown: MD };
    };
    await assert.rejects(
      service.runMddGenerationJob({ mode: "upstream-sync", projectId: "proj", stageId: "stage-1" } as never, () => undefined),
      (err: unknown) => {
        assert.ok(err instanceof ThreadLeaseLostError);
        return true;
      },
    );
    assert.equal(abortedBeforeLoss, false, "con el lease vigente la señal no está abortada");
    assert.equal(seen, lease.signal, "la señal LLM del paso es la del lease");
    assert.equal(seen?.aborted, true, "perder el lease aborta la señal que ve el LLM");
    assert.equal(writes.length, 0, "el resultado con el lease perdido no se persiste");
  });

  it("(c) section-pipeline: el persistidor recibe isLeaseHeld real (true mientras corre el lease, false al terminar)", async () => {
    const { service, internals, writes } = doubles(() => createService());
    const original = (internals.createMddPersister as (args: unknown) => unknown).bind(service);
    let isHeldProbe: (() => boolean) | undefined;
    internals.createMddPersister = (args: { isLeaseHeld?: () => boolean }) => {
      isHeldProbe = args.isLeaseHeld;
      return original(args);
    };
    let heldDuringStream: boolean | undefined;
    internals.streamMddRegenerateSection = async function* () {
      heldDuringStream = isHeldProbe?.();
      yield { type: "done", markdown: MD };
    };
    const result = await service.runMddGenerationJob(
      { mode: "section-pipeline", projectId: "proj", stageId: "stage-1", section: 5 } as never,
      () => undefined,
    );
    assert.equal(result.outcome, "done");
    assert.equal(heldDuringStream, true, "con el lease vigente el persistidor lo ve tomado");
    assert.equal(writes.length, 1, "el cierre se persiste");
    assert.equal(isHeldProbe?.(), false, "tras el job el lease está liberado");
  });
});

describe("AiAnalysisService: fencing token en las escrituras MDD (ADR 0004)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  /**
   * Reclamos del fence (`projects.claimMddWriteFence`) registrados con la forma del `updateMany` que hace la etapa;
   * `count` simula si la etapa acepta el fence (0 ⇒ `MddWriteFencedError`, como la persistencia real).
   */
  function claimsOf(internals: Record<string, unknown>, count = 1) {
    const claims: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    internals.projects = {
      ...(internals.projects as object),
      claimMddWriteFence: async (_projectId: string, stageId: string | null, fence: number) => {
        const id = stageId ?? "stage-1";
        claims.push({
          where: { id, OR: [{ mddLeaseFence: null }, { mddLeaseFence: { lte: BigInt(fence) } }] },
          data: { mddLeaseFence: BigInt(fence) },
        });
        if (count === 0) throw new MddWriteFencedError(id, fence);
      },
    };
    return claims;
  }
  const claimWhere = (fence: number) => ({
    id: "stage-1",
    OR: [{ mddLeaseFence: null }, { mddLeaseFence: { lte: BigInt(fence) } }],
  });
  const runManager = (service: AiAnalysisService) =>
    drain(service.streamMddAnalysisWithManager("", "proj", "hola", "borrador", "stage-1") as AsyncGenerator<AnyEvent>);

  it("(a) el stream reclama la etapa con (stageId, fence) tras adquirir el lease y el persist escribe con ese mismo fence", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const { service, internals } = createService(lockReturning(lease));
    const claims = claimsOf(internals);
    const writes: Array<{ fence?: number; stageId?: string }> = [];
    internals.projects = {
      ...(internals.projects as object),
      persistMddFromBackgroundJob: async (_p: string, _md: string, opts: { fence?: number; stageId?: string }) =>
        void writes.push(opts),
    };
    internals.runMddManagerStream = async function* () {
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(claims, [{ where: claimWhere(42), data: { mddLeaseFence: 42n } }]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.fence, 42);
    assert.equal(writes[0]!.stageId, "stage-1");
  });

  it("(a2) si la etapa ya tiene un fence mayor al adquirir, el stream termina en LEASE_LOST sin arrancar el turno", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const { service, internals } = createService(lockReturning(lease));
    claimsOf(internals, 0);
    let innerRan = false;
    internals.runMddManagerStream = async function* () {
      innerRan = true;
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "error");
    assert.equal(events[0]!.code, "LEASE_LOST");
    assert.equal(innerRan, false);
    assert.equal(lease.released(), true);
  });

  it("(a3) un nodo del stream lee el fence del lease activo tras un await (el contexto ALS sigue al turno)", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const { service, internals } = createService(lockReturning(lease));
    claimsOf(internals);
    const fenceInNode: Array<number | undefined> = [];
    internals.runMddManagerStream = async function* () {
      // Un await antes de leer: el fence debe seguir visible en la continuación del nodo, no solo en su primer tramo.
      await new Promise<void>((resolve) => setImmediate(resolve));
      fenceInNode.push(getActiveMddLeaseFence());
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(fenceInNode, [42]);
  });

  it("(b) turno zombi: el persist rechazado por fence (MddWriteFencedError) termina el stream en LEASE_LOST, sin done", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const { service, internals } = createService(lockReturning(lease));
    claimsOf(internals);
    internals.projects = {
      ...(internals.projects as object),
      persistMddFromBackgroundJob: async () => {
        throw new MddWriteFencedError("stage-1", 42);
      },
    };
    internals.runMddManagerStream = async function* () {
      yield { type: "done", markdown: MD };
    };
    const events = await runManager(service);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.code, "LEASE_LOST");
    assert.equal(events.some((e) => e.type === "done"), false);
  });

  it("(d) chat en cola: el reclamo, la corrección de patrones y el persist del turno llevan el mismo fence", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals } = createService(lock);
    const claims = claimsOf(internals);
    const stored = "# Master Design Document\n\n## 1. Contexto\n\nVERSION-VIGENTE guardada por otro turno del mismo hilo";
    // Patrones incompatibles: fuerza la corrección bajo el lease, antes del stream del turno.
    internals.resolveLockedPatternIdsForMddJob = async () => ({
      lockedPatternIds: new Set(["microservicios", "monolito-modular"]),
      stageMddContent: stored,
      stageId: "stage-1",
    });
    const fences: Array<number | undefined> = [];
    internals.projects = {
      ...(internals.projects as object),
      persistMddFromBackgroundJob: async (_p: string, _md: string, opts: { fence?: number }) => void fences.push(opts.fence),
    };
    internals.runMddManagerStream = async function* () {
      yield { type: "done", markdown: `${MD}\n\n${"contenido ".repeat(60)}` };
    };
    const result = await service.runMddChatTurn({
      mode: "manager",
      projectId: "proj",
      stageId: "stage-1",
      dbgaContent: "dbga",
    } as never);
    assert.equal(result.outcome, "done");
    // [corrección de patrones, persist del done]: ambas con el fence del lease del turno.
    assert.deepEqual(fences, [42, 42]);
    // [reclamo al adquirir en runExclusive, reclamo del stream interno (reentrante, mismo fence)].
    assert.equal(claims.length, 2);
    assert.ok(claims.every((c) => c.data.mddLeaseFence === 42n));
  });

  it("(c) job: si la etapa ya tiene un fence mayor al reclamar, el job rechaza con ThreadLeaseLostError y no persiste", async () => {
    const lease = fakeLease("proj:stage-1", 42);
    const lock = {
      acquire: async () => lease,
      runExclusive: async (_k: string, fn: (s: AbortSignal, l: ThreadRunLease) => Promise<unknown>) => fn(lease.signal, lease),
    };
    const { service, internals } = createService(lock);
    claimsOf(internals, 0);
    const writes: string[] = [];
    internals.projects = { ...(internals.projects as object), persistMddFromBackgroundJob: async (_p: string, md: string) => void writes.push(md) };
    internals.streamMddAnalysis = async function* () {
      throw new Error("el stream no debe arrancar");
    };
    await assert.rejects(
      service.runMddGenerationJob({ mode: "pipeline", projectId: "proj", stageId: "stage-1" } as never, () => undefined),
      ThreadLeaseLostError,
    );
    assert.equal(writes.length, 0);
  });
});
