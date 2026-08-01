import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { b64ToDataUrl } from "./evd-deck.utils";
import type { EvdDeckJson } from "./evd-deck.types";
import { EvdSlideContent } from "./EvdSlideContent";

const BTN_OUTLINE =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_50%,transparent)] disabled:pointer-events-none disabled:opacity-50";

interface EvdDeckPreviewProps {
  deck: EvdDeckJson;
}

export function EvdDeckPreview({ deck }: EvdDeckPreviewProps): ReactElement {
  const slides = useMemo(
    () => [...deck.slides].sort((a, b) => a.order - b.order),
    [deck.slides],
  );
  const [index, setIndex] = useState(0);

  const branding = deck.branding;
  const primary = branding?.primaryColor ?? "#2563EB";
  const textColor = branding?.textColor ?? "#1f2937";
  const fontFamily = branding?.fontFamily ?? "system-ui, sans-serif";

  const slide = slides[index];
  const total = slides.length;

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  if (!slide) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--muted-foreground)]">
        No hay diapositivas en el deck.
      </div>
    );
  }

  const bgUrl =
    slide.backgroundB64 && !slide.backgroundB64.startsWith("[image")
      ? b64ToDataUrl(slide.backgroundB64)
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--foreground)]">
            {deck.meta.title}
          </h2>
          {deck.meta.subtitle ? (
            <p className="truncate text-xs text-[var(--muted-foreground)]">{deck.meta.subtitle}</p>
          ) : null}
        </div>
        <p className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
          {index + 1} / {total}
        </p>
      </div>

      <div
        className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--border)] shadow-lg"
        style={{ aspectRatio: "16 / 9", fontFamily }}
      >
        {bgUrl ? (
          <img
            src={bgUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${primary} 0%, ${branding?.secondaryColor ?? primary} 100%)`,
            }}
          />
        )}

        <div
          className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent"
          aria-hidden
        />

        <div
          className="relative flex h-full flex-col justify-end p-6 text-white md:p-10"
          style={bgUrl ? undefined : { color: textColor }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
            {slide.type.replace(/_/g, " ")}
          </p>
          <h3 className="mt-1 text-xl font-bold leading-tight md:text-3xl">{slide.title}</h3>
          <div className="max-h-[40%] overflow-y-auto pr-1">
            <EvdSlideContent slide={slide} />
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
        <button type="button" className={BTN_OUTLINE} onClick={goPrev} disabled={index === 0}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Anterior
        </button>

        <div className="hidden flex-1 justify-center gap-1.5 sm:flex">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Ir a diapositiva ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 w-2 rounded-full transition-transform duration-100",
                i === index
                  ? "scale-125 bg-[var(--primary)]"
                  : "bg-[var(--muted-foreground)]/40 hover:bg-[var(--muted-foreground)]/70",
              )}
            />
          ))}
        </div>

        <button type="button" className={BTN_OUTLINE} onClick={goNext} disabled={index >= total - 1}>
          Siguiente
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
