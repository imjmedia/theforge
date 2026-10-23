/**
 * @fileoverview Folder tile with layered pocket, document peek on hover, and compact metadata.
 */
import type { DragEvent } from "react";
import { Check, GitBranch, Heart, Loader2, Palette, Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectFolderStatus = "ROJO" | "AMARILLO" | "VERDE";

export interface ProjectFolderTileProps {
  id: string;
  name: string;
  status: ProjectFolderStatus;
  precisionScore: number;
  approach?: "DOMAIN_FIRST" | "UX_FIRST";
  projectType?: "NEW" | "LEGACY";
  visibility?: "PRIVATE" | "SHARED";
  selected: boolean;
  selectable: boolean;
  isFavorite?: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleFavorite?: (id: string) => void;
  onRename?: (id: string) => void;
  /** Habilita arrastrar la carpeta a otro grupo (admin). */
  draggable?: boolean;
  isDragging?: boolean;
  isMoving?: boolean;
  /** Job MDD o entregables en curso (panel de proyectos). */
  generationBusy?: boolean;
  /** Etiqueta de etapa/agente en curso (`activeGenerationLabel`). */
  generationLabel?: string | null;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLElement>) => void;
}

const statusDotClass: Record<ProjectFolderStatus, string> = {
  ROJO: "bg-[var(--destructive)]",
  AMARILLO: "bg-[var(--warning)]",
  VERDE: "bg-[var(--success)]",
};

const statusLabelEs: Record<ProjectFolderStatus, string> = {
  ROJO: "Semáforo rojo",
  AMARILLO: "Semáforo amarillo",
  VERDE: "Semáforo verde",
};

const tileActionButtonClass = cn(
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm transition-all duration-150",
  "border-[color-mix(in_oklch,var(--foreground)_12%,var(--border))] bg-[color-mix(in_oklch,var(--card)_90%,var(--background))]",
  "text-[var(--muted-foreground)] hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))] hover:bg-[color-mix(in_oklch,var(--muted)_58%,var(--card))] hover:text-[var(--foreground)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background)]",
);

const tileActionButtonActiveClass =
  "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_88%,black)] text-[var(--primary-foreground)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]";

const tileFavoriteActiveClass =
  "border-[color-mix(in_oklch,var(--destructive)_45%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] text-[var(--destructive)] hover:border-[color-mix(in_oklch,var(--destructive)_55%,var(--border))] hover:bg-[color-mix(in_oklch,var(--destructive)_18%,var(--card))] hover:text-[var(--destructive)]";

/**
 * Layered folder with papers that slide up on `group-hover` (parent must have `group`).
 */
