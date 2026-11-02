/**
 * Propagación del contexto de telemetría de tokens en `buildMddEvalDeps().generate`.
 *
 * Dobles: `aiService.streamMddAnalysis` falso (generador con pausas que simulan llamadas LLM), y
 * `prisma` / `tokenUsage` mínimos que fallan si se usan (el generador no los toca). `requestUserStore`
 * es el real: la factoría lo importa directamente, así que no se puede sustituir.
 *
 * Qué demuestra: el contexto AsyncLocalStorage que la factoría fija en CADA `next()` llega a las
 * lecturas posteriores a una pausa, a promesas creadas en un paso y consumidas en otro, y no se
 * cruza entre casos que corren a la vez (el suite usa concurrencia hasta 3).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestUserStore } from "../../../common/request-user.store.js";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import type { AiAnalysisService } from "../ai-analysis.service.js";
import {
  getActiveTokenUsageContext,
  type TokenUsageContextPayload,
} from "../token-usage/token-usage.context.js";
import type { TokenUsageService } from "../token-usage/token-usage.service.js";
import { buildMddEvalDeps } from "./mdd-eval-nest-deps.js";
import type { EvalStreamEvent } from "./mdd-eval-runner.js";

const USER_ID = "user-eval";
const GROUP_ID = "group-eval";

/** Lo que vio un paso del generador: el contexto de tokens y el usuario de la petición. */
type Lectura = {
  paso: string;
  payload: TokenUsageContextPayload | null;
  usuario: string | undefined;
};

/** Evento de progreso que transporta una lectura (el runner no lo usa; la factoría lo reenvía tal cual). */
type EventoSonda = { type: "progress"; agent: string; message: string; sonda: Lectura };

