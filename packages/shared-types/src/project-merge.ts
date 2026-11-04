import { z } from "zod";

export const mergeSourceOptionsSchema = z.object({
  includeDbga: z.boolean().default(true),
  includePhase0Json: z.boolean().default(true),
  includeBenchmark: z.boolean().default(false),
});

export const mergeSourcesDispositionSchema = z.enum(["keep", "archive", "delete"]);

export const projectMergeBodySchema = z
  .object({
    sourceProjectIds: z.array(z.string().uuid()).min(2),
    targetMode: z.enum(["new", "existing"]).default("new"),
    targetProjectId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    sourceOptions: mergeSourceOptionsSchema.optional(),
    deleteSources: mergeSourcesDispositionSchema.default("keep"),
    resetDownstream: z.boolean().default(true),
    createSuite: z.boolean().default(false),
    autoAudit: z.boolean().default(true),
    preview: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.targetMode === "existing" && !data.targetProjectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetProjectId es requerido cuando targetMode es existing",
        path: ["targetProjectId"],
      });
    }
    if (data.targetMode === "new" && !data.name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "name es requerido cuando targetMode es new",
        path: ["name"],
      });
    }
  });

export const mergeConflictSchema = z.object({
  kind: z.enum([
    "entity_name_collision",
    "role_permission_mismatch",
    "proposito_divergence",
    "project_type_mismatch",
    "llm_reported",
  ]),
  severity: z.enum(["warning", "critical"]),
  message: z.string(),
  sources: z.array(z.string()),
});

export const mergeLineageEntrySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string(),
  mergedAt: z.string().datetime(),
});

export const projectMergePreviewSchema = z.object({
  name: z.string(),
  borrador: z.record(z.unknown()),
  markdown: z.string(),
  benchmarkMerged: z.string().nullable().optional(),
  conflicts: z.array(mergeConflictSchema),
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      projectType: z.enum(["NEW", "LEGACY", "DESIGN_FIRST"]).optional(),
    }),
  ),
});

export const projectMergeResultSchema = z.object({
  preview: projectMergePreviewSchema.optional(),
  project: z.record(z.unknown()).optional(),
  sourcesDisposition: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        action: mergeSourcesDispositionSchema,
      }),
    )
    .optional(),
  suite: z
    .object({
      parentId: z.string().uuid(),
      childIds: z.array(z.string().uuid()),
    })
    .optional(),
  audit: z
    .object({
      type: z.string(),
      threadId: z.string().optional(),
      message: z.string().optional(),
      question: z.string().optional(),
      n: z.number().optional(),
      total: z.number().optional(),
    })
    .nullable()
    .optional(),
});

export type MergeSourceOptions = z.infer<typeof mergeSourceOptionsSchema>;
export type MergeSourcesDisposition = z.infer<typeof mergeSourcesDispositionSchema>;
export type ProjectMergeBody = z.infer<typeof projectMergeBodySchema>;
export type MergeConflict = z.infer<typeof mergeConflictSchema>;
export type MergeLineageEntry = z.infer<typeof mergeLineageEntrySchema>;
export type ProjectMergePreview = z.infer<typeof projectMergePreviewSchema>;
export type ProjectMergeResult = z.infer<typeof projectMergeResultSchema>;
