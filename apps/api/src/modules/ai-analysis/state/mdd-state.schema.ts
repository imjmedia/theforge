import { z } from "zod";
import { mddStructuredSchema } from "./mdd-structured.schema.js";

/** Alineado con `Project.complexity` (Prisma): gobierna apéndices de rigor en Clarifier / Arquitecto / Auditor y el desglose del estimador en vivo. */
export const mddComplexityLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type MddComplexityLevel = z.infer<typeof mddComplexityLevelSchema>;

/** Auditor decision: loop back to Clarifier with feedback, finnish, or go to Blackboard for conflict resolution. */
export const mddAuditorDecisionSchema = z.enum(["clarifier", "done", "blackboard"]);
export type MDDAuditorDecision = z.infer<typeof mddAuditorDecisionSchema>;

/** Gap crítico generado por el Auditor (LLM). Textos en español. */
export const auditorCriticalGapSchema = z.object({
  sections: z.array(z.string()),
  issue: z.string(),
  fix: z.string(),
});

/** Gaps estructurados del Auditor (fuente de verdad para estimador cuando existe). */
export const auditorGapsSchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(["APROBADO", "RECHAZADO"]),
  critical_gaps: z.array(auditorCriticalGapSchema),
  syntax_errors: z.array(z.string()),
  infrastructure_ready: z.boolean(),
});
export type AuditorGapsState = z.infer<typeof auditorGapsSchema>;

/** Un paso del plan explícito (patrón Planner–Executor). El Executor ejecuta en orden. */
export const mddPlanStepSchema = z.object({
  step_id: z.string().describe("Identificador del paso (ej. '1', '2')"),
  task_description: z.string().describe("Descripción breve de la tarea"),
  node: z.string().describe("Nombre del nodo del grafo que ejecuta este paso"),
  /** Objetivo de este paso derivado de la solicitud del usuario (inyectado en contexto del agente). */
  goal: z.string().optional(),
  /** 4.3 Least privilege: solo estas tools para este paso (nombres de tool). Si no se define, el nodo usa todas sus tools. */
  required_tools: z.array(z.string()).optional(),
});
export type MddPlanStep = z.infer<typeof mddPlanStepSchema>;

/**
 * Shared state for the MDD (Master Design Document) agent pipeline.
 * Input: dbgaContent (Benchmark & Gap Analysis). Output: mddDraft.
 * mddStructured is the source of truth when present; mddDraft is derived via mddStructuredToMarkdown.
 * Flow: Clarifier → … → Auditor → (score < 85 ? Manager asigna gaps a agentes : END; umbral 85 = ceder al usuario).
 */
