import { Sparkles, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AiDocumentBuildingPlaceholder } from "@/components/AiGenerationLoader";
import { WORKSHOP_DOC_EMPTY_PRIMARY_BTN } from "@/components/WorkshopDocSourceSaveBar";

export function DocEmptyState({
  icon: Icon,
  title,
  description,
  onGenerate,
  loading,
  hasMdd,
  generateBlocked,
  generateBlockedReason,
  /** Etiqueta para botón "Generar desde MDD Inicial" en legacy etapa 1 */
  legacyGenerateLabel,
  onLegacyGenerate,
  legacyGenerateLoading,
  generateButtonLabel,
  prerequisiteHint,
  generationProgress,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onGenerate: () => void;
  loading: boolean;
  /** When false, primary generate stays disabled and `prerequisiteHint` is shown. */
  hasMdd: boolean;
  /** ej. Blueprint §3 incompleto — bloquea generación aunque haya MDD */
  generateBlocked?: boolean;
  generateBlockedReason?: string;
  legacyGenerateLabel?: string;
  onLegacyGenerate?: () => void;
  legacyGenerateLoading?: boolean;
  /** Overrides default «Generar {title} desde MDD». */
  generateButtonLabel?: string;
  /** Shown when `hasMdd` is false (e.g. Benchmark needs Fase 0). */
  prerequisiteHint?: string;
  /** Progreso de generación (plugins con reportProgress). */
  generationProgress?: { percent: number; detail?: string };
}) {
  const blocked = !!generateBlocked;
  if (loading && !blocked) {
    return (
      <div className="flex min-h-[280px] w-full flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6">
        <AiDocumentBuildingPlaceholder documentTitle={title} progress={generationProgress} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[260px] w-full flex-1 flex-col items-center justify-center gap-6 px-4 py-8 text-center sm:px-6">
      <Icon
        className="h-10 w-10 shrink-0 text-[color-mix(in_oklch,var(--primary)_45%,var(--muted-foreground))]"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="flex min-w-0 max-w-md flex-col gap-2">
        <h3 className="text-lg font-semibold tracking-tight text-[var(--foreground)] sm:text-xl">{title}</h3>
        <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{description}</p>
      </div>
      <div className="flex w-full max-w-md min-w-0 flex-col items-stretch gap-3">
        <Button
          type="button"
          variant="default"
          size="default"
          className={cn("w-full", WORKSHOP_DOC_EMPTY_PRIMARY_BTN)}
          onClick={onGenerate}
          disabled={loading || !hasMdd || blocked}
          loading={loading}
          generativeLoading={loading}
        >
          {!loading ? <Sparkles className="h-4 w-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden /> : null}
          {generateButtonLabel ?? `Generar ${title} desde MDD`}
        </Button>
        {!hasMdd && !blocked && (
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            {prerequisiteHint ??
              "Necesitas tener contenido en el MDD para generar este documento."}
          </p>
        )}
        {blocked && generateBlockedReason && (
          <p className="text-xs font-medium leading-relaxed text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]">
            {generateBlockedReason}
          </p>
        )}
        {legacyGenerateLabel && onLegacyGenerate && (
          <Button
            type="button"
            variant="outline"
            size="default"
            className="h-9 min-h-9 w-full gap-2 rounded-xl font-medium"
            onClick={onLegacyGenerate}
            disabled={legacyGenerateLoading}
            loading={legacyGenerateLoading}
            generativeLoading={legacyGenerateLoading}
          >
            {!legacyGenerateLoading ? <RefreshCw className="h-4 w-4 shrink-0 text-[var(--primary)]" strokeWidth={2} aria-hidden /> : null}
            {legacyGenerateLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
