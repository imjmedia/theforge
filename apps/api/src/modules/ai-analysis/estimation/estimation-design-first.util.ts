import {
  EMPTY_DESIGN_SPEC,
  evaluateDesignFirstPhaseGates,
  isDesignFirst,
  parseDesignSpec,
  projectArchitectureGraphSchema,
  type DesignFirstPhaseGates,
  type ProjectType,
} from "@theforge/shared-types";
import { hashDesignSpec } from "@theforge/shared-types/design-spec-hash.node";
import type { SemaphoreStatusLive } from "./estimation.types.js";

export function hasEvaluableInput(
  projectType: ProjectType | string,
  mddContent: string,
  designSpecRaw: unknown,
): boolean {
  if (isDesignFirst(projectType as ProjectType)) {
    const spec = parseDesignSpec(designSpecRaw ?? EMPTY_DESIGN_SPEC);
    return spec.screens.length > 0 || mddContent.trim().length > 0;
  }
  return mddContent.trim().length > 0;
}

export function resolveScreenCount(
  projectType: ProjectType | string,
  designSpecRaw: unknown,
  mddMarkdown: string,
  parseCountsFromMarkdown: (md: string) => { screenCount: number },
): number {
  if (isDesignFirst(projectType as ProjectType)) {
    return parseDesignSpec(designSpecRaw ?? EMPTY_DESIGN_SPEC).screens.length;
  }
  return parseCountsFromMarkdown(mddMarkdown).screenCount;
}

export function designFirstCompletenessScore(gates: DesignFirstPhaseGates): number {
  let score = 0;
  if (gates.phase1.ok) score += 20;
  if (gates.phase2.ok) score += 20;
  const openIssues =
    gates.phase1.issues.length + gates.phase2.issues.length + gates.phase3.issues.length;
  if (!gates.phase1.ok && openIssues > 0) {
    score += Math.max(0, 20 - Math.min(19, openIssues * 2));
  }
  return Math.min(40, score);
}

export function minSemaphoreStatus(
  a: SemaphoreStatusLive,
  b: SemaphoreStatusLive,
): SemaphoreStatusLive {
  const rank: Record<SemaphoreStatusLive, number> = { red: 0, yellow: 1, green: 2 };
  return rank[a] <= rank[b] ? a : b;
}

export function designFirstPhaseSemaphore(
  gates: DesignFirstPhaseGates,
  hasMdd: boolean,
): SemaphoreStatusLive {
  if (!gates.phase1.ok) return "red";
  if (!gates.phase2.ok || !gates.phase3.ok) return "yellow";
  if (!hasMdd) return "yellow";
  return "green";
}

export function loadDesignFirstGatesFromStage(stage: {
  designSpec: unknown;
  architectureGraph: unknown;
  architectureGraphSourceHash: string | null;
}) {
  const designSpec = parseDesignSpec(stage.designSpec ?? EMPTY_DESIGN_SPEC);
  const designSpecHash = hashDesignSpec(designSpec);
  const pagParsed = stage.architectureGraph
    ? projectArchitectureGraphSchema.safeParse(stage.architectureGraph)
    : null;
  const pag = pagParsed?.success ? pagParsed.data : null;
  const gates = evaluateDesignFirstPhaseGates({
    designSpec,
    pag,
    designSpecHash,
    architectureGraphSourceHash: stage.architectureGraphSourceHash,
  });
  return { designSpec, designSpecHash, pag, gates };
}
