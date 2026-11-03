/**
 * O14 · coste de los streams HTTP: cada `next()` de un stream de generación corre con contexto de
 * telemetría de tokens (los adapters registran uso solo con contexto activo) y con el contexto de aborto LLM.
 *
 * Dobles: `AiAnalysisService` real con prisma mínimo y dependencias sin uso (mocks por constructor); los
 * generadores internos (`run*Stream`) se sustituyen por stubs que hacen de "nodo": pausan, leen el contexto
 * y llaman a `recordTokenUsageFromContext` como lo haría un adapter. El recorder global es un doble que
 * captura las filas de uso (se restaura al terminar).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { recordTokenUsageFromContext, registerTokenUsageRecorder } from "../ai/utils/token-usage-recorder.js";
import { AiAnalysisService } from "./ai-analysis.service.js";
import { ThreadRunLockService } from "./checkpoint/thread-run-lock.service.js";
import {
  getActiveTokenUsageContext,
  runWithTokenUsageContext,
  type TokenUsageContextPayload,
} from "./token-usage/token-usage.context.js";
import { getActiveLlmAbortSignal } from "./utils/mdd-llm-stream-invoke.util.js";

type AnyEvent = { type: string; code?: string; message?: string; markdown?: string };
type Fila = { projectId: string; stageId?: string | null; documentField: string; context: string; node?: string | null; jobId?: string | null };

const GLOBAL_KEY = "__theforgeTokenUsageRecorder";
const MD = "# Master Design Document\n\n## 1. Contexto\n\ncontenido suficiente para persistir";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function createService(): { service: AiAnalysisService; internals: Record<string, unknown> } {
  // Proyecto existente: la etapa del hilo se resuelve (si no, `resolveMddThread` falla cerrado con LOCK_UNAVAILABLE).
  const prisma = {
    project: { findUnique: async () => ({ id: "proj", stages: [] }), update: async () => ({}) },
    stage: { updateMany: async () => ({ count: 1 }) },
    agentStateCheckpoint: { findFirst: async () => ({ mddStageId: "stage-1" }) },
  };
  // Supervisor: la etapa del hilo es la pista del cliente (o "stage-1").
  const agentSupervisor = {
    resolveRouteFromProject: async (_p: unknown, hint?: string | null) => ({ stageId: hint?.trim() || "stage-1" }),
  };
  // Constructor: prisma + 13 dependencias sin uso en estos tests (la 7.ª, índice 6, es el supervisor) + threadLock.
  const deps: unknown[] = Array.from({ length: 13 }, () => ({}));
  deps[6] = agentSupervisor;
  deps[4] = { claimMddWriteFence: async () => undefined };
  const service = new AiAnalysisService(prisma as never, ...(deps as [never]), new ThreadRunLockService() as never);
  return { service, internals: service as unknown as Record<string, unknown> };
}

async function drain<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** Lo que vio un paso del generador interno. */
type Lectura = { paso: string; payload: TokenUsageContextPayload | null; signal: AbortSignal | undefined };

function leer(paso: string): Lectura {
  return { paso, payload: getActiveTokenUsageContext(), signal: getActiveLlmAbortSignal() };
}

/**
 * Generador interno que hace de nodo LLM: registra uso con el contexto activo (como un adapter) en tres
 * momentos, incluida una promesa creada en el paso 1 y resuelta en el paso 2. Las lecturas quedan en `lecturas`.
 */
function nodoStub(lecturas: Lectura[], node: string) {
  return async function* (): AsyncGenerator<AnyEvent, void, undefined> {
    const pendiente = new Promise<Lectura>((resolve) => {
      setTimeout(() => {
        const l = leer("promesa-creada-en-paso-1");
        recordTokenUsageFromContext("prov", "model", 1, 1, 2, { node: `${node}:promesa` });
        resolve(l);
      }, 5);
    });
    await sleep(1);
    lecturas.push(leer("paso-1"));
    recordTokenUsageFromContext("prov", "model", 10, 5, 15, { node });
    yield { type: "progress", message: "p1" };

    lecturas.push(await pendiente); // consumida en otro paso que el de su creación
    yield { type: "progress", message: "p2" };

    await sleep(1);
    lecturas.push(leer("paso-3"));
    recordTokenUsageFromContext("prov", "model", 20, 10, 30, { node: `${node}:final` });
    yield { type: "done", markdown: MD };
  };
}

