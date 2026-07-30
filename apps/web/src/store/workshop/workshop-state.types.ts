/**
 * @fileoverview Tipo completo {@link WorkshopState}: compone todos los slices del store Workshop.
 * Cada slice define su propia interfaz; este archivo las unifica en un solo tipo raíz.
 */
import type {
  ChatImagePart,
  CodebaseDocResponseMode,
  MddDeliveryGateResult,
  PlanValidationPersisted,
  ProjectGenerationStatus,
  TraceabilitySuggestFixResponse,
  WorkshopChatScope,
  StageTransitionAction,
} from "@theforge/shared-types";
import type { ClarifyableDocumentField } from "@theforge/shared-types";
import type { AgentProgressItem } from "../../utils/agentProgress";
import type { WorkshopDocumentTimestamps } from "../../utils/workshop-document-content.util";
import type {
  ApiConformanceResult,
  ConformanceResult,
  CrossDocumentGap,
  DocumentCompleteness,
  LegacyDeliverablesDebugReport,
  LegacyMcpDebugEntry,
  LiveMetricsResult,
  PrecisionBreakdown,
  Project,
  Session,
  WorkshopStage,
} from "./types";

export interface WorkshopState {
  projectId: string | null;
  project: Project | null;
  session: Session | null;
  /** Contenido del MDD (Constitución del proyecto en SDD; gobierna Blueprint, Contratos, Infra). */
  mddContent: string;
  /** Último MDD guardado en BD alineado al editor (baseline «sin guardar»). */
  mddPersistedBaseline: string;
  uxUiGuideContent: string | null;
  dbgaContent: string | null;
  specContent: string | null;
  phase0SummaryContent: string | null;
  blueprintContent: string | null;
  tasksContent: string | null;
  apiContractsContent: string | null;
  logicFlowsContent: string | null;
  architectureContent: string | null;
  useCasesContent: string | null;
  userStoriesContent: string | null;
  infraContent: string | null;
  aemContent: string | null;

