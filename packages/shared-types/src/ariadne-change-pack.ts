import { z } from "zod";
import { integrationHandoffItemCoreSchema } from "./project-integration.js";
import { normalizeAriadneChangePackHandoffItems } from "./ariadne-handoff-normalize.util.js";
import {
  extractIntegrationScopeFromHandoff,
  packHasAriadneTasksHydration,
} from "./hydrate-tasks-from-ariadne-pack.util.js";

export const ariadneHandoffPlanTypeSchema = z.enum(["migration_tasks", "full_cascade"]);
export type AriadneHandoffPlanType = z.infer<typeof ariadneHandoffPlanTypeSchema>;

function normalizeAriadneChangePackV1Fields(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.cursorTasksMarkdown == null && typeof obj.cursor_tasks_markdown === "string") {
    obj.cursorTasksMarkdown = obj.cursor_tasks_markdown;
  }
  delete obj.cursor_tasks_markdown;
  if (obj.handoffPlanType == null && typeof obj.handoff_plan_type === "string") {
    obj.handoffPlanType = obj.handoff_plan_type;
  }
  delete obj.handoff_plan_type;
  return obj;
}

export const ariadneChangePackFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  repoId: z.string().uuid().optional(),
});

export type AriadneChangePackFile = z.infer<typeof ariadneChangePackFileSchema>;

/** Payload que Ariadne envía al importar un cambio brownfield en Forge. */
export const ariadneChangePackV1Schema = z.preprocess(
  normalizeAriadneChangePackV1Fields,
  z.object({
    version: z.literal("1"),
    changeDescription: z.string().trim().min(1).max(8000),
    ariadneChangeId: z.string().trim().max(120).optional(),
    ariadneRepositoryId: z.string().uuid().optional(),
    filesToModify: z.array(ariadneChangePackFileSchema).max(200).optional(),
    questionsToRefine: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    /** Ítems NEW-LEG embebidos (parity / handoff externo). Ids se normalizan a `NEW-LEG-NN` si Ariadne envía otro formato. */
    handoffItems: z
      .preprocess(
        normalizeAriadneChangePackHandoffItems,
        z.array(integrationHandoffItemCoreSchema).max(50).optional(),
      ),
    linkedNewProjectId: z.string().uuid().optional(),
    /**
     * `migration_tasks`: Forge importa tasks del handoff y omite LLM `tasks` en cascada legacy.
     * `full_cascade`: comportamiento clásico (legacy_generate_deliverables incluye tasks).
     */
    handoffPlanType: ariadneHandoffPlanTypeSchema.optional(),
    /** Markdown Cursor-ready (alias snake_case: cursor_tasks_markdown). SSOT de tasks cuando migration_tasks. */
    cursorTasksMarkdown: z.string().trim().min(1).max(200_000).optional(),
    /** Clave idempotente para re-import del mismo pack (merge tasks por id). */
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
    /** Timestamp del pack; re-import reemplaza tasksJson si es más reciente. */
    generatedAt: z.string().datetime().optional(),
  }),
);

export type AriadneChangePackV1 = z.infer<typeof ariadneChangePackV1Schema>;

/** True when the pack supplies handoff tasks and Forge must skip LLM task generation. */
export function isAriadneMigrationTasksPack(
  pack: Pick<AriadneChangePackV1, "handoffPlanType" | "cursorTasksMarkdown" | "handoffItems">,
): boolean {
  if (pack.handoffPlanType === "full_cascade") return false;
  const scope = extractIntegrationScopeFromHandoff(pack.handoffItems ?? []);
  if (scope?.mode === "integration_handoff") return true;
  if (packHasAriadneTasksHydration(pack)) return true;
  if (pack.handoffPlanType === "migration_tasks") return true;
  if (pack.cursorTasksMarkdown?.trim()) return true;
  return (pack.handoffItems?.length ?? 0) > 0;
}

export const createStageFromAriadneChangePackInputSchema = z.object({
  forgeProjectId: z.string().uuid(),
  pack: ariadneChangePackV1Schema,
  /** Si se indica, importa el pack en una etapa existente (ordinal ≥ 2) en lugar de crear una nueva. */
  stageId: z.string().uuid().optional(),
  stageName: z.string().trim().min(1).max(120).optional(),
  activate: z.boolean().optional().default(true),
  /** Si null, Forge decide: false cuando el pack trae filesToModify; si no, respeta LEGACY_HANDOFF_AUTO_LEGACY_START. */
  runLegacyStart: z.boolean().optional(),
  wireAriadne: z.boolean().optional().default(true),
  /** Fuerza reemplazo de tasksJson aunque el pack no sea más reciente. */
  forceTasksRefresh: z.boolean().optional(),
});

export type CreateStageFromAriadneChangePackInput = z.infer<
  typeof createStageFromAriadneChangePackInputSchema
>;

export const ariadneChangePackRecommendedToolSchema = z.object({
  tool: z.string(),
  reason: z.string(),
  /** Entregables a omitir en cascada legacy (p. ej. tasks ya importadas del handoff). */
  skipDeliverableKinds: z.array(z.string()).optional(),
});

export const createStageFromAriadneChangePackOutputSchema = z.object({
  forgeProjectId: z.string().uuid(),
  stageId: z.string().uuid(),
  stageOrdinal: z.number().int().positive(),
  stageName: z.string(),
  workflowStatus: z.string(),
  importMode: z.enum(["created", "existing"]),
  legacyStart: z
    .object({
      attempted: z.boolean(),
      ok: z.boolean(),
      skippedReason: z.string().optional(),
      filesCount: z.number().int().nonnegative(),
      questionsCount: z.number().int().nonnegative(),
      error: z.string().optional(),
    })
    .optional(),
  ariadneWire: z
    .object({
      scheduled: z.boolean(),
      skippedReason: z.string().optional(),
    })
    .optional(),
  recommendedNextTools: z.array(ariadneChangePackRecommendedToolSchema),
});

export type CreateStageFromAriadneChangePackOutput = z.infer<
  typeof createStageFromAriadneChangePackOutputSchema
>;
