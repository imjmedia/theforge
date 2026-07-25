/**
 * @fileoverview Estado inicial del store Workshop: defaults para todos los slices (UI, project, MDD, deliverables, chat, clarify, legacy).
 */
import type { ChatImagePart, MddDeliveryGateResult, PlanValidationPersisted, ProjectGenerationStatus } from "@theforge/shared-types";
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

export const workshopInitialState = {
  projectId: null as string | null,
  project: null as Project | null,
  session: null as Session | null,
  mddContent: "",
  mddPersistedBaseline: "",
  uxUiGuideContent: null as string | null,
  dbgaContent: null as string | null,
  specContent: null as string | null,
  phase0SummaryContent: null as string | null,
  blueprintContent: null as string | null,
  tasksContent: null as string | null,
  apiContractsContent: null as string | null,
  logicFlowsContent: null as string | null,
  architectureContent: null as string | null,
  useCasesContent: null as string | null,
  userStoriesContent: null as string | null,
  infraContent: null as string | null,
  aemContent: null as string | null,

  uiScreensContent: null as string | null,
  agentGovernanceContent: null as string | null,
  documentTimestamps: {} as Record<string, WorkshopDocumentTimestamps>,
  conformance: null as {
    blueprint: ConformanceResult;
    blueprintDataModel: ConformanceResult;
    api: ApiConformanceResult;
    logicFlows: ConformanceResult;
    infra: ConformanceResult;
  } | null,
  readinessAudit: null as {
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
  } | null,
  loading: false,
  loadingReason: null as
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
    | null,
  streamingUserMessage: null as string | null,
  streamingUserImages: null as ChatImagePart[] | null,
  streamingContent: null as string | null,
  streamingTab: null as string | null,
  agentProgress: [] as AgentProgressItem[],
  cascadeCompleted: 0,
  cascadeTotal: 0,
  liveMetrics: null as LiveMetricsResult | null,
  planValidation: null as PlanValidationPersisted | null,
  managerThreadId: null as string | null,
  mddReviewing: false,
  mddReapplyingFormat: false,
  mddPersisting: false,
  synced: true,
  error: null as string | null,
  notice: null as string | null,
  modelsUnavailableModalOpen: false,
  auditTrail: null as string[] | null,
  precisionBreakdown: null as PrecisionBreakdown | null,
  documentCompleteness: null as DocumentCompleteness | null,
  crossDocumentGaps: [] as CrossDocumentGap[],
  consistencyScore: null as number | null,
  auditorFeedback: null as string | null,
  deliveryGate: null as MddDeliveryGateResult | null,
  documentationGapsRefreshNonce: 0,
  evaluatorCritique: null as string | null,
  legacyMcpDebugTrace: null as LegacyMcpDebugEntry[] | null,
  lastLegacyDeliverablesDebug: null as LegacyDeliverablesDebugReport | null,
  pendingPlanApproval: null as {
    plan: Array<{ step_id: string; task_description: string; node: string; goal?: string }>;
    planMessage: string;
  } | null,
  mddJustGeneratedFromBenchmark: false,
  adrs: null as any[] | null,
  workshopStages: [] as WorkshopStage[],
  activeStageId: null as string | null,
  workshopActiveDocPanel: "mdd",
  generationStatus: null as ProjectGenerationStatus | null,
  activeDeliverablesJobId: null as string | null,
  pluginData: {} as Record<string, unknown>,
  /** Modo asistido Paso 0 (chat Workshop, una pregunta por turno). */
  phase0AssistedActive: false,
  phase0AssistedThreadId: null as string | null,
  phase0AssistedAwaitingSeed: false,
  phase0AssistedTemplateLabel: null as string | null,
  /** Respuesta del API si aún no se pudo persistir en sesión (sin session.id). */
  phase0AssistedBootstrapMessage: null as string | null,
};

export type WorkshopInitialState = typeof workshopInitialState;
