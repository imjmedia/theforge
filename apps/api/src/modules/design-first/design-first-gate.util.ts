import type { PrismaService } from "../../prisma/prisma.service.js";
import {
  EMPTY_DESIGN_SPEC,
  evaluateDesignFirstPhaseGates,
  parseDesignSpec,
  projectArchitectureGraphSchema,
  type DesignFirstPhaseGates,
  type DesignSpec,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";
import { hashDesignSpec } from "@theforge/shared-types/design-spec-hash.node";
import { pickPrimaryStage } from "../projects/stage-helpers.js";
import { throwDesignPhaseGate, throwDesignStale } from "./design-first.errors.js";

export type DesignFirstStageContext = {
  designSpec: DesignSpec;
  designSpecHash: string;
  pag: ProjectArchitectureGraph | null;
  gates: DesignFirstPhaseGates;
  stale: boolean;
};

export async function loadDesignFirstStageContext(
  prisma: PrismaService,
  projectId: string,
  stageId?: string | null,
): Promise<DesignFirstStageContext | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { stages: { orderBy: { ordinal: "asc" } } },
  });
  if (!project || project.projectType !== "DESIGN_FIRST") return null;
  const stage =
    (stageId ? project.stages.find((s) => s.id === stageId) : pickPrimaryStage(project.stages)) ??
    null;
  if (!stage) return null;

  const designSpec = parseDesignSpec(stage.designSpec ?? EMPTY_DESIGN_SPEC);
  const designSpecHash = hashDesignSpec(designSpec);
  let pag: ProjectArchitectureGraph | null = null;
  if (stage.architectureGraph) {
    const parsed = projectArchitectureGraphSchema.safeParse(stage.architectureGraph);
    pag = parsed.success ? parsed.data : null;
  }
  const gates = evaluateDesignFirstPhaseGates({
    designSpec,
    pag,
    designSpecHash,
    architectureGraphSourceHash: stage.architectureGraphSourceHash,
  });
  const stale =
    stage.architectureGraphSourceHash != null &&
    stage.architectureGraphSourceHash !== designSpecHash;

  return { designSpec, designSpecHash, pag, gates, stale };
}

export function assertDesignFirstMddJobGate(ctx: DesignFirstStageContext): void {
  if (!ctx.gates.phase2.ok) {
    throwDesignPhaseGate("Completa la fase 2 (datos) antes de iniciar el job MDD");
  }
}

export function assertDesignFirstDeliverableGate(ctx: DesignFirstStageContext): void {
  if (ctx.designSpec.screens.length === 0 && ctx.designSpec.entities.length === 0) {
    throwDesignPhaseGate("Define el diseño antes de generar entregables");
  }
  if (!ctx.pag) {
    throwDesignPhaseGate("Compila el contrato (PAG) antes de generar entregables");
  }
  if (!ctx.gates.phase3.ok) {
    throwDesignPhaseGate("La fase 3 del diseño debe estar en verde antes de generar entregables");
  }
  if (ctx.stale) {
    throwDesignStale();
  }
}
