import type { Dispatch, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";
import type { WorkshopComplexityTier, WorkshopDocToolbarViewModes } from "@/utils/workshopDocToolbar";

export type WorkshopDocEditToolbarToggle = {
  Icon: LucideIcon;
  tooltip: string;
  onClick: () => void;
};

export type WorkshopDocToolbarContentSnapshot = {
  blueprintContent?: string | null;
  tasksContent?: string | null;
  hasAgentGovernance: boolean;
  apiContractsContent?: string | null;
  architectureContent?: string | null;
  useCasesContent?: string | null;
  userStoriesContent?: string | null;
  logicFlowsContent?: string | null;
  infraContent?: string | null;
  activeLegacyState?: { codebaseDoc?: string | null } | null;
  mddInicialLocalContent?: string | null;
  activeStageId?: string | null;
  specContent?: string | null;
  aemContent?: string | null;
  uxUiGuideContent?: string | null;
  activeStageShortTermContext?: Record<string, unknown> | null;
};

export type WorkshopDocToolbarUiState = {
  loading: boolean;
  projectId: string;
  loadingReason?: string | null;
  effectiveMddTrimmed: string;
  mddReviewing: boolean;
  apiBlueprintDmBlocked: boolean;
  apiBlueprintBlockedHint: string;
  mddInicialViewMode: "preview" | "source";
  mddInicialSaving: boolean;
  brdDocViewMode: "preview" | "source";
  brdWorkshopDirty: boolean;
  brdTobePersistBusy: boolean;
  canGenerateAem: boolean;
  tasksPrerequisites: { ready: boolean };
  agentGovernanceGenerating: boolean;
  uxGenerating: boolean;
  uxGenProgress?: string | null;
  benchmarkViewMode: "preview" | "source";
  phase0SummaryViewMode: "preview" | "source";
  phase0EntryModeToolbarToggle: WorkshopDocEditToolbarToggle | null;
  isLgLayout: boolean;
  lgWorkshopChatCollapsed: boolean;
  /** SSOT freeze / stage snapshot — hide clarify + chat edit affordances. */
  deliverablesReadOnly: boolean;
};

export type WorkshopDocToolbarActions = {
  toggleDocViewMode: (panel: string) => void;
  setFlowOrderModalOpen: (open: boolean) => void;
  setClarifySpecDialogOpen: (open: boolean) => void;
  setDbgaRestoreOpen: (open: boolean) => void;
  handlePrintDocument: () => void;
  setBenchmarkViewMode: Dispatch<SetStateAction<"preview" | "source">>;
  setPhase0SummaryViewMode: Dispatch<SetStateAction<"preview" | "source">>;
  generateArchitecture: (projectId: string) => void;
  generateUseCases: (projectId: string) => void;
  generateUserStories: (projectId: string) => void;
  generateBlueprint: (projectId: string) => void;
  generateApiContracts: (projectId: string) => void;
  generateLogicFlows: (projectId: string) => void;
  generateInfra: (projectId: string) => void;
  handleRegenerateLegacyCodebaseDoc: () => void | Promise<unknown>;
  setMddInicialSaving: (saving: boolean) => void;
  legacyUpdateCodebaseDoc: (projectId: string, content: string) => void | Promise<unknown>;
  persistBrdWorkshopDraft: () => void | Promise<void>;
  generateSpec: (projectId: string) => void;
  setAemGenerateDialogOpen: (open: boolean) => void;
  generateTasks: (projectId: string) => void;
  convergeTasks: (
    projectId: string,
    persist: boolean,
  ) => Promise<{ openTaskCount?: number; persisted?: boolean } | null | undefined>;
  setError: (message: string | null) => void;
  tasksToIssues: (
    projectId: string,
    opts: { owner: string; repo: string; milestone?: number },
  ) => Promise<{ created: unknown[]; errors: string[] } | null | undefined>;
  generateAgentGovernance: (projectId: string) => void;
  repairUxGuide: () => void;
  generateUxGuideSequential: () => void;
  handleSetLgWorkshopChatCollapsed: (collapsed: boolean) => void;
};

export type WorkshopDocToolbarProps = {
  centralPanel: string;
  effectiveComplexityForTabs: WorkshopComplexityTier;
  isLegacyProject: boolean;
  benchmarkPhaseTab: "fase0" | "benchmark";
  docEditToolbarToggle: WorkshopDocEditToolbarToggle | null;
  viewModes: WorkshopDocToolbarViewModes;
  content: WorkshopDocToolbarContentSnapshot;
  ui: WorkshopDocToolbarUiState;
  actions: WorkshopDocToolbarActions;
};
