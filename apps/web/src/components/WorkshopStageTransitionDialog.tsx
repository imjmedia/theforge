/**
 * Modal para transiciones de workflow de etapa (activar, completar, archivar, reabrir).
 */
import { useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Layers,
  PlayCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  getAllowedStageTransitions,
  type StageTransitionAction,
} from "@theforge/shared-types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useWorkshopStore, type WorkshopStage } from "@/store/workshopStore";
import { isWorkshopAgentsBusy } from "@/utils/workshopAgentsBusy";
import {
  stageTransitionActionAcceptsReason,
  stageTransitionActionDescription,
  stageTransitionActionLabel,
} from "@/utils/stageTransitionLabels";
import { stageWorkflowStatusLabel } from "@/utils/stageWorkflowStatusLabel";

export interface WorkshopStageTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: WorkshopStage | null;
}

const ACTION_ICONS: Record<StageTransitionAction, LucideIcon> = {
  activate: PlayCircle,
  complete: CheckCircle2,
  archive: Archive,
  reopen: RotateCcw,
};

function stageDisplayName(stage: WorkshopStage): string {
  return `#${stage.ordinal} ${stage.name ?? stage.key ?? stage.id.slice(0, 8)}`;
}

export function WorkshopStageTransitionDialog({
  open,
  onOpenChange,
  stage,
}: WorkshopStageTransitionDialogProps) {
  const transitionWorkshopStage = useWorkshopStore((s) => s.transitionWorkshopStage);
  const workshopBusy = useWorkshopStore((s) => isWorkshopAgentsBusy(s));
  const [pendingAction, setPendingAction] = useState<StageTransitionAction | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allowed = stage ? getAllowedStageTransitions(stage.workflowStatus) : [];

  useEffect(() => {
    if (!open) {
      setPendingAction(null);
      setReason("");
      setSubmitting(false);
    }
  }, [open, stage?.id]);

  async function handleConfirm() {
    if (!stage || !pendingAction) return;
    setSubmitting(true);
    try {
      const ok = await transitionWorkshopStage(
        stage.id,
        pendingAction,
        stageTransitionActionAcceptsReason(pendingAction) ? reason : undefined,
      );
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="gap-0 overflow-hidden p-0 sm:max-w-md" showClose>
        <div className="border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))] px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-start gap-3 pr-6">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--primary)_16%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_28%,transparent)]"
                aria-hidden
              >
                <Layers className="h-5 w-5 text-[var(--primary)]" strokeWidth={2} />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
                  {pendingAction ? stageTransitionActionLabel(pendingAction) : "Estado de la etapa"}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {stage ? (
                    <>
                      <span className="font-medium text-[var(--foreground)]">{stageDisplayName(stage)}</span>
                      {" · "}
                      {stageWorkflowStatusLabel(stage.workflowStatus)}
                    </>
                  ) : (
                    "Selecciona una etapa en el header."
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
          {!stage ? (
            <p className="text-sm text-[var(--muted-foreground)]">No hay etapa seleccionada.</p>
          ) : pendingAction ? (
            <>
              <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
                {stageTransitionActionDescription(pendingAction)}
              </p>
              {stageTransitionActionAcceptsReason(pendingAction) ? (
                <div className="space-y-1.5">
                  <label htmlFor="stage-transition-reason" className="block text-sm font-medium text-[var(--foreground)]">
                    Motivo (opcional)
                  </label>
                  <textarea
                    id="stage-transition-reason"
                    className="flex min-h-[72px] w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ej. release cerrada, cambio de alcance descartado"
                    disabled={submitting || workshopBusy}
                  />
                </div>
              ) : null}
            </>
          ) : allowed.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No hay transiciones disponibles desde{" "}
              <strong className="text-[var(--foreground)]">
                {stageWorkflowStatusLabel(stage.workflowStatus)}
              </strong>
              .
            </p>
          ) : (
            <ul className="space-y-2">
              {allowed.map((action) => {
                const Icon = ACTION_ICONS[action];
                return (
                  <li key={action}>
                    <button
                      type="button"
                      disabled={workshopBusy}
                      onClick={() => setPendingAction(action)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_88%,var(--background))] px-3 py-3 text-left transition-colors",
                        "hover:border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] hover:bg-[color-mix(in_oklch,var(--primary)_6%,var(--card))]",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--foreground)]">
                          {stageTransitionActionLabel(action)}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted-foreground)]">
                          {stageTransitionActionDescription(action)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_18%,var(--card))] px-5 py-3 sm:px-6">
          {pendingAction ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={submitting}
                onClick={() => {
                  setPendingAction(null);
                  setReason("");
                }}
              >
                Atrás
              </Button>
              <Button
                type="button"
                variant="default"
                className="w-full sm:w-auto"
                disabled={submitting || workshopBusy}
                loading={submitting}
                onClick={() => void handleConfirm()}
              >
                Confirmar
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
