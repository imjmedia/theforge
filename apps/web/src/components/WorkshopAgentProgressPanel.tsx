import { useMemo } from "react";
import { Check } from "lucide-react";
import { AiGenerativeDots } from "@/components/AiGenerationLoader";
import { cn } from "@/lib/utils";
import { useWorkshopStore } from "@/store/workshopStore";
import {
  findActiveAgentProgressStep,
  isAgentProgressActive,
  resolveAgentProgressDisplayLabel,
  type AgentProgressItem,
} from "@/utils/agentProgress";

export type WorkshopAgentProgressPanelProps = {
  /** Encabezado del panel (default: «Progreso del flujo»). */
  title?: string;
  /** Override del flag loading del store. */
  loading?: boolean;
  className?: string;
  /** Progreso explícito (p. ej. tests); si no se pasa, usa `agentProgress` del store. */
  steps?: readonly AgentProgressItem[];
};

function StepIcon({ item }: { item: AgentProgressItem }) {
  const done = item.status === "terminado" || item.status === "done";
  const active = isAgentProgressActive(item);

  if (done) {
    return <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.5} />;
  }
  if (active) {
    return <AiGenerativeDots />;
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_45%,var(--border))]"
      aria-hidden
    />
  );
}

function ProgressStepRow({
  item,
  label,
}: {
  item: AgentProgressItem;
  label: string;
}) {
  const active = isAgentProgressActive(item);
  const done = item.status === "terminado" || item.status === "done";

  return (
    <li className="grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 text-sm">
      <span
        className={cn(
          "flex h-5 w-[1.125rem] shrink-0 items-center justify-center pt-0.5",
          active && "text-[var(--primary)]",
        )}
        aria-hidden
      >
        <StepIcon item={item} />
      </span>
      <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
        <span
          className={cn(
            "font-semibold leading-snug tracking-tight",
            done
              ? "text-[color-mix(in_oklch,var(--foreground)_90%,var(--muted-foreground))]"
              : active
                ? "text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]"
                : "text-[var(--foreground)]",
          )}
        >
          {label}
        </span>
        {item.message ? (
          <span className="text-xs leading-relaxed text-[var(--foreground-subtle)]">{item.message}</span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Lista de pasos con completados, activo y pendientes — mismo patrón que la columna chat en cascadas/MDD.
 */
export function WorkshopAgentProgressPanel({
  title,
  loading: loadingOverride,
  className,
  steps,
}: WorkshopAgentProgressPanelProps) {
  const storeLoading = useWorkshopStore((s) => s.loading);
  const agentProgress = useWorkshopStore((s) => s.agentProgress);
  const items = steps ?? agentProgress;
  const loading = loadingOverride ?? storeLoading;

  const heading = useMemo(() => {
    if (title?.trim()) return title.trim();
    return loading ? "Progreso del flujo" : items.length > 0 ? "Pasos completados" : "Flujo en curso";
  }, [title, loading, items.length]);

  if (items.length === 0 && !loading) return null;

  const activeStep = findActiveAgentProgressStep(items);
  const completedSteps = items.filter((p) => !isAgentProgressActive(p));
  const phaseHeading =
    activeStep?.phaseGroup != null
      ? `Fase ${activeStep.phaseGroup.current}/${activeStep.phaseGroup.total}: ${activeStep.phaseGroup.label}`
      : null;
  const usePhaseMode = phaseHeading != null;
  const visibleCompleted = usePhaseMode
    ? []
    : completedSteps.length > 6
      ? completedSteps.slice(-5)
      : completedSteps;
  const hiddenCompletedCount = usePhaseMode ? 0 : completedSteps.length - visibleCompleted.length;

  return (
    <div
      className={cn(
        "rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--card)_35%,var(--background))] px-3 py-3 shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy={loading || undefined}
    >
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground-subtle)]">
        {heading}
      </p>
      {phaseHeading ? (
        <p className="mb-2 text-sm font-semibold tracking-tight text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]">
          {phaseHeading}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {hiddenCompletedCount > 0 ? (
            <li className="pl-[calc(1.125rem+0.625rem)] text-xs text-[var(--foreground-subtle)]">
              {hiddenCompletedCount} paso{hiddenCompletedCount === 1 ? "" : "s"} anterior
              {hiddenCompletedCount === 1 ? "" : "es"} completado{hiddenCompletedCount === 1 ? "" : "s"}
            </li>
          ) : null}
          {visibleCompleted.map((p, i) => {
            const index = completedSteps.length - visibleCompleted.length + i;
            return (
              <ProgressStepRow
                key={`done-${p.step ?? p.agent}-${index}-${p.message.slice(0, 24)}`}
                item={p}
                label={resolveAgentProgressDisplayLabel(completedSteps, index, false)}
              />
            );
          })}
          {activeStep ? (
            <ProgressStepRow
              key={`active-${activeStep.step ?? activeStep.agent}-${items.indexOf(activeStep)}`}
              item={activeStep}
              label={
                usePhaseMode
                  ? activeStep.message
                  : resolveAgentProgressDisplayLabel(items, items.indexOf(activeStep), true)
              }
            />
          ) : null}
          {loading && !activeStep ? (
            <li className="grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-x-2.5 text-sm">
              <span className="flex h-5 w-[1.125rem] shrink-0 items-center justify-center pt-0.5 text-[var(--primary)]" aria-hidden>
                <AiGenerativeDots />
              </span>
              <span className="min-w-0 pt-0.5 font-semibold leading-snug text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]">
                Iniciando siguiente paso…
              </span>
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-x-2.5 text-sm text-[var(--muted-foreground)]">
          <span className="flex h-5 w-[1.125rem] shrink-0 items-center justify-center pt-0.5 text-[var(--primary)]" aria-hidden>
            <AiGenerativeDots />
          </span>
          <span className="min-w-0 pt-0.5 leading-snug">Procesando…</span>
        </div>
      )}
    </div>
  );
}
