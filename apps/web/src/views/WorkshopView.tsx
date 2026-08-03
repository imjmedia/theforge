import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  agentGovernanceScaffoldHasContent,
  isLegacyChangeGateSatisfied,
  isLegacyIntegrationHandoffGatePending,
  isPhase0BorradorJson,
  parseAgentGovernanceScaffold,
} from "@theforge/shared-types";
import {
  isMddEditorDirty,
  selectWorkshopAgentsBusy,
  useWorkshopStore,
  type Status,
} from "../store/workshopStore";
import { WORKSHOP_EXIT_BLOCKED_TITLE } from "@/utils/workshopAgentsBusy";
import { isWorkshopSemaphoreGreen } from "@/utils/workshopSemaphoreStatus";
import { apiFetch, API_BASE, getOfflineQueue } from "../utils/apiClient";
import { isWorkshopConnectionError, isSsotPatternsNotice } from "../utils/workshopSyncStatus";
import { activeGenerationLabel, generationJobAllowed, primaryMddJob } from "../utils/projectGenerationGate";
import { isDeliverablesCascadeUiActive } from "../utils/deliverablesCascadeUi";
import { projectCascadeWaveDeliverablesReady } from "../utils/cascadeDeliverablesReady";
import { MDD_JOB_MODE_LABELS } from "@theforge/shared-types";
import type { ArtifactTypeDefinition, ClarifyableDocumentField, GenerationJobType, AemMarketScope } from "@theforge/shared-types";
import ChatContainer from "../components/ChatContainer";
import { WorkshopAgentProgressPanel } from "../components/WorkshopAgentProgressPanel";
import ComplexityPendingBanner from "../components/ComplexityPendingBanner";
import MddUpstreamSyncBanner from "../components/MddUpstreamSyncBanner";
import { AIProviderBanner } from "../components/AIProviderBanner";
import type { MddRegenerateMode } from "../components/MddRegenerateDialog";
import {
  type MddPatternsWizardMode,
} from "../components/MddPatternsWizardDialog";
import {
  heuristicGovernancePatternIds,
  mddNeedsPatternWizard,
  selectedPatternIdsFromMdd,
  updateMddGovernancePatterns,
} from "@theforge/shared-types/mdd-governance-patterns";
import type { GovernancePatternCorrection } from "@theforge/shared-types";
import {
  offerGovernancePatternCompat,
  type PendingMddAfterPatternCompat,
} from "../utils/mddGovernancePatternCompatFlow";
import {
  WorkshopDocumentIslandToc,
  isWorkshopMarkdownPreviewActive,
} from "../components/WorkshopDocumentIslandToc";
import {
  resolveWorkshopDeliverableContent,
  useStageDeliverableView,
} from "../hooks/useStageDeliverableView";
import { replaceYamlFrontMatter } from "../components/DesignMdPreview";
import { type WorkshopComplexityTier } from "../utils/workshopDocToolbar";
import { WorkshopHeaderBar } from "./workshop/WorkshopHeaderBar";
import { WorkshopDocPanel } from "./workshop/WorkshopDocPanel";
import { WorkshopModals } from "./workshop/WorkshopModals";
import { WorkshopDocPanelContent } from "./workshop/WorkshopDocPanelContent";
import { useWorkshopDocPanelProps } from "./workshop/useWorkshopDocPanelProps";
import { useWorkshopDocToolbarProps } from "./workshop/useWorkshopDocToolbarProps";
import { useWorkshopDocBubbleMenuItems } from "./workshop/useWorkshopDocBubbleMenuItems";
import { useWorkshopModalsProps } from "./workshop/useWorkshopModalsProps";
import { WorkshopMetricsColumn } from "./workshop/WorkshopMetricsColumn";
import { WorkshopLayoutShell } from "./workshop/WorkshopLayoutShell";
import { WorkshopChatColumn } from "./workshop/WorkshopChatColumn";
import { WorkshopMobileNav } from "./workshop/WorkshopMobileNav";
import { WorkshopMobileFabs } from "./workshop/WorkshopMobileFabs";
import { useLgChatPanel } from "./workshop/useLgChatPanel";
import { useWorkshopMobileScrollFab } from "./workshop/useWorkshopMobileScrollFab";
import type { WorkshopMobileColumn } from "./workshop/workshopMetricsColumn.types";
import { HANDOFF_GATE_STORAGE_KEY } from "./workshop/workshopLegacyPanels.types";
import { type DocumentsForZip } from "../utils/downloadDocumentsZip";
import {
  downloadWorkshopProjectZip,
} from "../utils/downloadRepoHandoff";
import {
  downloadSpecKitBundle,
  downloadSpecKitBundleFromApi,
} from "../utils/downloadSpecKitBundle";
import {
  printDesignSystemDocument,
  printMarkdownDocument,
} from "../utils/printDocument";
import { isTabVisibleForComplexity, type WorkshopDocTab } from "../utils/complexityTabs";
import { isWorkshopFrozenDeliverableTab } from "@theforge/shared-types";
import { evaluateTasksGenerationPrerequisites } from "../utils/tasksGenerationPrerequisites";
import { isWorkshopAgentActivityPanel } from "../utils/workshopDocNav";
import { fetchPluginArtifacts, PLUGIN_ARTIFACTS_CHANGED_EVENT } from "../utils/pluginApi";
import {
  buildRegenerateSectionChatMessage,
  canRegenerateMddSectionFromWorkshop,
  MDD_QUALITY_TABLE_ROWS,
  mddSectionRegenDisabledTitle,
  resolveEffectiveMddContent,
} from "../utils/mddSectionRegen";
import { useAutoSaveContent } from "../hooks/useAutoSaveContent";
import {
  LEGACY_CODEBASE_DOC_STEPS,
  LEGACY_DELIVERABLES_STEPS,
  LEGACY_MDD_STEPS,
} from "../constants/legacy-workshop-loading-steps";

interface WorkshopViewProps {
  projectId: string;
  projectName?: string;
  onBack?: () => void;
  onOpenSettings?: () => void;
  /** Abre el diálogo de renombrar (solo si el usuario es propietario). */
  onRenameProject?: () => void;
  mergeAudit?: {
    type: string;
    threadId?: string;
    question?: string;
    n?: number;
    total?: number;
    message?: string;
  } | null;
}

