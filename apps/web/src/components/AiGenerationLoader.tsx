import { Braces, FileText, LayoutTemplate, MessageCircle, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AiGenerativeDotsProps = {
  className?: string;
};

/**
 * Staggered dots — compact “AI is building” affordance (replaces a plain spinner in tight UI).
 */
export function AiGenerativeDots({ className }: AiGenerativeDotsProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-ai-dot-wave"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

type AiGenerationPanelProps = {
  title: string;
  subtitle?: string;
  className?: string;
};

/**
 * Full-width panel with shimmer sweep + dots — document / long-running generation (workshop).
 */
export function AiGenerationPanel({ title, subtitle, className }: AiGenerationPanelProps) {
  return (
    <div
      className={cn(
        "relative min-h-[4.25rem] overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--primary)_26%,var(--border))] bg-[color-mix(in_oklch,var(--card)_55%,var(--background))] px-4 py-3.5 shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
        <div className="absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--primary)_28%,transparent)] to-transparent opacity-80 blur-[1px] animate-ai-shimmer-sweep" />
      </div>
      <div className="relative flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-start sm:text-left sm:gap-3">
        <span className="flex shrink-0 items-center justify-center text-[var(--primary)]">
          <AiGenerativeDots className="scale-110" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold tracking-tight text-[var(--foreground)]">{title}</p>
          {subtitle ? (
            <p className="text-xs leading-relaxed text-[var(--foreground-subtle)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type AiGenerationChatBubbleProps = {
  /** Short line, e.g. “Generando…” */
  label?: string;
  className?: string;
};

/**
 * Chat bubble replacement for a lone spinner — subtle border + dots + label.
 */
export function AiGenerationChatBubble({ label = "Generando…", className }: AiGenerationChatBubbleProps) {
  return (
    <div
      className={cn(
        "relative inline-flex max-w-[min(100%,20rem)] items-center gap-2.5 overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_85%,var(--primary))] bg-[color-mix(in_oklch,var(--card)_70%,var(--background))] px-3.5 py-2.5 shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
        <div className="absolute inset-y-0 left-0 w-[70%] bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--primary)_14%,transparent)] to-transparent opacity-70 animate-ai-shimmer-sweep" />
      </div>
      <span className="relative shrink-0 text-[var(--primary)]">
        <AiGenerativeDots />
      </span>
      <span className="relative text-xs font-medium text-[color-mix(in_oklch,var(--foreground)_82%,var(--muted-foreground))]">
        {label}
      </span>
    </div>
  );
}

const DOC_BUILD_FLOAT_ICONS: {
  Icon: LucideIcon;
  className: string;
  delayMs: number;
}[] = [
  { Icon: Sparkles, className: "left-[6%] top-[10%] h-6 w-6", delayMs: 0 },
  { Icon: FileText, className: "right-[8%] top-[14%] h-6 w-6", delayMs: 400 },
  { Icon: MessageCircle, className: "left-[10%] bottom-[18%] h-5 w-5", delayMs: 800 },
  { Icon: LayoutTemplate, className: "right-[12%] bottom-[14%] h-5 w-5", delayMs: 1200 },
  { Icon: Braces, className: "left-[42%] top-[38%] h-5 w-5 -translate-x-1/2", delayMs: 600 },
];

export type AiDocumentBuildingPlaceholderProps = {
  /** Document name for the status line, e.g. “Spec”. */
  documentTitle?: string;
  /** Progreso reportado por el plugin (0–100). */
  progress?: {
    percent: number;
    detail?: string;
  };
  className?: string;
};

/**
 * Workshop document column: Figma Make–style “building” state (dashed frame, skeleton shimmer, floating icons).
 */
export function AiDocumentBuildingPlaceholder({
  documentTitle,
  progress,
  className,
}: AiDocumentBuildingPlaceholderProps) {
  const lineWidthsPct = [100, 88, 94, 62, 76];
  const percent = progress?.percent;
  const statusLine = documentTitle?.trim()
    ? `Generando ${documentTitle.trim()}…`
    : "Generando documento…";
  const detailLine = progress?.detail?.trim();

  return (
    <div
      className={cn("flex w-full max-w-md flex-col items-center gap-5", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "relative w-full min-h-[200px] overflow-hidden rounded-2xl border-2 border-dashed p-6 sm:min-h-[220px]",
          "border-[color-mix(in_oklch,var(--border)_70%,var(--muted-foreground))] bg-[color-mix(in_oklch,var(--card)_35%,var(--background))]",
        )}
      >
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden>
          <div className="absolute inset-y-0 left-0 w-[50%] bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--primary)_22%,transparent)] to-transparent opacity-60 blur-[1px] animate-ai-shimmer-sweep" />
        </div>

        <div className="relative z-10 mx-auto max-w-[92%] space-y-3 pt-1">
          {lineWidthsPct.map((w, i) => (
            <div
              key={i}
              className="relative h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted)_48%,var(--card))]"
              style={{ width: `${w}%` }}
            >
              <div
                className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--primary)_32%,transparent)] to-transparent opacity-80 animate-ai-skeleton-shine"
                style={{ animationDelay: `${i * 160}ms` }}
                aria-hidden
              />
            </div>
          ))}
        </div>

        {DOC_BUILD_FLOAT_ICONS.map(({ Icon, className: iconPos, delayMs }, idx) => (
          <Icon
            key={idx}
            className={cn(
              "pointer-events-none absolute z-20 text-[color-mix(in_oklch,var(--primary)_70%,var(--foreground))] drop-shadow-[0_1px_2px_color-mix(in_oklch,var(--background)_85%,transparent)] animate-ai-doc-float",
              iconPos,
            )}
            strokeWidth={1.35}
            style={{ animationDelay: `${delayMs}ms` }}
            aria-hidden
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium tracking-tight text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">
          {statusLine}
        </p>
        {typeof percent === "number" ? (
          <div className="flex w-full max-w-[220px] flex-col items-center gap-1.5">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted)_55%,var(--card))]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
            <p className="text-xs font-semibold tabular-nums text-[var(--primary)]">{percent}%</p>
          </div>
        ) : null}
        {detailLine ? (
          <p className="max-w-[260px] text-xs leading-relaxed text-[var(--foreground-subtle)]">
            {detailLine}
          </p>
        ) : null}
        <span className="text-[var(--primary)]">
          <AiGenerativeDots className="scale-125" />
        </span>
      </div>
    </div>
  );
}