  uiScreensContent: string | null;
  agentGovernanceContent: string | null;
  /** Fechas Creado/Última regeneración por campo (desde stamp API, no del editor). */
  documentTimestamps: Record<string, WorkshopDocumentTimestamps>;
  conformance: {
    blueprint: ConformanceResult;
    blueprintDataModel: ConformanceResult;
    api: ApiConformanceResult;
    logicFlows: ConformanceResult;
    infra: ConformanceResult;
  } | null;
  /** Auditoría unificada SDD (gaps clasificados auto/LLM/humano). */
  readinessAudit: {
    gapSummary: {
      total: number;
      auto: number;
      llm: number;
      human: number;
      truncated: boolean;
      items: Array<{
        message: string;
        kind: "auto" | "llm" | "human";
        prefix: string;
        targetDeliverable?: string;
      }>;
    };
    compositeReadiness?: { reasons: string[] };
    consistencyScore?: number;
    conformanceOk: boolean;
  } | null;
  /** Vista previa de entregable eliminada — regeneración directa sin modal */
  loading: boolean;
  /** Razón del loading para mostrar mensajes específicos (ej. deep research tarda más) */
  loadingReason:
    | "benchmark"
    | "mdd"
    | "mdd-section"
    | "phase0-deep-research"
    | "legacy-codebase-doc"
    | "legacy-mdd"
    | "legacy-as-is"
    | "legacy-brd-suggest"
    | "brd-from-dbga"
    | "legacy-deliverables"
    | "deliverables-cascade"
    | "repair-sdd-gaps"
    | "agent-governance"
    | "tasks"
    | "converge"
    | "tasks-to-issues"
    | "clarify-spec"
    | "clarify-document"
    | "resolve-clarifications"
    | "aem"
    | null;
  /** Mensaje de usuario en curso (streaming); se muestra hasta recibir "done" */
  streamingUserMessage: string | null;
  /** Imágenes del turno en streaming (mismo ciclo que streamingUserMessage). */
  streamingUserImages: ChatImagePart[] | null;
  /** Contenido del asistente que llega por stream; se concatena hasta "done" */
  streamingContent: string | null;
  /** Tab del mensaje en streaming (para filtrar por tab) */
  streamingTab: string | null;
  /** Progreso de agentes DBGA (Benchmark): qué agente trabaja y qué hace */
  agentProgress: AgentProgressItem[];
  /** Conteo de docs completados en cascada (para botón) */
  cascadeCompleted: number;
  cascadeTotal: number;
  /** Métricas en vivo (Semáforo + estimación) desde GET /ai-analysis/estimation */
  liveMetrics: LiveMetricsResult | null;
  /** Gate 2 — Ariadne validate_change_plan (last persisted on stage). */
  planValidation: PlanValidationPersisted | null;
  /** ThreadId del flujo Manager (MDD); cuando está definido, el siguiente mensaje en tab MDD va a resume */
  managerThreadId: string | null;
  /** true mientras se ejecuta persistAndReviewMdd (grabar + revisión de consistencia) */
  mddReviewing: boolean;
  /** true mientras reapplyMddFormat persiste el MDD con sanitizers SSOT */
  mddReapplyingFormat: boolean;
  /** true mientras persistMddContent ejecuta un PATCH al proyecto */
  mddPersisting: boolean;
  synced: boolean;
  error: string | null;
  /** Avisos informativos (p. ej. patrones SSOT); no bloquean ni marcan «Sin conexión». */
  notice: string | null;
  /** Modal: ningún modelo de la cadena (principal + respaldos) respondió. */
  modelsUnavailableModalOpen: boolean;
  setModelsUnavailableModalOpen: (open: boolean) => void;
  /** Logs de auditoría del último stream MDD */
  auditTrail: string[] | null;
  /** Desglose de calificación del último stream MDD */
  precisionBreakdown: PrecisionBreakdown | null;
  /** Completitud por documento (semáforo integral). */
  documentCompleteness: DocumentCompleteness | null;
  /** Gaps de consistencia transversal entre documentos. */
  crossDocumentGaps: CrossDocumentGap[];
  /** Score de consistencia (0-100). */
  consistencyScore: number | null;
  /** Feedback del auditor (para mostrar en UI fuera del chat) */
  auditorFeedback: string | null;
  /** Gate bloqueante de entrega MDD (stream SSE o GET /estimation). */
  deliveryGate: MddDeliveryGateResult | null;
  /** Incrementar para refrescar paneles de gaps HITL tras cascada/regeneración. */
  documentationGapsRefreshNonce: number;
  bumpDocumentationGapsRefresh: () => void;
  /** Crítica del evaluador legacy (SDD vs código); solo si el backend la envía */
  evaluatorCritique: string | null;
  clearEvaluatorCritique: () => void;
  /** Última traza pregunta↔respuesta MCP al generar doc. partida (solo si el API envía `mcpDebugTrace`). */
  legacyMcpDebugTrace: LegacyMcpDebugEntry[] | null;
  clearLegacyMcpDebugTrace: () => void;
  /** Última traza de `POST …/legacy/generate-deliverables` (cuerpo JSON de la respuesta). */
  lastLegacyDeliverablesDebug: LegacyDeliverablesDebugReport | null;
  clearLegacyDeliverablesDebug: () => void;
  /** Plan pendiente de aprobación (HITL 4.4): pasos a ejecutar; el usuario puede Ejecutar o Modificar */
  pendingPlanApproval: {
    plan: Array<{ step_id: string; task_description: string; node: string; goal?: string }>;
    planMessage: string;
  } | null;
  /** true tras generar MDD desde Benchmark (one-shot); mostrar banner de revisión en panel MDD */
  mddJustGeneratedFromBenchmark: boolean;
  /** Decisiones Arquitectónicas (ADRs) asociadas al proyecto */
  adrs: any[] | null;
  /** Etapas del proyecto (sincronizado con API; fuente para selector y foco MDD). */
  workshopStages: WorkshopStage[];
  /** Etapa cuyo MDD edita el Workshop (vista en vivo). */
  activeStageId: string | null;
  setActiveStageId: (stageId: string | null) => void;
  /** Filtro del chat: `stage` (etapa activa) o `global` (historial completo del tab). */
  chatScope: WorkshopChatScope;
  setChatScope: (scope: WorkshopChatScope) => void;
  /** Panel central de documentos (pestaña activa); sincroniza barra global y `WorkshopView`. */
  workshopActiveDocPanel: string;
  setWorkshopActiveDocPanel: (panel: string) => void;
  /** `POST /projects/:id/stages` → `{ stage }`; opcional `copyMddFromStageId`. */
  createWorkshopStage: (opts: { name?: string; key?: string; copyMddFromStageId?: string; copyLegacyChangeFromStageId?: string }) => Promise<Project | null>;
  /** `PATCH /projects/:id/stages/:stageId` — BRD/To-Be/As-Is, aprobaciones, etc. */
  patchWorkshopStage: (
    stageId: string,
    body: Record<string, string | boolean | undefined>,
  ) => Promise<boolean>;
  /** `POST /projects/:id/stages/:stageId/transition` — activate, complete, archive, reopen. */
  transitionWorkshopStage: (
    stageId: string,
    action: StageTransitionAction,
    reason?: string,
  ) => Promise<boolean>;
  /** `PATCH /projects/:id` con `{ requireBrdTobeGate }` — control usuario (no env). */
  setProjectRequireBrdTobeGate: (projectId: string, requireBrdTobeGate: boolean) => Promise<boolean>;