export const mddStateSchema = z.object({
  /** Input: Domain Benchmark & Gap Analysis markdown. */
  dbgaContent: z.string(),
  /** BRD stage content (business capabilities) for domain inventory / delivery gate. */
  brdContent: z.string().optional(),
  /** Clarified scope/requirements from Clarifier (feeds Security & Integration). */
  clarifiedScope: z.string(),
  /** Structured MDD (source of truth when present); markdown is derived from this. */
  mddStructured: mddStructuredSchema.optional(),
  /** Accumulated MDD document (each agent appends). Derived from mddStructured when present. */
  mddDraft: z.string(),
  /** Auditor quality score 0–100. If < 85, Manager assigns gap tasks to agents; if >= 85, hand over to user. */
  auditorScore: z.number().min(0).max(100),
  /** Feedback from Auditor when score < 85 (passed to Clarifier/agents for correction). */
  auditorFeedback: z.string().optional(),
  /** Gaps estructurados del Auditor (LLM); usado por el estimador en lugar de regex. */
  auditorGaps: auditorGapsSchema.optional(),
  /** Route: "clarifier" = loop with feedback, "done" = end. */
  auditorDecision: mddAuditorDecisionSchema.optional(),
  /** Loop counter: max iterations to avoid infinite cycle (e.g. 3). */
  mddIteration: z.number().int().min(0).optional(),
  /** Manager (Supervisor): preguntas para el usuario (generadas por Clarifier cuando requestQuestionsOnly). */
  managerQuestions: z.array(z.string()).optional(),
  /** Respuestas del usuario acumuladas (entrevista). */
  userInputAccumulated: z.string().optional(),
  /** Ronda de entrevista del Manager (0 = inicial). */
  managerRound: z.number().int().min(0).optional(),
  /** Último mensaje del usuario (para que el Manager responda o delegue). */
  lastUserMessage: z.string().optional(),
  /** Cuando true, Clarifier solo genera 2 preguntas para el usuario (no actualiza mddDraft). */
  requestQuestionsOnly: z.boolean().optional(),
  /** Cuando true, Clarifier acaba de generar preguntas; el grafo vuelve a Manager para interrupt. */
  clarifierJustGeneratedQuestions: z.boolean().optional(),
  /** Cuando true, ya se lanzó la pregunta inicial "¿Sobre qué tema o problema necesitas el MDD?" (Case 1); usado por ask_initial_topic para distinguir primera invocación vs resume. */
  askedInitialTopicQuestion: z.boolean().optional(),
  /** Cuando "clarifier_only", tras el Clarifier se fusiona solo la sección 1. Cuando "sections", solo se ejecutan los nodos en sectionsToRun. */
  delegateTarget: z.enum(["clarifier_only", "full_pipeline", "sections"]).optional(),
  /** Copia del mddDraft antes de delegar a Clarifier con delegateTarget=clarifier_only; se usa para fusionar solo sección 1. */
  previousMddDraftForMerge: z.string().optional(),
  /** Snapshot del borrador tras Clarificador (pipeline HIGH): ancla §1 frente a merge/dedupe de stack/data_model/api. */
  clarifierMddDraftSnapshot: z.string().optional(),
  /** Snapshot del borrador tras stack_architect (pipeline HIGH): ancla §2 frente a data_model/api_contracts. */
  stackArchitectMddDraftSnapshot: z.string().optional(),
  /** Snapshot del borrador tras data_model (pipeline HIGH): ancla §3 frente a api_contracts/format/SSOT. */
  dataModelArchitectMddDraftSnapshot: z.string().optional(),
  /** Snapshot del borrador tras api_contracts (pipeline HIGH): ancla §4 frente a format/SSOT. */
  apiContractsArchitectMddDraftSnapshot: z.string().optional(),
  /** Snapshot tras post_critic_parallel con §6 sustancial. */
  securityArchitectMddDraftSnapshot: z.string().optional(),
  /** Snapshot tras post_critic_parallel con §7 sustancial. */
  integrationArchitectMddDraftSnapshot: z.string().optional(),
  /** Markdown §6 staged por Security (post_critic / gate reinject). */
  securitySectionMd: z.string().optional(),
  /** Markdown §7 staged por Integration (post_critic / gate reinject). */
  integrationSectionMd: z.string().optional(),
  /** Secuencia de nodos a ejecutar cuando delegateTarget="sections" (ej. ["software_architect", "security", "integration", ...]). */
  sectionsToRun: z.array(z.string()).optional(),
  /** Directiva concreta aceptada por el usuario (ej. "restricciones FK en todas las tablas"); el agente responsable debe aplicarla al MDD. */
  acceptedProposalDirective: z.string().optional(),
  /** Cuando un nodo falla (excepción/timeout), el servicio inyecta esto para que el Manager re-planifique al reanudar. */
  lastStepFailed: z
    .object({
      node: z.string().describe("Nombre del nodo que falló (ej. software_architect) o 'unknown'"),
      error: z.string().describe("Mensaje de error"),
    })
    .optional(),
  /** Plan estructurado (lista de pasos) generado al delegar; artefacto explícito para patrón Planner–Executor. */
  mddPlan: z.array(mddPlanStepSchema).optional(),
  /** Pendiente de aprobación humana (HITL 4.4): al reanudar con confirmación se ejecuta este plan. */
  pendingPlanApproval: z
    .object({
      mddPlan: z.array(mddPlanStepSchema),
      delegateTarget: z.enum(["clarifier_only", "full_pipeline", "sections"]),
      sectionsToRun: z.array(z.string()).optional(),
      previousMddDraftForMerge: z.string().optional(),
      goto: z.string(),
    })
    .optional(),
  /** Intención del usuario para este plan (rellenado al crear pendingPlanApproval); al confirmar se copia a acceptedProposalDirective. */
  planUserIntent: z.string().optional(),
  /** Modo Executor (Planner–Executor): el grafo ejecuta paso a paso según mddPlan; al terminar cada nodo vuelve al executor. */
  executorControlled: z.boolean().optional(),
  /** Índice del paso actual en mddPlan (0-based). El Executor avanza este valor tras cada paso. */
  mddPlanCurrentStep: z.number().int().min(-1).optional(),
  /** 4.3 Least privilege: solo estas tools para el paso actual (nombres). Lo setea el Executor antes de goto al nodo. */
  currentStepAllowedTools: z.array(z.string()).optional(),
  /** Goal del paso actual (del mddPlan); el agente lo recibe en su contexto. */
  currentStepGoal: z.string().optional(),
  /** Feedback del nodo Architect Critic cuando verdict === "gap"; el Software Architect lo usa para reintentar (una vez). */
  architectCriticFeedback: z.string().optional(),
  /** Número de veces que se ha pasado por Architect Critic en esta delegación (evita bucle infinito; máx. 1 reintento). */
  architectCriticAttempts: z.number().int().min(0).optional(),
  /** Fase del critic en pipeline HIGH: tras §3 (antes de §4) o revisión §3+§4 (monolítico). */
  architectCriticPhase: z.enum(["after_section3", "after_full"]).optional(),
  /** ID del proyecto activo (para memoria semántica). */
  projectId: z.string().optional(),
  /** Etapa SDD activa (FalkorDB / estimación); resuelto por AgentSupervisor. */
  activeStageId: z.string().optional(),
  /** Proyecto legacy (TheForge): habilita tools MCP en el Manager (search_memory). */
  isLegacyProject: z.boolean().optional(),
  /** ID en TheForge para herramientas de código. */
  theforgeProjectId: z.string().optional(),
  /** Resumen de EpisodicMemory (rechazos evaluator, reflexión) inyectado al Manager. */
  episodicMemoryContext: z.string().optional(),
  /** Complejidad del proyecto (desde Prisma al iniciar el stream MDD). */
  mddComplexity: mddComplexityLevelSchema.optional(),
  /** Lista de directivas internas enviadas entre agentes (Mesh Topology). */
  internalDirectives: z.array(
    z.object({
      from: z.string().describe("Nombre del nodo emisor"),
      to: z.string().describe("Nombre del nodo receptor"),
      message: z.string().describe("Directiva o aviso técnico crítico"),
      timestamp: z.string().optional(),
    }),
  ).optional(),
  /** Resumen del impacto de los cambios solicitados (Impact Analysis). */
  impactSummary: z.string().optional(),
  /** Intentos del auto-loop Fase 4 (delivery gate). */
  deliveryGateAttempt: z.number().int().min(0).optional(),
  /** Último resultado del gate tras prepareMddForOutput. */
  deliveryGate: z
    .object({
      ok: z.boolean(),
      score: z.number(),
      blockers: z.array(z.string()),
      warnings: z.array(z.string()),
    })
    .optional(),
  deliveryGateLoopActive: z.boolean().optional(),
  deliveryGateFixTarget: z
    .enum([
      "software_architect",
      "stack_architect",
      "data_model",
      "api_contracts",
      "integration",
      "clarifier",
      "section5",
    ])
    .optional(),
  /** Fingerprint de blockers placeholder del intento anterior (circuit breaker gate). */
  deliveryGatePlaceholderFingerprint: z.string().optional(),
  /** F3: §4∥§6∥§7 ya ejecutados tras critic (omitir tail_parallel en primera pasada). */
  postCriticParallelDone: z.boolean().optional(),
  /** True tras primera pasada del Auditor (score/gaps only — no re-enrutar a auditor). */
  auditorRan: z.boolean().optional(),
});

