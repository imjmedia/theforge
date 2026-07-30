import type { Dispatch, SetStateAction } from "react";
import type {
  AemMarketScope,
  GovernancePatternCorrection,
  ProjectGenerationStatus,
} from "@theforge/shared-types";
import type { MddPatternsWizardMode } from "@/components/MddPatternsWizardDialog";
import type { MddRegenerateMode } from "@/components/MddRegenerateDialog";
import type {
  CrossDocumentGap,
  DocumentCompleteness,
  LiveMetricsResult,
  PrecisionBreakdown,
  WorkshopStage,
} from "@/store/workshopStore";

/** Argument bundle for `useWorkshopModalsProps` — assembled in `WorkshopView`. */
export interface UseWorkshopModalsPropsArgs {
  projectId: string;
  isLegacyProject: boolean;
  onOpenSettings?: () => void;
  workshopStagesList: WorkshopStage[];
  activeStageId: string | null;
  createWorkshopStage: (opts: {
    name?: string;
    copyMddFromStageId?: string;
    copyLegacyChangeFromStageId?: string;
  }) => Promise<unknown>;
  fetchProject: (projectId: string) => Promise<unknown>;
  showStageModal: boolean;
  setShowStageModal: (open: boolean) => void;
  showHelpModal: boolean;
  setShowHelpModal: (open: boolean) => void;
  flowOrderModalOpen: boolean;
  setFlowOrderModalOpen: (open: boolean) => void;
  dbgaRestoreOpen: boolean;
  setDbgaRestoreOpen: (open: boolean) => void;
  modelsUnavailableModalOpen: boolean;
  setModelsUnavailableModalOpen: (open: boolean) => void;
  showAuditModal: boolean;
  setShowAuditModal: (open: boolean) => void;
  liveMetrics: LiveMetricsResult | null;
  documentCompleteness: DocumentCompleteness | null;
  consistencyScore: number | null;
  precisionBreakdown: PrecisionBreakdown | null;
  mddReadinessHints: string[] | null;
  traceabilityHints: string[] | null;
  crossDocumentGaps: CrossDocumentGap[] | null;
  auditTrail: string[];
  effectiveMddTrimmed: string;
  canRegenerateMddSection: boolean;
  mddSectionRegenDisabledReason: string;
  handleRegenerateMddSectionFromQuality: (section: number) => void | Promise<void>;
  reapplyMddFormat: () => void | Promise<unknown>;
  clearMddConfirmOpen: boolean;
  setClearMddConfirmOpen: (open: boolean) => void;
  handleClearMddCompletely: () => Promise<boolean>;
  clearMddDeliverablesConfirmOpen: boolean;
  setClearMddDeliverablesConfirmOpen: (open: boolean) => void;
  handleClearMddDependentDeliverables: () => Promise<boolean>;
  mddPatternsWizardOpen: boolean;
  setMddPatternsWizardOpen: Dispatch<SetStateAction<boolean>>;
  mddPatternsWizardMode: MddPatternsWizardMode;
  patternsWizardPreselected: Set<string> | null;
  patternsWizardAnalyzing: boolean;
  patternsAnalyzeRationale: string | null;
  loading: boolean;
  loadingReason: string | null;
  mddReviewing: boolean;
  handleMddPatternsWizardConfirm: (
    markdown: string,
    selectedIds: ReadonlySet<string>,
  ) => void | Promise<void>;
  mddRegenerateDialogOpen: boolean;
  setMddRegenerateDialogOpen: Dispatch<SetStateAction<boolean>>;
  generationStatus: ProjectGenerationStatus | null;
  mddRegenerateInitialMode: MddRegenerateMode;
  handleMddRegenerateFull: () => void | Promise<void>;
  handleMddRegenerateSync: (sections: number[]) => void | Promise<void>;
  patternCompatOpen: boolean;
  setPatternCompatOpen: (open: boolean) => void;
  patternCompatCorrections: GovernancePatternCorrection[];
  patternCompatConfirmLabel: string;
  patternCompatLoading: boolean;
  executePendingMddAfterPatternCompat: () => void | Promise<void>;
  aemGenerateDialogOpen: boolean;
  setAemGenerateDialogOpen: (open: boolean) => void;
  handleGenerateAem: (scope: AemMarketScope) => void | Promise<void>;
  error: string | null;
}