function esSonda(event: EvalStreamEvent): event is EvalStreamEvent & EventoSonda {
  return (event as { sonda?: unknown }).sonda !== undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leer(paso: string): Lectura {
  return {
    paso,
    payload: getActiveTokenUsageContext(),
    usuario: requestUserStore.getStore()?.userId,
  };
}

function sonda(lectura: Lectura): EvalStreamEvent {
  return {
    type: "progress",
    agent: "sonda",
    message: lectura.paso,
    sonda: lectura,
  } as unknown as EvalStreamEvent;
}

async function recoger(iterable: AsyncIterable<EvalStreamEvent>): Promise<EvalStreamEvent[]> {
  const eventos: EvalStreamEvent[] = [];
  for await (const evento of iterable) eventos.push(evento);
  return eventos;
}

/** Dobles de la factoría: solo `streamMddAnalysis` es real para este test; el resto falla si se usa. */
function dobles() {
  const llamadas: Array<{ projectId?: string; stageId?: string | null; signal?: AbortSignal }> = [];
  const aiService = {
    streamMddAnalysis(
      _dbgaContent: string,
      projectId?: string,
      stageId?: string | null,
      _clientMdd?: string,
      options?: { signal?: AbortSignal },
    ) {
      llamadas.push({ projectId, stageId, signal: options?.signal });
      return (async function* () {
        // Paso 1: arranca una promesa que se resuelve durante el paso 2 y lee el contexto al resolverse.
        const pendiente = new Promise<Lectura>((resolve) => {
          setTimeout(() => resolve(leer("promesa-creada-en-paso-1")), 5);
        });
        await sleep(1);
        yield sonda(leer("paso-1"));

        // Paso 2: consume la promesa de antes (su lectura se hizo al resolverse).
        const alResolverse = await pendiente;
        yield sonda(alResolverse);

        // Paso 3: otra pausa tipo llamada LLM y lectura posterior.
        await sleep(1);
        yield sonda(leer("paso-3"));

        yield { type: "done", markdown: "# MDD de prueba" } as EvalStreamEvent;
      })();
    },
  };
  const prisma = {
    project: {
      create: async () => {
        throw new Error("prisma no debe usarse en el generador");
      },
    },
  };
  const tokenUsage = {
    getSummary: async () => {
      throw new Error("tokenUsage no debe usarse en el generador");
    },
  };
  const deps = buildMddEvalDeps({
    prisma: prisma as unknown as PrismaService,
    aiService: aiService as unknown as AiAnalysisService,
    tokenUsage: tokenUsage as unknown as TokenUsageService,
    userId: USER_ID,
    groupId: GROUP_ID,
    keepProjects: false,
  });
  return { deps, llamadas };
}

function contextoEsperado(projectId: string, stageId: string): TokenUsageContextPayload {
  return {
    projectId,
    stageId,
    documentField: "mddContent",
    context: "initial",
    jobId: `eval-${projectId}`,
  };
}

describe("buildMddEvalDeps().generate: propagación del contexto de tokens", () => {
  it("el contexto llega a cada paso, incluidas las lecturas tras pausas y promesas de otro paso", async () => {
    const { deps } = dobles();
    const eventos = await recoger(deps.generate("dbga", "proj-1", "stage-1", new AbortController().signal));
    const lecturas = eventos.filter(esSonda).map((evento) => evento.sonda);

    assert.deepEqual(
      lecturas.map((lectura) => lectura.paso),
      ["paso-1", "promesa-creada-en-paso-1", "paso-3"],
    );
    for (const lectura of lecturas) {
      assert.notEqual(lectura.payload, null, `sin contexto de tokens en ${lectura.paso}`);
      assert.equal(lectura.payload?.projectId, "proj-1", `projectId en ${lectura.paso}`);
      assert.equal(lectura.payload?.stageId, "stage-1", `stageId en ${lectura.paso}`);
      assert.equal(lectura.payload?.documentField, "mddContent", `documentField en ${lectura.paso}`);
      assert.equal(lectura.payload?.context, "initial", `context en ${lectura.paso}`);
      assert.equal(lectura.payload?.jobId, "eval-proj-1", `jobId en ${lectura.paso}`);
      assert.deepEqual(lectura.payload, contextoEsperado("proj-1", "stage-1"));
      assert.equal(lectura.usuario, USER_ID, `usuario de petición en ${lectura.paso}`);
    }
  });

  it("reenvía la señal de aborto y el proyecto/etapa al pipeline", async () => {
    const { deps, llamadas } = dobles();
    const signal = new AbortController().signal;
    await recoger(deps.generate("dbga", "proj-2", "stage-2", signal));
    assert.equal(llamadas.length, 1, "el pipeline se invoca una sola vez por caso");
    assert.equal(llamadas[0].projectId, "proj-2");
    assert.equal(llamadas[0].stageId, "stage-2");
    assert.equal(llamadas[0].signal, signal);
  });

  it("casos concurrentes no se cruzan: cada lectura ve el projectId de su propio caso", async () => {
    const { deps } = dobles();
    const [a, b] = await Promise.all([
      recoger(deps.generate("dbga", "proj-A", "stage-A", new AbortController().signal)),
      recoger(deps.generate("dbga", "proj-B", "stage-B", new AbortController().signal)),
    ]);
    for (const [eventos, projectId, stageId] of [
      [a, "proj-A", "stage-A"],
      [b, "proj-B", "stage-B"],
    ] as const) {
      const lecturas = eventos.filter(esSonda).map((evento) => evento.sonda);
      assert.equal(lecturas.length, 3);
      for (const lectura of lecturas) {
        assert.deepEqual(lectura.payload, contextoEsperado(projectId, stageId), `contexto cruzado en ${lectura.paso}`);
      }
    }
  });

  it("el contexto no se filtra al llamador una vez terminado el generador", async () => {
    const { deps } = dobles();
    await recoger(deps.generate("dbga", "proj-3", "stage-3", new AbortController().signal));
    assert.equal(getActiveTokenUsageContext(), null);
  });
});
