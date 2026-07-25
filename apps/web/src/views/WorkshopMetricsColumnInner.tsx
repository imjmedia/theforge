/**
 * @fileoverview Semáforo, conformidad, estimación y CTA de cascada (columna derecha del workshop).
 */
import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  FileText,
  FolderGit2,
  Lock,
  Loader2,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveWorkshopSemaphoreStatus, isWorkshopSemaphoreGreen } from "@/utils/workshopSemaphoreStatus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui";
import { LlevarAlRepoWizardDialog } from "@/components/LlevarAlRepoWizardDialog";
import { TraceabilityGapList } from "@/components/TraceabilityGapList";
import { AnalyzeDashboard } from "@/components/AnalyzeDashboard";
import { TokenUsageCard } from "@/components/TokenUsageCard";
import type { SddAnalyzeReport, MddDeliveryGateResult } from "@theforge/shared-types";
import { agentGovernanceScaffoldHasContent, SDD_GRAPH_SYNC_STATE_LABELS } from "@theforge/shared-types";
import { useWorkshopStore, type Status } from "../store/workshopStore";
import { calculateCostFromMdd } from "../utils/costCalculator";
import { apiFetch, API_BASE } from "@/utils/apiClient";

/** Flat cards: border + bg only — avoids muddy stacked shadows next to the metrics flyout in light mode */
const WORKSHOP_METRICS_CARD =
  "rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_78%,var(--background))]";

const WORKSHOP_METRICS_BADGE_OK =
  "inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--success)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[color-mix(in_oklch,var(--success)_90%,var(--foreground))]";

const WORKSHOP_METRICS_BADGE_WARN =
  "inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]";

const WORKSHOP_METRICS_BADGE_ERR =
  "inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[color-mix(in_oklch,var(--destructive)_90%,var(--foreground))]";

/** Umbrales alineados con backend. */
const SEMAPHORE_PRECISION_RED_MAX = 85;
const WORKSHOP_DELIVERY_ROLE_ORDER: readonly string[] = [
  "architect",
  "techLead",
  "pm",
  "security",
  "back",
  "front",
  "ux",
  "qa",
  "devops",
];

const WORKSHOP_DELIVERY_ROLE_LABELS: Record<string, string> = {
  architect: "Arquitectura",
  techLead: "Tech lead",
  pm: "PM / delivery",
  security: "Seguridad",
  back: "Backend",
  front: "Frontend",
  ux: "UX / UI",
  qa: "QA",
  devops: "DevOps",
};

function formatWorkshopDeliveryRoleLabel(roleKey: string): string {
  const k = roleKey.trim();
  if (WORKSHOP_DELIVERY_ROLE_LABELS[k]) return WORKSHOP_DELIVERY_ROLE_LABELS[k];
  return k.length > 0 ? `${k.charAt(0).toUpperCase()}${k.slice(1)}` : k;
}

function sortWorkshopDeliveryRoleEntries(entries: [string, number][]): [string, number][] {
  const order = new Map(WORKSHOP_DELIVERY_ROLE_ORDER.map((key, index) => [key, index]));
  return entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => {
      const ia = order.get(a[0]) ?? 999;
      const ib = order.get(b[0]) ?? 999;
      if (ia !== ib) return ia - ib;
      return a[0].localeCompare(b[0]);
    });
}

function formatDeliveryGateBlockersHint(gate: MddDeliveryGateResult, maxItems = 2): string {
  const items = gate.blockers.slice(0, maxItems);
  const suffix = gate.blockers.length > items.length ? ` (+${gate.blockers.length - items.length} más)` : "";
  return `${items.join(" · ")}${suffix}`;
}

export interface WorkshopMetricsColumnInnerProps {
  projectId: string;
  conformanceUseLlm: boolean;
  onConformanceUseLlmChange: (next: boolean) => void;
  onOpenAuditModal: () => void;
  /**
   * `flyout`: responsive two-column grid (status + conformance vs estimation + actions)
   * so the hover panel stays shorter and scrolls less. `embedded`: single column (mobile rail).
   */
  layout?: "embedded" | "flyout";
}

