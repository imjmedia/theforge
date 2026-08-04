import type { IntegrationHandoffItem } from "@theforge/shared-types";
import type { LegacyFlowState, LegacyMcpDebugEntry } from "@/store/workshopStore";
import type { WorkshopDocumentTimestamps } from "@/utils/workshop-document-content.util";

const HANDOFF_GATE_STORAGE_KEY = "workshop:legacyHandoffGateStrict";

export { HANDOFF_GATE_STORAGE_KEY };

export type WorkshopLegacyPanelId = "mdd-inicial" | "integration" | "legacy";

export interface WorkshopLegacyStageSummary {
  id: string;
  ordinal: number;
  handoffImportedAt?: string | null;
  workflowStatus?: string | null;
}

export interface WorkshopLegacyPanelsProps {
  centralPanel: WorkshopLegacyPanelId | string;
  projectId: string;
  projectType: string | undefined;
  projectMddContent: string | null | undefined;
  projectName: string;
  convergeWebhookUrl: string | null;
  canGenerateFromCodebase: boolean;
  activeStageId: string | null;
  activeLegacyState: LegacyFlowState | null;
  isStage1Legacy: boolean;
  loading: boolean;
  loadingReason: string | null;
  error: string | null;
  legacyStepIndex: number;
  mddInicialLocalContent: string;
  mddInicialViewMode: "preview" | "source";
  mddInicialCopyOk: boolean;
  legacyMcpDebugTrace: LegacyMcpDebugEntry[] | null;
  legacyDescriptionInput: string;
  legacyAnswersInput: Record<number, string>;
  legacyHandoffGatePending: boolean;
  legacyHandoffGateBlocked: boolean;
  legacyChangeGateBlocked: boolean;
  legacyGenerateBlocked: boolean;
  handoffGateStrict: boolean;
  legacyAnalyzeDone: boolean;
  workshopStagesList: WorkshopLegacyStageSummary[];
  activeStageHandoffImportedAt: string | null;
  activeStageWorkflowStatus: string | null;
  activeStageHandoffSnapshot?: { items?: IntegrationHandoffItem[] } | null;
  tasksHydrated?: boolean;
  tasksSource?: string | null;
  docTs: (field: string) => WorkshopDocumentTimestamps | null;
  onCopyMddInicialMarkdown: () => void | Promise<void>;
  onMddInicialContentChange: (value: string) => void;
  onLegacyDescriptionChange: (value: string) => void;
  onLegacyAnswersChange: (value: Record<number, string>) => void;
  onHandoffGateStrictChange: (strict: boolean) => void;
  resolveLegacyAnswerValue: (index: number) => string;
  onNavigatePanel: (panel: string) => void;
  onFetchProject: (projectId: string) => void | Promise<unknown>;
  onLegacyUpdateCodebaseDoc: (projectId: string, content: string) => Promise<unknown>;
  onLegacySuggestBrdFromCodebaseDoc: (
    projectId: string,
    stageId?: string,
  ) => Promise<{ brdContent?: string } | null | undefined>;
  onSetBrdWorkshopDraft: (content: string) => void;
  onLegacyGenerateMdd: (projectId: string, stageId?: string) => Promise<boolean | unknown>;
  onLegacyGenerateDeliverables: (projectId: string) => Promise<unknown>;
  onLegacyGenerateCodebaseDoc: (
    projectId: string,
    options: { stageId?: string },
  ) => Promise<{ codebaseDoc?: string } | null | undefined>;
  onLegacyStart: (
    projectId: string,
    description: string,
    stageId?: string,
  ) => Promise<unknown>;
  onLegacyAnswer: (
    projectId: string,
    answers: Record<string, string>,
    stageId?: string,
  ) => Promise<boolean | unknown>;
}
