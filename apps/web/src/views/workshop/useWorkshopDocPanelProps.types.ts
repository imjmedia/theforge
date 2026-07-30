import type { ArtifactTypeDefinition, AgentGovernanceScaffold, GenerationJobType, StageDeliverablesResponse } from "@theforge/shared-types";
import type {
  LegacyFlowState,
  LegacyMcpDebugEntry,
  Project,
  WorkshopStage,
} from "@/store/workshopStore";
import type { WorkshopDocumentTimestamps } from "@/utils/workshop-document-content.util";
import type { WorkshopAdrItem } from "./workshopAdrsPluginPanels.types";
import type { WorkshopBenchmarkMergeAudit } from "./workshopBenchmarkPanel.types";
import type { BuildWorkshopDocClarification } from "./workshopStandardDocPanels.types";
import type { WorkshopLegacyStageSummary } from "./workshopLegacyPanels.types";

/** Argument bundle for `useWorkshopDocPanelProps` — assembled in `WorkshopView`. */
export interface UseWorkshopDocPanelPropsArgs {
  centralPanel: string;
  projectId: string;
  projectName?: string;
  mergeAudit: WorkshopBenchmarkMergeAudit | null | undefined;
  project: Project | null | undefined;
  activeWorkshopStage: WorkshopStage | null | undefined;
  effectiveMddTrimmed: string;
  loading: boolean;
  loadingReason: string | null;
  mddReviewing: boolean;
  canGenerateFromCodebase: boolean;
  activeStageId: string | null;
  deliverablesReadOnly: boolean;
  tasksPrerequisites: { ready: boolean; hint: string };
  apiBlueprintDmBlocked: boolean;
  apiBlueprintBlockedHint: string | undefined;
  docTs: (field: string) => WorkshopDocumentTimestamps | null;
  buildDocClarification: BuildWorkshopDocClarification;
  legacyGenerateFromCodebaseDoc: (
    projectId: string,
    deliverable: string,
    stageId?: string,
  ) => Promise<unknown>;
  architectureContent: string | null;
  setArchitectureContent: (value: string | null) => void;
  persistArchitectureContent: (content: string) => Promise<unknown>;
  architectureDirty: boolean;
  architectureViewMode: "preview" | "source";
  generateArchitecture: (projectId: string) => Promise<unknown>;
  handleArchitectureBlur: () => void;
  useCasesContent: string | null;
  setUseCasesContent: (value: string | null) => void;
  persistUseCasesContent: (content: string) => Promise<unknown>;
  useCasesDirty: boolean;
  useCasesViewMode: "preview" | "source";
  generateUseCases: (projectId: string) => Promise<unknown>;
  handleUseCasesBlur: () => void;
  userStoriesContent: string | null;
  setUserStoriesContent: (value: string | null) => void;
  persistUserStoriesContent: (content: string) => Promise<unknown>;
  userStoriesDirty: boolean;
  userStoriesViewMode: "preview" | "source";
  generateUserStories: (projectId: string) => Promise<unknown>;
  handleUserStoriesBlur: () => void;
  blueprintContent: string | null;
  setBlueprintContent: (value: string | null) => void;
  persistBlueprintContent: (content: string) => Promise<unknown>;
  blueprintDirty: boolean;
  blueprintViewMode: "preview" | "source";
  generateBlueprint: (projectId: string) => Promise<unknown>;
  handleBlueprintBlur: () => void;
  tasksContent: string | null;
  setTasksContent: (value: string | null) => void;
  persistTasksContent: (content: string) => Promise<unknown>;
  tasksDirty: boolean;
  tasksViewMode: "preview" | "source";
  generateTasks: (projectId: string) => Promise<unknown>;
  handleTasksBlur: () => void;
  apiContractsContent: string | null;
  setApiContractsContent: (value: string | null) => void;
  persistApiContractsContent: (content: string) => Promise<unknown>;
  apiContractsDirty: boolean;
  apiContractsViewMode: "preview" | "source";
  generateApiContracts: (projectId: string) => Promise<unknown>;
  handleApiContractsBlur: () => void;
  logicFlowsContent: string | null;
  setLogicFlowsContent: (value: string | null) => void;
  persistLogicFlowsContent: (content: string) => Promise<unknown>;
  logicFlowsDirty: boolean;
  logicFlowsViewMode: "preview" | "source";
  generateLogicFlows: (projectId: string) => Promise<unknown>;
  handleLogicFlowsBlur: () => void;
  infraContent: string | null;
  setInfraContent: (value: string | null) => void;
  persistInfraContent: (content: string) => Promise<unknown>;
  infraDirty: boolean;
  infraViewMode: "preview" | "source";
  generateInfra: (projectId: string) => Promise<unknown>;
  handleInfraBlur: () => void;
  activeLegacyState: LegacyFlowState | null;
  isStage1Legacy: boolean;
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
  copyMddInicialMarkdown: () => void | Promise<void>;
  setMddInicialLocalContent: (value: string) => void;
  setLegacyDescriptionInput: (value: string) => void;
  setLegacyAnswersInput: (value: Record<number, string>) => void;
  handleHandoffGateStrictChange: (strict: boolean) => void;
  resolveLegacyAnswerValue: (index: number) => string;
  setCentralPanel: (panel: string) => void;
  fetchProject: (projectId: string) => Promise<unknown>;
  legacyUpdateCodebaseDoc: (projectId: string, content: string) => Promise<unknown>;
  legacySuggestBrdFromCodebaseDoc: (
    projectId: string,
    stageId?: string,
  ) => Promise<{ brdContent?: string } | null | undefined>;
  setBrdWorkshopDraft: (content: string) => void;
  legacyGenerateMdd: (projectId: string, stageId?: string) => Promise<boolean | unknown>;
  legacyGenerateDeliverables: (projectId: string) => Promise<unknown>;
  legacyGenerateCodebaseDoc: (
    projectId: string,
    options: { stageId?: string },
  ) => Promise<{ codebaseDoc?: string } | null | undefined>;
  legacyStart: (projectId: string, description: string, stageId?: string) => Promise<unknown>;
  legacyAnswer: (
    projectId: string,
    answers: Record<string, string>,
    stageId?: string,
  ) => Promise<boolean | unknown>;
  dbgaContent: string | null;
  specContent: string | null;
  fase0Content: string | null;
  phase0IsEmpty: boolean;
  phase0EntryMode: "interview" | "paste";
  benchmarkPhaseTab: "fase0" | "benchmark";
  benchmarkViewMode: "preview" | "source";
  phase0SummaryViewMode: "preview" | "source";
  benchmarkMarkdown: string | null;
  benchmarkNeedsRegenerate: boolean;
  phase0SummaryContent: string | null;
  lastBenchmarkIdea: string;
  setBenchmarkPhaseTab: (tab: "fase0" | "benchmark") => void;
  handlePhase0Complete: () => void | Promise<void>;
  setDbgaRestoreOpen: (open: boolean) => void;
  setDbgaContent: (value: string) => void;
  setPhase0SummaryContent: (value: string | null) => void;
  handleBenchmarkBlur: () => void;
  handlePhase0SummaryBlur: () => void;
  suggestBrdFromDbga: (
    projectId: string,
    options: { stageId?: string },
  ) => Promise<unknown>;
  clearDbgaContent: (projectId: string) => void | Promise<void>;
  clearPhase0SummaryContent: (projectId: string) => void | Promise<void>;
  phase0DeepResearch: (
    projectId: string,
    options: { userIdea?: string; includeBenchmark: boolean },
  ) => Promise<unknown>;
  mddContent: string;
  mddViewMode: "preview" | "source";
  mddDirty: boolean;
  mddPersisting: boolean;
  mddReapplyingFormat: boolean;
  mddJustGeneratedFromBenchmark: boolean;
  notice: string | null;
  isLegacyProject: boolean;
  legacyMddNeedsCodebaseDoc: boolean;
  patternsWizardAnalyzing: boolean;
  canGenerate: boolean;
  cascadeRunning: boolean;
  cascadeCompleted: number;
  cascadeTotal: number;
  cascadePostPassRunning: boolean;
  isGenerationGateBlocked: (type: GenerationJobType) => boolean;
  clearMddJustGeneratedFromBenchmark: () => void;
  requestGenerateMdd: () => void;
  reapplyMddFormat: () => void;
  canRegenerateMddSection: boolean;
  mddSectionRegenDisabledReason: string;
  onRegenerateMddSection: (section: number) => void | Promise<void>;
  onRegenerateMddSection5Pipeline: () => void | Promise<void>;
  openSuggestMddPatterns: () => void;
  openEditMddPatterns: () => void;
  setClearMddConfirmOpen: (open: boolean) => void;
  setClearMddDeliverablesConfirmOpen: (open: boolean) => void;
  handleGenerateDeliverables: () => void | Promise<void>;
  setMddContent: (content: string) => void;
  revertMddContent: () => void;
  persistAndReviewMdd: () => void | Promise<void>;
  aemContent: string | null;
  uiScreensContent: string | null;
  brdWorkshopDraft: string;
  brdDocViewMode: "preview" | "source";
  specViewMode: "preview" | "source";
  aemViewMode: "preview" | "source";
  specDirty: boolean;
  aemDirty: boolean;
  brdWorkshopDirty: boolean;
  brdTobePersistBusy: boolean;
  canGenerateAem: boolean;
  clarifySpecDialogOpen: boolean;
  stageDeliverableView: StageDeliverablesResponse | null;
  setSpecContent: (value: string | null) => void;
  setAemContent: (value: string | null) => void;
  setClarifySpecDialogOpen: (open: boolean) => void;
  persistSpecContent: (content: string) => Promise<unknown>;
  persistAemContent: (content: string) => Promise<unknown>;
  persistBrdWorkshopDraft: () => void | Promise<void>;
  generateSpec: (projectId: string) => Promise<unknown>;
  setAemGenerateDialogOpen: (open: boolean) => void;
  syncUiScreens: (projectId: string) => Promise<unknown>;
  handleSpecBlur: () => void;
  handleAemBlur: () => void;
  agentGovernanceContent: string | null;
  agentGovernanceViewMode: "preview" | "source";
  agentGovernanceExportScaffold: AgentGovernanceScaffold | null;
  agentGovernanceExportLoading: boolean;
  agentGovernanceGenerating: boolean;
  hasAgentGovernance: boolean;
  documentationGapsRefreshNonce: number;
  generateAgentGovernance: (projectId: string) => Promise<unknown>;
  uxUiGuideContent: string | null;
  uxUiGuideViewMode: "preview" | "source" | "design";
  uxGenerating: boolean;
  setUxUiGuideContent: (value: string | null) => void;
  persistUxUiGuideContent: (content: string) => Promise<unknown>;
  generateUxGuideSequential: () => void | Promise<void>;
  handleDesignRefChange: (ref: string | null) => void | Promise<void>;
  handleUxUiGuideBlur: () => void;
  adrs: WorkshopAdrItem[];
  pluginArtifactTypes: ArtifactTypeDefinition[];
  fetchAdrs: (projectId: string) => void | Promise<void>;
}
