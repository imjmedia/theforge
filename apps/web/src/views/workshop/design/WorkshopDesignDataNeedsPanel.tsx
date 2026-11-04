import { useEffect } from "react";
import { Database, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { useWorkshopStore } from "@/store/workshopStore";
import { summarizeDesignPhaseGate } from "./design-panels.util";
import { DesignProposalDiffDialog } from "./DesignProposalDiffDialog";

export function WorkshopDesignDataNeedsPanel({ projectId }: { projectId: string }) {
  const designLoading = useWorkshopStore((s) => s.designLoading);
  const designSaving = useWorkshopStore((s) => s.designSaving);
  const designSpec = useWorkshopStore((s) => s.designSpec);
  const designRevision = useWorkshopStore((s) => s.designRevision);
  const designGates = useWorkshopStore((s) => s.designGates);
  const designPanelError = useWorkshopStore((s) => s.designPanelError);
  const pendingProposal = useWorkshopStore((s) => s.pendingDesignProposal);
  const fetchDesign = useWorkshopStore((s) => s.fetchDesign);
  const proposeDesignDataNeedsAction = useWorkshopStore((s) => s.proposeDesignDataNeedsAction);
  const acceptDesignProposalAction = useWorkshopStore((s) => s.acceptDesignProposalAction);
  const rejectDesignProposalAction = useWorkshopStore((s) => s.rejectDesignProposalAction);
  const setPendingDesignProposal = useWorkshopStore((s) => s.setPendingDesignProposal);

  useEffect(() => {
    if (!designSpec && !designLoading) void fetchDesign(projectId);
  }, [designSpec, designLoading, fetchDesign, projectId]);

  const dataNeeds = designSpec?.dataNeeds ?? [];
  const dataNeedRows = dataNeeds.flatMap((entry) =>
    entry.components.flatMap((comp) =>
      comp.needs.map((need) => ({
        key: `${entry.screenId}-${comp.componentId}-${need.id}`,
        screenId: entry.screenId,
        componentId: comp.componentId,
        need,
      })),
    ),
  );
  const phase2 = summarizeDesignPhaseGate("phase2", designGates);
  const busy = designLoading || designSaving;
  const empty = !busy && dataNeedRows.length === 0;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Necesidades de datos</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Propón necesidades con procedencia visible y revisa incidencias de la fase 2.
        </p>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-sm ${
          phase2.ok
            ? "border-[color-mix(in_oklch,var(--success)_35%,var(--border))] bg-[color-mix(in_oklch,var(--success)_8%,var(--card))]"
            : "border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))]"
        }`}
      >
        <p className="font-medium">{phase2.label}</p>
        <p className="text-xs text-[var(--foreground-muted)]">{phase2.detail}</p>
      </div>

      {designPanelError ? (
        <p className="rounded-lg border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,var(--card))] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--destructive)_90%,var(--foreground))]">
          {designPanelError}
        </p>
      ) : null}

      {busy && empty ? (
        <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando…
        </div>
      ) : null}

      {empty ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--foreground-muted)]">
          Sin necesidades de datos. Genera una propuesta para empezar.
        </p>
      ) : (
        <ul className="space-y-2">
          {dataNeedRows.map((row) => (
            <li
              key={row.key}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            >
              <div className="flex items-start gap-2">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-[var(--foreground)]">
                    {row.need.name} · {row.need.action}
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Pantalla {row.screenId} · componente {row.componentId} · tipo {row.need.type}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                    Procedencia: {row.need.provenance}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        disabled={busy || designRevision == null}
        onClick={() => void proposeDesignDataNeedsAction(projectId)}
      >
        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
        Proponer necesidades de datos
      </Button>

      <DesignProposalDiffDialog
        open={!!pendingProposal && pendingProposal.diff.dataNeeds != null}
        onOpenChange={(open) => {
          if (!open) setPendingDesignProposal(null);
        }}
        proposal={pendingProposal?.diff.dataNeeds != null ? pendingProposal : null}
        busy={designSaving}
        onAccept={() => {
          if (!pendingProposal || designRevision == null) return;
          void acceptDesignProposalAction(projectId, pendingProposal.proposalId, designRevision);
        }}
        onReject={() => {
          if (!pendingProposal) return;
          void rejectDesignProposalAction(projectId, pendingProposal.proposalId);
        }}
      />
    </div>
  );
}
