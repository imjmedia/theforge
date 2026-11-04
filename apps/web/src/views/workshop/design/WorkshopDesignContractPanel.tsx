import { useEffect } from "react";
import { FileCode, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { useWorkshopStore } from "@/store/workshopStore";
import { summarizeDesignPhaseGate } from "./design-panels.util";

export function WorkshopDesignContractPanel({ projectId }: { projectId: string }) {
  const designLoading = useWorkshopStore((s) => s.designLoading);
  const designSaving = useWorkshopStore((s) => s.designSaving);
  const designSpec = useWorkshopStore((s) => s.designSpec);
  const designRevision = useWorkshopStore((s) => s.designRevision);
  const designGates = useWorkshopStore((s) => s.designGates);
  const designStale = useWorkshopStore((s) => s.designStale);
  const designPanelError = useWorkshopStore((s) => s.designPanelError);
  const fetchDesign = useWorkshopStore((s) => s.fetchDesign);
  const compileDesignContractAction = useWorkshopStore((s) => s.compileDesignContractAction);
  const generateMddFromBenchmark = useWorkshopStore((s) => s.generateMddFromBenchmark);

  useEffect(() => {
    if (!designSpec && !designLoading) void fetchDesign(projectId);
  }, [designSpec, designLoading, fetchDesign, projectId]);

  const phase3 = summarizeDesignPhaseGate("phase3", designGates);
  const busy = designLoading || designSaving;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Contrato</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Compila el PAG y OpenAPI deterministas antes de lanzar el job del MDD.
        </p>
      </div>

      {designStale ? (
        <p className="rounded-lg border border-[color-mix(in_oklch,var(--warning)_40%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_10%,var(--card))] px-3 py-2 text-sm text-[var(--foreground)]">
          El diseño cambió después de la última compilación. Vuelve a compilar el contrato antes de continuar.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        {(["phase1", "phase2", "phase3"] as const).map((key) => {
          const gate = summarizeDesignPhaseGate(key, designGates);
          return (
            <div
              key={key}
              className={`rounded-lg border px-3 py-2 text-xs ${
                gate.ok
                  ? "border-[color-mix(in_oklch,var(--success)_35%,var(--border))]"
                  : "border-[var(--border)]"
              }`}
            >
              <p className="font-semibold text-[var(--foreground)]">{gate.label}</p>
              <p className="text-[var(--foreground-muted)]">{gate.detail}</p>
            </div>
          );
        })}
      </div>

      {designPanelError ? (
        <p className="rounded-lg border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,var(--card))] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--destructive)_90%,var(--foreground))]">
          {designPanelError}
        </p>
      ) : null}

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Procesando…
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || designRevision == null}
          onClick={() => {
            if (designRevision == null) return;
            void compileDesignContractAction(projectId, { revision: designRevision });
          }}
        >
          <FileCode className="mr-1.5 h-4 w-4" aria-hidden />
          Compilar contrato
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !phase3.ok || designStale}
          title={
            !phase3.ok
              ? "Completa la fase 3 antes de generar el MDD"
              : designStale
                ? "Recompila el contrato primero"
                : undefined
          }
          onClick={() => void generateMddFromBenchmark(projectId)}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
          Generar MDD compilado
        </Button>
      </div>

      {phase3.ok && !designStale ? (
        <p className="text-xs text-[color-mix(in_oklch,var(--success)_80%,var(--foreground))]">
          Contrato listo. Puedes lanzar el job del MDD.
        </p>
      ) : null}
    </div>
  );
}
