import {
  GitBranch,
  HelpCircle,
  History,
  ListOrdered,
  ListTodo,
  Loader2,
  MessageSquare,
  Printer,
  RefreshCw,
  Save,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORKSHOP_DOC_TOOLBAR_ICON,
  WORKSHOP_DOC_TOOLBAR_ICON_BTN,
} from "@/constants/workshopDocToolbar";
import { WorkshopDocPanelHeader } from "@/components/WorkshopDocPanelHeader";
import { WorkshopRegenButton } from "@/components/WorkshopRegenButton";
import { TasksQualityBadge } from "@/components/TasksQualityBadge";
import {
  WorkshopDocToolbarIcon,
  WorkshopDocToolbarIconButton,
} from "@/components/WorkshopButtons";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import {
  getWorkshopDocToolbarActiveViewMode,
  workshopDocSourceTogglePresentation,
  canShowWorkshopDocViewToggle,
} from "@/utils/workshopDocToolbar";
import { WorkshopDocToolbarHint } from "./WorkshopDocToolbarHint";
import type { WorkshopDocToolbarProps } from "./workshopDocToolbar.types";

/** Document column toolbar (preview/source, regen, print, mobile actions). */
export function WorkshopDocToolbar(props: WorkshopDocToolbarProps) {
  const {
    centralPanel,
    effectiveComplexityForTabs,
    isLegacyProject,
    benchmarkPhaseTab,
    docEditToolbarToggle,
    viewModes,
    content,
    ui,
    actions,
  } = props;

  const {
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
  } = content;

  const {
    loading,
    projectId,
    loadingReason,
    effectiveMddTrimmed,
    mddReviewing,
    apiBlueprintDmBlocked,
    apiBlueprintBlockedHint,
    mddInicialViewMode,
    mddInicialSaving,
    brdDocViewMode,
    brdWorkshopDirty,
    brdTobePersistBusy,
    canGenerateAem,
    tasksPrerequisites,
    agentGovernanceGenerating,
    uxGenerating,
    uxGenProgress,
    benchmarkViewMode,
    phase0SummaryViewMode,
    phase0EntryModeToolbarToggle,
    isLgLayout,
    lgWorkshopChatCollapsed,
    deliverablesReadOnly,
  } = ui;

  const {
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
  } = actions;

  return (
<div className="flex shrink-0 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_45%,var(--background))] px-3 py-2.5 text-sm text-[var(--muted-foreground)] sm:px-4 sm:py-3 lg:h-16 lg:min-h-16 lg:max-h-16 lg:items-center lg:overflow-hidden lg:py-0 lg:pl-4 lg:pr-4">
  <TooltipProvider delayDuration={280}>
  <div className="flex min-h-0 w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 lg:flex-nowrap lg:items-center lg:justify-between">
    <div className="min-w-0 flex-1 lg:hidden">
      <WorkshopDocToolbarHint
        tier={effectiveComplexityForTabs}
        isLegacyProject={isLegacyProject}
      />
    </div>
    <WorkshopDocPanelHeader
      className="hidden lg:flex"
      panel={centralPanel}
      benchmarkPhaseTab={benchmarkPhaseTab}
    />
    {docEditToolbarToggle ? (
      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        {centralPanel === "spec" && !deliverablesReadOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <WorkshopDocToolbarIconButton
                onClick={() => setClarifySpecDialogOpen(true)}
                disabled={loading || !projectId}
                aria-label="Aclarar Spec antes del plan (speckit.clarify)"
              >
                <HelpCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
              </WorkshopDocToolbarIconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
              Aclarar Spec — marca ambigüedades con [NEEDS CLARIFICATION]
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
              aria-label={docEditToolbarToggle.tooltip}
              onClick={docEditToolbarToggle.onClick}
            >
              <docEditToolbarToggle.Icon
                className={WORKSHOP_DOC_TOOLBAR_ICON}
                strokeWidth={2}
                aria-hidden
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
            {docEditToolbarToggle.tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
    ) : null}
    <div className="flex flex-wrap items-center gap-1.5 shrink-0 sm:justify-end sm:gap-2 sm:pt-0.5 lg:hidden">
      {!deliverablesReadOnly && canShowWorkshopDocViewToggle(centralPanel, content) && (() => {
                      const activeDocViewMode = getWorkshopDocToolbarActiveViewMode(centralPanel, viewModes);
                      const { Icon: DocToggleIcon, tooltip: docToggleTooltip } = workshopDocSourceTogglePresentation(
                        centralPanel,
                        activeDocViewMode,
                      );
                      return (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
                        aria-label={docToggleTooltip}
                        onClick={() => toggleDocViewMode(centralPanel)}
                          >
                            <DocToggleIcon className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
                          {docToggleTooltip}
                        </TooltipContent>
                      </Tooltip>
                      );
                    })()}
      {effectiveComplexityForTabs === "HIGH" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
              aria-label="Ver orden completo de flujo"
              onClick={() => setFlowOrderModalOpen(true)}
            >
              <ListOrdered className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Ver orden completo de flujo
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "benchmark" &&
        (() => {
          if (benchmarkPhaseTab === "fase0" && phase0EntryModeToolbarToggle) {
            const { Icon: BenchmarkToggleIcon, tooltip: benchmarkToggleTooltip, onClick } =
              phase0EntryModeToolbarToggle;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
                    aria-label={benchmarkToggleTooltip}
                    onClick={onClick}
                  >
                    <BenchmarkToggleIcon className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
                  {benchmarkToggleTooltip}
                </TooltipContent>
              </Tooltip>
            );
          }
          const activeBenchmarkViewMode =
            benchmarkPhaseTab === "fase0" ? benchmarkViewMode : phase0SummaryViewMode;
          const { Icon: BenchmarkToggleIcon, tooltip: benchmarkToggleTooltip } =
            workshopDocSourceTogglePresentation("mdd", activeBenchmarkViewMode);
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
                  aria-label={benchmarkToggleTooltip}
                  onClick={() => {
                    if (benchmarkPhaseTab === "fase0") {
                      setBenchmarkViewMode((m) => (m === "preview" ? "source" : "preview"));
                    } else {
                      setPhase0SummaryViewMode((m) => (m === "preview" ? "source" : "preview"));
                    }
                  }}
                >
                  <BenchmarkToggleIcon className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
                {benchmarkToggleTooltip}
              </TooltipContent>
            </Tooltip>
          );
        })()}
      {centralPanel === "benchmark" && benchmarkPhaseTab === "fase0" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
              aria-label="Restaurar versión anterior del DBGA"
              onClick={() => setDbgaRestoreOpen(true)}
            >
              <History className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
            Versiones anteriores del DBGA
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
            aria-label="Imprimir documento"
            onClick={handlePrintDocument}
          >
            <Printer className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-[10rem]">
          Imprimir
        </TooltipContent>
      </Tooltip>
      {centralPanel === "architecture" && !!architectureContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateArchitecture(projectId)}
          disabled={loading || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar arquitectura desde el MDD"
        />
      )}
      {centralPanel === "use-cases" && !!useCasesContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateUseCases(projectId)}
          disabled={loading || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar casos de uso desde el MDD"
        />
      )}
      {centralPanel === "user-stories" && !!userStoriesContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateUserStories(projectId)}
          disabled={loading || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar historias de usuario desde el MDD"
        />
      )}
      {centralPanel === "blueprint" && !!blueprintContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateBlueprint(projectId)}
          disabled={loading || mddReviewing || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar blueprint desde el MDD"
          tooltip="Regenerar blueprint desde el MDD"
        />
      )}
      {centralPanel === "api-contracts" && !!apiContractsContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateApiContracts(projectId)}
          disabled={loading || mddReviewing || !effectiveMddTrimmed || apiBlueprintDmBlocked}
          loading={loading}
          ariaLabel={apiBlueprintDmBlocked ? apiBlueprintBlockedHint : "Regenerar contratos API desde el MDD"}
          tooltip={apiBlueprintDmBlocked ? apiBlueprintBlockedHint : "Regenerar contratos API desde el MDD"}
        />
      )}
      {centralPanel === "logic-flows" && !!logicFlowsContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateLogicFlows(projectId)}
          disabled={loading || mddReviewing || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar flujos de lógica desde el MDD"
        />
      )}
      {centralPanel === "infra" && !!infraContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateInfra(projectId)}
          disabled={loading || mddReviewing || !effectiveMddTrimmed}
          loading={loading}
          ariaLabel="Regenerar infraestructura desde el MDD"
          tooltip="Regenerar infraestructura desde el MDD"
        />
      )}
      {centralPanel === "mdd-inicial" &&
        isLegacyProject &&
        projectId &&
        !!(activeLegacyState?.codebaseDoc ?? mddInicialLocalContent ?? "").trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={() => void handleRegenerateLegacyCodebaseDoc()}
              disabled={loading}
              aria-label="Regenerar documentación de partida del codebase (AriadneSpecs)"
            >
              {loading && loadingReason === "legacy-codebase-doc" ? (
                <Loader2 className={cn(WORKSHOP_DOC_TOOLBAR_ICON, "animate-spin")} strokeWidth={2} aria-hidden />
              ) : (
                <WorkshopDocToolbarIcon icon={RefreshCw} />
              )}
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Regenerar documentación de partida del codebase vía AriadneSpecs
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "mdd-inicial" && mddInicialViewMode === "source" && (mddInicialLocalContent || activeLegacyState?.codebaseDoc) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={async () => {
                setMddInicialSaving(true);
                        await legacyUpdateCodebaseDoc(projectId, mddInicialLocalContent ?? "");
                setMddInicialSaving(false);
              }}
              disabled={mddInicialSaving || mddInicialLocalContent === (activeLegacyState?.codebaseDoc ?? "")}
              aria-label="Guardar cambios en la documentación de partida"
            >
              {mddInicialSaving ? (
                <Loader2 className={cn(WORKSHOP_DOC_TOOLBAR_ICON, "animate-spin")} strokeWidth={2} aria-hidden />
              ) : (
                <WorkshopDocToolbarIcon icon={Save} />
              )}
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Guardar cambios en la documentación
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "brd" && brdDocViewMode === "source" && activeStageId && brdWorkshopDirty && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={() => void persistBrdWorkshopDraft()}
              disabled={brdTobePersistBusy}
              aria-label="Guardar BRD en la etapa activa"
            >
              {brdTobePersistBusy ? (
                <Loader2 className={cn(WORKSHOP_DOC_TOOLBAR_ICON, "animate-spin")} strokeWidth={2} aria-hidden />
              ) : (
                <WorkshopDocToolbarIcon icon={Save} />
              )}
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Guardar BRD en la etapa activa
          </TooltipContent>
        </Tooltip>
      )}
      {/* to-be save button removed */}
      {centralPanel === "spec" && !deliverablesReadOnly ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={() => setClarifySpecDialogOpen(true)}
              disabled={loading || !projectId}
              aria-label="Aclarar Spec antes del plan (speckit.clarify)"
            >
              <HelpCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Aclarar Spec — marca ambigüedades con [NEEDS CLARIFICATION]
          </TooltipContent>
        </Tooltip>
      ) : null}
      {centralPanel === "spec" && !!specContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateSpec(projectId)}
          disabled={loading}
          loading={loading}
          ariaLabel="Regenerar Spec desde Benchmark y alcance"
        />
      )}
      {centralPanel === "aem" && !!aemContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => setAemGenerateDialogOpen(true)}
          disabled={loading || !canGenerateAem}
          loading={loading && loadingReason === "aem"}
          ariaLabel="Regenerar Análisis y Estudio de Mercado"
        />
      )}
      {centralPanel === "tasks" && !!tasksContent?.trim() && (
        <TasksQualityBadge shortTermContext={content.activeStageShortTermContext} />
      )}
      {centralPanel === "tasks" && !!tasksContent?.trim() && (
        <WorkshopRegenButton
          onClick={() => generateTasks(projectId)}
          disabled={loading || !tasksPrerequisites.ready}
          loading={loading}
          ariaLabel="Regenerar Tasks desde upstream SDD"
        />
      )}
      {centralPanel === "tasks" && !!tasksContent?.trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={() => {
                const persist = window.confirm(
                  "¿Ejecutar converge brownfield? OK = guardar nuevas tareas en tasks.md. Cancelar = solo vista previa en mensaje.",
                );
                void convergeTasks(projectId, persist).then((res) => {
                  if (res && !persist) {
                    setError(`Converge (${res.openTaskCount} abiertas). Revisa el panel de errores/info.`);
                  } else if (res?.persisted) {
                    setError("✅ Converge aplicado en tasks.md");
                  }
                });
              }}
              disabled={loading || !projectId}
              aria-label="Converge: alinear tasks con codebase y conformidad"
            >
              <WorkshopDocToolbarIcon icon={GitBranch} />
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Converge brownfield (Ariadne + conformidad → tareas pendientes)
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "tasks" && !!tasksContent?.trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={() => {
                const owner = window.prompt("GitHub owner (org o usuario)");
                if (!owner?.trim()) return;
                const repo = window.prompt("GitHub repo");
                if (!repo?.trim()) return;
                const milestoneRaw = window.prompt("Milestone number (opcional, Enter para omitir)");
                const milestone =
                  milestoneRaw?.trim() && /^\d+$/.test(milestoneRaw.trim())
                    ? Number(milestoneRaw.trim())
                    : undefined;
                void tasksToIssues(projectId, {
                  owner: owner.trim(),
                  repo: repo.trim(),
                  milestone,
                }).then((res) => {
                  if (!res) return;
                  const n = res.created.length;
                  const errN = res.errors.length;
                  setError(
                    n > 0
                      ? `✅ ${n} issue(s) creadas en GitHub${errN ? ` (${errN} errores)` : ""}`
                      : errN
                        ? `No se crearon issues: ${res.errors[0]}`
                        : "Sin issues creadas",
                  );
                });
              }}
              disabled={loading || !projectId}
              aria-label="Crear GitHub Issues desde tareas abiertas"
            >
              <WorkshopDocToolbarIcon icon={ListTodo} />
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Tasks → GitHub Issues (requiere GITHUB_TOKEN en servidor)
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "agent-governance" && hasAgentGovernance && (
        <WorkshopRegenButton
          onClick={() => generateAgentGovernance(projectId)}
          disabled={agentGovernanceGenerating || !effectiveMddTrimmed}
          loading={agentGovernanceGenerating}
          ariaLabel="Regenerar scaffold de gobernanza de agentes desde el MDD"
        />
      )}
      {centralPanel === "ux-ui-guide" && !!uxUiGuideContent?.trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={repairUxGuide}
              disabled={uxGenerating || loading}
              aria-label="Reparar YAML frontmatter de la design system desde el contenido existente"
            >
              <WorkshopDocToolbarIcon icon={Wrench} />
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            Reparar YAML frontmatter — regenera tokens de diseño desde el MDD
          </TooltipContent>
        </Tooltip>
      )}
      {centralPanel === "ux-ui-guide" && !!uxUiGuideContent?.trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkshopDocToolbarIconButton
              onClick={generateUxGuideSequential}
              disabled={uxGenerating || loading || !effectiveMddTrimmed || !blueprintContent?.trim()}
              aria-label={uxGenProgress ?? "Regenerar design system desde MDD y Blueprint"}
            >
              {uxGenerating ? (
                <Loader2 className={cn(WORKSHOP_DOC_TOOLBAR_ICON, "animate-spin")} strokeWidth={2} aria-hidden />
              ) : (
                <WorkshopDocToolbarIcon icon={RefreshCw} />
              )}
            </WorkshopDocToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[16rem]">
            {uxGenProgress ?? "Regenerar design system desde MDD y Blueprint"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
    {isLgLayout && lgWorkshopChatCollapsed && !deliverablesReadOnly ? (
      <div className="hidden shrink-0 lg:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={WORKSHOP_DOC_TOOLBAR_ICON_BTN}
              aria-label="Mostrar conversación"
              onClick={() => handleSetLgWorkshopChatCollapsed(false)}
            >
              <MessageSquare className={WORKSHOP_DOC_TOOLBAR_ICON} strokeWidth={2} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[14rem]">
            Mostrar panel de conversación
          </TooltipContent>
        </Tooltip>
      </div>
    ) : null}
  </div>
  </TooltipProvider>
</div>
  );
}
