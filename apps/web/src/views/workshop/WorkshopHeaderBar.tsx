import {
  AlertTriangle,
  ChevronDown,
  Cloud,
  CloudOff,
  Globe,
  HelpCircle,
  Layers,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { StageDeliverablesResponse } from "@theforge/shared-types";
import { getAllowedStageTransitions } from "@theforge/shared-types";
import { cn } from "@/lib/utils";
import { WorkshopStageTransitionDialog } from "@/components/WorkshopStageTransitionDialog";
import {
  WORKSHOP_HEADER_CTL,
  WORKSHOP_HEADER_CTL_HOVER,
} from "@/constants/workshopHeaderToolbar";
import { WorkshopDownloadZipButton } from "@/components/WorkshopDownloadZipButton";
import { WorkshopExportSddButton } from "@/components/WorkshopExportSddButton";
import { WorkshopHeaderIconButton } from "@/components/WorkshopButtons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { apiFetch, API_BASE } from "@/utils/apiClient";
import { stageWorkflowStatusLabel } from "@/utils/stageWorkflowStatusLabel";
import { useWorkshopStore, type Project, type WorkshopStage } from "@/store/workshopStore";

export interface WorkshopHeaderBarProps {
  projectName?: string;
  project: Project | null;
  onRenameProject?: () => void;
  connectionError: boolean;
  error: string | null;
  synced: boolean;
  onRetrySync: () => void;
  workshopStagesList: WorkshopStage[];
  activeStageId: string | null;
  onActiveStageChange: (stageId: string) => void;
  stageDeliverableView: StageDeliverablesResponse | null;
  onNewStage: () => void;
  hasAgentGovernance: boolean;
  onDownloadZip: () => void | Promise<void>;
  exportSddDisabled: boolean;
  onExportSdd: () => void | Promise<void>;
  onOpenHelp: () => void;
}

function WorkshopHeaderActions({
  hasAgentGovernance,
  onDownloadZip,
  exportSddDisabled,
  onExportSdd,
  onOpenHelp,
}: Pick<
  WorkshopHeaderBarProps,
  "hasAgentGovernance" | "onDownloadZip" | "exportSddDisabled" | "onExportSdd" | "onOpenHelp"
>) {
  return (
    <>
      <WorkshopDownloadZipButton
        hasAgentGovernance={hasAgentGovernance}
        onClick={() => {
          void onDownloadZip();
        }}
      />

      <WorkshopExportSddButton
        disabled={exportSddDisabled}
        onClick={() => {
          void onExportSdd();
        }}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <WorkshopHeaderIconButton
            onClick={onOpenHelp}
            title="Manual de uso del Workshop"
            aria-label="Ayuda — manual del Workshop"
          >
            <HelpCircle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          </WorkshopHeaderIconButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">Manual del Workshop</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Global Workshop header: title, sync, visibility, stage selector, ZIP/SDD export, help. */
export function WorkshopHeaderBar({
  projectName,
  project,
  onRenameProject,
  connectionError,
  error,
  synced,
  onRetrySync,
  workshopStagesList,
  activeStageId,
  onActiveStageChange,
  stageDeliverableView,
  onNewStage,
  hasAgentGovernance,
  onDownloadZip,
  exportSddDisabled,
  onExportSdd,
  onOpenHelp,
}: WorkshopHeaderBarProps) {
  const displayName = projectName ?? project?.name ?? "Workshop";
  const [stageTransitionOpen, setStageTransitionOpen] = useState(false);

  const activeStage = useMemo(
    () => workshopStagesList.find((st) => st.id === activeStageId) ?? workshopStagesList[0] ?? null,
    [workshopStagesList, activeStageId],
  );
  const activeStageHasTransitions = activeStage
    ? getAllowedStageTransitions(activeStage.workflowStatus).length > 0
    : false;

  const toggleVisibility = async () => {
    if (!project) return;
    const newVis = project.visibility === "SHARED" ? "PRIVATE" : "SHARED";
    try {
      const r = await apiFetch(`${API_BASE}/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: newVis }),
      });
      if (r.ok) {
        const data = (await r.json()) as Project;
        useWorkshopStore.getState().setProject(data);
      }
    } catch {
      /* ignore — badge stays as-is */
    }
  };

  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_35%,var(--background))] px-3 py-2.5 max-sm:py-2.5 sm:px-5 sm:py-3">
      <div
        className={cn(
          "grid grid-cols-1 gap-3 max-sm:gap-2.5 sm:items-center sm:gap-x-4 sm:gap-y-0",
          "sm:grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:justify-between sm:flex-nowrap sm:gap-x-3">
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-[var(--foreground)] max-sm:text-[0.9375rem] max-sm:leading-tight sm:flex-1 sm:text-lg">
              {displayName}
            </h1>
            {onRenameProject ? (
              <button
                type="button"
                onClick={onRenameProject}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                title="Configuración del proyecto"
                aria-label="Configuración del proyecto"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {project?.projectType === "LEGACY" ? (
              <span
                className="shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-xs font-medium text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))]"
                title="Proyecto legacy: documentación de cambios con Relic"
              >
                Legacy
              </span>
            ) : null}
            {project ? (
              <button
                type="button"
                onClick={() => {
                  void toggleVisibility();
                }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium transition-colors",
                  project.visibility === "SHARED"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    : "border-zinc-500/40 bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20",
                )}
                title={
                  project.visibility === "SHARED"
                    ? "Compartido — todos los usuarios pueden ver y editar. Click para hacer privado."
                    : "Privado — solo tú puedes ver y editar. Click para compartir."
                }
              >
                {project.visibility === "SHARED" ? (
                  <>
                    <Globe className="h-3 w-3" aria-hidden /> Compartido
                  </>
                ) : (
                  <>
                    <Lock className="h-3 w-3" aria-hidden /> Privado
                  </>
                )}
              </button>
            ) : null}
            <span
              role="status"
              aria-live="polite"
              aria-label={
                connectionError
                  ? `Error de sincronización: ${error}`
                  : synced
                    ? "Sincronizado con el servidor"
                    : "Sincronizando con el servidor"
              }
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-xs text-[var(--foreground-subtle)]",
                "max-sm:rounded-full max-sm:border max-sm:border-[color-mix(in_oklch,var(--border)_80%,transparent)] max-sm:bg-[color-mix(in_oklch,var(--card)_40%,transparent)] max-sm:px-2 max-sm:py-1",
              )}
              title={
                connectionError
                  ? "Sin conexión — toca para reintentar"
                  : synced
                    ? "Sincronizado"
                    : "Sincronizando"
              }
              onClick={connectionError ? () => { void onRetrySync(); } : undefined}
              style={connectionError ? { cursor: "pointer" } : undefined}
            >
              {connectionError ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" aria-hidden />
                  <span className="hidden sm:inline">Sin conexión</span>
                </>
              ) : synced ? (
                <>
                  <Cloud className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden />
                  <span className="hidden sm:inline">Sincronizado</span>
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden />
                  <span className="hidden sm:inline">Sincronizando…</span>
                </>
              )}
            </span>
          </div>
        </div>

        {workshopStagesList.length > 0 ? (
          <TooltipProvider delayDuration={280}>
            <div
              className={cn(
                "flex min-w-0 flex-nowrap items-center gap-1.5",
                "max-sm:w-full max-sm:gap-2",
                "sm:max-w-none sm:justify-self-end",
                "overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] sm:overflow-visible sm:pb-0",
              )}
            >
              <span
                className="hidden sm:inline-flex h-9 w-9 shrink-0 items-center justify-center pointer-events-none text-[var(--foreground-subtle)]"
                aria-hidden
              >
                <Layers className="h-4 w-4 shrink-0" strokeWidth={2} />
              </span>
              <label htmlFor="workshop-stage-select" className="sr-only">
                Vista en vivo: etapa del Workshop (MDD y semáforo)
              </label>
              <div className="relative min-w-[12rem] max-w-[240px] flex-1 sm:min-w-[14rem] sm:flex-none">
                <select
                  id="workshop-stage-select"
                  className={cn(
                    WORKSHOP_HEADER_CTL,
                    WORKSHOP_HEADER_CTL_HOVER,
                    "w-full min-w-0 cursor-pointer appearance-none py-0 pl-3 pr-10 leading-9",
                  )}
                  value={activeStageId ?? workshopStagesList[0]?.id ?? ""}
                  onChange={(e) => onActiveStageChange(e.target.value)}
                >
                  {workshopStagesList.map((st) => (
                    <option key={st.id} value={st.id}>
                      #{st.ordinal}{" "}
                      {(st.name ?? st.key ?? st.id.slice(0, 8)) +
                        ` · ${stageWorkflowStatusLabel(st.workflowStatus)}`}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 z-[1] h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-[color-mix(in_oklch,var(--foreground)_72%,var(--muted-foreground))]"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </div>

              {stageDeliverableView?.source === "snapshot" ? (
                <div
                  role="status"
                  className="hidden shrink-0 rounded-lg bg-[color-mix(in_oklch,var(--info)_8%,var(--card))] px-2 py-1 text-[10px] leading-snug text-[color-mix(in_oklch,var(--info)_88%,var(--foreground))] sm:block sm:max-w-[14rem]"
                >
                  Entregables congelados · etapa {stageDeliverableView.ordinal}
                </div>
              ) : null}

              {activeStageHasTransitions ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkshopHeaderIconButton
                      onClick={() => setStageTransitionOpen(true)}
                      aria-label="Gestionar estado de la etapa"
                      title="Gestionar etapa"
                    >
                      <MoreHorizontal className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    </WorkshopHeaderIconButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Archivar, completar o reabrir etapa</TooltipContent>
                </Tooltip>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <WorkshopHeaderIconButton onClick={onNewStage} aria-label="Nueva etapa">
                    <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  </WorkshopHeaderIconButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">Nueva etapa</TooltipContent>
              </Tooltip>

              <WorkshopHeaderActions
                hasAgentGovernance={hasAgentGovernance}
                onDownloadZip={onDownloadZip}
                exportSddDisabled={exportSddDisabled}
                onExportSdd={onExportSdd}
                onOpenHelp={onOpenHelp}
              />
            </div>
          </TooltipProvider>
        ) : (
          <TooltipProvider delayDuration={280}>
            <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1.5 sm:justify-self-end">
              <WorkshopHeaderActions
                hasAgentGovernance={hasAgentGovernance}
                onDownloadZip={onDownloadZip}
                exportSddDisabled={exportSddDisabled}
                onExportSdd={onExportSdd}
                onOpenHelp={onOpenHelp}
              />
            </div>
          </TooltipProvider>
        )}
      </div>

      {project?.projectType === "LEGACY" && project?.theforgeProjectId?.trim() ? (
        <div className="mt-3 rounded-lg border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--muted)_25%,transparent)] px-2.5 py-1.5 sm:mt-3">
          <span
            className="font-mono text-[10px] leading-snug text-[var(--foreground-subtle)] sm:text-[11px]"
            title={`UUID guardado (theforgeProjectId). La API resuelve: ingest proyecto (ask_codebase, get_modification_plan) = id workspace; grafo/semantic = roots[].id; scope.repoIds en ask/plan. ${project.theforgeProjectId}`}
          >
            <span
              className="text-[color-mix(in_oklch,var(--foreground-subtle)_82%,var(--background))] select-none"
              aria-hidden
            >
              MCP{" "}
            </span>
            <span className="break-all text-[var(--muted-foreground)]">{project.theforgeProjectId}</span>
          </span>
        </div>
      ) : null}

      <WorkshopStageTransitionDialog
        open={stageTransitionOpen}
        onOpenChange={setStageTransitionOpen}
        stage={activeStage}
      />
    </header>
  );
}
