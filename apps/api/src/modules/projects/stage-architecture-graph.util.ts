import type { Prisma } from "@theforge/database";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { pickPrimaryStage, type StageWithEstimation } from "./stage-helpers.js";

export function stageJsonHasPagEndpoints(value: unknown): value is ProjectArchitectureGraph {
  return value != null && typeof value === "object" && "endpoints" in value;
}

/** PAG de una etapa: `architectureGraph` primero, luego `documentAst` si incluye endpoints (fallback una release). */
export function resolveStageProjectArchitectureGraph(
  stage: { architectureGraph?: unknown; documentAst?: unknown } | null | undefined,
): ProjectArchitectureGraph | null {
  if (!stage) return null;
  if (stageJsonHasPagEndpoints(stage.architectureGraph)) {
    return stage.architectureGraph;
  }
  if (stageJsonHasPagEndpoints(stage.documentAst)) {
    return stage.documentAst;
  }
  return null;
}

export function resolveProjectOpenApiPag(
  stages: StageWithEstimation[] | undefined,
): ProjectArchitectureGraph | null {
  const list = stages ?? [];
  const primary = pickPrimaryStage(list);
  const fromPrimary = resolveStageProjectArchitectureGraph(primary);
  if (fromPrimary) return fromPrimary;
  for (const stage of list) {
    const pag = resolveStageProjectArchitectureGraph(stage);
    if (pag) return pag;
  }
  return null;
}

/** Persiste PAG en columna dedicada y doble escritura temporal en `documentAst` (release N). */
export async function persistStageArchitectureGraph(
  prisma: PrismaService,
  stageId: string,
  pag: ProjectArchitectureGraph,
): Promise<void> {
  const json = pag as unknown as Prisma.InputJsonValue;
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      architectureGraph: json,
      documentAst: json,
    },
  });
}