export default function WorkshopView({
  projectId,
  projectName,
  onBack,
  onOpenSettings,
  onRenameProject,
  mergeAudit,
}: WorkshopViewProps) {
  const project = useWorkshopStore((s) => s.project);
  const activeStageId = useWorkshopStore((s) => s.activeStageId);
  const documentationGapsRefreshNonce = useWorkshopStore((s) => s.documentationGapsRefreshNonce);
  const setActiveStageId = useWorkshopStore((s) => s.setActiveStageId);
  const createWorkshopStage = useWorkshopStore((s) => s.createWorkshopStage);
  const workshopStages = useWorkshopStore((s) => s.workshopStages);
  const workshopStagesList =
    workshopStages.length > 0 ? workshopStages : (project?.stages ?? []);
  const activeWorkshopStage = useMemo(
    () => workshopStagesList.find((s) => s.id === activeStageId),
    [workshopStagesList, activeStageId],
  );
  const workshopActiveDocPanel = useWorkshopStore((s) => s.workshopActiveDocPanel);
  const { view: stageDeliverableView } = useStageDeliverableView(projectId ?? null, activeStageId);
  const ssotFrozenPanel = isWorkshopFrozenDeliverableTab(workshopActiveDocPanel);
  const deliverablesReadOnly = stageDeliverableView?.readOnly === true || ssotFrozenPanel;
  const patchWorkshopStage = useWorkshopStore((s) => s.patchWorkshopStage);
  const generateMddFromBenchmark = useWorkshopStore((s) => s.generateMddFromBenchmark);
  const generateMddUpstreamSync = useWorkshopStore((s) => s.generateMddUpstreamSync);
  const persistMddContent = useWorkshopStore((s) => s.persistMddContent);
  const [mddPatternsWizardOpen, setMddPatternsWizardOpen] = useState(false);
  const [mddRegenerateDialogOpen, setMddRegenerateDialogOpen] = useState(false);
  const [mddRegenerateInitialMode, setMddRegenerateInitialMode] =
    useState<MddRegenerateMode>("full");
  const [clearMddConfirmOpen, setClearMddConfirmOpen] = useState(false);
  const [clearMddDeliverablesConfirmOpen, setClearMddDeliverablesConfirmOpen] = useState(false);
  const [mddPatternsWizardMode, setMddPatternsWizardMode] =
    useState<MddPatternsWizardMode>("initial");
  const [patternCompatOpen, setPatternCompatOpen] = useState(false);
  const [patternCompatCorrections, setPatternCompatCorrections] = useState<
    GovernancePatternCorrection[]
  >([]);
  const [patternCompatCorrectedIds, setPatternCompatCorrectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [patternCompatConfirmLabel, setPatternCompatConfirmLabel] = useState(
    "Continuar y generar MDD",
  );
  const [pendingMddAfterPatternCompat, setPendingMddAfterPatternCompat] =
    useState<PendingMddAfterPatternCompat | null>(null);
  const [patternCompatLoading, setPatternCompatLoading] = useState(false);
  const [patternsWizardAnalyzing, setPatternsWizardAnalyzing] = useState(false);
  const [patternsWizardPreselected, setPatternsWizardPreselected] = useState<Set<string> | null>(
    null,
  );
  const [patternsAnalyzeRationale, setPatternsAnalyzeRationale] = useState<string | null>(null);
  /** Estado legacy efectivo desde la etapa activa (`legacyChangeState`). */
  const activeLegacyState = useMemo(() => {
    if (project?.projectType !== "LEGACY") return null;
    return activeWorkshopStage?.legacyChangeState ?? null;
  }, [project?.projectType, activeWorkshopStage?.legacyChangeState]);
  const liveMetrics = useWorkshopStore((s) => s.liveMetrics);
  const mddContent = useWorkshopStore((s) => s.mddContent);
  /** MDD en store, etapa activa o proyecto (evita botones deshabilitados si el store quedó vacío). */
  const effectiveMddTrimmed = useMemo(
    () =>
      resolveEffectiveMddContent({
        mddContent,
        stageMddContent: activeWorkshopStage?.mddContent,
        projectMddContent: project?.mddContent,
      }),
    [mddContent, activeWorkshopStage?.mddContent, project?.mddContent],
  );
  const specContentField = useWorkshopStore((s) => s.specContent);
  const dbgaContentField = useWorkshopStore((s) => s.dbgaContent);
  /** Mismo criterio que `POST …/suggest-brd-from-dbga` (lee `dbgaContent` persistido en proyecto). */
  // dbgaContentCharCount eliminado
  const blueprintContentField = useWorkshopStore((s) => s.blueprintContent);
  const apiContractsContentField = useWorkshopStore((s) => s.apiContractsContent);
  const logicFlowsContentField = useWorkshopStore((s) => s.logicFlowsContent);
  const infraContentField = useWorkshopStore((s) => s.infraContent);
  const tasksContentField = useWorkshopStore((s) => s.tasksContent);
  const agentGovernanceContentField = useWorkshopStore((s) => s.agentGovernanceContent);
  const architectureContentField = useWorkshopStore((s) => s.architectureContent);
  const useCasesContentField = useWorkshopStore((s) => s.useCasesContent);
  const userStoriesContentField = useWorkshopStore((s) => s.userStoriesContent);
  const phase0SummaryContentField = useWorkshopStore((s) => s.phase0SummaryContent);
  const uxUiGuideContentField = useWorkshopStore((s) => s.uxUiGuideContent);
  const aemContentField = useWorkshopStore((s) => s.aemContent);
  const setAemContent = useWorkshopStore((s) => s.setAemContent);
  const persistAemContent = useWorkshopStore((s) => s.persistAemContent);
  const uiScreensContentField = useWorkshopStore((s) => s.uiScreensContent);
  const syncUiScreens = useWorkshopStore((s) => s.syncUiScreens);

  const specContent = resolveWorkshopDeliverableContent(
    "specContent",
    specContentField ?? project?.specContent ?? null,
    stageDeliverableView,
  );
  const dbgaContent = dbgaContentField ?? project?.dbgaContent ?? null;
  /** Contenido visible en el panel Fase 0: usa dbgaContent o specContent legacy como fallback */
  const fase0Content = dbgaContent ?? specContent ?? null;
  const phase0IsEmpty = !dbgaContent?.trim() && !specContent?.trim();
  const blueprintContent = resolveWorkshopDeliverableContent(
    "blueprintContent",
    blueprintContentField ?? project?.blueprintContent ?? null,
    stageDeliverableView,
  );
  const apiContractsContent = resolveWorkshopDeliverableContent(
    "apiContractsContent",
    apiContractsContentField ?? project?.apiContractsContent ?? null,
    stageDeliverableView,
  );
  const logicFlowsContent = resolveWorkshopDeliverableContent(
    "logicFlowsContent",
    logicFlowsContentField ?? project?.logicFlowsContent ?? null,
    stageDeliverableView,
  );
  const infraContent = resolveWorkshopDeliverableContent(
    "infraContent",
    infraContentField ?? project?.infraContent ?? null,
    stageDeliverableView,
  );
  const tasksContent = resolveWorkshopDeliverableContent(
    "tasksContent",
    tasksContentField ?? project?.tasksContent ?? null,
    stageDeliverableView,
  );
  const agentGovernanceContent =
    agentGovernanceContentField ?? project?.agentGovernanceContent ?? null;
  const agentGovernanceScaffold = useMemo(
    () => parseAgentGovernanceScaffold(agentGovernanceContent),
    [agentGovernanceContent],
  );
  const hasAgentGovernance = agentGovernanceScaffoldHasContent(agentGovernanceContent);
  const architectureContent = architectureContentField ?? project?.architectureContent ?? null;
  const useCasesContent = useCasesContentField ?? project?.useCasesContent ?? null;
  const userStoriesContent = userStoriesContentField ?? project?.userStoriesContent ?? null;
  const phase0SummaryContent = phase0SummaryContentField ?? project?.phase0SummaryContent ?? null;
  /** Deep Research markdown; ignora JSON de borrador que pudo quedar en phase0SummaryContent. */
  const benchmarkMarkdown =
    phase0SummaryContent?.trim() && !isPhase0BorradorJson(phase0SummaryContent)
      ? phase0SummaryContent
      : null;
  const benchmarkNeedsRegenerate = isPhase0BorradorJson(phase0SummaryContent);
  const canGenerateAem = useMemo(
    () =>
      !!(
        dbgaContent?.trim() ||
        benchmarkMarkdown?.trim() ||
        (activeWorkshopStage?.brdContent ?? "").trim()
      ),
    [dbgaContent, benchmarkMarkdown, activeWorkshopStage?.brdContent],
  );
  const uxUiGuideContent = uxUiGuideContentField ?? project?.uxUiGuideContent ?? null;
  const aemContent = aemContentField ?? project?.aemContent ?? null;
  const uiScreensContent = uiScreensContentField ?? project?.uiScreensContent ?? null;

  const projectStatus: Status = project?.status ?? "ROJO";
  const semaphoreGreen = isWorkshopSemaphoreGreen(liveMetrics, projectStatus);
  const hasSpec = (specContent ?? "").trim().length > 0;
  const complexity = project?.complexity ?? "HIGH";
  const isLegacyProject = project?.projectType === "LEGACY";
  const tasksPrerequisites = useMemo(
    () =>
      evaluateTasksGenerationPrerequisites({
        mddMarkdown: effectiveMddTrimmed,
        blueprintMarkdown: blueprintContent,
        specMarkdown: specContent,
        apiContractsMarkdown: apiContractsContent,
        uiScreensMarkdown: uiScreensContent,
        hasUxTeam: project?.hasUxTeam === true,
        legacyBaseline: isLegacyProject,
      }),
    [
      effectiveMddTrimmed,
      blueprintContent,
      specContent,
      apiContractsContent,
      uiScreensContent,
      project?.hasUxTeam,
      isLegacyProject,
    ],
  );
  const legacyChangeGateSatisfied = useMemo(() => {
    if (!isLegacyProject) return true;
    const ordinal = activeWorkshopStage?.ordinal ?? 1;
    if (ordinal < 2) return true;
    return isLegacyChangeGateSatisfied({
      ordinal,
      legacyChangeState:
        activeWorkshopStage?.legacyChangeState ?? activeLegacyState ?? null,
      handoffImportedAt: activeWorkshopStage?.handoffImportedAt ?? null,
      handoffSnapshot: activeWorkshopStage?.handoffSnapshot ?? null,
    });
  }, [
    isLegacyProject,
    activeWorkshopStage?.ordinal,
    activeWorkshopStage?.legacyChangeState,
    activeWorkshopStage?.handoffImportedAt,
    activeWorkshopStage?.handoffSnapshot,
    activeLegacyState,
  ]);
  const legacyChangeGateBlocked =
    isLegacyProject && (activeWorkshopStage?.ordinal ?? 1) >= 2 && !legacyChangeGateSatisfied;

  const [handoffGateStrict, setHandoffGateStrict] = useState(() => {
    try {
      const v = localStorage.getItem(HANDOFF_GATE_STORAGE_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const handleHandoffGateStrictChange = useCallback((strict: boolean) => {
    setHandoffGateStrict(strict);
    try {
      localStorage.setItem(HANDOFF_GATE_STORAGE_KEY, strict ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const legacyHandoffGatePending = useMemo(() => {
    if (!isLegacyProject) return false;
    return isLegacyIntegrationHandoffGatePending({
      ordinal: activeWorkshopStage?.ordinal ?? 1,
      linkedNewProjectId:
        project?.linkedNewProjectId ?? activeWorkshopStage?.linkedNewProjectId ?? null,
      handoffImportedAt: activeWorkshopStage?.handoffImportedAt ?? null,
      handoffSnapshot: activeWorkshopStage?.handoffSnapshot ?? null,
      enforceHandoffGate: true,
    });
  }, [
    isLegacyProject,
    activeWorkshopStage?.ordinal,
    activeWorkshopStage?.handoffImportedAt,
    activeWorkshopStage?.handoffSnapshot,
    project?.linkedNewProjectId,
    activeWorkshopStage?.linkedNewProjectId,
  ]);
  const legacyHandoffGateBlocked = legacyHandoffGatePending && handoffGateStrict;
  const legacyGenerateBlocked = legacyChangeGateBlocked || legacyHandoffGateBlocked;

  // ─── Generación secuencial multi-sección del DESIGN.md ─────
  const [uxGenerating, setUxGenerating] = useState(false);
  const [uxGenProgress, setUxGenProgress] = useState<string | null>(null);

  const isReverseEngineering =
    isLegacyProject &&
    !!((activeLegacyState?.codebaseDoc ?? "").trim()) &&
    !effectiveMddTrimmed;
  const effectiveComplexityForTabs = isReverseEngineering ? "HIGH" : complexity;
  const hasCodebaseDoc = isLegacyProject && (activeLegacyState?.codebaseDoc ?? "").trim().length > 300;
  const isStage1Legacy = isLegacyProject && activeWorkshopStage?.ordinal === 1;
  const isLegacyModificationStage =
    isLegacyProject && (activeWorkshopStage?.ordinal ?? 1) >= 2;
  const canGenerateFromCodebase = isStage1Legacy && hasCodebaseDoc;
  const canGenerate = useMemo(() => {
    if (isLegacyProject) {
      const hasMdd = effectiveMddTrimmed.length > 0;
      const hasCodebaseDoc = (activeLegacyState?.codebaseDoc ?? "").trim().length > 0;
      return hasMdd || hasCodebaseDoc;
    }
    if (complexity === "LOW" || complexity === "MEDIUM" || complexity === "HIGH") {
      const hasBootstrap =
        (dbgaContent ?? "").trim().length > 0 || effectiveMddTrimmed.length > 0;
      return (semaphoreGreen && hasSpec) || hasBootstrap;
    }
    return semaphoreGreen && hasSpec;
  }, [
    isLegacyProject,
    complexity,
    semaphoreGreen,
    hasSpec,
    dbgaContent,
    effectiveMddTrimmed,
    activeLegacyState?.codebaseDoc,
  ]);

  /* Use stable selectors to avoid loops */
  const conformanceRaw = useWorkshopStore((s) => s.conformance);
  const conformance = useMemo(() => conformanceRaw, [conformanceRaw]);
  const apiBlueprintDmBlocked = conformance?.blueprintDataModel?.ok === false;
  const apiBlueprintBlockedHint =
    "El Blueprint no cubre el §3 Modelo de datos del MDD. Corrige o regenera el Blueprint; revisa el panel Conformance.";

  const precisionBreakdownRaw = useWorkshopStore((s) => s.precisionBreakdown);
  const precisionBreakdown = useMemo(() => precisionBreakdownRaw, [precisionBreakdownRaw]);
  const mddReadinessHints = useMemo(
    () => liveMetrics?.mddReadinessHints ?? liveMetrics?.readinessHints ?? null,
    [liveMetrics?.mddReadinessHints, liveMetrics?.readinessHints],
  );
  const traceabilityHints = useMemo(
    () => liveMetrics?.traceabilityHints ?? null,
    [liveMetrics?.traceabilityHints],
  );
  const consistencyScore = useWorkshopStore((s) => s.consistencyScore);
  const documentCompleteness = useWorkshopStore((s) => s.documentCompleteness);
  const crossDocumentGaps = useWorkshopStore((s) => s.crossDocumentGaps);

  const documentTimestamps = useWorkshopStore((s) => s.documentTimestamps);
  const docTs = useCallback(
    (field: string) => documentTimestamps[field] ?? null,
    [documentTimestamps],
  );

  const auditTrailRaw = useWorkshopStore((s) => s.auditTrail);
  const auditTrail = useMemo(() => auditTrailRaw || [], [auditTrailRaw]);

  const synced = useWorkshopStore((s) => s.synced);
  const loading = useWorkshopStore((s) => s.loading);
  const loadingReason = useWorkshopStore((s) => s.loadingReason);
  const generationStatus = useWorkshopStore((s) => s.generationStatus);
  const cascadeRunning = isDeliverablesCascadeUiActive({
    loading,
    loadingReason,
    generationStatus,
  });
  const mddBackgroundJob =
    loading &&
    (loadingReason === "mdd" || loadingReason === "legacy-mdd" || loadingReason === "mdd-section");
  const agentGovernanceGenerating =
    loading &&
    (loadingReason === "agent-governance" ||
      loadingReason === "deliverables-cascade" ||
      loadingReason === "legacy-deliverables");
  const cascadeCompleted = useWorkshopStore((s) => s.cascadeCompleted);
  const cascadeTotal = useWorkshopStore((s) => s.cascadeTotal);
  const agentProgress = useWorkshopStore((s) => s.agentProgress);
  const cascadePostPassRunning =
    cascadeRunning &&
    agentProgress.some(
      (item) => item.status === "generando" && item.step?.includes("Refinando precisión"),
    );
  const error = useWorkshopStore((s) => s.error);
  const notice = useWorkshopStore((s) => s.notice);
  const activeDeliverablesJobId = useWorkshopStore((s) => s.activeDeliverablesJobId);
  const cancelMddJob = useWorkshopStore((s) => s.cancelMddJob);
  const cancelDeliverablesJob = useWorkshopStore((s) => s.cancelDeliverablesJob);
  const backgroundGenerationLabel = activeGenerationLabel(generationStatus);
  const activeMddJob = primaryMddJob(generationStatus);
  const activeDeliverablesJob = generationStatus?.activeJob ?? generationStatus?.queuedJobs?.[0] ?? null;
  const cascadeWaveDocsReady = useMemo(
    () => (project ? projectCascadeWaveDeliverablesReady(project) : false),
    [project],
  );
  const cascadeJobPostProcessing =
    cascadeWaveDocsReady &&
    (cascadeRunning ||
      cascadePostPassRunning ||
      activeDeliverablesJob?.type === "cascade" ||
      activeDeliverablesJob?.type === "cascade-delta" ||
      generationStatus?.activeJob?.type === "cascade" ||
      generationStatus?.activeJob?.type === "cascade-delta");
  const backgroundBannerLabel = cascadeJobPostProcessing
    ? "Finalizando post-proceso (precisión y conformidad)… Puedes cerrar el navegador; al volver, recarga el proyecto para ver el resultado."
    : cascadeRunning
      ? "Generación de entregables en curso… Puedes cerrar el navegador; al volver, recarga el proyecto para ver el resultado."
      : backgroundGenerationLabel
        ? `${backgroundGenerationLabel} Puedes cerrar el navegador; al volver, recarga el proyecto para ver el resultado.`
        : null;
  const cancellableJobId =
    activeMddJob?.jobId ??
    activeDeliverablesJob?.jobId ??
    activeDeliverablesJobId ??
    null;
  const cancellableJobIsMdd = Boolean(activeMddJob && cancellableJobId === activeMddJob.jobId);
  const [cancellingJob, setCancellingJob] = useState(false);
  const isGenerationGateBlocked = useCallback(
    (type: GenerationJobType) => !generationJobAllowed(generationStatus, type),
    [generationStatus],
  );
  const setError = useWorkshopStore((s) => s.setError);
  const buildDocClarification = useCallback(
    (
      field: ClarifyableDocumentField,
      onApplied: (content: string) => void,
      hint?: string,
      extra?: { clarifyOpen?: boolean; onClarifyOpenChange?: (open: boolean) => void },
    ) =>
      projectId
        ? {
            projectId,
            field,
            stageId: activeStageId,
            disabled: loading,
            readOnly: deliverablesReadOnly,
            onContentApplied: onApplied,
            onMessage: (msg: string) => setError(msg),
            hint,
            ...extra,
          }
        : undefined,
    [projectId, activeStageId, loading, deliverablesReadOnly, setError],
  );
  const setNotice = useWorkshopStore((s) => s.setNotice);
  const retryWorkshopSync = useWorkshopStore((s) => s.retryWorkshopSync);
  const connectionError = isWorkshopConnectionError(error);
  const bannerNotice = notice ?? (isSsotPatternsNotice(error) ? error : null);
  const bannerError = error && !isSsotPatternsNotice(error) ? error : null;
  const modelsUnavailableModalOpen = useWorkshopStore((s) => s.modelsUnavailableModalOpen);
  const setModelsUnavailableModalOpen = useWorkshopStore((s) => s.setModelsUnavailableModalOpen);
  const convergeTasks = useWorkshopStore((s) => s.convergeTasks);
  const tasksToIssues = useWorkshopStore((s) => s.tasksToIssues);
  const fetchProject = useWorkshopStore((s) => s.fetchProject);
  const adrsRaw = useWorkshopStore((s) => s.adrs);
  const adrs = useMemo(() => adrsRaw || [], [adrsRaw]);
  const fetchAdrs = useWorkshopStore((s) => s.fetchAdrs);
  const suggestGovernancePatterns = useWorkshopStore((s) => s.suggestGovernancePatterns);
  const recordGovernancePatternAdrs = useWorkshopStore((s) => s.recordGovernancePatternAdrs);
  const mddDirty = useWorkshopStore(isMddEditorDirty);
  const sendMessage = useWorkshopStore((s) => s.sendMessage);
  const setMddContent = useWorkshopStore((s) => s.setMddContent);
  const revertMddContent = useWorkshopStore((s) => s.revertMddContent);
  const persistAndReviewMdd = useWorkshopStore((s) => s.persistAndReviewMdd);
  const reapplyMddFormat = useWorkshopStore((s) => s.reapplyMddFormat);
  const regenerateMddSection5Pipeline = useWorkshopStore((s) => s.regenerateMddSection5Pipeline);
  const mddReviewing = useWorkshopStore((s) => s.mddReviewing);
  const mddReapplyingFormat = useWorkshopStore((s) => s.mddReapplyingFormat);
  const mddPersisting = useWorkshopStore((s) => s.mddPersisting);
  const workshopAgentsBusy = useWorkshopStore(selectWorkshopAgentsBusy);

  const setBlueprintContent = useWorkshopStore((s) => s.setBlueprintContent);
  const persistBlueprintContent = useWorkshopStore((s) => s.persistBlueprintContent);
  const generateBlueprint = useWorkshopStore((s) => s.generateBlueprint);
  const setApiContractsContent = useWorkshopStore((s) => s.setApiContractsContent);
  const persistApiContractsContent = useWorkshopStore((s) => s.persistApiContractsContent);
  const generateApiContracts = useWorkshopStore((s) => s.generateApiContracts);
  const setLogicFlowsContent = useWorkshopStore((s) => s.setLogicFlowsContent);
  const persistLogicFlowsContent = useWorkshopStore((s) => s.persistLogicFlowsContent);
  const generateLogicFlows = useWorkshopStore((s) => s.generateLogicFlows);
  const setInfraContent = useWorkshopStore((s) => s.setInfraContent);
  const persistInfraContent = useWorkshopStore((s) => s.persistInfraContent);
  const generateInfra = useWorkshopStore((s) => s.generateInfra);
  const generateSpec = useWorkshopStore((s) => s.generateSpec);
  const generateAem = useWorkshopStore((s) => s.generateAem);
  const generateTasks = useWorkshopStore((s) => s.requestGenerateTasks);
  const generateAgentGovernance = useWorkshopStore((s) => s.generateAgentGovernance);
  const fetchAgentGovernanceExport = useWorkshopStore((s) => s.fetchAgentGovernanceExport);
  const persistTasksContent = useWorkshopStore((s) => s.persistTasksContent);
  const setTasksContent = useWorkshopStore((s) => s.setTasksContent);
  const setSpecContent = useWorkshopStore((s) => s.setSpecContent);
  const persistSpecContent = useWorkshopStore((s) => s.persistSpecContent);
  const setUxUiGuideContent = useWorkshopStore((s) => s.setUxUiGuideContent);
  const fetchConformance = useWorkshopStore((s) => s.fetchConformance);
  const setDbgaContent = useWorkshopStore((s) => s.setDbgaContent);
  const persistDbgaContent = useWorkshopStore((s) => s.persistDbgaContent);
  const clearDbgaContent = useWorkshopStore((s) => s.clearDbgaContent);
  const generateBenchmark = useWorkshopStore((s) => s.generateBenchmark);
  const suggestBrdFromDbga = useWorkshopStore((s) => s.suggestBrdFromDbga);
  const mddJustGeneratedFromBenchmark = useWorkshopStore((s) => s.mddJustGeneratedFromBenchmark);
  const clearMddJustGeneratedFromBenchmark = useWorkshopStore((s) => s.clearMddJustGeneratedFromBenchmark);
  const phase0DeepResearch = useWorkshopStore((s) => s.phase0DeepResearch);
  const clearPhase0SummaryContent = useWorkshopStore((s) => s.clearPhase0SummaryContent);
  const clearWorkshopDocumentContent = useWorkshopStore((s) => s.clearWorkshopDocumentContent);
  const clearMddContentCompletely = useWorkshopStore((s) => s.clearMddContentCompletely);
  const clearMddDependentDeliverables = useWorkshopStore((s) => s.clearMddDependentDeliverables);
  const setPhase0SummaryContent = useWorkshopStore((s) => s.setPhase0SummaryContent);
  const persistPhase0SummaryContent = useWorkshopStore((s) => s.persistPhase0SummaryContent);
  const legacyGenerateCodebaseDoc = useWorkshopStore((s) => s.legacyGenerateCodebaseDoc);
  const legacySuggestBrdFromCodebaseDoc = useWorkshopStore((s) => s.legacySuggestBrdFromCodebaseDoc);
  const legacyGenerateFromCodebaseDoc = useWorkshopStore((s) => s.legacyGenerateFromCodebaseDoc);
  const legacyMcpDebugTrace = useWorkshopStore((s) => s.legacyMcpDebugTrace);
  const legacyUpdateCodebaseDoc = useWorkshopStore((s) => s.legacyUpdateCodebaseDoc);
  const legacyStart = useWorkshopStore((s) => s.legacyStart);
  const legacyAnswer = useWorkshopStore((s) => s.legacyAnswer);
  const legacyGenerateMdd = useWorkshopStore((s) => s.legacyGenerateMdd);
  const openPatternsWizardWithAnalysis = useCallback(
    async (mode: MddPatternsWizardMode) => {
      if (!projectId?.trim()) return;
      setMddPatternsWizardMode(mode);
      setPatternsAnalyzeRationale(null);
      setMddPatternsWizardOpen(true);

      const heuristicInput = {
        dbgaContent: (dbgaContent ?? project?.dbgaContent ?? "").trim(),
        phase0SummaryContent: (phase0SummaryContent ?? project?.phase0SummaryContent ?? "").trim(),
        brdContent: (activeWorkshopStage?.brdContent ?? "").trim(),
      };
      const instantIds = heuristicGovernancePatternIds(heuristicInput);
      if (instantIds.length > 0) {
        setPatternsWizardPreselected(new Set(instantIds));
        setPatternsAnalyzeRationale(
          instantIds.length >= 2
            ? "Borrador inicial desde tus documentos; refinando con IA…"
            : "Borrador inicial; la IA analizará Fase 0, Benchmark y BRD…",
        );
      } else {
        setPatternsWizardPreselected(null);
      }

      setPatternsWizardAnalyzing(true);
      try {
        const { patternIds, rationale } = await suggestGovernancePatterns(
          projectId,
          activeStageId,
        );
        if (patternIds.length > 0) {
          setPatternsWizardPreselected(new Set(patternIds));
        }
        setPatternsAnalyzeRationale(
          rationale ??
            "Preselección a partir de Fase 0, Benchmark y BRD (puede variar si cambias esos documentos).",
        );
      } catch (e) {
        setPatternsAnalyzeRationale(
          e instanceof Error ? e.message : "No se pudo analizar; elige patrones manualmente.",
        );
      } finally {
        setPatternsWizardAnalyzing(false);
      }
    },
    [
      projectId,
      activeStageId,
      suggestGovernancePatterns,
      dbgaContent,
      project?.dbgaContent,
      phase0SummaryContent,
      project?.phase0SummaryContent,
      activeWorkshopStage?.brdContent,
    ],
  );

  const openPatternsWizardInitial = useCallback(
    () => void openPatternsWizardWithAnalysis("initial"),
    [openPatternsWizardWithAnalysis],
  );

  const openSuggestMddPatterns = useCallback(
    () => void openPatternsWizardWithAnalysis("edit"),
    [openPatternsWizardWithAnalysis],
  );

  const requestGenerateMdd = useCallback(() => {
    if (!projectId?.trim()) return;
    if (isLegacyProject) {
      void legacyGenerateMdd(projectId, activeStageId ?? undefined);
      return;
    }
    if (mddNeedsPatternWizard(effectiveMddTrimmed)) {
      void openPatternsWizardInitial();
      return;
    }
    if (effectiveMddTrimmed.length > 0) {
      setMddRegenerateInitialMode("full");
      setMddRegenerateDialogOpen(true);
      return;
    }
    void generateMddFromBenchmark(projectId);
  }, [
    projectId,
    isLegacyProject,
    legacyGenerateMdd,
    activeStageId,
    effectiveMddTrimmed,
    generateMddFromBenchmark,
    openPatternsWizardInitial,
  ]);

  const openMddSyncDialog = useCallback(() => {
    setMddRegenerateInitialMode("upstream-sync");
    setMddRegenerateDialogOpen(true);
  }, []);

  const openEditMddPatterns = useCallback(() => {
    setMddPatternsWizardMode("edit");
    setPatternsWizardPreselected(new Set(selectedPatternIdsFromMdd(effectiveMddTrimmed)));
    setPatternsAnalyzeRationale(null);
    setPatternsWizardAnalyzing(false);
    setMddPatternsWizardOpen(true);
  }, [effectiveMddTrimmed]);

  const saveEditedGovernancePatterns = useCallback(
    async (selectedIds: ReadonlySet<string>) => {
      await persistMddContent(
        updateMddGovernancePatterns(effectiveMddTrimmed, selectedIds),
        {
          force: true,
          allowGovernancePatternChange: true,
        },
      );
      if (
        !useWorkshopStore.getState().notice &&
        !isSsotPatternsNotice(useWorkshopStore.getState().error)
      ) {
        const pid = useWorkshopStore.getState().projectId;
        if (pid?.trim()) {
          await recordGovernancePatternAdrs(pid, selectedIds).catch(() => {});
          void useWorkshopStore.getState().fetchEstimation(pid);
        }
      }
    },
    [effectiveMddTrimmed, persistMddContent, recordGovernancePatternAdrs],
  );

  const runInitialMddGenerationAfterPersist = useCallback(
    async (seedMarkdown: string, correctedIds: ReadonlySet<string>) => {
      if (!projectId?.trim()) return;
      await persistMddContent(
        updateMddGovernancePatterns(seedMarkdown, correctedIds),
        {
          force: true,
          allowGovernancePatternChange: true,
          mddGovernanceSeedOnly: true,
        },
      );
      const storeAfterPersist = useWorkshopStore.getState();
      if (
        storeAfterPersist.notice ||
        isSsotPatternsNotice(storeAfterPersist.error) ||
        storeAfterPersist.error
      ) {
        return;
      }
      await recordGovernancePatternAdrs(projectId, correctedIds).catch(() => {});
      await generateMddFromBenchmark(projectId);
    },
    [projectId, persistMddContent, recordGovernancePatternAdrs, generateMddFromBenchmark],
  );

  const promptPatternCompatBeforeMdd = useCallback(
    (
      selectedIds: ReadonlySet<string>,
      pending: PendingMddAfterPatternCompat,
      confirmLabel: string,
      onProceed: () => void | Promise<void>,
    ) => {
      const offer = offerGovernancePatternCompat(selectedIds);
      if (offer.proceed) {
        void onProceed();
        return;
      }
      setPatternCompatCorrections(offer.corrections);
      setPatternCompatCorrectedIds(offer.correctedIds);
      setPatternCompatConfirmLabel(confirmLabel);
      setPendingMddAfterPatternCompat(pending);
      setPatternCompatOpen(true);
    },
    [],
  );

  const handlePatternCompatOpenChange = useCallback(
    (open: boolean) => {
      setPatternCompatOpen(open);
      if (!open && !patternCompatLoading) {
        setPendingMddAfterPatternCompat(null);
      }
    },
    [patternCompatLoading],
  );

  const executePendingMddAfterPatternCompat = useCallback(async () => {
    if (!pendingMddAfterPatternCompat || !projectId?.trim()) return;
    const pending = pendingMddAfterPatternCompat;
    const correctedIds = patternCompatCorrectedIds;
    setPatternCompatLoading(true);
    try {
      setPatternCompatOpen(false);
      setPendingMddAfterPatternCompat(null);

      if (pending.kind === "edit-patterns-only") {
        await saveEditedGovernancePatterns(correctedIds);
        return;
      }

      if (pending.kind === "wizard-initial") {
        await runInitialMddGenerationAfterPersist(pending.seedMarkdown, correctedIds);
        return;
      }

      const markdown = updateMddGovernancePatterns(effectiveMddTrimmed, correctedIds);
      await persistMddContent(markdown, {
        force: true,
        allowGovernancePatternChange: true,
      });
      const storeAfter = useWorkshopStore.getState();
      if (storeAfter.notice || isSsotPatternsNotice(storeAfter.error) || storeAfter.error) {
        return;
      }
      await recordGovernancePatternAdrs(projectId, correctedIds).catch(() => {});

      if (pending.kind === "generate-benchmark") {
        await generateMddFromBenchmark(projectId);
      } else if (pending.kind === "upstream-sync") {
        await generateMddUpstreamSync(projectId, {
          sections: pending.sections,
          stageId: activeStageId,
        });
      }
    } finally {
      setPatternCompatLoading(false);
    }
  }, [
    pendingMddAfterPatternCompat,
    projectId,
    patternCompatCorrectedIds,
    effectiveMddTrimmed,
    persistMddContent,
    recordGovernancePatternAdrs,
    generateMddFromBenchmark,
    generateMddUpstreamSync,
    activeStageId,
    saveEditedGovernancePatterns,
    runInitialMddGenerationAfterPersist,
  ]);

  const handleMddPatternsWizardConfirm = useCallback(
    async (markdown: string, selectedIds: ReadonlySet<string>) => {
      setMddPatternsWizardOpen(false);
      const mode = mddPatternsWizardMode;
      if (mode === "edit") {
        promptPatternCompatBeforeMdd(
          selectedIds,
          { kind: "edit-patterns-only" },
          "Guardar patrones corregidos",
          () => saveEditedGovernancePatterns(selectedIds),
        );
        return;
      }
      promptPatternCompatBeforeMdd(
        selectedIds,
        { kind: "wizard-initial", seedMarkdown: markdown },
        "Continuar y generar MDD",
        () => runInitialMddGenerationAfterPersist(markdown, selectedIds),
      );
    },
    [
      mddPatternsWizardMode,
      promptPatternCompatBeforeMdd,
      saveEditedGovernancePatterns,
      runInitialMddGenerationAfterPersist,
    ],
  );

  const handleMddRegenerateFull = useCallback(async () => {
    if (!projectId?.trim()) return;
    setMddRegenerateDialogOpen(false);
    const ids = selectedPatternIdsFromMdd(effectiveMddTrimmed);
    promptPatternCompatBeforeMdd(
      ids,
      { kind: "generate-benchmark" },
      "Continuar y regenerar MDD",
      () => void generateMddFromBenchmark(projectId),
    );
  }, [
    projectId,
    effectiveMddTrimmed,
    promptPatternCompatBeforeMdd,
    generateMddFromBenchmark,
  ]);

  const handleMddRegenerateSync = useCallback(
    async (sections: number[]) => {
      if (!projectId?.trim()) return;
      setMddRegenerateDialogOpen(false);
      const ids = selectedPatternIdsFromMdd(effectiveMddTrimmed);
      promptPatternCompatBeforeMdd(
        ids,
        { kind: "upstream-sync", sections },
        "Continuar y sincronizar MDD",
        () =>
          void generateMddUpstreamSync(projectId, {
            sections,
            stageId: activeStageId,
          }),
      );
    },
    [
      projectId,
      effectiveMddTrimmed,
      activeStageId,
      promptPatternCompatBeforeMdd,
      generateMddUpstreamSync,
    ],
  );

  const legacyGenerateDeliverables = useWorkshopStore((s) => s.legacyGenerateDeliverables);
  const persistUxUiGuideContent = useWorkshopStore((s) => s.persistUxUiGuideContent);
  const persistUxGuideDesignRef = useWorkshopStore((s) => s.persistUxGuideDesignRef);
  const generateUxGuideSequential = useCallback(async () => {
    const { apiFetch, API_BASE } = await import("../utils/apiClient");
    const blueprint = blueprintContent?.trim() || "";
    const specContentStr = specContent?.trim() || "";
    // Legacy: incluir codebaseDoc (MDD Inicial) como contexto AS-IS del frontend real
    const codebaseDoc = isLegacyProject && activeLegacyState?.codebaseDoc?.trim()
      ? activeLegacyState.codebaseDoc.slice(0, 4000)
      : "";
    const contextMd = [
      blueprint ? `## Blueprint (data model)\n${blueprint.slice(0, 3000)}` : "",
      specContentStr ? `## Spec\n${specContentStr.slice(0, 2000)}` : "",
      codebaseDoc ? `## Codebase Doc (AS-IS — documentación del frontend real)\n${codebaseDoc}` : "",
    ].filter(Boolean).join("\n\n");

    const projectName = project?.name || "Proyecto";

    try {
      setUxGenerating(true);

      const skipLibraryCompose =
        isLegacyProject && !!(activeLegacyState?.codebaseDoc?.trim());
      if (!skipLibraryCompose) {
        setUxGenProgress("Aplicando referencia visual (biblioteca)…");
        const composeRes = await apiFetch(
          `${API_BASE}/projects/${projectId}/compose-ux-guide-from-ref`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        if (composeRes.ok) {
          const data = (await composeRes.json()) as {
            composed?: boolean;
            uxUiGuideContent?: string | null;
            lint?: {
              unavailable?: boolean;
              summary?: { errors?: number; warnings?: number; infos?: number };
              findings?: { severity: "error" | "warning" | "info"; path?: string; message: string }[];
            };
          };
          if (data.lint && !data.lint.unavailable) {
            const { errors = 0, warnings = 0 } = data.lint.summary ?? {};
            if (errors > 0 || warnings > 0) {
              const relevant = (data.lint.findings ?? []).filter((f) => f.severity !== "info");
              console.warn(
                `[design.md lint] ${errors} error(es), ${warnings} advertencia(s):`,
                relevant.map((f) => `${f.severity}${f.path ? ` (${f.path})` : ""}: ${f.message}`),
              );
            }
          }
          if (data.composed && data.uxUiGuideContent?.trim()) {
            const fixed = replaceYamlFrontMatter(data.uxUiGuideContent, projectName);
            setUxUiGuideContent(fixed);
            await persistUxUiGuideContent(fixed);
            setUxGenerating(false);
            setUxGenProgress(null);
            return;
          }
        }
      }

      setUxGenProgress("Generando DESIGN.md completo\u2026");

      const fullPrompt =
        `Eres un diseñador UX/UI experto. Genera el archivo DESIGN.md COMPLETO para el proyecto "${projectName}".\n\n` +
        `El DESIGN.md debe tener formato YAML front matter seguido de secciones markdown, así:\n` +
        `---\n` +
        `name: "${projectName}"\n` +
        `colors:\n` +
        `  primary: '#...'\n` +
        `  secondary: '#...'\n` +
        `  ...\n` +
        `typography:\n` +
        `  font-sans: ['...', '...']\n` +
        `  h1: { fontSize: ..., fontWeight: ..., lineHeight: ... }\n` +
        `  ...\n` +
        `rounded:\n` +
        `  none: 0px\n` +
        `  sm: 6px\n` +
        `  md: 12px\n` +
        `  lg: 20px\n` +
        `  xl: 28px\n` +
        `  full: 9999px\n` +
        `spacing:\n` +
        `  xxs: 2px\n` +
        `  xs: 4px\n` +
        `  sm: 8px\n` +
        `  md: 16px\n` +
        `  lg: 24px\n` +
        `  xl: 32px\n` +
        `  2xl: 48px\n` +
        `  3xl: 64px\n` +
        `elevation:\n` +
        `  card: { boxShadow: '...' }\n` +
        `  dropdown: { boxShadow: '...' }\n` +
        `  modal: { boxShadow: '...' }\n` +
        `  sticky: { boxShadow: '...' }\n` +
        `components:\n` +
        `  button-primary: { backgroundColor, textColor, rounded, padding, typography }\n` +
        `  button-secondary: { ... }\n` +
        `  button-ghost: { ... }\n` +
        `  button-danger: { ... }\n` +
        `  card: { ... }\n` +
        `  badge: { ... }\n` +
        `  input: { ... }\n` +
        `  modal: { ... }\n` +
        `  toast: { ... }\n` +
        `  skeleton: { ... }\n` +
        `---\n\n` +
        `Luego las secciones markdown:\n` +
        `## Overview\n## Colors\n## Typography\n## Layout & Spacing\n## Elevation Depth\n## Shapes\n## Components\n## Do's and Don'ts\n\n` +
        `Incluye criterios WCAG AA (contraste 4.5:1, touch targets 44px, navegación por teclado).\n` +
        `Usa {token.references} en las descripciones de los tokens.\n` +
        `${
          codebaseDoc
            ? "IMPORTANTE: Extrae colores, tipografía, espaciado y componentes del codebase AS-IS — el proyecto YA EXISTE y tiene un frontend real con diseño definido. Refleja los tokens reales del proyecto, no propongas un diseño nuevo.\n"
            : ""
        }` +
        `\n` +
        `Contexto del proyecto (resumen MDD en system prompt del servidor):\n${contextMd}\n\n` +
        `IMPORTANTE: Responde ÚNICAMENTE con el archivo DESIGN.md completo empezando por "---". NO agregues texto explicativo ni bloques \`\`\` alrededor.`;

      const body: Record<string, unknown> = {
        projectId,
        message: fullPrompt,
        activeTab: "ux-ui-guide",
      };

      const r = await apiFetch(`${API_BASE}/ai-orchestrator/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Error: ${r.status}`);

      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = "";
      let streamError: string | null = null;
      let doneUxUiGuideContent: string | null = null;
      if (!reader) throw new Error("No reader");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const block of parts) {
          const lines = block.split("\n");
          let eventType = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            if (line.startsWith("data:")) dataStr = line.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>;
            if (eventType === "error" && data.error) {
              streamError = String(data.error);
            } else if (eventType === "done") {
              // The "done" event carries the actual document content
              const uxVal = (data as Record<string, unknown>).uxUiGuideContent;
              if (typeof uxVal === "string" && uxVal.trim().length > 0) {
                doneUxUiGuideContent = uxVal;
              }
            } else if (data.content) {
              result += data.content;
            }
          } catch { /* ignore */ }
        }
      }

      if (streamError) {
        throw new Error(streamError);
      }

      // Prefer the document content from the "done" event (which the backend
      // extracts before the ---FIN_UX_UI--- delimiter). The chunk events only
      // carry the chat message after the delimiter.
      if (doneUxUiGuideContent) {
        // Apply replaceYamlFrontMatter in case the backend returned markdown
        // without YAML frontmatter
        if (!doneUxUiGuideContent.startsWith("---")) {
          try {
            const fixed = replaceYamlFrontMatter(doneUxUiGuideContent, projectName);
            setUxUiGuideContent(fixed);
            await persistUxUiGuideContent(fixed);
          } catch {
            setUxUiGuideContent(doneUxUiGuideContent);
            await persistUxUiGuideContent(doneUxUiGuideContent);
          }
        } else {
          setUxUiGuideContent(doneUxUiGuideContent);
          await persistUxUiGuideContent(doneUxUiGuideContent);
        }
      } else {
        const trimmed = result.trim();
        let cleaned = trimmed
          .replace(/^```(?:yaml|markdown)\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();
        // Strip ---FIN_UX_UI--- delimiter and chat message
        cleaned = cleaned.replace(/\n?-{1,}FIN_UX_UI-{1,}[\s\S]*$/i, "").trim();

        if (!cleaned || !cleaned.startsWith("---")) {
          try {
            const finalContent = replaceYamlFrontMatter(cleaned || result, projectName);
            setUxUiGuideContent(finalContent);
            await persistUxUiGuideContent(finalContent);
          } catch {
            setUxUiGuideContent(cleaned || result);
            await persistUxUiGuideContent(cleaned || result);
          }
        } else {
          setUxUiGuideContent(cleaned);
          await persistUxUiGuideContent(cleaned);
        }
      }
      setUxGenerating(false);
      setUxGenProgress(null);
    } catch (e) {
      setUxGenerating(false);
      setUxGenProgress(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error al generar design system: ${msg}`);
      console.error("Error generating UX guide:", e);
    }
  }, [
    projectId,
    project,
    projectName,
    blueprintContent,
    specContent,
    isLegacyProject,
    activeLegacyState?.codebaseDoc,
    setUxUiGuideContent,
    persistUxUiGuideContent,
    setError,
    setUxGenerating,
    setUxGenProgress,
  ]);

  /** Repara/regenera el YAML frontmatter de la guía UX/UI usando el MDD como contexto vía API.
   * Si falla la API, hace reparación local (útil con contenido pegado sin frontmatter). */
  const repairUxGuide = useCallback(async () => {
    const current = uxUiGuideContent ?? "";
    if (!projectId || !current.trim()) return;
    setUxGenerating(true);
    setUxGenProgress("Reparando YAML frontmatter…");
    try {
      const { apiFetch, API_BASE } = await import("../utils/apiClient");
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/repair-ux-ui-guide`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`Error: ${r.status}`);
      const yamlStr: string = await r.text();
      if (!yamlStr.startsWith("---")) {
        console.warn("[repairUxGuide] Response is not YAML frontmatter, falling back to local repair");
        const repaired = replaceYamlFrontMatter(current, projectName);
        if (repaired !== current) {
          await persistUxUiGuideContent(repaired);
        }
        return;
      }
      // Strip existing YAML from the current content, keep the body
      const bodyMatch = current.match(/^---[\s\S]*?\n---\n?\n?([\s\S]*)$/);
      const body = bodyMatch?.[1]?.trim() ?? current.trim();
      const newContent = yamlStr + "\n\n" + body;
      // Let persistField handle the local state update (single re-render)
      await persistUxUiGuideContent(newContent);
    } catch (e) {
      console.error("[repairUxGuide] API call failed, falling back to local repair:", e);
      // Fallback: local regex-based repair
      const repaired = replaceYamlFrontMatter(current, projectName);
      if (repaired !== current) {
        await persistUxUiGuideContent(repaired);
      }
    } finally {
      setUxGenerating(false);
      setUxGenProgress(null);
    }
  }, [projectId, uxUiGuideContent, projectName, persistUxUiGuideContent, setUxGenerating, setUxGenProgress]);

  const handleDesignRefChange = useCallback(
    async (ref: string | null) => {
      const saved = await persistUxGuideDesignRef(ref);
      if (!saved) return;
      const canRegen = !!(effectiveMddTrimmed && blueprintContent?.trim() && projectId);
      if (canRegen) {
        await generateUxGuideSequential();
      }
    },
    [
      persistUxGuideDesignRef,
      effectiveMddTrimmed,
      blueprintContent,
      projectId,
      generateUxGuideSequential,
    ],
  );

  const persistArchitectureContent = useWorkshopStore((s) => s.persistArchitectureContent);
  const persistUseCasesContent = useWorkshopStore((s) => s.persistUseCasesContent);
  const persistUserStoriesContent = useWorkshopStore((s) => s.persistUserStoriesContent);
  const generateArchitecture = useWorkshopStore((s) => s.generateArchitecture);
  const generateUseCases = useWorkshopStore((s) => s.generateUseCases);
  const generateUserStories = useWorkshopStore((s) => s.generateUserStories);
  const generateDeliverablesCascade = useWorkshopStore((s) => s.generateDeliverablesCascade);
  const reassessComplexity = useWorkshopStore((s) => s.reassessComplexity);
  const setArchitectureContent = useWorkshopStore((s) => s.setArchitectureContent);
  const setUseCasesContent = useWorkshopStore((s) => s.setUseCasesContent);
  const setUserStoriesContent = useWorkshopStore((s) => s.setUserStoriesContent);
  const [mddViewMode, setMddViewMode] = useState<"preview" | "source">("preview");
  const [benchmarkViewMode, setBenchmarkViewMode] = useState<"preview" | "source">("preview");
  const [specViewMode, setSpecViewMode] = useState<"preview" | "source">("preview");
  const [phase0SummaryViewMode, setPhase0SummaryViewMode] = useState<"preview" | "source">("preview");
  /** Última idea usada al generar benchmark; se reutiliza en Deep Research para extraer URLs del texto */
  const [lastBenchmarkIdea, setLastBenchmarkIdea] = useState("");
  /** Pestañas internas del panel benchmark: Fase 0 (DBGA) / Benchmark (Deep Research). */
  const [benchmarkPhaseTab, setBenchmarkPhaseTab] = useState<"fase0" | "benchmark">("fase0");
  /** Modo de entrada cuando Paso 0 está vacío: entrevista IA o pegar DBGA. */
  const [phase0EntryMode, setPhase0EntryMode] = useState<"interview" | "paste">("interview");
  useEffect(() => {
    if (!phase0IsEmpty) {
      setPhase0EntryMode("interview");
    }
  }, [phase0IsEmpty]);
  const [dbgaRestoreOpen, setDbgaRestoreOpen] = useState(false);
  const [blueprintViewMode, setBlueprintViewMode] = useState<"preview" | "source">("preview");
  const [apiContractsViewMode, setApiContractsViewMode] = useState<"preview" | "source">("preview");
  const [logicFlowsViewMode, setLogicFlowsViewMode] = useState<"preview" | "source">("preview");
  const [infraViewMode, setInfraViewMode] = useState<"preview" | "source">("preview");
  const [uxUiGuideViewMode, setUxUiGuideViewMode] = useState<"design" | "preview" | "source">("design");
  const [architectureViewMode, setArchitectureViewMode] = useState<"preview" | "source">("preview");
  const [useCasesViewMode, setUseCasesViewMode] = useState<"preview" | "source">("preview");
  const [userStoriesViewMode, setUserStoriesViewMode] = useState<"preview" | "source">("preview");
  const [mddInicialViewMode, setMddInicialViewMode] = useState<"preview" | "source">("preview");
  const [aemViewMode, setAemViewMode] = useState<"preview" | "source">("preview");
  const [agentGovernanceViewMode, setAgentGovernanceViewMode] = useState<"preview" | "source">("preview");
  const [tasksViewMode, setTasksViewMode] = useState<"preview" | "source">("preview");
  const [mddInicialLocalContent, setMddInicialLocalContent] = useState("");
  const [mddInicialSaving, setMddInicialSaving] = useState(false);
  const [mddInicialCopyOk, setMddInicialCopyOk] = useState(false);

  const [pluginArtifactTypes, setPluginArtifactTypes] = useState<ArtifactTypeDefinition[]>([]);
  useEffect(() => {
    const refresh = () => {
      void fetchPluginArtifacts({ force: true }).then(setPluginArtifactTypes);
    };
    refresh();
    window.addEventListener(PLUGIN_ARTIFACTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PLUGIN_ARTIFACTS_CHANGED_EVENT, refresh);
  }, []);

  /** BRD / To-Be (pestañas Workshop): borradores locales y modo preview|fuente (Grabar vía barra / aviso). */
  const brdTobeServerSnap = useRef({ stageId: "", brd: "" });
  const prevLoadingReasonRef = useRef<string | null>(null);
  const [brdWorkshopDraft, setBrdWorkshopDraft] = useState("");
  const [brdDocViewMode, setBrdDocViewMode] = useState<"preview" | "source">("preview");
  const [brdTobePersistBusy, setBrdTobePersistBusy] = useState(false);
  /** Alterna preview/source/design del panel de documento activo. */
  const toggleDocViewMode = (panel: string) => {
    if (panel === "mdd") setMddViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "mdd-inicial") setMddInicialViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "spec") setSpecViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "architecture") setArchitectureViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "use-cases") setUseCasesViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "user-stories") setUserStoriesViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "ux-ui-guide") setUxUiGuideViewMode((m) => m === "design" ? "preview" : m === "preview" ? "source" : "design");
    else if (panel === "aem") setAemViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "blueprint") setBlueprintViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "api-contracts") setApiContractsViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "logic-flows") setLogicFlowsViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "infra") setInfraViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "brd") setBrdDocViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "agent-governance") setAgentGovernanceViewMode((m) => (m === "preview" ? "source" : "preview"));
    else if (panel === "tasks") setTasksViewMode((m) => (m === "preview" ? "source" : "preview"));
  };

  const copyMddInicialMarkdown = useCallback(async () => {
    const text = (mddInicialLocalContent || activeLegacyState?.codebaseDoc || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMddInicialCopyOk(true);
      window.setTimeout(() => setMddInicialCopyOk(false), 2000);
    } catch {
      /* clipboard */
    }
  }, [mddInicialLocalContent, activeLegacyState?.codebaseDoc]);

  type DocPanel =
    | "benchmark"
    | "legacy"
    | "mdd-inicial"
    | "spec"
    | "brd"
    | "mdd"
    | "ux-ui-guide"
    | "blueprint"
    | "tasks"
    | "api-contracts"
    | "logic-flows"
    | "architecture"
    | "use-cases"
    | "user-stories"
    | "infra"
    | "aem"
    | "ui-screens"
    | "agent-governance"
    | "adrs"
    | "integration"
    | "agent-pending-changes"
    | "agent-session-log"
    | (string & {});
  const centralPanel = useWorkshopStore((s) => s.workshopActiveDocPanel) as DocPanel;
  const setCentralPanel = useWorkshopStore((s) => s.setWorkshopActiveDocPanel);

  const chatActiveTab = useMemo((): import("../components/ChatContainer").ActiveTab => {
    if (isWorkshopAgentActivityPanel(centralPanel)) return "mdd";
    const nonChatPanels = new Set([
      "integration",
      "agent-governance",
      "aem",
      "agent-pending-changes",
      "agent-session-log",
    ]);
    if (nonChatPanels.has(centralPanel)) return "mdd";
    return centralPanel as import("../components/ChatContainer").ActiveTab;
  }, [centralPanel]);

  useEffect(() => {
    const tryReconnect = () => {
      const { error: err, projectId: pid } = useWorkshopStore.getState();
      if (!pid?.trim()) return;
      if (isWorkshopConnectionError(err) || getOfflineQueue().length > 0) {
        void useWorkshopStore.getState().retryWorkshopSync();
      }
    };
    const onOnline = () => tryReconnect();
    const onVisible = () => {
      if (document.visibilityState === "visible") tryReconnect();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** En pestaña MDD legacy: regenerar siempre vía `generate-mdd` (desde codebaseDoc / etapa), nunca `generate-codebase-doc`. */
  const legacyMddNeedsCodebaseDoc = isLegacyProject && !hasCodebaseDoc;

  const handleRegenerateLegacyCodebaseDoc = useCallback(async () => {
    if (!projectId) return null;
    const res = await legacyGenerateCodebaseDoc(projectId, {
      stageId: activeStageId ?? undefined,
    });
    if (res?.codebaseDoc) {
      setMddInicialLocalContent(res.codebaseDoc);
      setCentralPanel("mdd-inicial");
    }
    return res;
  }, [
    projectId,
    legacyGenerateCodebaseDoc,
    activeStageId,
    setCentralPanel,
  ]);
  /** Por debajo de `lg`: una columna con control de Chat / Documentos / Semáforo. */
  const [mobileWorkshopColumn, setMobileWorkshopColumn] = useState<WorkshopMobileColumn>("workspace");

  useEffect(() => {
    if (ssotFrozenPanel && mobileWorkshopColumn === "chat") {
      setMobileWorkshopColumn("workspace");
    }
  }, [ssotFrozenPanel, mobileWorkshopColumn]);

  /** Tras vaciar el MDD: vista por defecto (previsualización con «Sin contenido aún.»), no el editor. */
  const handleClearMddCompletely = useCallback(async () => {
    if (!projectId?.trim()) return false;
    const ok = await clearMddContentCompletely(projectId);
    if (!ok) return false;
    setMddPatternsWizardOpen(false);
    setCentralPanel("mdd");
    setMobileWorkshopColumn("workspace");
    setMddViewMode("preview");
    requestAnimationFrame(() => {
      workspaceScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
    return true;
  }, [projectId, clearMddContentCompletely, setCentralPanel]);

  const handleClearMddDependentDeliverables = useCallback(async () => {
    if (!projectId?.trim()) return false;
    const ok = await clearMddDependentDeliverables(projectId);
    return ok;
  }, [projectId, clearMddDependentDeliverables]);

  const [isLgLayout, setIsLgLayout] = useState(() =>
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(min-width: 1024px)").matches
      : false,
  );
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  const chatSectionRef = useRef<HTMLElement>(null);
  const metricsSectionRef = useRef<HTMLElement>(null);

  const { mobileScrollFabScrollable, scrollFabDirection, getActiveScrollContainer } =
    useWorkshopMobileScrollFab({
      isLgLayout,
      mobileWorkshopColumn,
      centralPanel,
      workspaceScrollRef,
      chatSectionRef,
      metricsSectionRef,
    });

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia("(min-width: 1024px)");
    function handleMediaChange() {
      setIsLgLayout(mq.matches);
    }
    handleMediaChange();
    mq.addEventListener("change", handleMediaChange);
    return () => mq.removeEventListener("change", handleMediaChange);
  }, []);

  const [revaluateBusy, setRevaluateBusy] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [flowOrderModalOpen, setFlowOrderModalOpen] = useState(false);
  const [clarifySpecDialogOpen, setClarifySpecDialogOpen] = useState(false);
  const [aemGenerateDialogOpen, setAemGenerateDialogOpen] = useState(false);
  const [showStageModal, setShowStageModal] = useState(false);
  const initialPanelSetForProject = useRef<string | null>(null);
  /** Flujo legacy: descripción y respuestas locales antes de enviar */
  const [legacyDescriptionInput, setLegacyDescriptionInput] = useState("");
  const [legacyAnswersInput, setLegacyAnswersInput] = useState<Record<string, string>>({});
  /** Paso actual mostrado mientras corre legacy-mdd o legacy-deliverables (rota cada 6s) */
  const [legacyStepIndex, setLegacyStepIndex] = useState(0);
  useEffect(() => {
    if (!loading || (loadingReason !== "legacy-mdd" && loadingReason !== "legacy-deliverables" && loadingReason !== "legacy-codebase-doc")) {
      setLegacyStepIndex(0);
      return;
    }
    const steps =
      loadingReason === "legacy-codebase-doc"
        ? LEGACY_CODEBASE_DOC_STEPS
        : loadingReason === "legacy-mdd"
          ? LEGACY_MDD_STEPS
          : LEGACY_DELIVERABLES_STEPS;
    const id = setInterval(() => setLegacyStepIndex((i) => (i + 1) % steps.length), 6000);
    return () => clearInterval(id);
  }, [loading, loadingReason]);

  useEffect(() => {
    const codebaseDoc = activeLegacyState?.codebaseDoc ?? "";
    if (codebaseDoc) setMddInicialLocalContent(codebaseDoc);
  }, [activeLegacyState?.codebaseDoc]);

  /** Sincroniza inputs locales de Modificación al cambiar proyecto/etapa o cuando llega estado del servidor. */
  useEffect(() => {
    if (project?.projectType !== "LEGACY") {
      setLegacyDescriptionInput("");
      setLegacyAnswersInput({});
      return;
    }
    setLegacyDescriptionInput(activeLegacyState?.description ?? "");
    setLegacyAnswersInput({});
  }, [projectId, activeStageId, project?.projectType]);

  useEffect(() => {
    if (project?.projectType !== "LEGACY") return;
    const answers = activeLegacyState?.answers;
    if (!answers || Object.keys(answers).length === 0) return;
    setLegacyAnswersInput((prev) => {
      if (Object.values(prev).some((v) => v.trim())) return prev;
      const synced: Record<number, string> = {};
      for (const [k, v] of Object.entries(answers)) {
        if (typeof v === "string" && v.trim()) synced[Number(k)] = v;
      }
      return synced;
    });
    setLegacyDescriptionInput((prev) => prev.trim() || (activeLegacyState?.description ?? ""));
  }, [project?.projectType, activeLegacyState?.answers, activeLegacyState?.description]);

  const resolveLegacyAnswerValue = useCallback(
    (index: number): string => {
      const local = legacyAnswersInput[index];
      if (local !== undefined && local.trim()) return local;
      const saved = activeLegacyState?.answers?.[String(index)];
      if (typeof saved === "string" && saved.trim()) return saved;
      const suggested = activeLegacyState?.suggestedAnswers?.[String(index)]
        ?? activeLegacyState?.suggestedAnswers?.[index];
      return typeof suggested === "string" ? suggested : "";
    },
    [legacyAnswersInput, activeLegacyState?.answers, activeLegacyState?.suggestedAnswers],
  );

  const legacyAnalyzeDone = useMemo(
    () =>
      !!(
        activeLegacyState?.filesToModify?.length || activeLegacyState?.questions?.length
      ),
    [activeLegacyState?.filesToModify, activeLegacyState?.questions],
  );

  useEffect(() => {
    brdTobeServerSnap.current = { stageId: "", brd: "" };
    setBrdWorkshopDraft("");
    setBrdDocViewMode("preview");
  }, [projectId]);

  /** Sincroniza BRD draft desde el stage cuando el contenido del servidor cambia, preservando ediciones del usuario. */
  useEffect(() => {
    if (!activeWorkshopStage || activeWorkshopStage.id !== activeStageId) return;
    const id = activeWorkshopStage.id;
    const brd = activeWorkshopStage.brdContent ?? "";

    const cur = brdTobeServerSnap.current;
    if (cur.stageId !== id) {
      brdTobeServerSnap.current = { stageId: id, brd };
      setBrdWorkshopDraft(brd);
      setBrdDocViewMode("preview");
      return;
    }

    if (cur.brd !== brd) {
      setBrdWorkshopDraft((d) => (d === cur.brd ? brd : d));
      brdTobeServerSnap.current.brd = brd;
    }
  }, [
    activeStageId,
    activeWorkshopStage?.id,
    activeWorkshopStage?.brdContent,
  ]);

  /** Fuerza sincronización cuando una operación de BRD acaba de completarse (loading pasó de true a false). */
  useEffect(() => {
    const wasGeneratingBrd =
      prevLoadingReasonRef.current === "brd-from-dbga" ||
      prevLoadingReasonRef.current === "legacy-brd-suggest";
    if (!loading && wasGeneratingBrd && activeWorkshopStage) {
      setBrdWorkshopDraft(activeWorkshopStage.brdContent ?? "");
      brdTobeServerSnap.current = {
        stageId: activeWorkshopStage.id,
        brd: activeWorkshopStage.brdContent ?? "",
      };
    }
    prevLoadingReasonRef.current = loadingReason;
  }, [loading, loadingReason, activeWorkshopStage?.id, activeWorkshopStage?.brdContent]);

  const brdWorkshopDirty = useMemo(
    () => brdWorkshopDraft !== (activeWorkshopStage?.brdContent ?? ""),
    [brdWorkshopDraft, activeWorkshopStage?.brdContent],
  );
  const persistBrdWorkshopDraft = useCallback(async () => {
    if (!activeStageId || !brdWorkshopDirty) return;
    setBrdTobePersistBusy(true);
    await patchWorkshopStage(activeStageId, { brdContent: brdWorkshopDraft });
    setBrdTobePersistBusy(false);
  }, [activeStageId, brdWorkshopDirty, brdWorkshopDraft, patchWorkshopStage]);

  const handleGenerateAem = useCallback(
    async (marketScope: AemMarketScope) => {
      if (!projectId) return;
      const res = await generateAem(projectId, { marketScope });
      if (res) setAemGenerateDialogOpen(false);
    },
    [projectId, generateAem],
  );

  const {
    lgWorkshopChatCollapsed,
    lgChatPanelWidthPx,
    lgChatPanelResizing,
    handleSetLgWorkshopChatCollapsed,
    handleLgChatResizePointerDown,
    handleLgChatResizePointerMove,
    finishLgChatResizePointer,
    handleLgChatResizeLostPointerCapture,
  } = useLgChatPanel(projectId, isLgLayout);

  const handleGenerateDeliverables = useCallback(async () => {
    if (!projectId || !canGenerate || cascadeRunning) return;
    setError(null);
    if (isLegacyProject) {
      await legacyGenerateDeliverables(projectId);
      if (projectId) fetchProject(projectId);
    } else {
      await generateDeliverablesCascade(projectId);
    }
  }, [projectId, canGenerate, cascadeRunning, setError, isLegacyProject, legacyGenerateDeliverables, fetchProject, generateDeliverablesCascade]);

  /** Re-valorar complejidad: NEW → tab Paso 0 + chat benchmark; LEGACY → tab MDD (no existe DBGA). Misma API `reassess-complexity`. */
  const handleRevaluateComplexity = useCallback(async () => {
    if (!projectId || !project) return;
    setRevaluateBusy(true);
    try {
      const isLegacy = project.projectType === "LEGACY";
      if (!isLegacy) setCentralPanel("benchmark");
      else setCentralPanel("mdd");
      const updated = await reassessComplexity(projectId);
      if (updated == null) return;
      const tab = isLegacy ? "mdd" : "benchmark";
      await sendMessage(
        "Acabo de solicitar una re-valoración de complejidad sobre el alcance documentado. Conduce la entrevista: si el alcance no es claro, haz 1–2 preguntas de escala; luego propón nivel LOW/MEDIUM/HIGH y el plan de entregables, y espera mi confirmación explícita antes de asumir que quedó aplicado.",
        tab,
      );
    } finally {
      setRevaluateBusy(false);
    }
  }, [projectId, project, reassessComplexity, sendMessage]);

  const canRegenerateMddSection = useMemo(
    () =>
      canRegenerateMddSectionFromWorkshop(projectId, effectiveMddTrimmed, {
        loading,
        mddReviewing,
        mddReapplyingFormat,
        workshopAgentsBusy,
      }),
    [
      projectId,
      effectiveMddTrimmed,
      loading,
      mddReviewing,
      mddReapplyingFormat,
      workshopAgentsBusy,
    ],
  );

  const mddSectionRegenDisabledReason = useMemo(
    () =>
      mddSectionRegenDisabledTitle(projectId, effectiveMddTrimmed, {
        loading,
        mddReviewing,
        mddReapplyingFormat,
        workshopAgentsBusy,
      }),
    [
      projectId,
      effectiveMddTrimmed,
      loading,
      mddReviewing,
      mddReapplyingFormat,
      workshopAgentsBusy,
    ],
  );

  const handleRegenerateMddSectionFromQuality = useCallback(
    async (section: number, gapReasons?: string[]) => {
      if (!canRegenerateMddSection) return;
      setCentralPanel("mdd");
      setShowAuditModal(false);
      const row = MDD_QUALITY_TABLE_ROWS.find((r) => r.section === section);
      const reasonsFromAudit =
        gapReasons ??
        (row && precisionBreakdown?.sectionReasons?.[row.reasonKey]
          ? [precisionBreakdown.sectionReasons[row.reasonKey]!]
          : undefined);
      await sendMessage(buildRegenerateSectionChatMessage(section), "mdd", {
        regenerateSection: section,
        ...(reasonsFromAudit?.length ? { regenerateSectionGaps: reasonsFromAudit } : {}),
      });
    },
    [canRegenerateMddSection, setCentralPanel, sendMessage, precisionBreakdown],
  );

  const handleRegenerateMddSection5Pipeline = useCallback(async () => {
    if (!canRegenerateMddSection || !projectId?.trim()) return;
    setCentralPanel("mdd");
    const row = MDD_QUALITY_TABLE_ROWS.find((r) => r.section === 5);
    const gapReasons =
      row && precisionBreakdown?.sectionReasons?.[row.reasonKey]
        ? [precisionBreakdown.sectionReasons[row.reasonKey]!]
        : undefined;
    await regenerateMddSection5Pipeline(projectId.trim(), {
      ...(gapReasons?.length ? { gapReasons } : {}),
    });
  }, [
    canRegenerateMddSection,
    projectId,
    setCentralPanel,
    regenerateMddSection5Pipeline,
    precisionBreakdown,
  ]);

  const setProjectId = useWorkshopStore((s) => s.setProjectId);
  /* Prevent infinite fetch loop */
  const hasFetchedProject = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    if (hasFetchedProject.current === projectId) {
      // Si ya se disparó para este ID, solo aseguramos que el store lo tenga
      setProjectId(projectId);
      return;
    }
    hasFetchedProject.current = projectId;
    setProjectId(projectId);
    fetchProject(projectId);
  }, [projectId, setProjectId, fetchProject]);

  useEffect(() => {
    if (!projectId || !project || project.id !== projectId) return;
    void fetchConformance(projectId);
  }, [projectId, project?.id, fetchConformance]);

  const refreshWorkshopOnTabVisible = useWorkshopStore((s) => s.refreshWorkshopOnTabVisible);

  // Al volver de otra pestaña: sincronizar cola sin vaciar checklist ni sesión del chat.
  useEffect(() => {
    if (!projectId) return;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const store = useWorkshopStore.getState();
      if (!store.loading) return;
      void refreshWorkshopOnTabVisible(projectId);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [projectId, refreshWorkshopOnTabVisible]);

  useEffect(() => {
    if (!project || project.id !== projectId) return;
    if (initialPanelSetForProject.current === projectId) return;
    initialPanelSetForProject.current = projectId;
    if (project.projectType === "LEGACY" && !(project.mddContent ?? "").trim()) setCentralPanel("legacy");
    else if (!(project.mddContent ?? "").trim()) {
      const cx0 = project.complexity ?? "HIGH";
      if (cx0 === "MEDIUM" && project.projectType !== "LEGACY") setCentralPanel("spec");
      else setCentralPanel("mdd");
    }
  }, [project?.id, projectId, project?.mddContent, project?.projectType, project?.complexity]);

  // Legacy: no hay Paso 0; redirigir benchmark al panel de modificación
  useEffect(() => {
    if (project?.projectType === "LEGACY" && centralPanel === "benchmark") {
      setCentralPanel("legacy");
    }
  }, [project?.projectType, centralPanel]);

  /** LOW: no mostrar MDD / Blueprint / API — si el panel activo es uno oculto, ir a Spec */
  useEffect(() => {
    if (complexity !== "LOW") return;
    const hidden: DocPanel[] = ["mdd", "blueprint", "api-contracts"];
    if (hidden.includes(centralPanel)) setCentralPanel("spec");
  }, [complexity, centralPanel]);

  /** MEDIUM: barra acotada a entregables de la matriz — redirige si el panel ya no aplica */
  useEffect(() => {
    if (complexity !== "MEDIUM" || !project) return;
    if (isWorkshopAgentActivityPanel(centralPanel)) return;
    const pt = project.projectType === "LEGACY" ? "LEGACY" : "NEW";
    const tabOpts = {
      projectType: pt as "NEW" | "LEGACY",
      legacyStageOrdinal: activeWorkshopStage?.ordinal ?? 1,
    };
    if (isTabVisibleForComplexity(centralPanel as WorkshopDocTab, "MEDIUM", tabOpts)) return;
    setCentralPanel(pt === "LEGACY" ? "mdd" : "spec");
  }, [complexity, centralPanel, project?.projectType, activeWorkshopStage?.ordinal]);

  /** Etapas de modificación: MDD Inicial y BRD no aplican — redirigir a Modificación. */
  useEffect(() => {
    if (!isLegacyModificationStage) return;
    if (centralPanel === "mdd-inicial" || centralPanel === "brd") setCentralPanel("legacy");
  }, [isLegacyModificationStage, centralPanel]);

  // Legacy: si el panel activo es un documento que no tiene contenido y NO es etapa 1 (AS-IS),
  // redirigir a Modificación. En etapa 1 todos los paneles deben ser accesibles.
  useEffect(() => {
    if (project?.projectType !== "LEGACY") return;
    // Etapa 1 (ordinal 1) = AS-IS: todos los paneles accesibles con botón "Generar desde MDD Inicial"
    if (activeWorkshopStage?.ordinal === 1) return;
    const emptyLegacyPanels: DocPanel[] = [
      "spec", "architecture", "use-cases", "user-stories", "blueprint",
      "api-contracts", "logic-flows", "tasks", "agent-governance", "infra",
    ];
    if (!emptyLegacyPanels.includes(centralPanel as DocPanel)) return;
    const contentByPanel: Record<string, string | null> = {
      spec: specContent ?? null,
      architecture: architectureContent ?? null,
      "use-cases": useCasesContent ?? null,
      "user-stories": userStoriesContent ?? null,
      blueprint: blueprintContent ?? null,
      "api-contracts": apiContractsContent ?? null,
      "logic-flows": logicFlowsContent ?? null,
      tasks: tasksContent ?? null,
      "agent-governance": hasAgentGovernance ? "ok" : null,
      infra: infraContent ?? null,
    };
    const content = contentByPanel[centralPanel as string];
    if (!(content ?? "").trim()) setCentralPanel("legacy");
  }, [
    project?.projectType,
    activeWorkshopStage?.ordinal,
    centralPanel,
    specContent,
    architectureContent,
    useCasesContent,
    userStoriesContent,
    blueprintContent,
    apiContractsContent,
    logicFlowsContent,
    tasksContent,
    hasAgentGovernance,
    infraContent,
  ]);

  // ─── Auto-save hooks ────
  const { handleBlur: handleSpecBlur, isDirty: specDirty } = useAutoSaveContent(specContent, project?.specContent, persistSpecContent, projectId);
  const { handleBlur: handleAemBlur, isDirty: aemDirty } = useAutoSaveContent(aemContent, project?.aemContent, persistAemContent, projectId);
  const { handleBlur: handleArchitectureBlur, isDirty: architectureDirty } = useAutoSaveContent(architectureContent, project?.architectureContent, persistArchitectureContent, projectId);
  const { handleBlur: handleUseCasesBlur, isDirty: useCasesDirty } = useAutoSaveContent(useCasesContent, project?.useCasesContent, persistUseCasesContent, projectId);
  const { handleBlur: handleUserStoriesBlur, isDirty: userStoriesDirty } = useAutoSaveContent(userStoriesContent, project?.userStoriesContent, persistUserStoriesContent, projectId);
  const { handleBlur: handleBlueprintBlur, isDirty: blueprintDirty } = useAutoSaveContent(blueprintContent, project?.blueprintContent, persistBlueprintContent, projectId);
  const { handleBlur: handleApiContractsBlur, isDirty: apiContractsDirty } = useAutoSaveContent(apiContractsContent, project?.apiContractsContent, persistApiContractsContent, projectId);
  const { handleBlur: handleLogicFlowsBlur, isDirty: logicFlowsDirty } = useAutoSaveContent(logicFlowsContent, project?.logicFlowsContent, persistLogicFlowsContent, projectId);
  const { handleBlur: handleInfraBlur, isDirty: infraDirty } = useAutoSaveContent(infraContent, project?.infraContent, persistInfraContent, projectId);
  const { handleBlur: handleTasksBlur, isDirty: tasksDirty } = useAutoSaveContent(tasksContent, project?.tasksContent, persistTasksContent, projectId);
  const { handleBlur: handleBenchmarkBlur } = useAutoSaveContent(dbgaContent, project?.dbgaContent, persistDbgaContent, projectId);
  const { handleBlur: handlePhase0SummaryBlur } = useAutoSaveContent(phase0SummaryContent, project?.phase0SummaryContent, persistPhase0SummaryContent, projectId);

  // ux-ui-guide auto-save (YAML frontmatter solo en blur; en debounce no mutar el editor)
  useEffect(() => {
    if (!projectId || !project || (uxUiGuideContent ?? "") === (project.uxUiGuideContent ?? "")) return;
    const t = setTimeout(() => persistUxUiGuideContent(uxUiGuideContent ?? ""), 1500);
    return () => clearTimeout(t);
  }, [uxUiGuideContent, projectId, project?.uxUiGuideContent, project, persistUxUiGuideContent]);

  // ux-ui-guide blur (special: replaceYamlFrontMatter)
  const handleUxUiGuideBlur = useCallback(() => {
    if (uxUiGuideContent != null) {
      const content = replaceYamlFrontMatter(uxUiGuideContent, projectName);
      if (content !== uxUiGuideContent) setUxUiGuideContent(content);
      persistUxUiGuideContent(content);
    }
  }, [uxUiGuideContent, persistUxUiGuideContent, projectName]);

  /** Prints the visible document (.design-system-preview or .markdown-preview). */
  const handlePrintDocument = useCallback(() => {
    const useDesignSystemPrint =
      centralPanel === "ux-ui-guide" && uxUiGuideViewMode === "design";

    if (useDesignSystemPrint) {
      const designPreview = document.querySelector<HTMLElement>(
        "[data-design-system-print-root].design-system-preview, .design-system-preview",
      );
      if (!designPreview) return;
      printDesignSystemDocument(designPreview);
      return;
    }

    const mdPreview = document.querySelector<HTMLElement>(".markdown-preview");
    if (!mdPreview) return;

    const docTitle =
      centralPanel === "mdd"
        ? "Master Design Document"
        : centralPanel === "brd"
          ? "Business Requirements Document"
          : "Documento";
    printMarkdownDocument(mdPreview, { title: docTitle });
  }, [centralPanel, uxUiGuideViewMode]);

  const handlePhase0Complete = useCallback(async () => {
    const store = useWorkshopStore.getState();
    const dbga = (store.dbgaContent ?? store.project?.dbgaContent ?? "").trim();
    if (!dbga) {
      const res = await apiFetch(`${API_BASE}/ai-analysis/phase0/sync-markdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { markdown?: string | null };
        if (data.markdown?.trim()) {
          store.setDbgaContent(data.markdown.trim());
        }
      }
    }
    await store.fetchProject(projectId);
  }, [projectId]);

  const { workshopDocToolbarProps, phase0EntryModeToolbarToggle } = useWorkshopDocToolbarProps({
    centralPanel,
    effectiveComplexityForTabs: effectiveComplexityForTabs as WorkshopComplexityTier,
    isLegacyProject,
    benchmarkPhaseTab,
    phase0IsEmpty,
    phase0EntryMode,
    setPhase0EntryMode,
    mddViewMode,
    mddInicialViewMode,
    specViewMode,
    architectureViewMode,
    useCasesViewMode,
    userStoriesViewMode,
    uxUiGuideViewMode,
    aemViewMode,
    blueprintViewMode,
    apiContractsViewMode,
    logicFlowsViewMode,
    brdDocViewMode,
    infraViewMode,
    agentGovernanceViewMode,
    tasksViewMode,
    blueprintContent,
    tasksContent,
    hasAgentGovernance,
    apiContractsContent,
    architectureContent,
    useCasesContent,
    userStoriesContent,
    logicFlowsContent,
    infraContent,
    activeLegacyState,
    mddInicialLocalContent,
    activeStageId,
    specContent,
    aemContent,
    uxUiGuideContent,
    activeStageShortTermContext: activeWorkshopStage?.shortTermContext ?? null,
    loading,
    projectId,
    loadingReason,
    effectiveMddTrimmed,
    mddReviewing,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    mddInicialSaving,
    brdWorkshopDirty,
    brdTobePersistBusy,
    canGenerateAem,
    tasksPrerequisites,
    agentGovernanceGenerating,
    uxGenerating,
    uxGenProgress,
    benchmarkViewMode,
    phase0SummaryViewMode,
    isLgLayout,
    lgWorkshopChatCollapsed,
    deliverablesReadOnly,
    toggleDocViewMode,
    setFlowOrderModalOpen,
    setClarifySpecDialogOpen,
    setDbgaRestoreOpen,
    handlePrintDocument,
    setBenchmarkViewMode,
    setPhase0SummaryViewMode,
    generateArchitecture,
    generateUseCases,
    generateUserStories,
    generateBlueprint,
    generateApiContracts,
    generateLogicFlows,
    generateInfra,
    handleRegenerateLegacyCodebaseDoc,
    setMddInicialSaving,
    legacyUpdateCodebaseDoc,
    persistBrdWorkshopDraft,
    generateSpec,
    setAemGenerateDialogOpen,
    generateTasks,
    convergeTasks,
    setError,
    tasksToIssues,
    generateAgentGovernance,
    repairUxGuide,
    generateUxGuideSequential,
    handleSetLgWorkshopChatCollapsed,
  });

  const docBubbleMenuItems = useWorkshopDocBubbleMenuItems({
    centralPanel,
    benchmarkPhaseTab,
    dbgaContent,
    phase0SummaryContent,
    specContent,
    mddContent,
    mddInicialLocalContent,
    activeLegacyState,
    brdWorkshopDraft,
    uxUiGuideContent,
    blueprintContent,
    apiContractsContent,
    logicFlowsContent,
    tasksContent,
    infraContent,
    architectureContent,
    useCasesContent,
    userStoriesContent,
    aemContent,
    effectiveMddTrimmed,
    loading,
    projectId,
    mddReviewing,
    mddReapplyingFormat,
    patternsWizardAnalyzing,
    requestGenerateMdd,
    openSuggestMddPatterns,
    openEditMddPatterns,
    reapplyMddFormat,
    handleRegenerateLegacyCodebaseDoc,
    setClarifySpecDialogOpen,
    isGenerationGateBlocked,
    generateSpec,
    generateArchitecture,
    generateUseCases,
    generateUserStories,
    generateBlueprint,
    generateApiContracts,
    generateLogicFlows,
    generateInfra,
    generateTasks,
    tasksPrerequisites,
    hasAgentGovernance,
    generateAgentGovernance,
    canGenerateAem,
    setAemGenerateDialogOpen,
    uxGenProgress,
    uxGenerating,
    generateUxGuideSequential,
    agentGovernanceScaffold,
    activeStageId,
    handleClearMddCompletely,
    clearWorkshopDocumentContent,
    effectiveComplexityForTabs: effectiveComplexityForTabs as WorkshopComplexityTier,
    setFlowOrderModalOpen,
    projectName,
    project,
    handlePrintDocument,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    deliverablesReadOnly,
  });

  const workshopDocumentsForZip = useMemo(
    (): DocumentsForZip => ({
      dbgaContent: dbgaContent ?? project?.dbgaContent ?? null,
      phase0SummaryContent: phase0SummaryContent ?? project?.phase0SummaryContent ?? null,
      specContent: specContent ?? project?.specContent ?? null,
      mddContent: mddContent ?? project?.mddContent ?? "",
      uxUiGuideContent: uxUiGuideContent ?? project?.uxUiGuideContent ?? null,
      uiScreensContent: uiScreensContent ?? project?.uiScreensContent ?? null,
      blueprintContent: blueprintContent ?? project?.blueprintContent ?? null,
      apiContractsContent: apiContractsContent ?? project?.apiContractsContent ?? null,
      logicFlowsContent: logicFlowsContent ?? project?.logicFlowsContent ?? null,
      tasksContent: tasksContent ?? project?.tasksContent ?? null,
      infraContent: infraContent ?? project?.infraContent ?? null,
      aemContent: aemContent ?? project?.aemContent ?? null,
      
    }),
    [
      dbgaContent,
      project?.dbgaContent,
      phase0SummaryContent,
      project?.phase0SummaryContent,
      specContent,
      project?.specContent,
      mddContent,
      project?.mddContent,
      uxUiGuideContent,
      project?.uxUiGuideContent,
      uiScreensContent,
      project?.uiScreensContent,
      blueprintContent,
      project?.blueprintContent,
      apiContractsContent,
      project?.apiContractsContent,
      logicFlowsContent,
      project?.logicFlowsContent,
      tasksContent,
      project?.tasksContent,
      infraContent,
      project?.infraContent,
      aemContent,
      project?.aemContent,
    ],
  );

  const workshopSpecKitInput = useMemo(
    () => {
      const name = projectName ?? project?.name ?? "Workshop";
      if (!effectiveMddTrimmed && !mddContent?.trim()) return null;
      return {
        projectName: name,
        featureOrdinal: activeWorkshopStage?.ordinal ?? 1,
        mddContent: effectiveMddTrimmed || mddContent || "",
        specContent: specContent ?? project?.specContent,
        blueprintContent: blueprintContent ?? project?.blueprintContent,
        tasksContent: tasksContent ?? project?.tasksContent,
        apiContractsContent: apiContractsContent ?? project?.apiContractsContent,
        logicFlowsContent: logicFlowsContent ?? project?.logicFlowsContent,
        infraContent: infraContent ?? project?.infraContent,
        phase0SummaryContent: phase0SummaryContent ?? project?.phase0SummaryContent,
        dbgaContent: dbgaContent ?? project?.dbgaContent,
        uxUiGuideContent: uxUiGuideContent ?? project?.uxUiGuideContent,
        uiScreensContent: uiScreensContent ?? project?.uiScreensContent,
      };
    },
    [
      projectName,
      project?.name,
      effectiveMddTrimmed,
      mddContent,
      activeWorkshopStage?.ordinal,
      specContent,
      project?.specContent,
      blueprintContent,
      project?.blueprintContent,
      tasksContent,
      project?.tasksContent,
      apiContractsContent,
      project?.apiContractsContent,
      logicFlowsContent,
      project?.logicFlowsContent,
      infraContent,
      project?.infraContent,
      phase0SummaryContent,
      project?.phase0SummaryContent,
      dbgaContent,
      project?.dbgaContent,
      uxUiGuideContent,
      project?.uxUiGuideContent,
      uiScreensContent,
      project?.uiScreensContent,
    ],
  );

  const handleDownloadProjectZip = useCallback(async () => {
    const name = projectName ?? project?.name ?? "Workshop";
    try {
      const result = await downloadWorkshopProjectZip({
        projectId,
        projectName: name,
        hasAgentGovernance,
        documents: workshopDocumentsForZip,
        governanceScaffold: agentGovernanceScaffold,
        fetchGovernanceExport: fetchAgentGovernanceExport,
        specKitInput: hasAgentGovernance ? workshopSpecKitInput : null,
      });

      if (result.ok) {
        setError(null);
        return;
      }

      setError(
        result.error ??
          (hasAgentGovernance
            ? "No se pudo exportar el ZIP handoff (spec-kit + gobernanza)."
            : "No hay documentos con contenido para descargar."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el ZIP de descarga.");
    }
  }, [
    projectId,
    projectName,
    project?.name,
    hasAgentGovernance,
    workshopDocumentsForZip,
    agentGovernanceScaffold,
    fetchAgentGovernanceExport,
    workshopSpecKitInput,
    setError,
  ]);

  const handleExportSdd = useCallback(async () => {
    if (!projectId || !workshopSpecKitInput) return;
    const name = projectName ?? project?.name ?? "Workshop";
    try {
      const apiResult = await downloadSpecKitBundleFromApi(projectId, name);
      if (apiResult.ok) {
        setError(null);
        return;
      }

      const localOk = await downloadSpecKitBundle(workshopSpecKitInput, name);
      if (localOk) {
        setError(null);
        return;
      }

      setError(apiResult.error ?? "No hay contenido MDD para exportar bundle SDD.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar bundle SDD.");
    }
  }, [projectId, projectName, project?.name, workshopSpecKitInput, setError]);

  const workshopModalsProps = useWorkshopModalsProps({
    projectId,
    isLegacyProject,
    onOpenSettings,
    workshopStagesList,
    activeStageId,
    createWorkshopStage,
    fetchProject,
    showStageModal,
    setShowStageModal,
    showHelpModal,
    setShowHelpModal,
    flowOrderModalOpen,
    setFlowOrderModalOpen,
    dbgaRestoreOpen,
    setDbgaRestoreOpen,
    modelsUnavailableModalOpen,
    setModelsUnavailableModalOpen,
    showAuditModal,
    setShowAuditModal,
    liveMetrics,
    documentCompleteness,
    consistencyScore,
    precisionBreakdown,
    mddReadinessHints,
    traceabilityHints,
    crossDocumentGaps,
    auditTrail,
    effectiveMddTrimmed,
    canRegenerateMddSection,
    mddSectionRegenDisabledReason,
    handleRegenerateMddSectionFromQuality,
    reapplyMddFormat,
    clearMddConfirmOpen,
    setClearMddConfirmOpen,
    handleClearMddCompletely,
    clearMddDeliverablesConfirmOpen,
    setClearMddDeliverablesConfirmOpen,
    handleClearMddDependentDeliverables,
    mddPatternsWizardOpen,
    setMddPatternsWizardOpen,
    mddPatternsWizardMode,
    patternsWizardPreselected,
    patternsWizardAnalyzing,
    patternsAnalyzeRationale,
    loading,
    loadingReason,
    mddReviewing,
    handleMddPatternsWizardConfirm,
    mddRegenerateDialogOpen,
    setMddRegenerateDialogOpen,
    generationStatus,
    mddRegenerateInitialMode,
    handleMddRegenerateFull,
    handleMddRegenerateSync,
    patternCompatOpen,
    setPatternCompatOpen: handlePatternCompatOpenChange,
    patternCompatCorrections,
    patternCompatConfirmLabel,
    patternCompatLoading,
    executePendingMddAfterPatternCompat,
    aemGenerateDialogOpen,
    setAemGenerateDialogOpen,
    handleGenerateAem,
    error,
  });

  const workshopDocPanelContentProps = useWorkshopDocPanelProps({
    centralPanel,
    projectId,
    projectName,
    mergeAudit,
    project,
    activeWorkshopStage,
    effectiveMddTrimmed,
    loading,
    loadingReason,
    mddReviewing,
    canGenerateFromCodebase,
    activeStageId,
    deliverablesReadOnly,
    tasksPrerequisites,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    docTs,
    buildDocClarification,
    legacyGenerateFromCodebaseDoc,
    architectureContent,
    setArchitectureContent,
    persistArchitectureContent,
    architectureDirty,
    architectureViewMode,
    generateArchitecture,
    handleArchitectureBlur,
    useCasesContent,
    setUseCasesContent,
    persistUseCasesContent,
    useCasesDirty,
    useCasesViewMode,
    generateUseCases,
    handleUseCasesBlur,
    userStoriesContent,
    setUserStoriesContent,
    persistUserStoriesContent,
    userStoriesDirty,
    userStoriesViewMode,
    generateUserStories,
    handleUserStoriesBlur,
    blueprintContent,
    setBlueprintContent,
    persistBlueprintContent,
    blueprintDirty,
    blueprintViewMode,
    generateBlueprint,
    handleBlueprintBlur,
    tasksContent,
    setTasksContent,
    persistTasksContent,
    tasksDirty,
    tasksViewMode,
    generateTasks,
    handleTasksBlur,
    apiContractsContent,
    setApiContractsContent,
    persistApiContractsContent,
    apiContractsDirty,
    apiContractsViewMode,
    generateApiContracts,
    handleApiContractsBlur,
    logicFlowsContent,
    setLogicFlowsContent,
    persistLogicFlowsContent,
    logicFlowsDirty,
    logicFlowsViewMode,
    generateLogicFlows,
    handleLogicFlowsBlur,
    infraContent,
    setInfraContent,
    persistInfraContent,
    infraDirty,
    infraViewMode,
    generateInfra,
    handleInfraBlur,
    activeLegacyState,
    isStage1Legacy,
    error,
    legacyStepIndex,
    mddInicialLocalContent,
    mddInicialViewMode,
    mddInicialCopyOk,
    legacyMcpDebugTrace,
    legacyDescriptionInput,
    legacyAnswersInput,
    legacyHandoffGatePending,
    legacyHandoffGateBlocked,
    legacyChangeGateBlocked,
    legacyGenerateBlocked,
    handoffGateStrict,
    legacyAnalyzeDone,
    workshopStagesList,
    copyMddInicialMarkdown,
    setMddInicialLocalContent,
    setLegacyDescriptionInput,
    setLegacyAnswersInput,
    handleHandoffGateStrictChange,
    resolveLegacyAnswerValue,
    setCentralPanel,
    fetchProject,
    legacyUpdateCodebaseDoc,
    legacySuggestBrdFromCodebaseDoc,
    setBrdWorkshopDraft,
    legacyGenerateMdd,
    legacyGenerateDeliverables,
    legacyGenerateCodebaseDoc,
    legacyStart,
    legacyAnswer,
    dbgaContent,
    specContent,
    fase0Content,
    phase0IsEmpty,
    phase0EntryMode,
    benchmarkPhaseTab,
    benchmarkViewMode,
    phase0SummaryViewMode,
    benchmarkMarkdown,
    benchmarkNeedsRegenerate,
    phase0SummaryContent,
    lastBenchmarkIdea,
    setBenchmarkPhaseTab,
    handlePhase0Complete,
    setDbgaRestoreOpen,
    setDbgaContent,
    setPhase0SummaryContent,
    handleBenchmarkBlur,
    handlePhase0SummaryBlur,
    suggestBrdFromDbga,
    clearDbgaContent,
    clearPhase0SummaryContent,
    phase0DeepResearch,
    mddContent,
    mddViewMode,
    mddDirty,
    mddPersisting,
    mddReapplyingFormat,
    mddJustGeneratedFromBenchmark,
    notice,
    isLegacyProject,
    legacyMddNeedsCodebaseDoc,
    patternsWizardAnalyzing,
    canGenerate,
    cascadeRunning,
    cascadeCompleted,
    cascadeTotal,
    cascadePostPassRunning,
    isGenerationGateBlocked,
    clearMddJustGeneratedFromBenchmark,
    requestGenerateMdd,
    reapplyMddFormat,
    canRegenerateMddSection,
    mddSectionRegenDisabledReason,
    onRegenerateMddSection: handleRegenerateMddSectionFromQuality,
    onRegenerateMddSection5Pipeline: handleRegenerateMddSection5Pipeline,
    openSuggestMddPatterns,
    openEditMddPatterns,
    setClearMddConfirmOpen,
    setClearMddDeliverablesConfirmOpen,
    handleGenerateDeliverables,
    setMddContent,
    revertMddContent,
    persistAndReviewMdd,
    aemContent,
    uiScreensContent,
    brdWorkshopDraft,
    brdDocViewMode,
    specViewMode,
    aemViewMode,
    specDirty,
    aemDirty,
    brdWorkshopDirty,
    brdTobePersistBusy,
    canGenerateAem,
    clarifySpecDialogOpen,
    stageDeliverableView,
    setSpecContent,
    setAemContent,
    setClarifySpecDialogOpen,
    persistSpecContent,
    persistAemContent,
    persistBrdWorkshopDraft,
    generateSpec,
    setAemGenerateDialogOpen,
    syncUiScreens,
    handleSpecBlur,
    handleAemBlur,
    agentGovernanceContent,
    agentGovernanceViewMode,
    agentGovernanceExportScaffold: null,
    agentGovernanceExportLoading: false,
    agentGovernanceGenerating,
    hasAgentGovernance,
    documentationGapsRefreshNonce,
    generateAgentGovernance,
    uxUiGuideContent,
    uxUiGuideViewMode,
    uxGenerating,
    setUxUiGuideContent,
    persistUxUiGuideContent,
    generateUxGuideSequential,
    handleDesignRefChange,
    handleUxUiGuideBlur,
    adrs,
    pluginArtifactTypes,
    fetchAdrs,
  });

  if (error && !project) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))] mb-4">{error}</p>
          {onBack && (
            <button
              type="button"
              onClick={() => {
                if (!workshopAgentsBusy) onBack();
              }}
              disabled={workshopAgentsBusy}
              title={workshopAgentsBusy ? WORKSHOP_EXIT_BLOCKED_TITLE : undefined}
              className={cn(
                "text-[var(--primary)] hover:underline",
                workshopAgentsBusy && "cursor-not-allowed opacity-45 no-underline hover:no-underline",
              )}
            >
              Volver
            </button>
          )}
        </div>
      </div>
    );
  }

  if (projectId && !project) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--primary)]" />
        <p className="text-[var(--muted-foreground)]">Cargando proyecto…</p>
        {onBack && (
          <button
            type="button"
            onClick={() => {
              if (!workshopAgentsBusy) onBack();
            }}
            disabled={workshopAgentsBusy}
            title={workshopAgentsBusy ? WORKSHOP_EXIT_BLOCKED_TITLE : undefined}
            className={cn(
              "text-[var(--primary)] hover:underline text-sm",
              workshopAgentsBusy && "cursor-not-allowed opacity-45 no-underline hover:no-underline",
            )}
          >
            Volver
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-workshop-root
      className="workshop-root flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] antialiased"
    >
      <WorkshopHeaderBar
        projectName={projectName}
        project={project}
        onRenameProject={onRenameProject}
        connectionError={connectionError}
        error={error}
        synced={synced}
        onRetrySync={() => { void retryWorkshopSync(); }}
        workshopStagesList={workshopStagesList}
        activeStageId={activeStageId}
        onActiveStageChange={setActiveStageId}
        stageDeliverableView={stageDeliverableView}
        onNewStage={() => setShowStageModal(true)}
        hasAgentGovernance={hasAgentGovernance}
        onDownloadZip={handleDownloadProjectZip}
        exportSddDisabled={!effectiveMddTrimmed || !projectId}
        onExportSdd={handleExportSdd}
        onOpenHelp={() => setShowHelpModal(true)}
      />

      {(backgroundBannerLabel || cascadeRunning || mddBackgroundJob) && (
        <div className="shrink-0 border-b border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,transparent)] px-4 py-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm text-[color-mix(in_oklch,var(--primary)_80%,white)]">
                {backgroundBannerLabel ??
                  (loadingReason === "mdd-section"
                    ? "Regeneración de sección MDD en curso…"
                    : loadingReason === "legacy-mdd" || loadingReason === "mdd"
                      ? "Regeneración MDD en curso…"
                      : "Generación en curso…")}
              </p>
              {activeMddJob ? (
                <p className="text-xs text-[color-mix(in_oklch,var(--primary)_65%,white)]">
                  Job {activeMddJob.jobId.slice(0, 8)}… · {MDD_JOB_MODE_LABELS[activeMddJob.mode]} ·{" "}
                  {activeMddJob.status === "queued" ? "en cola" : "en ejecución"}
                  {activeMddJob.progressMessage ? ` · ${activeMddJob.progressMessage}` : ""}
                </p>
              ) : activeDeliverablesJob ? (
                <p className="text-xs text-[color-mix(in_oklch,var(--primary)_65%,white)]">
                  Job {activeDeliverablesJob.jobId.slice(0, 8)}… · {activeDeliverablesJob.type} ·{" "}
                  {activeDeliverablesJob.status === "queued" ? "en cola" : "en ejecución"}
                </p>
              ) : activeDeliverablesJobId ? (
                <p className="text-xs text-[color-mix(in_oklch,var(--primary)_65%,white)]">
                  Job {activeDeliverablesJobId.slice(0, 8)}… · en ejecución
                </p>
              ) : null}
              {(generationStatus?.mddJobs?.length ?? 0) > 1 ? (
                <p className="text-xs text-[color-mix(in_oklch,var(--primary)_55%,white)]">
                  {generationStatus!.mddJobs.length} jobs MDD registrados (cola in-memory o BullMQ).
                </p>
              ) : null}
            </div>
            {(agentProgress.length > 0 ||
              (cascadeRunning &&
                (loadingReason === "deliverables-cascade" ||
                  loadingReason === "legacy-deliverables" ||
                  loadingReason === "repair-sdd-gaps"))) && (
              <WorkshopAgentProgressPanel
                title={
                  loadingReason === "repair-sdd-gaps"
                    ? "Corrigiendo brechas SDD…"
                    : "Generando entregables…"
                }
                loading={cascadeRunning}
                className="mt-2 w-full max-w-xl"
              />
            )}
            {cancellableJobId && projectId ? (
              <button
                type="button"
                disabled={cancellingJob}
                onClick={() => {
                  setCancellingJob(true);
                  const action = cancellableJobIsMdd
                    ? cancelMddJob(projectId, cancellableJobId)
                    : cancelDeliverablesJob(projectId, cancellableJobId);
                  void action.finally(() => setCancellingJob(false));
                }}
                className="shrink-0 rounded-md border border-[color-mix(in_oklch,var(--destructive)_45%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,transparent)] px-2.5 py-1 text-xs font-medium text-[color-mix(in_oklch,var(--destructive)_75%,white)] hover:bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] disabled:opacity-50"
              >
                {cancellingJob ? (
                  <>
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
                    Cancelando…
                  </>
                ) : (
                  "Cancelar generación"
                )}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {(bannerError || bannerNotice) && (
        <div
          className={cn(
            "shrink-0 px-4 py-2 border-b flex items-center justify-between gap-2",
            bannerNotice && !bannerError
              ? "bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] border-[color-mix(in_oklch,var(--warning)_35%,var(--border))]"
              : "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))]",
          )}
        >
          <p
            className={cn(
              "text-sm",
              bannerNotice && !bannerError
                ? "text-[color-mix(in_oklch,var(--warning)_75%,white)]"
                : "text-[color-mix(in_oklch,var(--destructive)_65%,white)]",
            )}
          >
            {bannerError ?? bannerNotice}
          </p>
          <button
            type="button"
            onClick={() => {
              if (bannerError) setError(null);
              if (bannerNotice) setNotice(null);
              if (isSsotPatternsNotice(error)) setError(null);
            }}
            className={cn(
              "hover:text-[var(--foreground)] text-xs",
              bannerNotice && !bannerError
                ? "text-[color-mix(in_oklch,var(--warning)_85%,white)]"
                : "text-[color-mix(in_oklch,var(--destructive)_75%,white)]",
            )}
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="shrink-0">
        <AIProviderBanner onOpenSettings={onOpenSettings} />
        <ComplexityPendingBanner />
        {!isLegacyProject ? (
          <MddUpstreamSyncBanner
            syncStatus={generationStatus?.mddUpstreamSync}
            generationStatus={generationStatus}
            disabled={loading || generationStatus?.busy === true}
            onOpenSyncDialog={openMddSyncDialog}
          />
        ) : null}
      </div>

      <WorkshopLayoutShell
        chatColumn={
          ssotFrozenPanel ? null : (
          <WorkshopChatColumn
            mobileWorkshopColumn={mobileWorkshopColumn}
            isLgLayout={isLgLayout}
            lgWorkshopChatCollapsed={lgWorkshopChatCollapsed}
            lgChatPanelWidthPx={lgChatPanelWidthPx}
            lgChatPanelResizing={lgChatPanelResizing}
            chatSectionRef={chatSectionRef}
            onExpandChat={() => handleSetLgWorkshopChatCollapsed(false)}
            onResizePointerDown={handleLgChatResizePointerDown}
            onResizePointerMove={handleLgChatResizePointerMove}
            onResizePointerUp={finishLgChatResizePointer}
            onResizeLostPointerCapture={handleLgChatResizeLostPointerCapture}
          >
              <ChatContainer
                projectId={projectId}
                activeTab={chatActiveTab}
                embedded={false}
                onOpenSettings={onOpenSettings}
                onRevaluate={project ? handleRevaluateComplexity : undefined}
                revaluateBusy={revaluateBusy}
                benchmarkMode={
                  centralPanel === "benchmark"
                    ? {
                      hasBenchmark: !!dbgaContent?.trim(),
                      onGenerateBenchmark: (idea) => {
                        setLastBenchmarkIdea(idea);
                        generateBenchmark(projectId, idea);
                      },
                    }
                    : undefined
                }
              />
          </WorkshopChatColumn>
          )
        }
        docPanel={
          <WorkshopDocPanel
            mobileWorkshopColumn={mobileWorkshopColumn}
            workspaceScrollRef={workspaceScrollRef}
            toolbarProps={workshopDocToolbarProps}
            isLgLayout={isLgLayout}
            docBubbleMenuItems={docBubbleMenuItems}
          >
            <WorkshopDocPanelContent {...workshopDocPanelContentProps} />
          </WorkshopDocPanel>
        }
        metricsColumn={
          <WorkshopMetricsColumn
            projectId={projectId}
            mobileWorkshopColumn={mobileWorkshopColumn}
            isLgLayout={isLgLayout}
            metricsSectionRef={metricsSectionRef}
            onOpenAuditModal={() => {
              setShowAuditModal(true);
              if (projectId?.trim()) {
                void useWorkshopStore.getState().fetchEstimation(projectId.trim());
              }
            }}
          />
        }
        mobileOverlays={
          <>
            <WorkshopMobileFabs
              mobileWorkshopColumn={mobileWorkshopColumn}
              centralPanel={centralPanel}
              effectiveComplexityForTabs={effectiveComplexityForTabs as WorkshopComplexityTier}
              viewModes={{
                mddViewMode,
                mddInicialViewMode,
                specViewMode,
                architectureViewMode,
                useCasesViewMode,
                userStoriesViewMode,
                uxUiGuideViewMode,
                aemViewMode,
                blueprintViewMode,
                apiContractsViewMode,
                logicFlowsViewMode,
                brdDocViewMode,
                infraViewMode,
                agentGovernanceViewMode,
                tasksViewMode,
              }}
              blueprintContent={blueprintContent}
              tasksContent={tasksContent}
              apiContractsContent={apiContractsContent}
              architectureContent={architectureContent}
              useCasesContent={useCasesContent}
              userStoriesContent={userStoriesContent}
              logicFlowsContent={logicFlowsContent}
              infraContent={infraContent}
              activeLegacyState={activeLegacyState}
              mddInicialLocalContent={mddInicialLocalContent}
              activeStageId={activeStageId}
              benchmarkPhaseTab={benchmarkPhaseTab}
              benchmarkViewMode={benchmarkViewMode}
              phase0SummaryViewMode={phase0SummaryViewMode}
              phase0EntryModeToolbarToggle={phase0EntryModeToolbarToggle}
              mobileScrollFabScrollable={mobileScrollFabScrollable}
              scrollFabDirection={scrollFabDirection}
              onScrollFabClick={() => {
                const container = getActiveScrollContainer();
                if (!container) return;
                if (scrollFabDirection === "down") {
                  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
                } else {
                  container.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              onToggleDocViewMode={toggleDocViewMode}
              onOpenFlowOrderModal={() => setFlowOrderModalOpen(true)}
              onBenchmarkViewModeChange={(mode) => setBenchmarkViewMode(mode)}
              onPhase0SummaryViewModeChange={(mode) => setPhase0SummaryViewMode(mode)}
            />
            <WorkshopDocumentIslandToc
              scrollContainerRef={workspaceScrollRef}
              enabled={
                isLgLayout &&
                isWorkshopMarkdownPreviewActive(
                  centralPanel,
                  {
                    mddViewMode,
                    mddInicialViewMode,
                    specViewMode,
                    architectureViewMode,
                    useCasesViewMode,
                    userStoriesViewMode,
                    uxUiGuideViewMode,
                    aemViewMode,
                    blueprintViewMode,
                    apiContractsViewMode,
                    logicFlowsViewMode,
                    brdDocViewMode,
                    infraViewMode,
                    agentGovernanceViewMode,
                    tasksViewMode,
                  },
                  benchmarkPhaseTab,
                  benchmarkViewMode,
                  phase0SummaryViewMode,
                )
              }
              centralPanel={centralPanel}
              contentKey={centralPanel}
            />
          </>
        }
        mobileNav={
          <WorkshopMobileNav
            mobileWorkshopColumn={mobileWorkshopColumn}
            onMobileWorkshopColumnChange={setMobileWorkshopColumn}
            hideChat={ssotFrozenPanel}
          />
        }
        modals={
          <WorkshopModals {...workshopModalsProps} />
        }
      />
    </div >
  );
}
