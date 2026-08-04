import { z } from "zod";

export const integrationHandoffItemStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "implemented",
  "rejected",
]);

export type IntegrationHandoffItemStatus = z.infer<typeof integrationHandoffItemStatusSchema>;

export const integrationHandoffItemKindSchema = z.enum([
  "requirement",
  "tasks_json_seed",
  "cursor_tasks_markdown",
  "integration_scope",
  "change_plan_seed",
  "mdd_evidence",
  "modification_plan_enriched",
  "change_work_description",
  "er_diagram",
  "deliverable_request",
  "post_deliverable_gate",
]);

export type IntegrationHandoffItemKind = z.infer<typeof integrationHandoffItemKindSchema>;

export const integrationHandoffItemCoreSchema = z.object({
  id: z.string().regex(/^NEW-LEG-\d{2,}$/),
  title: z.string().min(1).max(200),
  /** Vacío permitido en ítems seed/scope; obligatorio (trim) en `requirement`. */
  description: z.string().max(200_000).default(""),
  kind: integrationHandoffItemKindSchema.optional().default("requirement"),
  /** JSON embebido (seed, scope) cuando Ariadne no usa solo description. */
  payload: z.unknown().optional(),
  actor: z.string().max(120).optional(),
  acceptanceCriteria: z.array(z.string().max(500)).max(12).optional(),
  status: integrationHandoffItemStatusSchema.default("draft"),
  legacyStoryId: z.string().max(40).optional(),
});

export const integrationHandoffItemSchema = integrationHandoffItemCoreSchema
  .extend({
    legacyStageId: z.string().uuid().optional(),
  })
  .superRefine((item, ctx) => {
    const kind = item.kind ?? "requirement";
    if (kind === "requirement" && !(item.description?.trim().length ?? 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "description is required for requirement handoff items",
        path: ["description"],
      });
    }
  });

export type IntegrationHandoffItem = z.infer<typeof integrationHandoffItemSchema>;

export const integrationHandoffSchema = z.object({
  items: z.array(integrationHandoffItemSchema),
  updatedAt: z.string().datetime().optional(),
});

export type IntegrationHandoff = z.infer<typeof integrationHandoffSchema>;

export const integrationLinkBodySchema = z
  .object({
    linkedLegacyProjectId: z.string().uuid().nullable().optional(),
    linkedNewProjectId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.linkedLegacyProjectId !== undefined || d.linkedNewProjectId !== undefined, {
    message: "Indica linkedLegacyProjectId o linkedNewProjectId",
  });

export const createHandoffItemBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  actor: z.string().max(120).optional(),
  acceptanceCriteria: z.array(z.string().max(500)).max(12).optional(),
});

export const updateHandoffItemBodySchema = createHandoffItemBodySchema.partial().extend({
  status: integrationHandoffItemStatusSchema.optional(),
  legacyStoryId: z.string().max(40).optional(),
  screenOrEndpoint: z.string().max(300).optional(),
});

export const updateIntegrationTraceBodySchema = z.object({
  legacyStoryId: z.string().max(40).optional().nullable(),
  screenOrEndpoint: z.string().max(300).optional().nullable(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "IMPLEMENTED", "REJECTED"]).optional(),
  legacyStageId: z.string().uuid().optional().nullable(),
});

export const integrationProjectPickerQuerySchema = z.object({
  targetType: z.enum(["LEGACY", "NEW"]),
  q: z.string().max(80).optional(),
});

export interface IntegrationLinkedProjectSummary {
  id: string;
  name: string;
  projectType: "NEW" | "LEGACY";
  hasBaselineMdd: boolean;
}

export interface IntegrationContextResponse {
  legacyProjectId: string;
  legacyProjectName: string;
  contextSectionMarkdown: string;
  apiSectionMarkdown: string;
  baselineStageOrdinal: number;
}

export interface IntegrationStatusResponse {
  linkedLegacyProject: IntegrationLinkedProjectSummary | null;
  linkedNewProject: IntegrationLinkedProjectSummary | null;
  handoff: IntegrationHandoff;
  traces: IntegrationTraceRow[];
  warnings: string[];
  handoffImportedAt: string | null;
  promotableItemIds?: string[];
  linkedNewHandoff?: IntegrationHandoff;
}

export interface IntegrationTraceRow {
  id: string;
  newLegId: string;
  legacyStoryId: string | null;
  legacyStageId: string | null;
  screenOrEndpoint: string | null;
  status: string;
  title: string;
  description: string;
  actor?: string | null;
  acceptanceCriteria?: string[];
}