function FolderWithPeekPapers() {
  return (
    <div className="relative mx-auto h-[5.75rem] w-[7rem] shrink-0 select-none" aria-hidden>
      {/* Folder back + tab (single silhouette feel) */}
      <div className="absolute inset-x-0 top-[0.65rem] bottom-0 rounded-xl bg-[#3a3a3e] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" />
      <div className="absolute left-[0.35rem] top-[0.4rem] z-[1] h-[0.65rem] w-[42%] rounded-t-[10px] bg-[#45454b] shadow-sm ring-1 ring-white/[0.04]" />

      {/* Pocket: papers clipped; on hover they slide up (staggered end positions). */}
      <div className="absolute left-[10%] right-[10%] top-[1.35rem] z-[2] h-[2.45rem] overflow-hidden rounded-b-md">
        <div className="flex h-full flex-col items-center justify-end gap-[3px] pb-0 will-change-transform">
          {/* Sheet 3 (back) */}
          <div
            className={cn(
              "h-5 w-[86%] rounded-[5px] border border-zinc-400/25 bg-zinc-100/95 shadow-md will-change-transform",
              "translate-y-10 opacity-80 transition-[transform,opacity] duration-500 ease-forge-smooth dark:border-zinc-500/40 dark:bg-zinc-200/95",
              "delay-0 group-hover:translate-y-1 group-hover:opacity-100 group-hover:delay-0",
              "motion-reduce:translate-y-1 motion-reduce:opacity-100 motion-reduce:transition-none",
            )}
          />
          {/* Sheet 2 */}
          <div
            className={cn(
              "h-5 w-[90%] translate-x-px rounded-[5px] border border-zinc-400/35 bg-white shadow-md will-change-transform",
              "translate-y-11 transition-[transform,opacity] duration-500 ease-forge-smooth dark:border-zinc-500/55 dark:bg-zinc-50",
              "delay-0 group-hover:translate-y-0.5 group-hover:delay-75",
              "motion-reduce:translate-y-0.5 motion-reduce:transition-none",
            )}
          />
          {/* Sheet 1 (front) + PDF chip */}
          <div
            className={cn(
              "relative h-6 w-[94%] rounded-[6px] border border-zinc-300/70 bg-white shadow-lg will-change-transform",
              "translate-y-12 transition-[transform,opacity] duration-500 ease-forge-smooth dark:border-zinc-500/65 dark:bg-white",
              "delay-0 group-hover:translate-y-0 group-hover:delay-150",
              "motion-reduce:translate-y-0 motion-reduce:transition-none",
            )}
          >
            <span className="absolute left-2 top-1 rounded px-1 py-px text-[6px] font-bold uppercase leading-none tracking-wide text-white shadow-sm bg-red-500">
              PDF
            </span>
          </div>
        </div>
      </div>

      {/* Front flap (covers lower pocket — papers slide from behind) */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[52%] rounded-b-xl rounded-t-sm bg-gradient-to-b from-[#4a4a50] to-[#353539] shadow-[0_-2px_8px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.05]"
        style={{
          clipPath: "polygon(0 18%, 12% 0, 100% 0, 100% 100%, 0 100%)",
        }}
      />

      {/* Subtle inner lip line */}
      <div className="pointer-events-none absolute inset-x-[8%] bottom-[48%] z-[4] h-px bg-black/25 dark:bg-white/10" />
    </div>
  );
}

export function ProjectFolderTile({
  id,
  name,
  status,
  precisionScore,
  approach,
  projectType,
  visibility,
  selected,
  selectable,
  isFavorite,
  onOpen,
  onToggleSelect,
  onToggleFavorite,
  onRename,
  draggable = false,
  isDragging = false,
  isMoving = false,
  generationBusy = false,
  generationLabel = null,
  onDragStart,
  onDragEnd,
}: ProjectFolderTileProps) {
  const typeIsNew = (projectType ?? "NEW") === "NEW";
  const isShared = visibility === "SHARED";
  const selectId = `select-project-${id}`;
  const visibilityLabel = isShared ? "Compartido" : "Privado";
  const busyLabel = generationBusy ? (generationLabel?.trim() || "Generación en curso…") : null;
  const subtitle = generationBusy
    ? busyLabel
    : `${precisionScore}% precisión · ${statusLabelEs[status]} · ${visibilityLabel}`;
  const hasActionBar = selectable || !!onToggleFavorite || !!onRename;

  return (
    <article
      className={cn(
        "group relative rounded-2xl border border-transparent p-3 transition-[background-color,border-color,opacity,transform] duration-300 ease-forge-smooth motion-reduce:transition-none",
        "hover:bg-[color-mix(in_oklch,var(--muted)_65%,transparent)]",
        generationBusy &&
          "border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_6%,transparent)]",
        isDragging && "scale-[0.98] opacity-45",
        isMoving && "pointer-events-none opacity-60",
        selected && "border-[var(--primary)]/50 bg-[color-mix(in_oklch,var(--primary)_10%,var(--muted))] ring-2 ring-[var(--primary)]/35 ring-offset-2 ring-offset-[var(--background)]",
      )}
    >
      {hasActionBar ? (
        <div
          className="absolute inset-x-2.5 top-2.5 z-30 flex items-center justify-between gap-2"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
        >
          {selectable ? (
            <div className="flex items-center">
              <input
                id={selectId}
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect()}
                className="peer sr-only"
                aria-label={`Seleccionar carpeta ${name}`}
              />
              <label
                htmlFor={selectId}
                className={cn(
                  tileActionButtonClass,
                  "cursor-pointer",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--background)]",
                  selected && tileActionButtonActiveClass,
                )}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 stroke-[2.75] transition-[opacity,transform] duration-150",
                    selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
                  )}
                  aria-hidden
                />
              </label>
            </div>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden />
          )}

          {(onToggleFavorite || onRename) && (
            <div className="flex items-center gap-1">
              {onToggleFavorite ? (
                <button
                  type="button"
                  onClick={() => onToggleFavorite(id)}
                  className={cn(tileActionButtonClass, isFavorite && tileFavoriteActiveClass)}
                  aria-label={isFavorite ? `Quitar ${name} de favoritos` : `Añadir ${name} a favoritos`}
                  aria-pressed={isFavorite}
                >
                  <Heart
                    className="h-3.5 w-3.5 shrink-0"
                    fill={isFavorite ? "currentColor" : "none"}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
              ) : null}
              {onRename ? (
                <button
                  type="button"
                  onClick={() => onRename(id)}
                  className={tileActionButtonClass}
                  aria-label={`Configuración del proyecto ${name}`}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <button
        type="button"
        draggable={draggable}
        onDragStart={draggable ? onDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-xl px-1 pb-1 text-center outline-none transition-transform duration-500 ease-forge-smooth",
          "group-hover:scale-[1.02] active:scale-[0.99] motion-reduce:group-hover:scale-100 motion-reduce:active:scale-100",
          "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
          draggable && "cursor-grab active:cursor-grabbing",
          hasActionBar ? "pt-9" : "pt-2",
        )}
        aria-label={
          generationBusy
            ? `Abrir proyecto ${name}, ${busyLabel}`
            : `Abrir proyecto ${name}, ${statusLabelEs[status]}, precisión ${precisionScore} por ciento`
        }
      >
        <div className="relative w-full">
          {isMoving ? (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" aria-hidden />
            </div>
          ) : null}
          {generationBusy ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center">
              <span className="inline-flex max-w-[95%] items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] px-2 py-0.5 text-[10px] font-semibold leading-tight text-[var(--primary)] shadow-sm">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                <span className="truncate">{busyLabel}</span>
              </span>
            </div>
          ) : null}
          <FolderWithPeekPapers />

          {/* Overlapping “integration” badges — tipo + semáforo */}
          <div className="pointer-events-none absolute bottom-[0.15rem] left-1/2 z-20 flex -translate-x-1/2 translate-y-1/2 items-center">
            <div className="flex -space-x-1.5">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--background)] shadow-md",
                  typeIsNew
                    ? approach === "UX_FIRST"
                      ? "bg-pink-500 text-white"
                      : "bg-emerald-500 text-white"
                    : "bg-amber-500 text-white",
                )}
                title={
                  typeIsNew
                    ? approach === "UX_FIRST"
                      ? "Proyecto nuevo (UX-First)"
                      : "Proyecto nuevo (Domain-First)"
                    : "Legacy"
                }
              >
                {typeIsNew ? (
                  approach === "UX_FIRST" ? (
                    <Palette className="h-3 w-3" strokeWidth={2.5} />
                  ) : (
                    <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                  )
                ) : (
                  <GitBranch className="h-3 w-3" strokeWidth={2.5} />
                )}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--background)] shadow-md ring-1 ring-black/10",
                  "bg-[var(--card)]",
                )}
                title={statusLabelEs[status]}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", statusDotClass[status])} />
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 w-full min-w-0 px-0.5">
          <p className="line-clamp-2 text-center text-[0.9375rem] font-semibold leading-snug tracking-tight text-[var(--foreground)]">
            {name}
          </p>
          <p
            className={cn(
              "mt-1 line-clamp-2 text-center text-xs leading-snug",
              generationBusy ? "font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]",
            )}
          >
            {subtitle}
          </p>
        </div>
      </button>
    </article>
  );
}
