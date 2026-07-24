import type { AgentGovernanceScaffold, GenerationJobType } from "@theforge/shared-types";
import type { LegacyFlowState, Project } from "@/store/workshopStore";
import type { WorkshopComplexityTier } from "@/utils/workshopDocToolbar";

/** Argument bundle for `useWorkshopDocBubbleMenuItems` — assembled in `WorkshopView`. */
export interface UseWorkshopDocBubbleMenuItemsArgs {
  centralPanel: string;
  benchmarkPhaseTab: "fase0" | "benchmark";
  dbgaContent: string | null;
  phase0SummaryContent: string | null;
  specContent: string | null;
  mddContent: string;
  mddInicialLocalContent: string;
  activeLegacyState: LegacyFlowState | null;
  brdWorkshopDraft: string;
  uxUiGuideContent: string | null;
  blueprintContent: string | null;
  apiContractsContent: string | null;
  logicFlowsContent: string | null;
  tasksContent: string | null;
  infraContent: string | null;
  architectureContent: string | null;
  useCasesContent: string | null;
  userStoriesContent: string | null;
  aemContent: string | null;
  effectiveMddTrimmed: string;
  loading: boolean;
  projectId: string;
  mddReviewing: boolean;
  mddReapplyingFormat: boolean;
  patternsWizardAnalyzing: boolean;
  requestGenerateMdd: () => void;
  openSuggestMddPatterns: () => void;
  openEditMddPatterns: () => void;
  reapplyMddFormat: () => void | Promise<unknown>;
  handleRegenerateLegacyCodebaseDoc: () => void | Promise<unknown>;
  setClarifySpecDialogOpen: (open: boolean) => void;
  isGenerationGateBlocked: (type: GenerationJobType) => boolean;
  generateSpec: (projectId: string) => void | Promise<unknown>;
  generateArchitecture: (projectId: string) => void | Promise<unknown>;
  generateUseCases: (projectId: string) => void | Promise<unknown>;
  generateUserStories: (projectId: string) => void | Promise<unknown>;
  generateBlueprint: (projectId: string) => void | Promise<unknown>;
  generateApiContracts: (projectId: string) => void | Promise<unknown>;
  generateLogicFlows: (projectId: string) => void | Promise<unknown>;
  generateInfra: (projectId: string) => void | Promise<unknown>;
  generateTasks: (projectId: string) => void | Promise<unknown>;
  tasksPrerequisites: { ready: boolean; hint: string };
  hasAgentGovernance: boolean;
  generateAgentGovernance: (projectId: string) => void | Promise<unknown>;
  canGenerateAem: boolean;
  setAemGenerateDialogOpen: (open: boolean) => void;
  uxGenProgress: string | null | undefined;
  uxGenerating: boolean;
  generateUxGuideSequential: () => void | Promise<void>;
  agentGovernanceScaffold: AgentGovernanceScaffold | null;
  activeStageId: string | null;
  handleClearMddCompletely: () => Promise<boolean>;
  clearWorkshopDocumentContent: (
    projectId: string,
    panel: string,
    opts: { benchmarkPhaseTab: "fase0" | "benchmark"; stageId?: string },
  ) => void | Promise<unknown>;
  effectiveComplexityForTabs: WorkshopComplexityTier;
  setFlowOrderModalOpen: (open: boolean) => void;
  projectName?: string;
  project: Project | null | undefined;
  handlePrintDocument: () => void;
  apiBlueprintDmBlocked: boolean;
  apiBlueprintBlockedHint: string;
  deliverablesReadOnly: boolean;
}
