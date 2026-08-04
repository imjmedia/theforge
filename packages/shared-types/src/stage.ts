import { z } from "zod";
import { INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS } from "./integration-handoff-tasks.util.js";

/** POST /projects/:projectId/stages */
export const createStageBodySchema = z.object({
  name: z.string().min(1).optional(),
  key: z.string().min(1).max(64).optional(),
  /** Si no se envía, se usa max(ordinal)+1 */
  ordinal: z.number().int().min(1).optional(),
  /** Copiar MDD y semáforo desde otra etapa del mismo proyecto */
  copyMddFromStageId: z.string().uuid().optional(),
  /** Copiar legacyChangeState desde otra etapa del mismo proyecto (flujo legacy) */
  copyLegacyChangeFromStageId: z.string().uuid().optional(),
  /** Si true (default), esta etapa pasa a ACTIVE y las demás ACTIVE → SUPERSEDED */
  activate: z.boolean().optional().default(true),
  /**
   * Campos de entregables que no se copian del snapshot baseline al activar la etapa.
   * Integración handoff usa `tasksContent`, `userStoriesContent` y `logicFlowsContent` por defecto.
   */
  seedExcludeDeliverableKeys: z
    .array(z.enum(INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS))
    .optional(),
});

/** PATCH /projects/:projectId/stages/:stageId */
export const patchStageBodySchema = z.object({
  name: z.string().min(1).optional(),
  key: z.string().min(1).max(64).optional(),
  ordinal: z.number().int().min(1).optional(),
  /** Poner esta etapa como única ACTIVE del proyecto */
  activate: z.boolean().optional(),
  brdContent: z.string().optional(),
  /** Terminal or lifecycle workflow transitions */
  workflowStatus: z
    .enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED", "SUPERSEDED"])
    .optional(),
});

export type CreateStageBody = z.infer<typeof createStageBodySchema>;
export type PatchStageBody = z.infer<typeof patchStageBodySchema>;

/** Acciones de transición de workflow soportadas por la API y MCP. */
export const STAGE_TRANSITION_ACTIONS = ["activate", "complete", "archive", "reopen"] as const;
export type StageTransitionAction = (typeof STAGE_TRANSITION_ACTIONS)[number];

/** POST /projects/:projectId/stages/:stageId/transition */
export const transitionStageBodySchema = z.object({
  action: z.enum(STAGE_TRANSITION_ACTIONS),
  reason: z.string().max(500).optional(),
});

export type TransitionStageBody = z.infer<typeof transitionStageBodySchema>;

/** Transiciones permitidas según workflowStatus actual de la etapa. */
export function getAllowedStageTransitions(workflowStatus: string): StageTransitionAction[] {
  switch (workflowStatus) {
    case "DRAFT":
      return ["activate", "archive"];
    case "ACTIVE":
      return ["complete", "archive"];
    case "COMPLETED":
      return ["reopen", "activate", "archive"];
    case "SUPERSEDED":
      return ["reopen", "activate", "archive"];
    case "ARCHIVED":
      return ["reopen"];
    default:
      return [];
  }
}