/** Markdown de vista previa (integración) — no persiste en `userStoriesContent` del legacy. */
export function formatIntegrationHandoffPreviewStory(
  item: Pick<IntegrationHandoffItem, "id" | "title" | "description" | "actor" | "acceptanceCriteria">,
): string {
  const lines: string[] = [
    `### [Integración] ${item.id} — ${item.title}`,
    "",
    "> Sincronizado desde el proyecto NEW. **No** forma parte del documento **Historias de Usuario** del legacy hasta promover a nueva etapa.",
    "",
    "### 🧾 Historia de Usuario",
    "",
  ];
  if (item.actor?.trim()) {
    lines.push(`**Como:** ${item.actor.trim()}`, "");
  }
  lines.push((item.description ?? "").trim(), "");
  if (item.acceptanceCriteria?.length) {
    lines.push("**Criterios de aceptación:**", "");
    for (const ac of item.acceptanceCriteria) lines.push(`- ${ac}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Genera el siguiente id NEW-LEG-XX a partir de items existentes. */
export function nextNewLegId(items: Pick<IntegrationHandoffItem, "id">[]): string {
  let max = 0;
  for (const item of items) {
    const m = item.id.match(/^NEW-LEG-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `NEW-LEG-${String(max + 1).padStart(2, "0")}`;
}

export function emptyIntegrationHandoff(): IntegrationHandoff {
  return { items: [] };
}

export function parseIntegrationHandoff(raw: unknown): IntegrationHandoff {
  const parsed = integrationHandoffSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return emptyIntegrationHandoff();
}

export const promoteHandoffToStageBodySchema = z.object({
  itemIds: z.array(z.string().regex(/^NEW-LEG-\d{2,}$/)).optional(),
  stageName: z.string().min(1).max(120).optional(),
  activate: z.boolean().optional().default(true),
});

export type PromoteHandoffToStageBody = z.infer<typeof promoteHandoffToStageBodySchema>;

export const reconcileHandoffStageBodySchema = z.object({
  wireAriadne: z.boolean().optional().default(true),
  legacyStart: z.boolean().optional().default(true),
});

export type ReconcileHandoffStageBody = z.infer<typeof reconcileHandoffStageBodySchema>;

export const abandonIntegrationHandoffBodySchema = z.object({
  /** Optional note stored on the abandoned stage snapshot. */
  reason: z.string().max(500).optional(),
  /** When true, released NEW-LEG items become `rejected` instead of `sent`. */
  rejectReleasedItems: z.boolean().optional().default(false),
  /** Override auto-pick of stage to activate when abandoning the ACTIVE stage. */
  activateStageId: z.string().uuid().optional(),
});

export type AbandonIntegrationHandoffBody = z.infer<typeof abandonIntegrationHandoffBodySchema>;

export interface AbandonIntegrationHandoffResponse {
  stage: {
    id: string;
    ordinal: number;
    name: string | null;
    workflowStatus: string;
    handoffImportedAt: string | null;
  };
  releasedItemIds: string[];
  activatedStageId: string | null;
  tracesUpdated: number;
}

export interface ReconcileHandoffStageResponse {
  stageId: string;
  description: string;
  ariadneWire: {
    attempted: boolean;
    wired: boolean;
    repositoryIds: string[];
    patched: string[];
    skippedReason?: string;
    errors: string[];
  };
  legacyStart: {
    attempted: boolean;
    ok: boolean;
    filesCount: number;
    questionsCount: number;
    error?: string;
  };
}

export interface PromoteHandoffToStageResponse {
  stage: {
    id: string;
    ordinal: number;
    name: string | null;
    workflowStatus: string;
    handoffImportedAt: string | null;
    linkedNewProjectId: string | null;
  };
  traces: IntegrationTraceRow[];
  promotedItemIds: string[];
}

export function buildHandoffImportDescription(
  items: IntegrationHandoffItem[],
  newProjectName: string,
): string {
  const lines: string[] = [
    `Integración con proyecto NEW: ${newProjectName}`,
    "",
    "Handoff importado:",
    "",
  ];
  for (const item of items) {
    const desc = (item.description ?? "").replace(/\n/g, " ").trim();
    lines.push(`- **${item.id}** — ${item.title}${desc ? `: ${desc.slice(0, 200)}` : ""}`);
  }
  return lines.join("\n");
}

export function mergeHandoffIntoLegacyDescription(
  existing: string | undefined,
  handoffBlock: string,
): string {
  const marker = "## Handoff importado";
  const base = (existing ?? "").trim();
  const idx = base.indexOf(marker);
  const withoutOld = idx >= 0 ? base.slice(0, idx).trim() : base;
  return [withoutOld, handoffBlock].filter(Boolean).join("\n\n").trim();
}
