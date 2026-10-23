import { z } from "zod";
import { StatusEnum } from "./status.js";

export const ProjectTypeEnum = z.enum(["NEW", "LEGACY"]);
export type ProjectType = z.infer<typeof ProjectTypeEnum>;

/** Enfoque metodológico del proyecto: Domain-First (actual) o UX-First (con traducción técnica). */
export const ProjectApproachEnum = z.enum(["DOMAIN_FIRST", "UX_FIRST"]);
export type ProjectApproach = z.infer<typeof ProjectApproachEnum>;

/** Alineado con Prisma `ComplexityLevel`: define semáforo y entregables obligatorios. */
export const ComplexityLevelEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type ComplexityLevel = z.infer<typeof ComplexityLevelEnum>;

/** Propuesta de complejidad pendiente de confirmación (HITL). */
export const complexityPendingSchema = z
  .object({
    level: ComplexityLevelEnum,
    planSummary: z.string(),
    reason: z.string().optional(),
  })
  .strict();
export type ComplexityPending = z.infer<typeof complexityPendingSchema>;

export const VisibilityEnum = z.enum(["PRIVATE", "SHARED"]);
export type Visibility = z.infer<typeof VisibilityEnum>;

export const createProjectSchema = z
  .object({
    name: z.string().min(1),
    visibility: VisibilityEnum.default("PRIVATE"),
    approach: ProjectApproachEnum.default("DOMAIN_FIRST"),
    uxDesignSource: z.string().optional().nullable(),
    hasUxTeam: z.boolean().default(false),
    complexity: ComplexityLevelEnum.default("HIGH"),
    projectType: ProjectTypeEnum.default("NEW"),
    theforgeProjectId: z.string().uuid().optional().nullable(),
    /** Grupo destino al crear; si se omite, el backend usa el grupo por defecto. */
    groupId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (data.projectType === "LEGACY") return !!data.theforgeProjectId;
      return true;
    },
    { message: "theforgeProjectId es obligatorio cuando projectType es LEGACY", path: ["theforgeProjectId"] },
  );

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  visibility: VisibilityEnum.optional(),
  approach: ProjectApproachEnum.optional(),
  uxDesignSource: z.string().optional().nullable(),
  hasUxTeam: z.boolean().optional(),
  /** Si true, el backend exige BRD + To-Be aprobados antes del MDD técnico (streams y, en legacy, generate-mdd / entregables). */
  requireBrdTobeGate: z.boolean().optional(),
  complexity: ComplexityLevelEnum.optional(),
  /** Borrar propuesta pendiente sin aplicar (rechazo). */
  clearComplexityPending: z.boolean().optional(),
  complexityPending: complexityPendingSchema.nullable().optional(),
  projectType: ProjectTypeEnum.optional(),
  theforgeProjectId: z.string().uuid().optional().nullable(),
  /** Etapa donde aplicar `mddContent`; si se omite, la etapa activa (workflow) o la primera por ordinal. */
  stageId: z.string().uuid().optional(),
  dbgaContent: z.string().optional().nullable(),
  specContent: z.string().optional().nullable(),
  architectureContent: z.string().optional().nullable(),
  useCasesContent: z.string().optional().nullable(),
  userStoriesContent: z.string().optional().nullable(),
  mddContent: z.string().optional().nullable(),
  /** true solo al guardar desde el wizard «Editar patrones (SSOT)»; si no, el backend restaura la selección [X] previa. */
  allowGovernancePatternChange: z.boolean().optional(),
  /** Vacía el MDD por completo (sin reinyectar wizard de patrones). */
  clearMddCompletely: z.boolean().optional(),
  /** Semilla SSOT sin §1–§7: omite pipeline de validación al persistir. */
  mddGovernanceSeedOnly: z.boolean().optional(),
  /** Reformato determinista (headings/fences/Mermaid) sin exigir delivery gate completo. */
  mddFormatOnly: z.boolean().optional(),
  blueprintContent: z.string().optional().nullable(),
  tasksContent: z.string().optional().nullable(),
  apiContractsContent: z.string().optional().nullable(),
  logicFlowsContent: z.string().optional().nullable(),
  infraContent: z.string().optional().nullable(),
  /** JSON (`AgentGovernanceScaffold`) del entregable agent-governance. */
  agentGovernanceContent: z.string().optional().nullable(),
  uxUiGuideContent: z.string().optional().nullable(),
  /** Slug de design reference (`stripe`, `auto`, etc.) para Guía UX/UI. */
  uxGuideDesignRef: z.string().max(512).optional().nullable(),
  phase0SummaryContent: z.string().optional().nullable(),
  aemContent: z.string().optional().nullable(),
  pluginData: z.record(z.unknown()).optional().nullable(),

  /** RFC-001: AST estructurado del documento (source of truth v2). */
  documentAst: z.record(z.unknown()).optional().nullable(),
  /** RFC-001: Versión de parche atómico del documento. */
  documentVersion: z.number().int().optional(),

  figmaMapping: z.record(z.unknown()).optional().nullable(),
  /** Per-project converge webhook (POST /projects/:id/converge/trigger). */
  convergeWebhookUrl: z.string().url().optional().nullable(),
  /** Optional HMAC secret for converge webhook signing. */
  convergeWebhookSecret: z.string().min(8).optional().nullable(),
  /** Mover proyecto a otro grupo (solo admin+). */
  groupId: z.string().uuid().optional(),
});

