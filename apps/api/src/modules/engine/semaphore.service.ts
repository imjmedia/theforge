import { Injectable } from "@nestjs/common";
import { ProjectApproach } from "@theforge/database";
import { mddJsonSchema, type MddJson } from "@theforge/shared-types";

/** Longitud mínima (caracteres no vacíos) para considerar un entregable “presente”. */
const MIN_DELIVERABLE_LEN = 48;

function substantial(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length >= MIN_DELIVERABLE_LEN;
}

/** Degradador Figma/UX: false ⇒ el núcleo limita a amarillo. */
export function evaluateFigmaGateOk(
  hasUxTeam: boolean,
  figmaMapping: unknown,
  approach?: ProjectApproach,
  uiScreensContent?: string | null,
): boolean {
  if (approach === ProjectApproach.UX_FIRST || hasUxTeam) {
    return figmaMapping != null || substantial(uiScreensContent);
  }
  return true;
}

/** Degradador Constitución Cursor: true si hay bloqueantes abiertos en plantilla detectada. */
export function evaluateConstitutionBlockersOpen(mddJsonString: string | null | undefined): boolean {
  if (!mddJsonString?.trim()) return false;
  let parsed: MddJson;
  try {
    parsed = mddJsonSchema.parse(JSON.parse(mddJsonString) as unknown);
  } catch {
    return false;
  }
  const c = parsed.constitution;
  if (!c?.template_detected) return false;
  return c.has_open_blockers === true;
}

/** @deprecated Tipos legacy del composite; el color sale del núcleo (P7). */
export type SemaphoreDeliverablesSnapshot = {
  specContent: string | null;
  useCasesContent: string | null;
  userStoriesContent: string | null;
  tasksContent: string | null;
  apiContractsContent: string | null;
  uxUiGuideContent: string | null;
  logicFlowsContent: string | null;
  infraContent: string | null;
};

/** @deprecated El listado de proyectos usa `evaluateMddSemaphore`; solo degradadores activos aquí. */
export type SemaphoreEvaluationInput = {
  complexity: import("@theforge/database").ComplexityLevel;
  approach?: ProjectApproach;
  hasUxTeam: boolean;
  figmaMapping?: unknown;
  uiScreensContent?: string | null;
  mddJsonString: string | null;
  deliverables: SemaphoreDeliverablesSnapshot;
  sddDomainGraphOk?: boolean;
  sddCrossArtifactGapCount?: number;
};

/**
 * Servicio de degradadores (Figma/Constitución) para alimentar `evaluateMddSemaphore`.
 * Las puertas de color LOW/MEDIUM/HIGH y buckets 70/82/92 se retiraron en el paso 7.
 */
@Injectable()
export class SemaphoreService {
  evaluateFigmaGate(input: Pick<SemaphoreEvaluationInput, "hasUxTeam" | "figmaMapping" | "approach" | "uiScreensContent">): boolean {
    return evaluateFigmaGateOk(
      input.hasUxTeam,
      input.figmaMapping,
      input.approach,
      input.uiScreensContent,
    );
  }

  evaluateConstitutionBlockers(mddJsonString: string | null | undefined): boolean {
    return evaluateConstitutionBlockersOpen(mddJsonString);
  }
}