export function WorkshopMetricsColumnInner({
  projectId,
  conformanceUseLlm,
  onConformanceUseLlmChange,
  onOpenAuditModal,
  layout = "embedded",
}: WorkshopMetricsColumnInnerProps) {
  const project = useWorkshopStore((s) => s.project);
  const liveMetrics = useWorkshopStore((s) => s.liveMetrics);
  const planValidation = useWorkshopStore((s) => s.planValidation);
  const validateChangePlan = useWorkshopStore((s) => s.validateChangePlan);
  const deliveryGateStore = useWorkshopStore((s) => s.deliveryGate);
  const deliveryGate = deliveryGateStore ?? liveMetrics?.deliveryGate ?? null;
  const deliveryGateOk = deliveryGate == null || deliveryGate.ok;
  const mddContent = useWorkshopStore((s) => s.mddContent);
  const infraContentField = useWorkshopStore((s) => s.infraContent);
  const specContentField = useWorkshopStore((s) => s.specContent);
  const dbgaContentField = useWorkshopStore((s) => s.dbgaContent);
  const specContent = specContentField ?? project?.specContent ?? null;
  const dbgaContent = dbgaContentField ?? project?.dbgaContent ?? null;
  const showIaCost = useMemo(() => localStorage.getItem("theforge_show_ia_cost") !== "0", []);
  const effectiveMddTrimmed = useMemo(
    () => (mddContent ?? "").trim() || (project?.mddContent ?? "").trim(),
    [mddContent, project?.mddContent],
  );
  const projectStatus: Status = project?.status ?? "ROJO";
  const semaphoreGreen = isWorkshopSemaphoreGreen(liveMetrics, projectStatus);
  const hasSpec = (specContent ?? "").trim().length > 0;
  const complexity = project?.complexity ?? "HIGH";
  const isLegacyProject = project?.projectType === "LEGACY";
  const activeStageId = useWorkshopStore((s) => s.activeStageId);
  const workshopStages = useWorkshopStore((s) => s.workshopStages);
  const workshopStagesList = workshopStages.length > 0 ? workshopStages : (project?.stages ?? []);
  const activeWorkshopStage = useMemo(
    () => workshopStagesList.find((s) => s.id === activeStageId),
    [workshopStagesList, activeStageId],
  );
  const activeLegacyState = useMemo(() => {
    if (project?.projectType !== "LEGACY") return null;
    return activeWorkshopStage?.legacyChangeState ?? null;
  }, [project?.projectType, activeWorkshopStage?.legacyChangeState]);

  const lastLegacyDebug = useWorkshopStore((s) => s.lastLegacyDeliverablesDebug);
  const logicFlowsDocField = useWorkshopStore((s) => s.logicFlowsContent);
  const logicFlowsDoc = (logicFlowsDocField ?? project?.logicFlowsContent ?? "").trim();
  const agentGovernanceField = useWorkshopStore((s) => s.agentGovernanceContent);
  const hasAgentGovernance = agentGovernanceScaffoldHasContent(
    agentGovernanceField ?? project?.agentGovernanceContent ?? null,
  );
  const [repoWizardOpen, setRepoWizardOpen] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeReport, setAnalyzeReport] = useState<SddAnalyzeReport | null>(null);
  const [gapConfirmOpen, setGapConfirmOpen] = useState(false);
  const [gapConfirmPendingCount, setGapConfirmPendingCount] = useState(0);

  const isLegacyBaselineStage = useMemo(() => {
    if (!isLegacyProject) return false;
    if (lastLegacyDebug?.legacyBaselineStage != null) return lastLegacyDebug.legacyBaselineStage;
    return (activeWorkshopStage?.ordinal ?? 1) === 1;
  }, [isLegacyProject, lastLegacyDebug?.legacyBaselineStage, activeWorkshopStage?.ordinal]);

  const logicFlowsS5Coverage = lastLegacyDebug?.logicFlowsSection5Coverage;
  const logicFlowsCoverageGateActive = useMemo(() => {
    if (!isLegacyProject || !isLegacyBaselineStage) return false;
    if (!logicFlowsS5Coverage || logicFlowsDoc.length < 48) return false;
    return !logicFlowsS5Coverage.metTarget;
  }, [isLegacyProject, isLegacyBaselineStage, logicFlowsS5Coverage, logicFlowsDoc]);

  const canGenerate = useMemo(() => {
    if (isLegacyProject) {
      const hasMdd = effectiveMddTrimmed.length > 0;
      const hasCodebaseDoc = (activeLegacyState?.codebaseDoc ?? "").trim().length > 0;
      return hasMdd || hasCodebaseDoc;
    }
    if (complexity === "LOW" || complexity === "MEDIUM") {
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

  const conformanceRaw = useWorkshopStore((s) => s.conformance);
  const readinessAudit = useWorkshopStore((s) => s.readinessAudit);
  const conformance = useMemo(() => conformanceRaw, [conformanceRaw]);
  const documentCompleteness = useWorkshopStore((s) => s.documentCompleteness);
  const consistencyScore = useWorkshopStore((s) => s.consistencyScore);
  const crossDocumentGaps = useWorkshopStore((s) => s.crossDocumentGaps);
  const sddAuditSummary = useMemo(() => {
    const gapTotal = readinessAudit?.gapSummary.total ?? 0;
    const crossDoc = crossDocumentGaps?.length ?? 0;
    const derivadosIssue =
      !!conformance &&
      (!conformance.blueprint.ok ||
        conformance.blueprintDataModel?.ok === false ||
        !conformance.api.ok ||
        !conformance.logicFlows.ok ||
        !conformance.infra.ok);
    return {
      gapTotal,
      crossDoc,
      derivadosIssue,
      hasIssues: gapTotal > 0 || crossDoc > 0 || derivadosIssue,
    };
  }, [readinessAudit, crossDocumentGaps, conformance]);
  const apiBlueprintDmBlocked = conformance?.blueprintDataModel?.ok === false;
  const apiBlueprintBlockedHint =
    "El Blueprint no cubre el §3 Modelo de datos del MDD. Corrige o regenera el Blueprint; revisa Auditoría SDD.";

  const auditorFeedback = useWorkshopStore((s) => s.auditorFeedback);
  const auditFeedbackStatusLabel = useMemo(() => {
    const st = liveMetrics?.status;
    return st === "green" ? "Verde" : st === "yellow" ? "Amarillo" : "Rojo";
  }, [liveMetrics?.status]);

  const loading = useWorkshopStore((s) => s.loading);
  const loadingReason = useWorkshopStore((s) => s.loadingReason);
  const generationStatus = useWorkshopStore((s) => s.generationStatus);
  const sddGraph = generationStatus?.sddGraph ?? null;
  const mddReviewing = useWorkshopStore((s) => s.mddReviewing);
  const cascadeRunning = loading && (loadingReason === "deliverables-cascade" || loadingReason === "legacy-deliverables");
  const repairSddRunning = loading && loadingReason === "repair-sdd-gaps";
  const brechasBusy = cascadeRunning || repairSddRunning || mddReviewing;
  const setError = useWorkshopStore((s) => s.setError);
  const fetchProject = useWorkshopStore((s) => s.fetchProject);

  const cascadeCtaHint = useMemo(() => {
    if (cascadeRunning) return "Generación de entregables en curso…";
    if (mddReviewing) return "Revisión o grabado del MDD en curso; espera a que termine.";
    if (logicFlowsCoverageGateActive && logicFlowsS5Coverage) {
      return `Flujos legacy: cobertura §5 ${logicFlowsS5Coverage.coveragePercent}% (objetivo ${logicFlowsS5Coverage.targetPercent}%). Regenera flujos o la cascada legacy.`;
    }
    if (canGenerate) return null;
    if (!deliveryGateOk && deliveryGate) {
      if (deliveryGate.blockers.length > 0) {
        return `Gate de entrega MDD (${deliveryGate.score}/100): ${formatDeliveryGateBlockersHint(deliveryGate)}`;
      }
      return `Gate de entrega MDD (${deliveryGate.score}/100): corrige advertencias antes de generar entregables.`;
    }
    if (
      isLegacyProject &&
      effectiveMddTrimmed.length === 0 &&
      !(activeLegacyState?.codebaseDoc ?? "").trim()
    ) {
      return "Añade MDD o la documentación de partida (Modificación / MDD Inicial) para habilitar la cascada.";
    }
    if (!semaphoreGreen) {
      return "El semáforo debe estar en verde: revisa el MDD y la conformidad en los bloques de arriba.";
    }
    if (!hasSpec) {
      return "Genera y guarda el Spec en su pestaña; es requisito cuando aplica esta regla.";
    }
    return "Aún no se cumplen las condiciones para generar entregables en cascada.";
  }, [
    cascadeRunning,
    mddReviewing,
    canGenerate,
    logicFlowsCoverageGateActive,
    logicFlowsS5Coverage,
    isLegacyProject,
    effectiveMddTrimmed,
    activeLegacyState?.codebaseDoc,
    semaphoreGreen,
    hasSpec,
    deliveryGateOk,
    deliveryGate,
  ]);

  const generateBlueprint = useWorkshopStore((s) => s.generateBlueprint);
  const generateApiContracts = useWorkshopStore((s) => s.generateApiContracts);
  const generateLogicFlows = useWorkshopStore((s) => s.generateLogicFlows);
  const generateInfra = useWorkshopStore((s) => s.generateInfra);
  const legacyGenerateDeliverables = useWorkshopStore((s) => s.legacyGenerateDeliverables);
  const generateDeliverablesCascade = useWorkshopStore((s) => s.generateDeliverablesCascade);
  const repairSddGaps = useWorkshopStore((s) => s.repairSddGaps);
  const setWorkshopActiveDocPanel = useWorkshopStore((s) => s.setWorkshopActiveDocPanel);

  const mddEmpty = !((mddContent ?? "").trim() || (project?.mddContent ?? "").trim());
  const precisionScore = mddEmpty ? 0 : (liveMetrics?.precision ?? project?.precisionScore ?? 0);
  const infraContent = infraContentField ?? project?.infraContent ?? null;
  const costDisplayFallback = calculateCostFromMdd(mddContent, {
    status: projectStatus,
    infraContent: project?.infraContent ?? infraContent,
  });
  const costDisplay = mddEmpty
    ? {
        totalMxn: costDisplayFallback.totalMxn,
        totalMxnMarket: costDisplayFallback.totalMxn,
        totalMxnIA: 0,
        totalHours: costDisplayFallback.totalHours,
        teamStructure: costDisplayFallback.teamStructure,
        rolesHours: { architect: 0, back: 0, front: 0 } as Record<string, number>,
      }
    : liveMetrics
      ? {
          totalMxn: liveMetrics.totalMXN,
          totalMxnMarket: liveMetrics.totalMXNMarket,
          totalMxnIA: liveMetrics.totalMXNIA ?? 0,
          totalHours: liveMetrics.totalHours,
          teamStructure: liveMetrics.roles as Record<string, number>,
          rolesHours: liveMetrics.rolesHours as Record<string, number>,
        }
      : {
          ...costDisplayFallback,
          totalMxnMarket: costDisplayFallback.totalMxn,
          totalMxnIA: 0,
          rolesHours: {} as Record<string, number>,
        };

  const deliveryRoleRows = useMemo(
    () =>
      costDisplay.teamStructure && Object.keys(costDisplay.teamStructure).length > 0
        ? sortWorkshopDeliveryRoleEntries(Object.entries(costDisplay.teamStructure))
        : [],
    [costDisplay.teamStructure],
  );

  const canGenerateDeliverables = useMemo(() => {
    if (isLegacyProject) return canGenerate;
    return canGenerate;
  }, [isLegacyProject, canGenerate]);

  const hasKnownGenerationGaps = useMemo(() => {
    const deliveryGateIssue = !deliveryGateOk && deliveryGate != null;
    const conformanceIssues = Boolean(
      conformance &&
        (!conformance.blueprint.ok ||
          !conformance.blueprintDataModel.ok ||
          !conformance.api.ok ||
          !conformance.logicFlows.ok ||
          !conformance.infra.ok),
    );
    const crossDoc = (crossDocumentGaps?.length ?? 0) > 0;
    return deliveryGateIssue || conformanceIssues || crossDoc;
  }, [deliveryGateOk, deliveryGate, conformance, crossDocumentGaps]);

  const effectiveStatus = mddEmpty
    ? "red"
    : deliveryGate && !deliveryGate.ok
      ? deliveryGate.blockers.length > 0
        ? "red"
        : "yellow"
      : liveMetrics?.status ?? resolveWorkshopSemaphoreStatus(null, projectStatus);
  const statusDiffersByDeliveryGate =
    deliveryGate != null &&
    !deliveryGate.ok &&
    liveMetrics?.status != null &&
    effectiveStatus !== liveMetrics.status;
  const precisionFormulaBreakdown = useMemo(() => {
    const docsScore = liveMetrics?.completeness?.overall ?? documentCompleteness?.overall;
    const traceScore = liveMetrics?.consistencyScore ?? consistencyScore;
    const mddScore = liveMetrics?.mddQualityScore;
    if (docsScore == null && traceScore == null && mddScore == null) return null;
    return {
      docs: docsScore,
      trace: traceScore,
      mdd: mddScore,
    };
  }, [liveMetrics, documentCompleteness, consistencyScore]);
  const semaphoreConfig =
    effectiveStatus === "red"
      ? {
          icon: Lock,
          color: "text-[color-mix(in_oklch,var(--destructive)_92%,var(--foreground))]",
          borderAccent: "border-l-4 border-l-[color-mix(in_oklch,var(--destructive)_62%,var(--border))]",
          tint: "bg-[color-mix(in_oklch,var(--destructive)_7%,var(--card))]",
          label: "Bloqueado",
        }
      : effectiveStatus === "yellow"
        ? {
            icon: AlertTriangle,
            color: "text-[color-mix(in_oklch,var(--warning)_92%,var(--foreground))]",
            borderAccent: "border-l-4 border-l-[color-mix(in_oklch,var(--warning)_55%,var(--border))]",
            tint: "bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))]",
            label: "Advertencia",
          }
        : {
            icon: CheckCircle2,
            color: "text-[color-mix(in_oklch,var(--success)_92%,var(--foreground))]",
            borderAccent: "border-l-4 border-l-[color-mix(in_oklch,var(--success)_50%,var(--border))]",
            tint: "bg-[color-mix(in_oklch,var(--success)_8%,var(--card))]",
            label: "Listo",
          };

  const SemaphoreIcon = semaphoreConfig.icon;

  const sddGraphBadgeClass =
    sddGraph?.state === "synced"
      ? WORKSHOP_METRICS_BADGE_OK
      : sddGraph?.state === "empty" || sddGraph?.state === "unavailable"
        ? "inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklch,var(--muted)_28%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[color-mix(in_oklch,var(--muted-foreground)_92%,var(--foreground))]"
        : WORKSHOP_METRICS_BADGE_WARN;

  const handleGenerateDeliverables = useCallback(async () => {
    if (!projectId || !canGenerateDeliverables || cascadeRunning) return;
    setError(null);
    if (isLegacyProject) {
      await legacyGenerateDeliverables(projectId);
      if (projectId) fetchProject(projectId);
      return;
    }

    let pendingCount = 0;
    if (activeStageId) {
      try {
        const r = await apiFetch(
          `${API_BASE}/projects/${projectId}/stages/${activeStageId}/documentation-gaps?status=pending`,
        );
        if (r.ok) {
          const data = (await r.json()) as { gaps?: unknown[] };
          pendingCount = data.gaps?.length ?? 0;
        }
      } catch {
        /* confirmación opcional */
      }
    }

    if (hasKnownGenerationGaps || pendingCount > 0) {
      setGapConfirmPendingCount(pendingCount);
      setGapConfirmOpen(true);
      return;
    }

    await generateDeliverablesCascade(projectId);
  }, [
    projectId,
    canGenerateDeliverables,
    cascadeRunning,
    setError,
    isLegacyProject,
    legacyGenerateDeliverables,
    fetchProject,
    generateDeliverablesCascade,
    activeStageId,
    hasKnownGenerationGaps,
  ]);

  const handleConfirmGenerateWithGaps = useCallback(async () => {
    if (!projectId) return;
    setGapConfirmOpen(false);
    await generateDeliverablesCascade(projectId, { acknowledgeGaps: true });
  }, [projectId, generateDeliverablesCascade]);

  return (
    <div
      className={cn(
        layout === "flyout"
          ? "grid w-full min-w-0 grid-cols-2 items-start gap-4 sm:gap-5"
          : "contents",
      )}
    >
      <div
        className={cn(
          layout === "flyout" ? "flex min-w-0 flex-col gap-3" : "contents",
        )}
      >
          <div className="shrink-0 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-[var(--foreground)]">
              <Package className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
              Semáforo
            </h3>
            <p
              className="line-clamp-2 text-[11px] text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]"
              title="Consistencia del MDD frente a entregables y reglas del taller. Condiciona la generación en cascada."
            >
              Consistencia del MDD frente a entregables y reglas del taller. Condiciona la generación en cascada.
            </p>
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={cn(
                WORKSHOP_METRICS_CARD,
                semaphoreConfig.borderAccent,
                semaphoreConfig.tint,
                "flex items-center gap-2.5 p-2.5",
              )}
            >
              <SemaphoreIcon
                className={`h-8 w-8 shrink-0 ${semaphoreConfig.color}`}
                aria-hidden
              />
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold leading-tight", semaphoreConfig.color)}>
                  {semaphoreConfig.label}
                </p>
                <p className="text-[11px] text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                  Precisión {precisionScore}%
                  {deliveryGate ? ` · Gate ${deliveryGate.score}/100` : ""}
                </p>
                {precisionFormulaBreakdown ? (
                  <p className="text-[10px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_92%,var(--foreground))]">
                    {[
                      precisionFormulaBreakdown.docs != null
                        ? `Docs ${precisionFormulaBreakdown.docs}%`
                        : null,
                      precisionFormulaBreakdown.trace != null
                        ? `BRD→MDD ${precisionFormulaBreakdown.trace}%`
                        : null,
                      precisionFormulaBreakdown.mdd != null
                        ? `MDD ${precisionFormulaBreakdown.mdd}%`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {statusDiffersByDeliveryGate ? (
                  <p className="text-[10px] leading-snug text-[color-mix(in_oklch,var(--destructive)_82%,var(--foreground))]">
                    Bloqueado por gate de entrega
                  </p>
                ) : effectiveStatus === "red" && precisionScore < SEMAPHORE_PRECISION_RED_MAX ? (
                  <p className="text-[10px] leading-snug text-[color-mix(in_oklch,var(--destructive)_82%,var(--foreground))]">
                    Precisión &lt; {SEMAPHORE_PRECISION_RED_MAX}%
                  </p>
                ) : null}
              </div>
            </div>
            {sddGraph ? (
              <div
                role="status"
                className={cn(
                  WORKSHOP_METRICS_CARD,
                  sddGraph.state === "synced"
                    ? "border-l-4 border-l-[color-mix(in_oklch,var(--success)_50%,var(--border))] bg-[color-mix(in_oklch,var(--success)_6%,var(--card))]"
                    : sddGraph.state === "stale"
                      ? "border-l-4 border-l-[color-mix(in_oklch,var(--warning)_55%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))]"
                      : "p-2.5",
                  "space-y-1 p-2.5",
                )}
                title={sddGraph.message}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[var(--foreground)]">Grafo SDD</p>
                  <span className={sddGraphBadgeClass}>
                    {SDD_GRAPH_SYNC_STATE_LABELS[sddGraph.state]}
                  </span>
                </div>
                <p className="text-[10px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                  {sddGraph.message}
                </p>
                {sddGraph.expectedEntities > 0 || sddGraph.expectedEndpoints > 0 ? (
                  <p className="text-[10px] tabular-nums text-[color-mix(in_oklch,var(--muted-foreground)_92%,var(--foreground))]">
                    §3: {sddGraph.entityCount}/{sddGraph.expectedEntities} tablas · §4:{" "}
                    {sddGraph.endpointCount}/{sddGraph.expectedEndpoints} endpoints
                    {sddGraph.orphanEntityCount + sddGraph.orphanEndpointCount > 0
                      ? ` · ${sddGraph.orphanEntityCount + sddGraph.orphanEndpointCount} huérfano(s)`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            {deliveryGate && !deliveryGate.ok ? (
              <div
                role="status"
                className={cn(
                  WORKSHOP_METRICS_CARD,
                  deliveryGate.blockers.length > 0
                    ? "border-l-4 border-l-[color-mix(in_oklch,var(--destructive)_62%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_7%,var(--card))]"
                    : "border-l-4 border-l-[color-mix(in_oklch,var(--warning)_55%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))]",
                  "space-y-1.5 p-2.5",
                )}
              >
                <p className="text-[11px] font-semibold text-[var(--foreground)]">
                  Gate de entrega MDD — {deliveryGate.ok ? "aprobado" : "bloqueado"}
                </p>
                {deliveryGate.blockers.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]">
                    {deliveryGate.blockers.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {deliveryGate.blockers.length > 4 ? (
                      <li className="list-none pl-0 text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                        +{deliveryGate.blockers.length - 4} bloqueo(s) más
                      </li>
                    ) : null}
                  </ul>
                ) : null}
                {deliveryGate.warnings.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-[color-mix(in_oklch,var(--warning)_88%,var(--foreground))]">
                    {deliveryGate.warnings.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenAuditModal()}
              className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_48%,transparent)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--muted)_50%,var(--card))] lg:w-auto lg:justify-start"
            >
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              Ver logs y desglose
            </button>
          </div>

          {conformance && (
            <div className="min-w-0 space-y-2">
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-[var(--foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
                  <span className="min-w-0 truncate">Auditoría SDD</span>
                </h3>
                <p className="text-[10px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                  {[
                    readinessAudit
                      ? `${readinessAudit.gapSummary.total} brecha(s) · ${readinessAudit.gapSummary.auto} auto · ${readinessAudit.gapSummary.llm} LLM · ${readinessAudit.gapSummary.human} humano`
                      : null,
                    consistencyScore != null ? `Trazabilidad ${consistencyScore}%` : null,
                    sddAuditSummary.hasIssues ? "Revisar derivados y MDD" : "Sin brechas críticas detectadas",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {readinessAudit?.compositeReadiness?.reasons?.length ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[10px] text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                    {readinessAudit.compositeReadiness.reasons.slice(0, 3).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {logicFlowsCoverageGateActive && logicFlowsS5Coverage ? (
                  <div
                    role="status"
                    className="rounded-lg border border-[color-mix(in_oklch,var(--warning)_45%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_10%,var(--card))] px-2.5 py-2 text-[11px] leading-snug text-[color-mix(in_oklch,var(--warning)_88%,var(--foreground))]"
                  >
                    <div className="flex gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <p>
                        <span className="font-semibold">Legacy etapa 1 — flujos vs §5:</span>{" "}
                        {logicFlowsS5Coverage.coveragePercent}% documentado (objetivo{" "}
                        {logicFlowsS5Coverage.targetPercent}%). Pendientes:{" "}
                        {logicFlowsS5Coverage.missingServices.length} servicios. Regenera con la cascada
                        legacy o «Regenerar Flujos» (AS-IS por lotes).
                      </p>
                    </div>
                  </div>
                ) : null}
                <label
                  htmlFor="workshop-conformance-use-llm"
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_55%,var(--background))] px-2 py-1.5 text-[11px] font-medium text-[var(--foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_35%,var(--card))] focus-within:ring-2 focus-within:ring-[var(--ring)] focus-within:ring-offset-1 focus-within:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]"
                >
                  <input
                    id="workshop-conformance-use-llm"
                    type="checkbox"
                    checked={conformanceUseLlm}
                    onChange={(e) => {
                      onConformanceUseLlmChange(e.target.checked);
                    }}
                    className="h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] bg-[var(--background)] text-[var(--primary)] accent-[var(--primary)] focus:outline-none"
                  />
                  <span className="min-w-0 leading-tight">
                    Opinión IA adicional (no cambia badges)
                    <span className="mt-0.5 block font-normal text-[color-mix(in_oklch,var(--muted-foreground)_98%,var(--foreground))]">
                      Los badges usan chequeo determinista MDD↔derivados; la IA añade contexto opcional.
                    </span>
                  </span>
                </label>
              </div>
              <div className={cn(WORKSHOP_METRICS_CARD, "divide-y divide-[color-mix(in_oklch,var(--border)_90%,transparent)] p-0")}>
                {conformance.blueprint.ok ? (
                  <div
                    className="flex flex-col gap-1 px-2 py-1.5"
                    title={undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Blueprint</span>
                      <span className={WORKSHOP_METRICS_BADGE_OK}>Cumple</span>
                    </div>
                  </div>
                ) : (
                  <details className="group min-w-0">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Blueprint</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {conformance.blueprint.gaps.length > 0 ? (
                          <span
                            className="hidden max-w-[9rem] truncate text-[10px] font-normal text-[var(--muted-foreground)] group-open:hidden sm:inline"
                            aria-hidden
                          >
                            {conformance.blueprint.gaps.length}{" "}
                            {conformance.blueprint.gaps.length === 1 ? "hallazgo" : "hallazgos"}
                          </span>
                        ) : null}
                        <span className={WORKSHOP_METRICS_BADGE_WARN}>Gaps</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        />
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--background)_30%,transparent)] px-2 pb-2 pt-1.5">
                      <p className="text-[11px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                        {conformance.blueprint.gaps.join("; ")}
                      </p>
                      {conformance.blueprint.gaps.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            generateBlueprint(projectId!, { gapsFeedback: conformance!.blueprint.gaps.join("\n") })
                          }
                          disabled={loading || mddReviewing}
                          className="self-start text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Regenerar Blueprint con gaps
                        </button>
                      ) : null}
                    </div>
                  </details>
                )}
                {conformance.blueprintDataModel?.ok !== false ? (
                  <div
                    className="flex flex-col gap-1 px-2 py-1.5"
                    title="Alineado con Blueprint; puedes generar Contratos de API."
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Modelo §3</span>
                      <span className={WORKSHOP_METRICS_BADGE_OK}>Cumple</span>
                    </div>
                  </div>
                ) : (
                  <details className="group min-w-0">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Modelo §3</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {(conformance.blueprintDataModel?.gaps?.length ?? 0) > 0 ? (
                          <span
                            className="hidden max-w-[9rem] truncate text-[10px] font-normal text-[var(--muted-foreground)] group-open:hidden sm:inline"
                            aria-hidden
                          >
                            {conformance.blueprintDataModel?.gaps?.length}{" "}
                            {(conformance.blueprintDataModel?.gaps?.length ?? 0) === 1 ? "hallazgo" : "hallazgos"}
                          </span>
                        ) : null}
                        <span className={WORKSHOP_METRICS_BADGE_ERR}>Bloquea API</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        />
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--background)_30%,transparent)] px-2 pb-2 pt-1.5">
                      <p className="text-[11px] leading-snug text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]">
                        {(conformance.blueprintDataModel?.gaps ?? []).join("; ")}
                      </p>
                      {(conformance.blueprintDataModel?.gaps?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            generateBlueprint(projectId!, {
                              gapsFeedback: conformance!.blueprintDataModel!.gaps.join("\n"),
                            })
                          }
                          disabled={loading || mddReviewing}
                          className="self-start text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Regenerar Blueprint (gaps §3)
                        </button>
                      ) : null}
                    </div>
                  </details>
                )}
                {conformance.api.ok ? (
                  <div className="flex flex-col gap-1 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">API</span>
                      <span className={WORKSHOP_METRICS_BADGE_OK}>Cumple</span>
                    </div>
                  </div>
                ) : (
                  <details className="group min-w-0">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">API</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span
                          className="hidden max-w-[11rem] truncate text-right text-[10px] font-normal leading-tight text-[var(--muted-foreground)] group-open:hidden sm:inline"
                          aria-hidden
                        >
                          {conformance.api.missingInApi.length > 0
                            ? `${conformance.api.missingInApi.length} sin documentar${
                                conformance.api.extraInApi.length > 0
                                  ? ` · ${conformance.api.extraInApi.length} extra`
                                  : ""
                              }`
                            : conformance.api.extraInApi.length > 0
                              ? `${conformance.api.extraInApi.length} en doc. a contrastar`
                              : "Ver detalle"}
                        </span>
                        <span className={WORKSHOP_METRICS_BADGE_WARN}>Revisar</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        />
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--background)_30%,transparent)] px-2 pb-2 pt-1.5">
                      {conformance.api.missingInApi.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                            Rutas del MDD sin ver en el documento de API
                          </p>
                          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-[var(--border)]/80 bg-[color-mix(in_oklch,var(--card)_55%,var(--background))] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))] [scrollbar-gutter:stable]">
                            {conformance.api.missingInApi.map((ep) => (
                              <li key={ep} className="break-all">
                                {ep}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-[11px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                          Revisa la alineación entre el MDD y el contrato de API.
                        </p>
                      )}
                      {conformance.api.extraInApi.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                            En el doc. de API pero no referenciadas igual en el chequeo
                          </p>
                          <ul className="max-h-24 space-y-0.5 overflow-y-auto rounded-md border border-[var(--border)]/80 bg-[color-mix(in_oklch,var(--card)_55%,var(--background))] px-2 py-1.5 font-mono text-[10px] leading-relaxed [scrollbar-gutter:stable]">
                            {conformance.api.extraInApi.map((ep) => (
                              <li key={ep} className="break-all">
                                {ep}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {(conformance.api.missingInApi.length > 0 || conformance.api.extraInApi.length > 0) && (
                        <button
                          type="button"
                          onClick={() =>
                            generateApiContracts(projectId!, {
                              gapsFeedback: [...conformance!.api.missingInApi, ...conformance!.api.extraInApi].join("\n"),
                            })
                          }
                          disabled={loading || mddReviewing || apiBlueprintDmBlocked}
                          title={apiBlueprintDmBlocked ? apiBlueprintBlockedHint : undefined}
                          className="self-start text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Regenerar API con gaps
                        </button>
                      )}
                    </div>
                  </details>
                )}
                {conformance.logicFlows.ok ? (
                  <div className="flex flex-col gap-1 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Flujos</span>
                      {logicFlowsCoverageGateActive && logicFlowsS5Coverage ? (
                        <span className={WORKSHOP_METRICS_BADGE_WARN}>
                          §5 {logicFlowsS5Coverage.coveragePercent}%
                        </span>
                      ) : (
                        <span className={WORKSHOP_METRICS_BADGE_OK}>Cumple</span>
                      )}
                    </div>
                    {isLegacyBaselineStage && logicFlowsS5Coverage && logicFlowsDoc.length >= 48 ? (
                      <p className="text-[10px] leading-snug text-[var(--muted-foreground)]">
                        Cobertura §5: {logicFlowsS5Coverage.coveredServices}/{logicFlowsS5Coverage.totalServices}{" "}
                        servicios ({logicFlowsS5Coverage.coveragePercent}% / objetivo{" "}
                        {logicFlowsS5Coverage.targetPercent}%)
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <details className="group min-w-0">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Flujos</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {conformance.logicFlows.gaps.length > 0 ? (
                          <span
                            className="hidden max-w-[9rem] truncate text-[10px] font-normal text-[var(--muted-foreground)] group-open:hidden sm:inline"
                            aria-hidden
                          >
                            {conformance.logicFlows.gaps.length}{" "}
                            {conformance.logicFlows.gaps.length === 1 ? "hallazgo" : "hallazgos"}
                          </span>
                        ) : null}
                        <span className={WORKSHOP_METRICS_BADGE_WARN}>Gaps</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        />
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--background)_30%,transparent)] px-2 pb-2 pt-1.5">
                      <p className="text-[11px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                        {conformance.logicFlows.gaps.join("; ")}
                      </p>
                      {conformance.logicFlows.gaps.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => generateLogicFlows(projectId!, { gapsFeedback: conformance!.logicFlows.gaps.join("\n") })}
                          disabled={loading || mddReviewing}
                          title={
                            isLegacyBaselineStage
                              ? "Etapa 1 AS-IS: lotes §5 + re-pase de cobertura cuando aplica"
                              : undefined
                          }
                          className="self-start text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Regenerar Flujos con gaps
                        </button>
                      ) : null}
                    </div>
                  </details>
                )}
                {conformance.infra.ok ? (
                  <div className="flex flex-col gap-1 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Infra</span>
                      <span className={WORKSHOP_METRICS_BADGE_OK}>Cumple</span>
                    </div>
                  </div>
                ) : (
                  <details className="group min-w-0">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))]">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">Infra</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {conformance.infra.gaps.length > 0 ? (
                          <span
                            className="hidden max-w-[9rem] truncate text-[10px] font-normal text-[var(--muted-foreground)] group-open:hidden sm:inline"
                            aria-hidden
                          >
                            {conformance.infra.gaps.length}{" "}
                            {conformance.infra.gaps.length === 1 ? "hallazgo" : "hallazgos"}
                          </span>
                        ) : null}
                        <span className={WORKSHOP_METRICS_BADGE_WARN}>Gaps</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        />
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--background)_30%,transparent)] px-2 pb-2 pt-1.5">
                      <p className="text-[11px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]">
                        {conformance.infra.gaps.join("; ")}
                      </p>
                      {conformance.infra.gaps.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => generateInfra(projectId!, { gapsFeedback: conformance!.infra.gaps.join("\n") })}
                          disabled={loading || mddReviewing}
                          className="self-start text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Regenerar Infra con gaps
                        </button>
                      ) : null}
                    </div>
                  </details>
                )}
              </div>
              {(readinessAudit?.gapSummary.items?.length ?? 0) > 0 ? (
                <div className={cn(WORKSHOP_METRICS_CARD, "space-y-1.5 p-2.5")}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Brechas transversales
                  </p>
                  <ul className="max-h-36 space-y-1 overflow-y-auto text-[10px]">
                    {readinessAudit!.gapSummary.items.slice(0, 12).map((item, idx) => (
                      <li key={`${item.kind}-${idx}`} className="flex gap-1.5">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 py-px font-semibold uppercase tracking-wide",
                            item.kind === "auto" &&
                              "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[color-mix(in_oklch,var(--success)_90%,var(--foreground))]",
                            item.kind === "llm" &&
                              "bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]",
                            item.kind === "human" &&
                              "bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[color-mix(in_oklch,var(--warning)_88%,var(--foreground))]",
                          )}
                        >
                          {item.kind}
                        </span>
                        <span className="min-w-0 line-clamp-3" title={item.message}>
                          {item.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {crossDocumentGaps && crossDocumentGaps.length > 0 ? (
                <div className={cn(WORKSHOP_METRICS_CARD, "space-y-1.5 p-2.5")}>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    Trazabilidad BRD → MDD ({crossDocumentGaps.length})
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_10%,var(--card))] p-2">
                    <TraceabilityGapList
                      gaps={crossDocumentGaps}
                      projectId={projectId}
                      stageId={activeStageId}
                      mddContent={effectiveMddTrimmed}
                      maxVisible={8}
                      compact
                    />
                  </div>
                </div>
              ) : null}
              {readinessAudit && readinessAudit.gapSummary.total > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {readinessAudit.gapSummary.auto + readinessAudit.gapSummary.llm > 0 ? (
                    <button
                      type="button"
                      disabled={!projectId || brechasBusy}
                      onClick={() => {
                        if (!projectId) return;
                        void repairSddGaps(projectId, {
                          acknowledgeGaps: deliveryGate != null && !deliveryGate.ok,
                        });
                      }}
                      className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] px-2 text-[11px] font-semibold text-[var(--primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--primary)_22%,var(--card))] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {repairSddRunning ? (
                        <>
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                          Corrigiendo…
                        </>
                      ) : (
                        "Corregir auto/LLM"
                      )}
                    </button>
                  ) : null}
                  {readinessAudit.gapSummary.human > 0 ? (
                    <button
                      type="button"
                      onClick={() => setWorkshopActiveDocPanel("brd")}
                      className="inline-flex min-h-7 w-full items-center justify-center rounded-md px-2 text-[11px] font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
                    >
                      Abrir BRD (gaps humanos)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {documentCompleteness ? (
            <details className="min-w-0 shrink-0 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_40%,transparent)] px-2 py-1.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-[var(--foreground)] marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_oklch,var(--card)_40%,var(--background))] rounded [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileText className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
                  <span className="truncate">Más métricas</span>
                </span>
                <span className="shrink-0 text-right text-[10px] font-normal leading-tight text-[var(--muted-foreground)]">
                  {documentCompleteness ? `${documentCompleteness.overall}% docs` : null}
                </span>
              </summary>
              <div className="mt-2 space-y-3 border-t border-[var(--border)]/70 pt-2">
                {documentCompleteness && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Completitud por documento
                    </p>
                    <div className={cn(WORKSHOP_METRICS_CARD, "max-h-36 space-y-1 overflow-y-auto p-2 text-[11px]")}>
                      {[
                        ["brdContent", "BRD"],
                        ["specContent", "SPEC"],
                        ["architectureContent", "Arq."],
                        ["useCasesContent", "Casos"],
                        ["userStoriesContent", "H.U."],
                        ["blueprintContent", "BP"],
                        ["apiContractsContent", "API"],
                        ["logicFlowsContent", "Flujos"],
                        ["infraContent", "Infra"],
                        ["tasksContent", "Tasks"],
                      ].map(([key, label]) => {
                        const score = (documentCompleteness as unknown as Record<string, number>)[key as string] ?? 0;
                        return (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <span className="text-[color-mix(in_oklch,var(--foreground)_90%,var(--muted-foreground))]">{label}</span>
                            <span
                              className={
                                score >= 100
                                  ? "text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]"
                                  : score >= 50
                                    ? "text-[var(--primary)]"
                                    : score > 0
                                      ? "text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]"
                                      : "text-[color-mix(in_oklch,var(--foreground-subtle)_82%,var(--background))]"
                              }
                            >
                              {score >= 100 ? "✓" : score >= 50 ? "◐" : score > 0 ? "○" : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </details>
          ) : null}
      </div>
      <div
        className={cn(
          layout === "flyout" ? "flex min-w-0 flex-col gap-3" : "contents",
        )}
      >
          <div className="shrink-0 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-[var(--foreground)]">
              <DollarSign className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
              Estimación (MXN)
            </h3>
            <p
              className="line-clamp-3 text-[11px] leading-snug text-[color-mix(in_oklch,var(--muted-foreground)_96%,var(--foreground))]"
              title="Nómina: coste interno estimado. IA: uso aproximado de generación. Mercado: referencia comercial. El cuadro inferior separa personas sugeridas y horas repartidas por rol."
            >
              <strong className="font-medium text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">Nómina</strong> = coste interno del equipo;{" "}
              <strong className="font-medium text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">IA</strong> = uso aproximado de generación;{" "}
              <strong className="font-medium text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">Mercado</strong> = referencia de precio. Abajo:{" "}
              <strong className="font-medium text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">personas</strong> por rol y{" "}
              <strong className="font-medium text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">horas</strong> asignadas (orientativo).
            </p>
            <div className={cn(WORKSHOP_METRICS_CARD, "overflow-hidden p-0")}>
              <div className="border-b border-[var(--border)]/60 bg-[color-mix(in_oklch,var(--muted)_18%,transparent)] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-medium text-[color-mix(in_oklch,var(--foreground)_94%,var(--muted-foreground))]">
                    Horas estimadas
                  </span>
                  <span className="tabular-nums text-sm font-semibold tracking-tight text-[var(--foreground)]">
                    {costDisplay.totalHours.toFixed(1)} h
                  </span>
                </div>
              </div>
              <div className="divide-y divide-[var(--border)]/60 px-3">
                <div className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 pr-1">
                    <span className="block text-[11px] font-medium text-[var(--foreground)]">Nómina interna</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-foreground)]">
                      Σ (horas rol × tarifa)
                    </span>
                  </div>
                  <span className="shrink-0 tabular-nums text-base font-bold text-[var(--primary)]">
                    ${costDisplay.totalMxn.toLocaleString("es-MX")}
                  </span>
                </div>
                {showIaCost ? (
                  <div className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0 pr-1">
                      <span className="block text-[11px] font-medium text-[var(--foreground)]">Coste IA (aprox.)</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-foreground)]">
                        Tokens / llamadas orientativas
                      </span>
                    </div>
                    <span className="shrink-0 tabular-nums text-base font-bold text-[color-mix(in_oklch,var(--chart-2)_78%,var(--foreground))]">
                      ${costDisplay.totalMxnIA.toLocaleString("es-MX")}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 pr-1">
                    <span className="block text-[11px] font-medium text-[var(--foreground)]">Referencia mercado</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-foreground)]">
                      Precio orientativo de venta
                    </span>
                  </div>
                  <span className="shrink-0 tabular-nums text-base font-bold text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]">
                    ${(costDisplay.totalMxnMarket ?? costDisplay.totalMxn).toLocaleString("es-MX")}
                  </span>
                </div>
              </div>
              {deliveryRoleRows.length > 0 ? (
                <div className="border-t border-[var(--border)]/70 bg-[color-mix(in_oklch,var(--background)_35%,transparent)]">
                  <p className="px-3 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Equipo sugerido (orientativo)
                  </p>
                  <div
                    className="max-h-44 overflow-y-auto px-3 pb-2.5 pt-1.5"
                    role="region"
                    aria-label="Personas y horas por rol"
                  >
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.25rem] gap-x-2 border-b border-[var(--border)]/50 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        <span>Rol</span>
                        <span className="text-right">Personas</span>
                        <span className="text-right">Horas</span>
                      </div>
                      {deliveryRoleRows.map(([role, count]) => {
                        const hours = costDisplay.rolesHours?.[role];
                        return (
                          <div
                            key={role}
                            className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.25rem] gap-x-2 text-[11px] leading-tight"
                          >
                            <span className="min-w-0 truncate font-medium text-[color-mix(in_oklch,var(--foreground)_95%,var(--muted-foreground))]">
                              {formatWorkshopDeliveryRoleLabel(role)}
                            </span>
                            <span
                              className="text-right tabular-nums text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]"
                              title={count === 1 ? "1 persona asignada" : `${count} personas asignadas`}
                            >
                              {count}
                            </span>
                            <span className="text-right tabular-nums text-[color-mix(in_oklch,var(--foreground)_90%,var(--muted-foreground))]">
                              {hours != null ? `${Number(hours).toFixed(1)} h` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 space-y-1.5">
            <button
              type="button"
              onClick={handleGenerateDeliverables}
              disabled={!canGenerateDeliverables || cascadeRunning || mddReviewing}
              aria-describedby={cascadeCtaHint ? "workshop-cascade-cta-hint" : undefined}
              className={cn(
                "flex w-full min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color-mix(in_oklch,var(--muted)_50%,var(--card))]",
                canGenerateDeliverables && !cascadeRunning && !mddReviewing
                  ? "bg-[var(--success)] text-[var(--success-foreground)] hover:bg-[color-mix(in_oklch,var(--success)_88%,black)]"
                  : "cursor-not-allowed border border-dashed border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_28%,var(--card))] text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))]",
              )}
            >
              {cascadeRunning ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  Generando entregables…
                </>
              ) : canGenerateDeliverables ? (
                !deliveryGateOk ? "Generar entregables (con advertencias)" : "Generar entregables"
              ) : !semaphoreGreen ? (
                "Semáforo en verde requerido"
              ) : (
                "Revisa el Spec para continuar"
              )}
            </button>
            {cascadeCtaHint ? (
              <p
                id="workshop-cascade-cta-hint"
                className="text-center text-[11px] leading-snug text-[color-mix(in_oklch,var(--foreground)_94%,var(--muted-foreground))]"
              >
                {cascadeCtaHint}
              </p>
            ) : null}
            {semaphoreGreen && projectId ? (
              <button
                type="button"
                onClick={() => setRepoWizardOpen(true)}
                disabled={!effectiveMddTrimmed}
                className={cn(
                  "flex w-full min-h-9 items-center justify-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--success)_45%,var(--border))] px-3 text-xs font-semibold transition-colors",
                  effectiveMddTrimmed
                    ? "bg-[color-mix(in_oklch,var(--success)_14%,var(--card))] text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success)_22%,var(--card))]"
                    : "cursor-not-allowed opacity-50",
                )}
              >
                <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden />
                Llevar al repo
              </button>
            ) : null}
            {projectId ? (
              <button
                type="button"
                onClick={() => setShowAnalyze((v) => !v)}
                className="w-full rounded-lg px-2 py-1.5 text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline"
              >
                {showAnalyze ? "Ocultar análisis SDD" : "Analizar consistencia SDD"}
              </button>
            ) : null}
          </div>

          {projectId ? (
            <TokenUsageCard projectId={projectId} stageId={activeStageId ?? undefined} />
          ) : null}

          {showAnalyze && projectId ? (
            <AnalyzeDashboard
              projectId={projectId}
              className="rounded-lg bg-[var(--background)] shadow-sm"
              onReportLoaded={setAnalyzeReport}
            />
          ) : null}

          <LlevarAlRepoWizardDialog
            open={repoWizardOpen}
            onOpenChange={setRepoWizardOpen}
            projectId={projectId ?? ""}
            projectName={project?.name ?? "Workshop"}
            hasAgentGovernance={hasAgentGovernance}
            hasMdd={!!effectiveMddTrimmed}
            analyzeReport={analyzeReport}
            onError={(msg) => useWorkshopStore.getState().setError(msg)}
            onSuccess={(msg) => useWorkshopStore.getState().setError(msg)}
          />

          <AlertDialog open={gapConfirmOpen} onOpenChange={setGapConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Generar con gaps pendientes</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-[color-mix(in_oklch,var(--foreground-subtle)_90%,var(--foreground))]">
                    <p>
                      Hay discrepancias sin resolver. Puedes generar entregables igualmente; los conflictos
                      quedarán visibles en Cambios pendientes para que decidas si reconciliar.
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-xs">
                      {!deliveryGateOk && deliveryGate ? (
                        <li>
                          Gate MDD ({deliveryGate.score}/100):{" "}
                          {deliveryGate.blockers[0] ?? "advertencias pendientes"}
                        </li>
                      ) : null}
                      {hasKnownGenerationGaps && conformance?.blueprintDataModel?.ok === false ? (
                        <li>Blueprint no cubre el modelo de datos del MDD (§3).</li>
                      ) : null}
                      {(crossDocumentGaps?.length ?? 0) > 0 ? (
                        <li>{crossDocumentGaps.length} gap(s) transversal(es) entre documentos.</li>
                      ) : null}
                      {gapConfirmPendingCount > 0 ? (
                        <li>
                          {gapConfirmPendingCount} cambio(s) de documentación pendiente(s) de aprobación.
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleConfirmGenerateWithGaps()}>
                  Generar de todos modos
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Plan Ariadne (Gate 2) */}
          {(project as { theforgeProjectId?: string | null })?.theforgeProjectId ? (
            <div className="max-h-32 shrink-0 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-[11px] leading-snug shadow-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <strong className="text-[var(--foreground)]">Plan Ariadne</strong>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] text-[var(--primary)] hover:underline"
                  onClick={() => void validateChangePlan(projectId)}
                >
                  Validar
                </button>
              </div>
              {planValidation ? (
                <p className="text-[color-mix(in_oklch,var(--foreground)_85%,var(--muted-foreground))]">
                  <span
                    className={
                      planValidation.verdict === "APPROVED"
                        ? "text-emerald-600"
                        : planValidation.verdict === "BLOCKED"
                          ? "text-red-600"
                          : "text-amber-600"
                    }
                  >
                    {planValidation.verdict}
                  </span>
                  {" · "}
                  {planValidation.score}%
                  {planValidation.report.blockers.length > 0
                    ? ` · ${planValidation.report.blockers.length} blocker(s)`
                    : ""}
                </p>
              ) : (
                <p className="text-[var(--muted-foreground)]">Sin validación aún. Regenera Tasks o pulsa Validar.</p>
              )}
            </div>
          ) : null}

          {/* Feedback del auditor debajo del semáforo (selectores Zustand → re-render al actualizar liveMetrics / auditorFeedback) */}
          {auditorFeedback ? (
            <div className="max-h-28 shrink-0 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-[11px] leading-snug text-[color-mix(in_oklch,var(--foreground)_90%,var(--muted-foreground))] shadow-sm">
              <strong className="mb-0.5 block text-[var(--foreground)]">
                Auditoría ({liveMetrics?.precision ?? 0}% — {auditFeedbackStatusLabel})
              </strong>
              {auditorFeedback}
            </div>
          ) : null}

          {liveMetrics?.conformanceSummary && !liveMetrics.conformanceSummary.ok ? (
            <div className="max-h-28 shrink-0 overflow-y-auto rounded-lg border border-[color-mix(in_oklch,var(--warning)_40%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_6%,var(--background))] p-2 text-[11px] leading-snug shadow-sm">
              <strong className="mb-0.5 block text-[var(--foreground)]">Conformidad cascada</strong>
              <ul className="list-disc space-y-0.5 pl-4">
                {!liveMetrics.conformanceSummary.api.ok ? (
                  <li>
                    API: {liveMetrics.conformanceSummary.api.missingCount} endpoint(s) faltante(s)
                    {liveMetrics.conformanceSummary.api.extraCount > 0
                      ? `, ${liveMetrics.conformanceSummary.api.extraCount} extra(s)`
                      : ""}
                  </li>
                ) : null}
                {!liveMetrics.conformanceSummary.infra.ok ? (
                  <li>
                    Infra: {liveMetrics.conformanceSummary.infra.gapCount} gap(s) —{" "}
                    {liveMetrics.conformanceSummary.infra.gaps[0] ?? "revisar §7"}
                  </li>
                ) : null}
                {liveMetrics.conformanceSummary.api.aliasWarnings?.slice(0, 2).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
      </div>
    </div>
  );
}
