import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import MddViewer from "@/components/MddViewer";
import { DocEmptyState } from "@/components/DocEmptyState";
import { AiDocumentBuildingPlaceholder } from "@/components/AiGenerationLoader";
import { WorkshopDocSourceSaveBar, WORKSHOP_DOC_EMPTY_PRIMARY_BTN } from "@/components/WorkshopDocSourceSaveBar";
import { WorkshopDocTextarea } from "@/components/WorkshopDocTextarea";
import { WorkshopDocumentStampBar } from "@/components/WorkshopDocumentStampBar";
import type { WorkshopDocumentTimestamps } from "@/utils/workshop-document-content.util";
import {
  DocumentClarificationSection,
  type DocumentClarificationSectionProps,
} from "@/components/DocumentClarificationSection";

export interface StandardDocPanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  content: string | null;
  onContentChange: (value: string | null) => void;
  onSave: () => void;
  isDirty: boolean;
  viewMode: "preview" | "source";
  onGenerate: () => void;
  canGenerate: boolean;
  isLoading: boolean;
  generateLabel?: string;
  placeholder?: string;
  onBlur?: () => void;
  /** Legacy generate (desde codebase, para spec/blueprint). */
  legacyGenerateLabel?: string;
  onLegacyGenerate?: () => void;
  legacyGenerateLoading?: boolean;
  /** Bloqueo específico (ej. Blueprint §3). */
  generateBlocked?: boolean;
  generateBlockedReason?: string;
  /** Oculta completamente los botones de generar (panel manual como AEM). */
  hideGenerate?: boolean;
  readOnly?: boolean;
  /** Fechas de creación/regeneración del documento persistido. */
  documentTimestamps?: WorkshopDocumentTimestamps | null;
  /** Clarificación `[NEEDS CLARIFICATION]` — banner, respuestas y regeneración. */
  clarification?: Omit<DocumentClarificationSectionProps, "content">;
  /** Etiqueta del botón Guardar en modo fuente (default: "Guardar"). */
  saveLabel?: string;
  /** Progreso de generación (plugins con reportProgress). */
  generationProgress?: { percent: number; detail?: string };
  /** Vista preview personalizada (p. ej. diapositivas EVD). */
  previewSlot?: ReactNode;
}

/**
 * Panel de documento estándar — 3 estados:
 * 1. Preview vacío → DocEmptyState (icono + descripción + botón Generar)
 * 2. Preview con contenido → MddViewer
 * 3. Source mode → textarea + savebar + botón "Generar" si está vacío
 */
export function StandardDocPanel({
  icon,
  title,
  description,
  content,
  onContentChange,
  onSave,
  isDirty,
  viewMode,
  onGenerate,
  canGenerate,
  isLoading,
  generateLabel,
  placeholder,
  onBlur,
  legacyGenerateLabel,
  onLegacyGenerate,
  legacyGenerateLoading,
  generateBlocked,
  generateBlockedReason,
  hideGenerate,
  readOnly = false,
  documentTimestamps,
  clarification,
  generationProgress,
  previewSlot,
  saveLabel,
}: StandardDocPanelProps) {
  const IconComp = icon;
  // Estado 1: preview vacío → DocEmptyState
  if (viewMode === "preview" && !content?.trim()) {
    if (hideGenerate) {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <IconComp className="h-12 w-12 text-[var(--muted-foreground)] opacity-50" strokeWidth={1.5} />
          <h3 className="text-lg font-semibold text-[var(--foreground)]">{title}</h3>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">{description}</p>
          <p className="mt-2 text-xs text-[var(--muted-foreground)] opacity-60">Este documento se escribe manualmente. Cambia a modo edición para empezar.</p>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocEmptyState
          icon={icon}
          title={title}
          description={description}
          onGenerate={onGenerate}
          loading={isLoading}
          hasMdd={canGenerate}
          generateBlocked={generateBlocked}
          generateBlockedReason={generateBlockedReason}
          legacyGenerateLabel={legacyGenerateLabel}
          onLegacyGenerate={onLegacyGenerate}
          legacyGenerateLoading={legacyGenerateLoading}
          generateButtonLabel={generateLabel}
          generationProgress={generationProgress}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {clarification ? (
        <DocumentClarificationSection {...clarification} content={content} />
      ) : null}
      {viewMode === "preview" ? (
        isLoading ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 text-center">
            <AiDocumentBuildingPlaceholder
              documentTitle={title}
              progress={generationProgress ?? { percent: 0, detail: "Iniciando generación…" }}
            />
          </div>
        ) : (
          previewSlot ?? (
            <MddViewer content={content || ""} documentTimestamps={documentTimestamps} />
          )
        )
      ) : (
        <>
          {isLoading && !content?.trim() && !hideGenerate && !readOnly ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 text-center">
              <AiDocumentBuildingPlaceholder documentTitle={title} progress={generationProgress} />
            </div>
          ) : (
            <>
              <WorkshopDocumentStampBar timestamps={documentTimestamps} />
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <WorkshopDocSourceSaveBar
                  onSave={onSave}
                  disabled={!isDirty || readOnly}
                  label={saveLabel}
                />
                <WorkshopDocTextarea
                  value={content ?? ""}
                  onChange={(v) => {
                    if (!readOnly) onContentChange(v || null);
                  }}
                  onBlur={onBlur}
                  disabled={readOnly}
                  placeholder={placeholder ?? `# ${title}\n\nEl contenido se genera aquí o puedes escribirlo manualmente...`}
                  className="min-h-0 w-full flex-1 bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] border border-[var(--border)] rounded-lg p-4 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none resize-none"
                  spellCheck={false}
                />
              </div>
              {!content?.trim() && !hideGenerate && !readOnly && (
                <div className="shrink-0 mt-4 flex min-h-[200px] w-full items-center justify-center px-4">
                  <Button
                    type="button"
                    variant="default"
                    size="default"
                    className={cn("w-full max-w-md sm:w-auto sm:min-w-[280px]", WORKSHOP_DOC_EMPTY_PRIMARY_BTN)}
                    onClick={onGenerate}
                    disabled={!canGenerate}
                  >
                    <Sparkles className="h-4 w-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden />
                    {generateLabel ?? `Generar ${title} desde MDD`}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
