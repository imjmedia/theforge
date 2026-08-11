import { useState } from "react";
import { AlertTriangle, CheckCircle2, GitMerge } from "lucide-react";
import type { MddUpstreamSyncStatus, ProjectGenerationStatus } from "@theforge/shared-types";
import { effectiveMddUpstreamSyncStatus, MDD_UPSTREAM_SOURCE_LABELS } from "@theforge/shared-types";
import { cn } from "@/lib/utils";
import { WorkshopPanelButton, WorkshopButtonIcon } from "@/components/WorkshopButtons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";

export interface MddUpstreamSyncBannerProps {
  syncStatus: MddUpstreamSyncStatus | null | undefined;
  /** Estado de generación para ocultar el banner mientras corre pipeline/upstream-sync. */
  generationStatus?: Pick<ProjectGenerationStatus, "mddJobs"> | null;
  disabled?: boolean;
  onOpenSyncDialog: () => void;
  /** Re-ancla baseline sin regenerar MDD (acknowledge humano). */
  onAcceptSynced?: () => Promise<void> | void;
}

/**
 * Aviso cuando DBGA/BRD/Benchmark cambiaron respecto al baseline del MDD persistido.
 */
export default function MddUpstreamSyncBanner({
  syncStatus,
  generationStatus,
  disabled = false,
  onOpenSyncDialog,
  onAcceptSynced,
}: MddUpstreamSyncBannerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const effectiveSync = effectiveMddUpstreamSyncStatus(syncStatus, generationStatus);
  if (!effectiveSync?.pendingSync || !effectiveSync.canSync) return null;

  const sources =
    effectiveSync.changedSources?.map((s) => MDD_UPSTREAM_SOURCE_LABELS[s] ?? s).join(", ") ||
    "documentos upstream";

  const handleConfirmAccept = async () => {
    if (!onAcceptSynced || accepting) return;
    setAccepting(true);
    try {
      await onAcceptSynced();
      setConfirmOpen(false);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div
      className={cn(
        "shrink-0 border-b px-3 py-2 sm:px-4 sm:py-2.5",
        "border-[color-mix(in_oklch,var(--warning)_42%,var(--border))]",
        "bg-[color-mix(in_oklch,var(--warning)_14%,var(--card))]",
        "dark:bg-[color-mix(in_oklch,var(--warning)_12%,var(--card))]",
      )}
      role="region"
      aria-label="Cambios upstream pendientes de reflejar en el MDD"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))] sm:mt-0"
            aria-hidden
          />
          <p className="min-w-0 text-sm leading-snug text-[var(--foreground)]">
            <span className="font-semibold">MDD desactualizado:</span> hay cambios en {sources} que no están reflejados
            en el MDD. Puedes sincronizar solo las secciones afectadas (§
            {(effectiveSync.expandedSections ?? []).join(", §")}) o regenerar el documento completo.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onAcceptSynced ? (
            <WorkshopPanelButton
              tone="secondary"
              disabled={disabled || accepting}
              onClick={() => setConfirmOpen(true)}
            >
              <WorkshopButtonIcon icon={CheckCircle2} tone="secondary" />
              Marcar MDD como sincronizado
            </WorkshopPanelButton>
          ) : null}
          <WorkshopPanelButton tone="primary" disabled={disabled || accepting} onClick={onOpenSyncDialog}>
            <WorkshopButtonIcon icon={GitMerge} tone="primary" />
            Sincronizar MDD…
          </WorkshopPanelButton>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !accepting && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar MDD como sincronizado?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmas que el MDD actual ya refleja Fase 0 / BRD / Benchmark. No se regenerará contenido; solo se
              actualiza el baseline para apagar este aviso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={accepting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={accepting} onClick={(e) => {
              e.preventDefault();
              void handleConfirmAccept();
            }}>
              {accepting ? "Guardando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
