import { Injectable } from "@nestjs/common";
import { ComplexityLevel, ProjectApproach, Status } from "@theforge/database";
import { mddJsonSchema, type MddJson } from "@theforge/shared-types";

/** Longitud mínima (caracteres no vacíos) para considerar un entregable “presente”. */
const MIN_DELIVERABLE_LEN = 48;

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

export type SemaphoreEvaluationInput = {
  complexity: ComplexityLevel;
  approach?: ProjectApproach;
  hasUxTeam: boolean;
  figmaMapping?: unknown;
  uiScreensContent?: string | null;
  /** JSON string normalizado del MDD (solo aplica al camino HIGH). */
  mddJsonString: string | null;
  deliverables: SemaphoreDeliverablesSnapshot;
  /**
   * Si es true, el Grafo SDD (FalkorDB) no reporta dependencias huérfanas entre API_Endpoint y DB_Entity
   * para la etapa; en HIGH puede sustituir la puerta rígida edge_cases/field_types (§3–§5) hacia VERDE.
   */
  sddDomainGraphOk?: boolean;
  /** Gaps cross-artifact de precisión SDD (Architecture, Tasks, Scheduler, Research→Tasks, …). */
  sddCrossArtifactGapCount?: number;
};

function substantial(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length >= MIN_DELIVERABLE_LEN;
}