export type MDDState = z.infer<typeof mddStateSchema>;

export const defaultMDDState: MDDState = {
  dbgaContent: "",
  brdContent: undefined,
  clarifiedScope: "",
  mddStructured: undefined,
  mddDraft: "",
  auditorScore: 0,
  auditorFeedback: undefined,
  auditorGaps: undefined,
  auditorDecision: undefined,
  mddIteration: 0,
  managerQuestions: undefined,
  userInputAccumulated: undefined,
  managerRound: 0,
  lastUserMessage: undefined,
  requestQuestionsOnly: undefined,
  clarifierJustGeneratedQuestions: undefined,
  askedInitialTopicQuestion: undefined,
  delegateTarget: undefined,
  previousMddDraftForMerge: undefined,
  clarifierMddDraftSnapshot: undefined,
  stackArchitectMddDraftSnapshot: undefined,
  dataModelArchitectMddDraftSnapshot: undefined,
  apiContractsArchitectMddDraftSnapshot: undefined,
  securityArchitectMddDraftSnapshot: undefined,
  integrationArchitectMddDraftSnapshot: undefined,
  securitySectionMd: undefined,
  integrationSectionMd: undefined,
  sectionsToRun: undefined,
  acceptedProposalDirective: undefined,
  lastStepFailed: undefined,
  mddPlan: undefined,
  pendingPlanApproval: undefined,
  planUserIntent: undefined,
  executorControlled: undefined,
  mddPlanCurrentStep: undefined,
  currentStepAllowedTools: undefined,
  currentStepGoal: undefined,
  architectCriticFeedback: undefined,
  architectCriticAttempts: undefined,
  architectCriticPhase: undefined,
  projectId: undefined,
  activeStageId: undefined,
  isLegacyProject: undefined,
  theforgeProjectId: undefined,
  episodicMemoryContext: undefined,
  mddComplexity: undefined,
  internalDirectives: undefined,
  impactSummary: undefined,
  deliveryGateAttempt: 0,
  deliveryGate: undefined,
  deliveryGateLoopActive: undefined,
  deliveryGateFixTarget: undefined,
  deliveryGatePlaceholderFingerprint: undefined,
  postCriticParallelDone: undefined,
  auditorRan: undefined,
};