  setProjectId: (id: string | null) => void;
  setProject: (p: Project | null) => void;
  setSession: (s: Session | null) => void;
  setMddContent: (content: string) => void;
  setUxUiGuideContent: (content: string | null) => void;
  persistUxUiGuideContent: (content: string) => Promise<void>;
  persistUxGuideDesignRef: (ref: string | null) => Promise<boolean>;
  setLoading: (v: boolean) => void;
  setSynced: (v: boolean) => void;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
  /** Reintenta cola offline y valida conexión con el API. */
  retryWorkshopSync: () => Promise<void>;

  /** Gate de cola: jobs activos, MDD en stream y dependencias upstream. */
  generationStatus: ProjectGenerationStatus | null;
  fetchGenerationStatus: (projectId: string, stageId?: string | null, options?: { light?: boolean }) => Promise<ProjectGenerationStatus | null>;
  /** Job de entregables iniciado en esta sesión (p. ej. cascada en cola). */
  activeDeliverablesJobId: string | null;
  cancelMddJob: (projectId: string, jobId: string) => Promise<boolean>;
  cancelDeliverablesJob: (projectId: string, jobId: string) => Promise<boolean>;
  /** Datos por pluginId (`project.pluginData` sincronizado desde API). */
  pluginData: Record<string, unknown>;
  patchPluginData: (pluginId: string, data: unknown) => void;
  /** Tab visible again: sync queue status without wiping deliverables checklist. */
  refreshWorkshopOnTabVisible: (projectId: string) => Promise<void>;
  fetchPlanValidation: (projectId: string, stageId?: string) => Promise<PlanValidationPersisted | null>;
  validateChangePlan: (projectId: string, stageId?: string) => Promise<PlanValidationPersisted | null>;

  fetchProject: (projectId: string, options?: { preferServerMdd?: boolean }) => Promise<Project | null>;
  fetchWelcome: (
    projectId: string,
    activeTab?: string,
    options?: { skipLoading?: boolean },
  ) => Promise<void>;
  clearChat: (projectId: string, activeTab?: string) => Promise<void>;
  /** options.regenerateSection (1–7): regenerar solo esa sección del MDD (comando / en chat). §1 = solo sintetizador de contexto. */
  sendMessage: (
    message: string,
    activeTab?: string,
    options?: { regenerateSection?: number; regenerateSectionGaps?: string[]; images?: ChatImagePart[] },
  ) => Promise<void>;
  /** `/formatear` — normaliza markdown del documento del tab (sin LLM). */
  formatDocumentForActiveTab: (activeTab?: string) => Promise<{ ok: boolean; message: string }>;

