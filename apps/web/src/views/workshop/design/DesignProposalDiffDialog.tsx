import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import type { DesignProposalResponse } from "@/lib/design-first-api";
import { groupProposalDiff, countProposalDiffChanges } from "./design-panels.util";

export interface DesignProposalDiffDialogProps {
  open: boolean;
  proposal: DesignProposalResponse | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
}

export function DesignProposalDiffDialog({
  open,
  proposal,
  busy,
  onOpenChange,
  onAccept,
  onReject,
}: DesignProposalDiffDialogProps) {
  const grouped = proposal ? groupProposalDiff(proposal.diff) : [];
  const changeCount = proposal ? countProposalDiffChanges(proposal.diff) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar propuesta de diseño</DialogTitle>
          <DialogDescription>
            {changeCount > 0
              ? `${changeCount} cambio(s) propuesto(s). Acepta para aplicar con revisión ${proposal?.baseRevision ?? "—"}.`
              : "No hay cambios en la propuesta."}
          </DialogDescription>
        </DialogHeader>
        {proposal?.issues?.length ? (
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--warning)_40%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))] p-3 text-xs text-[var(--foreground)]">
            <p className="font-semibold">Avisos</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {proposal.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="space-y-3">
          {grouped.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">Sin cambios que mostrar.</p>
          ) : (
            grouped.map((section) => (
              <div key={section.section + section.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                  {section.label}
                </p>
                <ul className="mt-1 space-y-1 text-sm text-[var(--foreground)]">
                  {section.items.map((item) => (
                    <li key={item} className="rounded-md border border-[var(--border)] bg-[var(--muted)]/20 px-2 py-1">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onReject}>
            Rechazar
          </Button>
          <Button type="button" disabled={busy || !proposal || changeCount === 0} onClick={onAccept}>
            Aceptar propuesta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
