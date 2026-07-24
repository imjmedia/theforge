import type { Dispatch, SetStateAction } from "react";
import type { LegacyFlowState } from "@/store/workshopStore";
import type { WorkshopComplexityTier } from "@/utils/workshopDocToolbar";

/** Argument bundle for `useWorkshopDocToolbarProps` — assembled in `WorkshopView`. */
export interface UseWorkshopDocToolbarPropsArgs {
  centralPanel: string;
  effectiveComplexityForTabs: WorkshopComplexityTier;
  isLegacyProject: boolean;
  benchmarkPhaseTab: "fase0" | "benchmark";
  phase0IsEmpty: boolean;
  phase0EntryMode: "interview" | "paste";
  setPhase0EntryMode: Dispatch<SetStateAction<"interview" | "paste">>;
  mddViewMode: "preview" | "source";
  mddInicialViewMode: "preview" | "source";
  specViewMode: "preview" | "source";
  architectureViewMode: "preview" | "source";
  useCasesViewMode: "preview" | "source";
  userStoriesViewMode: "preview" | "source";
  uxUiGuideViewMode: "preview" | "source" | "design";
  aemViewMode: "preview" | "source";
  blueprintViewMode: "preview" | "source";
  apiContractsViewMode: "preview" | "source";
  logicFlowsViewMode: "preview" | "source";
  infraViewMode: "preview" | "source";
  agentGovernanceViewMode: "preview" | "source";
  tasksViewMode: "preview" | "source";
  blueprintContent: string | null;
  tasksContent: string | null;
  hasAgentGovernance: boolean;
  apiContractsContent: string | null;
  architectureContent: string | null;
  useCasesContent: string | null;
  userStoriesContent: string | null;
  logicFlowsContent: string | null;
  infraContent: string | null;
  activeLegacyState: LegacyFlowState | null;
  mddInicialLocalContent: string;
  activeStageId: string | null;
  specContent: string | null;
  aemContent: string | null;
  uxUiGuideContent: string | null;
  activeStageShortTermContext: Record<string, unknown> | null;
  loading: boolean;
  projectId: string;
  loadingReason: string | null;
  effectiveMddTrimmed: string;
  mddReviewing: boolean;
  apiBlueprintDmBlocked: boolean;
  apiBlueprintBlockedHint: string;
  mddInicialSaving: boolean;
  brdDocViewMode: "preview" | "source";
  brdWorkshopDirty: boolean;
  brdTobePersistBusy: boolean;
  canGenerateAem: boolean;
  tasksPrerequisites: { ready: boolean; hint: string };
  agentGovernanceGenerating: boolean;
  uxGenerating: boolean;
  uxGenProgress: string | null | undefined;
  benchmarkViewMode: "preview" | "source";
  phase0SummaryViewMode: "preview" | "source";
  isLgLayout: boolean;
  lgWorkshopChatCollapsed: boolean;
  deliverablesReadOnly: boolean;
  toggleDocViewMode: (panel: string) => void;
  setFlowOrderModalOpen: (open: boolean) => void;
  setClarifySpecDialogOpen: (open: boolean) => void;
  setDbgaRestoreOpen: (open: boolean) => void;
  handlePrintDocument: () => void;
  setBenchmarkViewMode: Dispatch<SetStateAction<"preview" | "source">>;
  setPhase0SummaryViewMode: Dispatch<SetStateAction<"preview" | "source">>;
  generateArchitecture: (projectId: string) => void | Promise<unknown>;
  generateUseCases: (projectId: string) => void | Promise<unknown>;
  generateUserStories: (projectId: string) => void | Promise<unknown>;
  generateBlueprint: (projectId: string) => void | Promise<unknown>;
  generateApiContracts: (projectId: string) => void | Promise<unknown>;
  generateLogicFlows: (projectId: string) => void | Promise<unknown>;
  generateInfra: (projectId: string) => void | Promise<unknown>;
  handleRegenerateLegacyCodebaseDoc: () => void | Promise<unknown>;
  setMddInicialSaving: (saving: boolean) => void;
  legacyUpdateCodebaseDoc: (projectId: string, content: string) => void | Promise<unknown>;
  persistBrdWorkshopDraft: () => void | Promise<void>;
  generateSpec: (projectId: string) => void | Promise<unknown>;
  setAemGenerateDialogOpen: (open: boolean) => void;
  generateTasks: (projectId: string) => void | Promise<unknown>;
  convergeTasks: (
    projectId: string,
    persist: boolean,
  ) => Promise<{ openTaskCount?: number; persisted?: boolean } | null | undefined>;
  setError: (message: string | null) => void;
  tasksToIssues: (
    projectId: string,
    opts: { owner: string; repo: string; milestone?: number },
  ) => Promise<{ created: unknown[]; errors: string[] } | null | undefined>;
  generateAgentGovernance: (projectId: string) => void | Promise<unknown>;
  repairUxGuide: () => void;
  generateUxGuideSequential: () => void | Promise<void>;
  handleSetLgWorkshopChatCollapsed: (
    collapsed: boolean,
    opts?: { persistOpenWidthPx?: number },
  ) => void;
}
