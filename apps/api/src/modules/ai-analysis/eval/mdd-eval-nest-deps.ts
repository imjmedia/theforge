/**
 * @fileoverview Dependencias reales del runner del eval de MDDs (Nest + Prisma + pipeline MDD).
 * Una sola implementación para el CLI (`scripts/eval-mdd.ts`) y para el worker de la web
 * (`mdd-eval-queue.service.ts`).
 */

import { requestUserStore } from "../../../common/request-user.store.js";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import type { AiAnalysisService } from "../ai-analysis.service.js";
import type { TokenUsageService } from "../token-usage/token-usage.service.js";
import { runWithNodeCacheDisabled } from "../checkpoint/node-cache.service.js";
import {
  classifyTokenUsageOutcome,
  runWithTokenUsageContext,
  type TokenUsageContextPayload,
} from "../token-usage/token-usage.context.js";
import { scoreMddAgainstCase } from "./mdd-eval-rubric.js";
import type { EvalStreamEvent, MddEvalRunnerDeps } from "./mdd-eval-runner.js";

export interface BuildMddEvalDepsInput {
  prisma: PrismaService;
  aiService: AiAnalysisService;
  tokenUsage: TokenUsageService;
  /** Dueño de los proyectos temporales; el pipeline resuelve su LLM (BYOK) con este usuario. */
  userId: string;
  groupId: string;
  /** true: no borrar los proyectos temporales. */
  keepProjects: boolean;
  /**
   * true (default): la caché por nodo se salta durante la corrida, para medir el pipeline real y no
   * salidas cacheadas de un modelo o prompt anterior.
   */
  disableNodeCache?: boolean;
}

/** Tope de filas de `TokenUsage` leídas por caso (un caso hace decenas de llamadas, no miles). */
const TOKEN_USAGE_EVENTS_LIMIT = 10_000;

/**
 * Cuenta las filas de `TokenUsage` de un caso con la regla de `classifyTokenUsageOutcome`: `measured` = llamadas
 * con resultado; `failed` = error/timeout/abort. Las filas `unknown` (sin `outcome` y sin tarifa) no suman a
 * ninguno de los dos totales. Las fallidas llegan con 0 tokens y coste 0 (`skipCost`): contarlas como medidas
 * haría pasar por "medido, $0" un caso cuyas llamadas fallaron todas (p. ej. 401).
 */
export function countLlmCallsByOutcome(
  events: ReadonlyArray<{ outcome?: string | null; costKnown?: boolean | null }>,
): { measured: number; failed: number } {
  let measured = 0;
  let failed = 0;
  for (const event of events) {
    const kind = classifyTokenUsageOutcome(event);
    if (kind === "measured") measured += 1;
    else if (kind === "failed") failed += 1;
  }
  return { measured, failed };
}

/** Dependencias reales: proyectos temporales en Prisma, pipeline MDD, uso de tokens y rúbrica. */
export function buildMddEvalDeps(input: BuildMddEvalDepsInput): MddEvalRunnerDeps {
  const { prisma, aiService, tokenUsage, userId, groupId, keepProjects } = input;
  const disableNodeCache = input.disableNodeCache ?? true;
  return {
    async createTempProject(evalCase) {
      // Nested create: proyecto y etapa en una sola transacción (mismo default que ProjectLifecycle.create).
      const project = await prisma.project.create({
        data: {
          userId,
          groupId,
          name: `eval-mdd-${evalCase.id}-${Date.now()}`,
          complexity: evalCase.complexity,
          stages: {
            create: {
              ordinal: 1,
              key: "main",
              name: "Etapa principal",
              workflowStatus: "ACTIVE",
            },
          },
        },
        select: { id: true, stages: { select: { id: true }, orderBy: { ordinal: "asc" }, take: 1 } },
      });
      const stageId = project.stages[0]?.id;
      if (!stageId) throw new Error(`el proyecto temporal ${project.id} no tiene etapa`);
      return { projectId: project.id, stageId };
    },
    async deleteTempProject(projectId) {
      if (keepProjects) return;
      await prisma.project.delete({ where: { id: projectId } });
    },
    generate(dbgaContent, projectId, stageId, signal): AsyncIterable<EvalStreamEvent> {
      // Mismo contexto de telemetría que el job MDD de la cola: sin él los adapters LLM no registran uso.
      const tokenCtx: TokenUsageContextPayload = {
        projectId,
        stageId,
        documentField: "mddContent",
        context: "initial",
        jobId: `eval-${projectId}`,
      };
      return (async function* () {
        // El pipeline resuelve el LLM (BYOK) con el usuario del contexto de petición: se fija por paso.
        const inner = aiService.streamMddAnalysis(dbgaContent, projectId, stageId, undefined, { signal });
        try {
          while (true) {
            // El cuerpo de un generador se reanuda en cada `next()`: el contexto de tokens debe fijarse en
            // cada paso (envolver solo su creación no llegaría a las llamadas LLM).
            const step = await runWithTokenUsageContext(tokenCtx, () =>
              requestUserStore.run({ userId, role: "admin" }, () =>
                disableNodeCache ? runWithNodeCacheDisabled(() => inner.next()) : inner.next(),
              ),
            );
            if (step.done) return;
            yield step.value as EvalStreamEvent;
          }
        } finally {
          void inner.return(undefined).catch(() => undefined);
        }
      })();
    },
    async getTokenUsage(projectId) {
      const summary = await tokenUsage.getSummary(projectId);
      const events = await tokenUsage.listEvents(projectId, { limit: TOKEN_USAGE_EVENTS_LIMIT });
      const { measured, failed } = countLlmCallsByOutcome(events.filter((event) => event.documentField !== "chat"));
      return {
        llmCalls: measured,
        failedLlmCalls: failed,
        promptTokens: summary.totalPromptTokens,
        completionTokens: summary.totalCompletionTokens,
        costUsd: summary.totalCostUsd,
      };
    },
    score: scoreMddAgainstCase,
    now: () => Date.now(),
  };
}