  /** Modo asistido Paso 0 — pregunta a pregunta en el chat del Workshop. */
  phase0AssistedActive: boolean;
  phase0AssistedThreadId: string | null;
  phase0AssistedAwaitingSeed: boolean;
  phase0AssistedTemplateLabel: string | null;
  phase0AssistedBootstrapMessage: string | null;
  startPhase0Assisted: (idea?: string) => Promise<void>;
  stopPhase0Assisted: () => Promise<void>;
  updateMddContent: (content: string) => void;
  persistMddContent: (
    content: string,
    options?: {
      force?: boolean;
      allowGovernancePatternChange?: boolean;
      mddGovernanceSeedOnly?: boolean;
      mddFormatOnly?: boolean;
      clearMddCompletely?: boolean;
    },
  ) => Promise<void>;
  /** Vacía el MDD (sin reinyectar patrones SSOT). */
  clearMddContentCompletely: (projectId: string) => Promise<boolean>;
  revertMddContent: () => void;
  persistAndReviewMdd: () => Promise<void>;
  /** Re-ejecuta sanitizeMddAtPersist en servidor sin editar manualmente el borrador. */
  reapplyMddFormat: () => Promise<void>;
  /** §5 con paridad pipeline (section5 + Formatter + prepare); no usa mode section ligero. */
  regenerateMddSection5Pipeline: (
    projectId: string,
    options?: { gapReasons?: string[] },
  ) => Promise<void>;
  setBlueprintContent: (content: string | null) => void;
  persistBlueprintContent: (content: string) => Promise<void>;
  generateBlueprint: (projectId: string, options?: { gapsFeedback?: string }) => Promise<Project | null>;
  setApiContractsContent: (content: string | null) => void;
  persistApiContractsContent: (content: string) => Promise<void>;
  generateApiContracts: (projectId: string, options?: { gapsFeedback?: string }) => Promise<Project | null>;
  setLogicFlowsContent: (content: string | null) => void;
  persistLogicFlowsContent: (content: string) => Promise<void>;
  generateLogicFlows: (projectId: string, options?: { gapsFeedback?: string }) => Promise<Project | null>;
  setInfraContent: (content: string | null) => void;
  persistInfraContent: (content: string) => Promise<void>;
  generateInfra: (projectId: string, options?: { gapsFeedback?: string }) => Promise<Project | null>;

  setArchitectureContent: (content: string | null) => void;
  persistArchitectureContent: (content: string) => Promise<void>;
  generateArchitecture: (projectId: string, options?: Record<string, never>) => Promise<Project | null>;

  setUseCasesContent: (content: string | null) => void;
  persistUseCasesContent: (content: string) => Promise<void>;
  generateUseCases: (projectId: string, options?: Record<string, never>) => Promise<Project | null>;

