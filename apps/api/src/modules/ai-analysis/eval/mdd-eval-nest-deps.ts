/**
 * @fileoverview Dependencias reales del runner del eval de MDDs (Nest + Prisma + pipeline MDD).
 * Una sola implementación para el CLI (`scripts/eval-mdd.ts`) y para el worker de la web
 * (`mdd-eval-queue.service.ts`).
 */

import { requestUserStore } from "../../../common/request-user.store.js";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import type { AiAnalysisService } from "../ai-analysis.service.js";
import type { TokenUsageService } from "../token-usage/token-usage.service.js";
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
}

/** Dependencias reales: proyectos temporales en Prisma, pipeline MDD, uso de tokens y rúbrica. */
export function buildMddEvalDeps(input: BuildMddEvalDepsInput): MddEvalRunnerDeps {
  const { prisma, aiService, tokenUsage, userId, groupId, keepProjects } = input;
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
      return (async function* () {
        // El pipeline resuelve el LLM (BYOK) con el usuario del contexto de petición: se fija por paso.
        const inner = aiService.streamMddAnalysis(dbgaContent, projectId, stageId, undefined, { signal });
        try {
          while (true) {
            const step = await requestUserStore.run({ userId, role: "admin" }, () => inner.next());
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
      return {
        llmCalls: summary.documents.reduce((total, doc) => total + doc.generations, 0),
        promptTokens: summary.totalPromptTokens,
        completionTokens: summary.totalCompletionTokens,
        costUsd: summary.totalCostUsd,
      };
    },
    score: scoreMddAgainstCase,
    now: () => Date.now(),
  };
}
