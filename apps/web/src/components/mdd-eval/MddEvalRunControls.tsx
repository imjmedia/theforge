import { Loader2, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface MddEvalRunControlsProps {
  selectedCount: number;
  concurrency: number;
  onConcurrencyChange: (value: number) => void;
  keepProjects: boolean;
  onKeepProjectsChange: (value: boolean) => void;
  onStart: () => void;
  starting: boolean;
  /** Hay una corrida en cola o ejecutándose. */
  runActive: boolean;
}

export function MddEvalRunControls({
  selectedCount,
  concurrency,
  onConcurrencyChange,
  keepProjects,
  onKeepProjectsChange,
  onStart,
  starting,
  runActive,
}: MddEvalRunControlsProps) {
  const disabled = runActive || starting || selectedCount === 0;

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] p-4">
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm text-[var(--foreground)]"
      >
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
        <p>
          La evaluación usa <strong>tu proveedor de IA configurado</strong> (consume tokens y genera coste real) y
          crea <strong>proyectos temporales</strong> en el grupo «Proyectos» que se eliminan al terminar, salvo que
          actives «Conservar proyectos».
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Concurrencia
          </span>
          <select
            value={concurrency}
            disabled={runActive || starting}
            onChange={(e) => onConcurrencyChange(Number(e.target.value))}
            className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--input)] px-2 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "caso a la vez" : "casos a la vez"}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={keepProjects}
            aria-label="Conservar proyectos"
            disabled={runActive || starting}
            onClick={() => onKeepProjectsChange(!keepProjects)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50",
              keepProjects ? "bg-[var(--primary)]" : "bg-[var(--muted)] border-[var(--border)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-[var(--background)] shadow transition-transform",
                keepProjects ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
          <span>Conservar proyectos</span>
        </div>

        <Button type="button" onClick={onStart} disabled={disabled} className="ml-auto">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Ejecutar evaluación
          {selectedCount > 0 ? ` (${selectedCount})` : ""}
        </Button>
      </div>

      {runActive ? (
        <p className="text-xs text-[var(--foreground-muted)]">Hay una corrida en curso; espera a que termine o cancélala.</p>
      ) : selectedCount === 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">Selecciona al menos un caso.</p>
      ) : null}
    </div>
  );
}
