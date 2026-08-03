import { z } from "zod";
import { integrationHandoffItemSchema } from "./project-integration.js";
import { normalizeAriadneChangePackHandoffItems } from "./ariadne-handoff-normalize.util.js";

export const ariadneChangePackFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  repoId: z.string().uuid().optional(),
});

export type AriadneChangePackFile = z.infer<typeof ariadneChangePackFileSchema>;

/** Payload que Ariadne envía al importar un cambio brownfield en Forge. */
export const ariadneChangePackV1Schema = z.object({
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
      z.array(integrationHandoffItemSchema.omit({ legacyStageId: true })).max(50).optional(),
    ),
  linkedNewProjectId: z.string().uuid().optional(),
});

export type AriadneChangePackV1 = z.infer<typeof ariadneChangePackV1Schema>;

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
});

export type CreateStageFromAriadneChangePackInput = z.infer<
  typeof createStageFromAriadneChangePackInputSchema
>;

export const ariadneChangePackRecommendedToolSchema = z.object({
  tool: z.string(),
  reason: z.string(),
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