function figmaGateOk(
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

/**
 * Puertas de calidad dinámicas según ComplexityLevel:
 * - LOW: Historias de usuario + tareas (sin exigir MDD).
 * - MEDIUM: Spec o casos de uso, contratos API, guía UX/flujos, historias de usuario, tareas (5 gates; ver código).
 * - HIGH: regla histórica del MDD en JSON (entidades, negocio, edge cases, field_types) + Figma si hay equipo UX;
 *   alivio opcional con `sddDomainGraphOk` cuando faltan textos edge/field_types.
 *   Si `constitution.template_detected` (plantilla Constitución Cursor en §1), puertas extra — incumplimientos → AMARILLO
 *   (no ROJO salvo reglas previas); se combinan con el resultado base (no empeora un AMARILLO ya más bajo que la constitución).
 */
@Injectable()
export class SemaphoreService {
  evaluate(input: SemaphoreEvaluationInput): { status: Status; precisionScore: number } {
    let result: { status: Status; precisionScore: number };
    switch (input.complexity) {
      case ComplexityLevel.LOW:
        result = this.evaluateLow(input);
        break;
      case ComplexityLevel.MEDIUM:
        result = this.evaluateMedium(input);
        break;
      case ComplexityLevel.HIGH:
      default:
        result = this.evaluateHigh(input);
        break;
    }
    return this.applySddPrecisionGates(result, input.sddCrossArtifactGapCount);
  }

  /** Gaps de precisión SDD pendientes → AMARILLO (no empeora ROJO). */
  private applySddPrecisionGates(
    result: { status: Status; precisionScore: number },
    gapCount: number | undefined,
  ): { status: Status; precisionScore: number } {
    if (!gapCount || gapCount <= 0) return result;
    if (result.status === Status.ROJO) return result;
    const cappedScore = Math.min(result.precisionScore, 82);
    if (result.status === Status.VERDE) {
      return { status: Status.AMARILLO, precisionScore: cappedScore };
    }
    if (result.precisionScore > 82) {
      return { status: Status.AMARILLO, precisionScore: cappedScore };
    }
    return result;
  }

  private evaluateLow(input: SemaphoreEvaluationInput): { status: Status; precisionScore: number } {
    const { userStoriesContent, tasksContent } = input.deliverables;
    const hasHu = substantial(userStoriesContent);
    const hasTasks = substantial(tasksContent);

    if (!figmaGateOk(input.hasUxTeam, input.figmaMapping, input.approach, input.uiScreensContent)) {
      return { status: Status.AMARILLO, precisionScore: 85 };
    }

    if (hasHu && hasTasks) {
      return { status: Status.VERDE, precisionScore: 95 };
    }

    if (hasHu || hasTasks) {
      return { status: Status.AMARILLO, precisionScore: 70 };
    }

    return { status: Status.ROJO, precisionScore: 25 };
  }

  private evaluateMedium(input: SemaphoreEvaluationInput): { status: Status; precisionScore: number } {
    const d = input.deliverables;
    const hasSpecOrUc = substantial(d.specContent) || substantial(d.useCasesContent);
    const hasApi = substantial(d.apiContractsContent);
    const hasUxOrFlows = substantial(d.uxUiGuideContent) || substantial(d.logicFlowsContent);
    const hasUserStories = substantial(d.userStoriesContent);
    const hasTasks = substantial(d.tasksContent);

    if (!figmaGateOk(input.hasUxTeam, input.figmaMapping, input.approach, input.uiScreensContent)) {
      return { status: Status.AMARILLO, precisionScore: 85 };
    }

    const gates = [hasSpecOrUc, hasApi, hasUxOrFlows, hasUserStories, hasTasks];
    const okCount = gates.filter(Boolean).length;

    if (okCount === 5) {
      return { status: Status.VERDE, precisionScore: 95 };
    }
    if (okCount >= 3) {
      return { status: Status.AMARILLO, precisionScore: 70 };
    }
    return { status: Status.ROJO, precisionScore: 30 };
  }

  /**
   * Si el MDD usa la plantilla Constitución Cursor, exige señales mínimas (parser markdown → JSON).
   * Devuelve AMARILLO con la peor puntuación entre las dimensiones fallidas; null si no aplica o todo cumple.
   */
  private applyConstitutionHighGates(parsed: MddJson): { status: Status; precisionScore: number } | null {
    const c = parsed.constitution;
    if (!c?.template_detected) return null;

    let score = 95;
    if (!c.has_context_map) score = Math.min(score, 84);
    if (!c.has_glossary) score = Math.min(score, 86);
    if (!c.has_gherkin) score = Math.min(score, 88);
    if (c.has_open_blockers) score = Math.min(score, 78);
    if (!c.has_stack_rationale) score = Math.min(score, 90);

    if (score >= 95) return null;
    return { status: Status.AMARILLO, precisionScore: score };
  }

  /** Aplica puertas de constitución sin suavizar un AMARILLO que ya es más estricto (precision más bajo). */
  private mergeConstitutionHigh(
    parsed: MddJson,
    result: { status: Status; precisionScore: number },
  ): { status: Status; precisionScore: number } {
    const constitutionDowngrade = this.applyConstitutionHighGates(parsed);
    if (!constitutionDowngrade) return result;
    if (result.status === Status.VERDE) {
      return constitutionDowngrade;
    }
    if (
      result.status === Status.AMARILLO &&
      constitutionDowngrade.precisionScore < result.precisionScore
    ) {
      return constitutionDowngrade;
    }
    return result;
  }

  private evaluateHigh(input: SemaphoreEvaluationInput): { status: Status; precisionScore: number } {
    const mddContent = input.mddJsonString;
    const hasUxTeam = input.hasUxTeam;
    const figmaMapping = input.figmaMapping;
    const graphRelief = input.sddDomainGraphOk === true;

    if (!mddContent?.trim()) {
      return { status: Status.ROJO, precisionScore: 0 };
    }

    let parsed: MddJson;
    try {
      const json = JSON.parse(mddContent) as unknown;
      parsed = mddJsonSchema.parse(json);
    } catch {
      return { status: Status.ROJO, precisionScore: 0 };
    }

    const entities = parsed.db_entities ?? [];
    const hasEntities = entities.length > 0;
    const hasBusinessCore =
      parsed.business_core != null && typeof parsed.business_core === "string" && parsed.business_core.trim().length > 0;
    const hasEdgeCases =
      parsed.edge_cases != null && typeof parsed.edge_cases === "string" && parsed.edge_cases.trim().length > 0;

    const fieldStr =
      parsed.field_types != null && typeof parsed.field_types === "string"
        ? parsed.field_types
        : typeof parsed.field_types === "object" && parsed.field_types !== null
          ? JSON.stringify(parsed.field_types)
          : "";
    const hasFieldTypes =
      fieldStr.length > 50 || (fieldStr.trim().length >= 8 && /inferred|detected|markdown/i.test(fieldStr.trim()));

    if (!hasEntities || !hasBusinessCore) {
      return { status: Status.ROJO, precisionScore: 30 };
    }

    const docGaps = !hasEdgeCases || !hasFieldTypes;

    let result: { status: Status; precisionScore: number };
    if (docGaps && !graphRelief) {
      result = { status: Status.AMARILLO, precisionScore: 70 };
    } else {
      const figmaOk = figmaGateOk(hasUxTeam, figmaMapping, input.approach, input.uiScreensContent);
      if (!figmaOk) {
        result = { status: Status.AMARILLO, precisionScore: 82 };
      } else if (input.approach === ProjectApproach.UX_FIRST && !substantial(input.deliverables.apiContractsContent)) {
        // Enfoque UX-First: Si las pantallas no tienen contratos API mapeados, falta la capa de traducción técnica
        result = { status: Status.AMARILLO, precisionScore: 80 };
      } else {
        const precisionScore = docGaps && graphRelief ? 92 : 95;
        result = { status: Status.VERDE, precisionScore };
      }
    }

    return this.mergeConstitutionHigh(parsed, result);
  }
}