/** Body para POST /projects/:id/clear-mdd-deliverables */
export const clearMddDependentDeliverablesBodySchema = z.object({
  /** Etapa activa donde limpiar entregables live; si se omite, la etapa principal del proyecto. */
  stageId: z.string().uuid().optional(),
});
export type ClearMddDependentDeliverablesBody = z.infer<
  typeof clearMddDependentDeliverablesBodySchema
>;

/** Body para POST /projects/:id/phase0-deep-research */
export const phase0DeepResearchBodySchema = z.object({
  userIdea: z.string().optional(),
  urls: z.array(z.string()).optional(),
  includeBenchmark: z.boolean().optional().default(false),
});

/** Body for POST /projects/:id/clone — duplicate project documents and stages for sandbox work. */
export const cloneProjectBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    visibility: VisibilityEnum.default("PRIVATE"),
  })
  .strict();

export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string().optional(),
  projectType: ProjectTypeEnum,
  requireBrdTobeGate: z.boolean(),
  theforgeProjectId: z.string().nullable(),
  hasUxTeam: z.boolean(),
  complexity: ComplexityLevelEnum,
  complexityPending: complexityPendingSchema.nullable().optional(),
  status: z.enum(StatusEnum),
  precisionScore: z.number(),
  dbgaContent: z.string().nullable(),
  specContent: z.string().nullable(),
  architectureContent: z.string().nullable(),
  useCasesContent: z.string().nullable(),
  userStoriesContent: z.string().nullable(),
  mddContent: z.string().nullable(),
  blueprintContent: z.string().nullable(),
  tasksContent: z.string().nullable(),
  apiContractsContent: z.string().nullable(),
  logicFlowsContent: z.string().nullable(),
  infraContent: z.string().nullable(),
  agentGovernanceContent: z.string().nullable(),
  uxUiGuideContent: z.string().nullable(),
  uxGuideDesignRef: z.string().nullable(),
  phase0SummaryContent: z.string().nullable(),
  aemContent: z.string().nullable(),
  pluginData: z.record(z.unknown()).nullable(),

  figmaMapping: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

export const cloneProjectResultSchema = projectResponseSchema.extend({
  clonedFromProjectId: z.string().uuid(),
});

export type Phase0DeepResearchBody = z.infer<typeof phase0DeepResearchBodySchema>;
export type CloneProjectBody = z.infer<typeof cloneProjectBodySchema>;
export type CloneProjectResult = z.infer<typeof cloneProjectResultSchema>;
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