describe("AiAnalysisService: contexto de tokens en streams HTTP (O14)", () => {
  let prevRedis: string | undefined;
  let prevRecorder: unknown;
  let filas: Fila[];

  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    prevRecorder = (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
    filas = [];
    registerTokenUsageRecorder({
      recordAsync: (event) => {
        filas.push({
          projectId: event.projectId,
          stageId: event.stageId,
          documentField: event.documentField,
          context: event.context,
          node: event.node,
          jobId: event.jobId,
        });
      },
    });
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
    (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = prevRecorder;
  });

  it("stream MDD (pipeline): registra una fila de uso con node y el contexto llega a cada paso, también a la promesa creada en uno y resuelta en otro", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runMddPipelineStream = nodoStub(lecturas, "nodo-stub");

    assert.equal(getActiveTokenUsageContext(), null);
    const eventos = await drain(service.streamMddAnalysis("dbga", "proj-1", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(eventos.at(-1)?.type, "done");

    assert.equal(lecturas.length, 3);
    for (const l of lecturas) {
      assert.notEqual(l.payload, null, `sin contexto de tokens en ${l.paso}`);
      assert.equal(l.payload?.projectId, "proj-1", l.paso);
      assert.equal(l.payload?.stageId, "stage-1", l.paso);
      assert.equal(l.payload?.documentField, "mddContent", l.paso);
      assert.equal(l.payload?.context, "initial", l.paso);
      assert.equal(l.payload?.jobId, undefined, l.paso);
    }
    assert.deepEqual(
      filas.map((f) => f.node),
      ["nodo-stub", "nodo-stub:promesa", "nodo-stub:final"],
    );
    for (const f of filas) {
      assert.equal(f.projectId, "proj-1");
      assert.equal(f.stageId, "stage-1");
      assert.equal(f.documentField, "mddContent");
      assert.equal(f.jobId, null);
    }
    // El contexto no se filtra al consumidor.
    assert.equal(getActiveTokenUsageContext(), null);
  });

  it("manager con borrador o mensaje inicial es 'regenerate'; sin ellos 'initial'; resume siempre 'regenerate'", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runMddManagerStream = nodoStub(lecturas, "m");
    internals.runMddResumeStream = nodoStub(lecturas, "r");
    internals.createMddStreamPersister = async () => null;

    await drain(service.streamMddAnalysisWithManager("", "proj-m", undefined, undefined, "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(lecturas.at(-1)?.payload?.context, "initial");
    lecturas.length = 0;
    await drain(service.streamMddAnalysisWithManager("", "proj-m", "hola", "borrador", "stage-1") as AsyncGenerator<AnyEvent>);
    assert.equal(lecturas.at(-1)?.payload?.context, "regenerate");
    lecturas.length = 0;
    await drain(service.streamMddResume("proj-m", "thread-1", "sigue", undefined) as AsyncGenerator<AnyEvent>);
    assert.equal(lecturas.at(-1)?.payload?.context, "regenerate");
    assert.equal(lecturas.at(-1)?.payload?.projectId, "proj-m");
    assert.equal(lecturas.at(-1)?.payload?.stageId, "stage-1");
  });

  it("DBGA, regenerar sección y upstream-sync: cada stream HTTP lleva su documentField y context", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runDbgaAnalysisStream = nodoStub(lecturas, "dbga");
    internals.runMddRegenerateSectionStream = nodoStub(lecturas, "regen");
    internals.runMddUpstreamSyncStream = nodoStub(lecturas, "sync");

    await drain(service.streamAnalysis("idea suficientemente larga para analizar", "proj-d") as AsyncGenerator<AnyEvent>);
    assert.equal(lecturas.length, 3);
    assert.ok(lecturas.every((l) => l.payload?.projectId === "proj-d" && l.payload.documentField === "dbgaContent" && l.payload.context === "initial"));
    assert.ok(lecturas.every((l) => l.payload?.stageId === null));

    lecturas.length = 0;
    await drain(service.streamMddRegenerateSection("proj-r", 3, MD, "stage-9") as AsyncGenerator<AnyEvent>);
    assert.ok(lecturas.every((l) => l.payload?.projectId === "proj-r" && l.payload.stageId === "stage-9" && l.payload.documentField === "mddContent" && l.payload.context === "regenerate"));

    lecturas.length = 0;
    await drain(service.streamMddUpstreamSync("proj-u", [2, 3], "cambio", "dbga", "stage-8") as AsyncGenerator<AnyEvent>);
    assert.ok(lecturas.every((l) => l.payload?.projectId === "proj-u" && l.payload.stageId === "stage-8" && l.payload.documentField === "mddContent" && l.payload.context === "regenerate"));

    assert.deepEqual(
      [...new Set(filas.map((f) => `${f.projectId}:${f.documentField}`))].sort(),
      ["proj-d:dbgaContent", "proj-r:mddContent", "proj-u:mddContent"],
    );
  });

  it("sin projectId no hay a quién atribuir el uso: DBGA corre sin contexto y no registra filas", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runDbgaAnalysisStream = nodoStub(lecturas, "dbga");
    await drain(service.streamAnalysis("idea suficientemente larga para analizar") as AsyncGenerator<AnyEvent>);
    assert.ok(lecturas.every((l) => l.payload === null));
    assert.equal(filas.length, 0);
  });

  it("con contexto ya activo (job, eval, stream exterior) no se crea otro: se conserva el projectId del externo", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runMddPipelineStream = nodoStub(lecturas, "n");
    internals.runMddRegenerateSectionStream = nodoStub(lecturas, "n");
    const externo: TokenUsageContextPayload = {
      projectId: "proj-externo",
      stageId: "stage-ext",
      documentField: "mddContent",
      context: "regenerate",
      jobId: "job-1",
    };

    await runWithTokenUsageContext(externo, async () => {
      await drain(service.streamMddAnalysis("dbga", "proj-interno", "stage-1") as AsyncGenerator<AnyEvent>);
      await drain(service.streamMddRegenerateSection("proj-interno", 2, MD, "stage-1") as AsyncGenerator<AnyEvent>);
    });

    assert.equal(lecturas.length, 6);
    for (const l of lecturas) {
      assert.equal(l.payload?.projectId, "proj-externo", l.paso);
      assert.equal(l.payload?.jobId, "job-1", l.paso);
      assert.equal(l.payload?.stageId, "stage-ext", l.paso);
    }
    assert.ok(filas.length >= 6 && filas.every((f) => f.projectId === "proj-externo" && f.jobId === "job-1"));
  });

  it("el contexto de un consumidor que lo fija por paso (eval) gana aunque el generador sea creado fuera", async () => {
    const { service, internals } = createService();
    const lecturas: Lectura[] = [];
    internals.runMddPipelineStream = nodoStub(lecturas, "n");
    const externo: TokenUsageContextPayload = { projectId: "eval-p", documentField: "mddContent", context: "initial", jobId: "eval-1" };
    const gen = service.streamMddAnalysis("dbga", "otro", "stage-1") as AsyncGenerator<AnyEvent>;
    for (;;) {
      const step = await runWithTokenUsageContext(externo, () => gen.next());
      if (step.done) break;
    }
    assert.ok(lecturas.every((l) => l.payload?.projectId === "eval-p" && l.payload.jobId === "eval-1"));
  });

  it("streams concurrentes de proyectos distintos no cruzan su contexto", async () => {
    const { service, internals } = createService();
    const porProyecto = new Map<string, Lectura[]>();
    internals.runMddPipelineStream = async function* (_d: string, projectId: string) {
      const propias: Lectura[] = [];
      porProyecto.set(projectId, propias);
      yield* nodoStub(propias, projectId)();
    };
    await Promise.all(
      ["proj-a", "proj-b", "proj-c"].map((p) => drain(service.streamMddAnalysis("dbga", p, "stage-1") as AsyncGenerator<AnyEvent>)),
    );
    for (const [projectId, lecturas] of porProyecto) {
      assert.equal(lecturas.length, 3);
      assert.ok(lecturas.every((l) => l.payload?.projectId === projectId), projectId);
    }
    for (const f of filas) assert.ok(f.node?.startsWith(f.projectId), `${f.node} atribuido a ${f.projectId}`);
  });

  it("el abort sigue llegando junto al contexto de tokens, y cortar el stream no deja el contexto colgado", async () => {
    const { service, internals } = createService();
    const ac = new AbortController();
    let passedToInner: AbortSignal | undefined;
    const lecturas: Lectura[] = [];
    internals.runMddPipelineStream = async function* (
      _d: string,
      _p: string,
      _s: string,
      _c: string,
      signal: AbortSignal | undefined,
    ) {
      passedToInner = signal;
      await sleep(2);
      lecturas.push(leer("paso-1"));
      yield { type: "progress", message: "p1" };
      await sleep(2);
      lecturas.push(leer("paso-2"));
      yield { type: "done", markdown: MD };
    };

    await drain(
      service.streamMddAnalysis("dbga", "proj-ab", "stage-1", undefined, { signal: ac.signal }) as AsyncGenerator<AnyEvent>,
    );
    assert.equal(lecturas.length, 2);
    for (const l of lecturas) {
      assert.ok(l.signal && l.signal === passedToInner, `la señal de aborto no llegó en ${l.paso}`);
      assert.equal(l.payload?.projectId, "proj-ab");
    }
    ac.abort();
    assert.equal(lecturas[0]!.signal!.aborted, true);

    // Corte del consumidor: el lease se libera y no queda contexto en el hilo principal.
    internals.runMddPipelineStream = async function* () {
      for (let i = 0; i < 20; i += 1) {
        await sleep(1);
        yield { type: "progress", message: String(i) };
      }
    };
    const gen = service.streamMddAnalysis("dbga", "proj-ab", "stage-1") as AsyncGenerator<AnyEvent>;
    await gen.next();
    await gen.return(undefined);
    assert.equal(getActiveTokenUsageContext(), null);
    assert.equal(getActiveLlmAbortSignal(), undefined);
  });
});