  setUserStoriesContent: (content: string | null) => void;
  persistUserStoriesContent: (content: string) => Promise<void>;
  generateUserStories: (projectId: string, options?: Record<string, never>) => Promise<Project | null>;
  setSpecContent: (content: string | null) => void;
  persistSpecContent: (content: string) => Promise<void>;
  setAemContent: (content: string | null) => void;
  persistAemContent: (content: string) => Promise<void>;
  setUiScreensContent: (content: string | null) => void;
  /** Genera el deliverable "Pantallas" desde el MCP gráfico compatible activo. */
  syncUiScreens: (projectId: string) => Promise<string | null>;
  generateSpec: (projectId: string) => Promise<Project | null>;
  generateAem: (
    projectId: string,
    opts: { marketScope: import("@theforge/shared-types").AemMarketScope },
  ) => Promise<Project | null>;
  setTasksContent: (content: string | null) => void;
  persistTasksContent: (content: string) => Promise<void>;
  generateTasks: (
    projectId: string,
    options?: { acknowledgeGaps?: boolean },
  ) => Promise<Project | null>;
  /** Pregunta acknowledgeGaps si el gate MDD tiene blockers; luego encola generate-tasks. */
  requestGenerateTasks: (projectId: string) => Promise<Project | null>;
  generateAgentGovernance: (projectId: string) => Promise<Project | null>;
  /** GET reconciled scaffold para ZIP (materializa sugerencias omitidas en `files[]`). */
  fetchAgentGovernanceExport: (projectId: string) => Promise<import("@theforge/shared-types").AgentGovernanceScaffold | null>;
  /** POST /projects/:id/generate-deliverables — cascada según complexity. */
  generateDeliverablesCascade: (
    projectId: string,
    options?: { acknowledgeGaps?: boolean },
  ) => Promise<Project | null>;
  /** POST /projects/:id/repair-sdd-gaps — convergencia Brechas SDD (auto + LLM). */
  repairSddGaps: (
    projectId: string,
    options?: { acknowledgeGaps?: boolean },
  ) => Promise<Project | null>;
  /** HITL: aplica propuesta pendiente a `complexity` y limpia `complexityPending`. */
  confirmComplexityProposal: (projectId: string) => Promise<Project | null>;
  /** HITL: descarta propuesta sin aplicar nivel (`clearComplexityPending`). */
  dismissComplexityProposal: (projectId: string) => Promise<Project | null>;
  /** Re-infiere propuesta HITL desde documentos existentes (`POST .../reassess-complexity`). */
  reassessComplexity: (projectId: string, note?: string) => Promise<Project | null>;
  fetchConformance: (projectId: string, options?: { useLlm?: boolean }) => Promise<void>;
  verifyDeliverable: (projectId: string, deliverable: "blueprint" | "api" | "infra" | "architecture" | "use-cases" | "user-stories") => Promise<string>;
  setDbgaContent: (content: string | null) => void;
  persistDbgaContent: (content: string) => Promise<void>;
  clearDbgaContent: (projectId: string) => Promise<void>;
  generateBenchmark: (projectId: string, userIdea: string, urls?: string[]) => Promise<Project | null>;
  generateMddFromBenchmark: (projectId: string) => Promise<Project | null>;
  /** Sincroniza §1–§7 afectadas por cambios upstream (mode upstream-sync en cola MDD). */
  generateMddUpstreamSync: (
    projectId: string,
    opts?: { sections?: number[]; stageId?: string | null },
  ) => Promise<Project | null>;
  clearMddJustGeneratedFromBenchmark: () => void;
  setAgentProgress: (progress: Array<{ agent: string; message: string }>) => void;
  setPhase0SummaryContent: (content: string | null) => void;
  persistPhase0SummaryContent: (content: string) => Promise<void>;
  phase0DeepResearch: (
    projectId: string,
    opts: { userIdea?: string; urls?: string[]; includeBenchmark?: boolean },
  ) => Promise<Project | null>;
  clearPhase0SummaryContent: (projectId: string) => Promise<void>;
  /** Vacía entregables SDD dependientes del MDD (spec, blueprint, tasks, etc.) sin borrar el MDD. */
  clearMddDependentDeliverables: (projectId: string) => Promise<boolean>;
  /** Clears the active workshop document tab content (PATCH null / empty). */
  clearWorkshopDocumentContent: (
    projectId: string,
    panel: string,
    options?: { benchmarkPhaseTab?: "fase0" | "benchmark"; stageId?: string },
  ) => Promise<boolean>;
  /** Flujo legacy: documentación de partida (opcional); puede incluir `mcpDebugTrace` si el API tiene debug activo. */
  legacyGenerateCodebaseDoc: (
    projectId: string,
    opts?: { responseMode?: CodebaseDocResponseMode; stageId?: string },
  ) => Promise<{ codebaseDoc: string; mcpDebugTrace?: LegacyMcpDebugEntry[] } | null>;
  /** Flujo legacy: actualizar documentación de partida (edición manual) */
  legacyUpdateCodebaseDoc: (projectId: string, codebaseDoc: string) => Promise<boolean>;
  /** Flujo legacy: analizar con AriadneSpecs → archivos + preguntas */
  legacyStart: (projectId: string, description: string, stageId?: string) => Promise<{ filesToModify: (string | { path: string; repoId?: string })[]; questions: string[]; suggestedAnswers?: Record<string, string> } | null>;
  legacyAnswer: (projectId: string, answers: Record<string, string>, stageId?: string) => Promise<boolean>;
  legacyGenerateMdd: (projectId: string, stageId?: string) => Promise<{ mddContent: string } | null>;
  /** POST …/legacy/generate-as-is-manual → persiste `asIsManualContent` en la etapa legacy/primaria. */
  legacyGenerateAsIsManual: (projectId: string) => Promise<{ asIsManualContent: string; stageId: string } | null>;
  /** POST …/legacy/suggest-brd-from-codebase-doc — borrador BRD desde doc. Ariadne. */
  legacySuggestBrdFromCodebaseDoc: (
    projectId: string,
    stageId?: string,
  ) => Promise<{ brdContent: string; stageId: string } | null>;
  /** POST …/legacy/generate-from-codebase — genera entregable individual desde codebaseDoc. */
  legacyGenerateFromCodebaseDoc: (
    projectId: string,
    documentType: string,
    stageId?: string,
  ) => Promise<{ content: string; field: string } | null>;
  /** POST …/projects/:id/suggest-brd-from-dbga — greenfield desde `dbgaContent`. */
  suggestBrdFromDbga: (
    projectId: string,
    opts?: { stageId?: string | null },
  ) => Promise<{ brdContent: string; stageId: string } | null>;
  legacyGenerateDeliverables: (projectId: string) => Promise<boolean>;
  fetchEstimation: (projectId: string, mddContentOverride?: string) => Promise<LiveMetricsResult | null>;
  fetchAdrs: (projectId: string) => Promise<void>;
  suggestGovernancePatterns: (
    projectId: string,
    stageId?: string | null,
  ) => Promise<{ patternIds: string[]; rationale?: string }>;
  /** POST …/ai-analysis/traceability/suggest-fix — parche markdown para brecha BRD→MDD. */
  suggestTraceabilityFix: (
    projectId: string,
    gap: CrossDocumentGap,
    opts?: { stageId?: string | null; mddContent?: string; signal?: AbortSignal },
  ) => Promise<TraceabilitySuggestFixResponse | null>;
  /** Inserta parche al final de §1/§4/§5 y persiste el MDD. */
  insertTraceabilityPatch: (
    suggestion: string,
    targetSection: TraceabilitySuggestFixResponse["targetSection"],
  ) => Promise<boolean>;
  recordGovernancePatternAdrs: (
    projectId: string,
    patternIds: ReadonlySet<string>,
  ) => Promise<void>;
  convergeTasks: (
    projectId: string,
    persist?: boolean,
  ) => Promise<{ convergeSection: string; persisted: boolean; openTaskCount: number } | null>;
  tasksToIssues: (
    projectId: string,
    body: { owner: string; repo: string; milestone?: number; dryRun?: boolean },
  ) => Promise<{ created: Array<{ number: number; html_url: string }>; errors: string[] } | null>;
  clarifySpec: (
    projectId: string,
    opts: { persist: boolean; notes?: string; syncMdd?: boolean },
  ) => Promise<{
    clarifiedSpec: string;
    clarificationMarkerCount: number;
    persisted: boolean;
    mddSyncQueued?: boolean;
  } | null>;
  clarifyDocument: (
    projectId: string,
    opts: {
      field: ClarifyableDocumentField;
      persist: boolean;
      notes?: string;
      stageId?: string | null;
      syncMdd?: boolean;
    },
  ) => Promise<{
    field: ClarifyableDocumentField;
    clarifiedContent: string;
    clarificationMarkerCount: number;
    persisted: boolean;
    mddSyncQueued?: boolean;
  } | null>;
  resolveClarifications: (
    projectId: string,
    opts: {
      field: ClarifyableDocumentField;
      answers: Record<string, string>;
      persist?: boolean;
      stageId?: string | null;
    },
  ) => Promise<{
    field: ClarifyableDocumentField;
    resolvedContent: string;
    clarificationMarkerCount: number;
    persisted: boolean;
  } | null>;
  reset: () => void;
}
