import type { Dispatch, SetStateAction } from "react";
import type {
  AemMarketScope,
  GovernancePatternCorrection,
  MddUpstreamSyncStatus,
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

export type WorkshopAuditModalProps = {
  open: boolean;
  onClose: () => void;
  liveMetrics: LiveMetricsResult | null;
  documentCompleteness: DocumentCompleteness | null;
  consistencyScore: number | null;
  precisionBreakdown: PrecisionBreakdown | null;
  mddReadinessHints: string[] | null;
  traceabilityHints: string[] | null;
  crossDocumentGaps: CrossDocumentGap[] | null;
  auditTrail: string[];
  projectId: string;
  activeStageId: string | null;
  effectiveMddTrimmed: string;
  canRegenerateMddSection: boolean;
  mddSectionRegenDisabledReason: string;
  onRegenerateMddSection: (section: number) => void | Promise<void>;
  onReapplyMddFormat: () => void | Promise<void>;
};

export type WorkshopModalsProps = {
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
  audit: WorkshopAuditModalProps;
  clearMddConfirmOpen: boolean;
  setClearMddConfirmOpen: (open: boolean) => void;
  onClearMddConfirm: () => void | Promise<boolean | void>;
  clearMddDeliverablesConfirmOpen: boolean;
  setClearMddDeliverablesConfirmOpen: (open: boolean) => void;
  onClearMddDeliverablesConfirm: () => void | Promise<boolean | void>;
  mddPatternsWizardOpen: boolean;
  setMddPatternsWizardOpen: Dispatch<SetStateAction<boolean>>;
  mddPatternsWizardMode: MddPatternsWizardMode;
  effectiveMddTrimmed: string;
  patternsWizardPreselected: Set<string> | null;
  patternsWizardAnalyzing: boolean;
  patternsAnalyzeRationale: string | null;
  patternsWizardLoading: boolean;
  onMddPatternsWizardConfirm: (
    markdown: string,
    selectedIds: ReadonlySet<string>,
  ) => void | Promise<void>;
  mddRegenerateDialogOpen: boolean;
  setMddRegenerateDialogOpen: Dispatch<SetStateAction<boolean>>;
  mddUpstreamSync?: MddUpstreamSyncStatus | null;
  mddRegenerateInitialMode: MddRegenerateMode;
  mddRegenerateLoading: boolean;
  onMddRegenerateFull: () => void | Promise<void>;
  onMddRegenerateSync: (sections: number[]) => void | Promise<void>;
  mddPatternCompatOpen: boolean;
  setMddPatternCompatOpen: (open: boolean) => void;
  mddPatternCompatCorrections: readonly GovernancePatternCorrection[];
  mddPatternCompatConfirmLabel: string;
  mddPatternCompatLoading: boolean;
  onMddPatternCompatConfirm: () => void | Promise<void>;
  aemGenerateDialogOpen: boolean;
  setAemGenerateDialogOpen: (open: boolean) => void;
  aemGenerateLoading: boolean;
  aemGenerateError?: string | null;
  onGenerateAem: (marketScope: AemMarketScope) => void | Promise<void>;
};
