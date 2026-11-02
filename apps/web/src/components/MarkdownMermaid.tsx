/**
 * Renders ```mermaid fenced blocks from ReactMarkdown as SVG (default) with an optional Excalidraw
 * toggle (flowchart, erDiagram, sequenceDiagram y classDiagram). Supports fullscreen expand for dense diagrams.
 *
 * El render SVG lo orquesta `useMermaidRender` (./mermaid-render): original primero, reparación solo si
 * el parser real la acepta, error real si no. El SVG vive en estado y se pinta en un contenedor
 * siempre montado. El hook inline queda siempre habilitado: Excalidraw recibe su texto final (original
 * o reparado por el oráculo) y nunca convierte texto que el parser no aceptó.
 */
import {
  Children,
  Component,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Maximize2, Loader2, RotateCcw, Sparkles, Wrench, ZoomIn, ZoomOut, PenLine, Code } from "lucide-react";
import {
  prepareMermaidForRender,
} from "./mermaid-render-prep.util";
import {
  MERMAID_NO_AUTO_REPAIR_MESSAGE,
  mermaidKey,
  truncateMermaidError,
  useMermaidRender,
  type MermaidErrorState,
} from "./mermaid-render";
import { regenerateMermaidDiagram } from "@/lib/mermaid-api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { ExcalidrawDiagramBlock } from "./ExcalidrawDiagramBlock";
import {
  clampPanZoomScale,
  computeMermaidFitTransform,
  type PanZoomState,
} from "./mermaid-fit.util";
import {
  defaultMermaidViewMode,
  detectMermaidDiagramType,
  isExcalidrawSupported,
  isMermaidCodeBlock,
} from "./mermaid-diagram-type.util";

export const MERMAID_BLOCK_MARKER = "data-theforge-mermaid";

/** Re-export: la clave vive en `mermaid-render` para poder probarse sin DOM. */
export { mermaidKey };

function flattenMarkdownChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement(child) && child.props && typeof child.props === "object") {
        const props = child.props as { children?: ReactNode };
        if (props.children != null) return flattenMarkdownChildren(props.children);
      }
      return "";
    })
    .join("");
}

function extractCodeBlockSource(
  _className: string | undefined,
  children: ReactNode,
  node?: unknown,
): string {
  const fromNode =
    node &&
    typeof node === "object" &&
    "value" in node &&
    typeof (node as { value?: unknown }).value === "string"
      ? (node as { value: string }).value
      : "";
  const fromChildren = flattenMarkdownChildren(children);
  const raw =
    (fromNode || fromChildren || (Array.isArray(children) ? children.join("") : String(children ?? "")))
      .replace(/\n$/, "")
      .trim();
  return raw;
}

export class MermaidBlockErrorBoundary extends Component<
  { content: string; blockKey: string; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err: unknown) {
    console.error("MermaidBlockErrorBoundary:", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <pre className="my-6 overflow-x-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] p-3 text-sm text-[var(--foreground)]">
          <code>{this.props.content}</code>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]" aria-live="polite">
            No se pudo mostrar el diagrama (código fuente arriba).
          </p>
        </pre>
      );
    }
    return this.props.children;
  }
}

type MermaidDiagramBlockProps = {
  content: string;
  blockKey: string;
  enableFullscreen?: boolean;
  enableRepair?: boolean;
  svgClassName?: string;
};

/**
 * Contenedor SIEMPRE montado del SVG. El error o la carga no lo reemplazan: así no hay `ref` nulo que
 * deje un error pegado. `normalizeSizing` solo se usa en pantalla completa (el inline se ajusta por CSS).
 */
function MermaidSvgSurface({
  svg,
  bindFunctions,
  className,
  normalizeSizing = false,
  pending = false,
}: {
  svg: string;
  bindFunctions?: (el: Element) => void;
  className?: string;
  normalizeSizing?: boolean;
  pending?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !svg) return;
    if (normalizeSizing) normalizeMermaidSvgSizing(el);
    bindFunctions?.(el);
  }, [svg, bindFunctions, normalizeSizing]);

  return (
    <div
      ref={ref}
      aria-busy={pending}
      className={cn(
        "flex justify-center [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:min-w-0",
        pending && "min-h-[120px]",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Error real del parser (recortado) y el código ORIGINAL que falló. */
function MermaidErrorPanel({ state, className }: { state: MermaidErrorState; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <p
        role="status"
        className="whitespace-pre-wrap break-words text-xs text-[var(--destructive)]"
      >
        No se pudo mostrar el diagrama: {truncateMermaidError(state.message)}
      </p>
      {state.extendedTried ? (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          {MERMAID_NO_AUTO_REPAIR_MESSAGE}
        </p>
      ) : null}
      <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] p-3 text-sm text-[var(--foreground)]">
        <code>{state.text}</code>
      </pre>
    </div>
  );
}

/**
 * Acciones ante un diagrama que no se pudo mostrar:
 * - Reparar: reintento ampliado (render + oráculo con candidatos extra, siempre validados por el parser).
 *   Si ya se probó sin éxito sobre este texto se deshabilita hasta que cambie el contenido.
 * - Regenerar con IA: envía el contenido original y el error del parser a la API.
 */
function MermaidRepairActions({
  variant,
  failure,
  isFixing,
  onRetry,
  onRegenerate,
}: {
  variant: "inline" | "fullscreen";
  failure: MermaidErrorState;
  isFixing: boolean;
  onRetry: () => void;
  onRegenerate: (failure: MermaidErrorState) => void;
}) {
  const buttonClass =
    variant === "inline"
      ? "h-8 gap-1.5 border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--foreground)] shadow-md"
      : "h-8 shrink-0 gap-1.5 text-xs";
  const buttonVariant = variant === "inline" ? "secondary" : "outline";
  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        disabled={isFixing || failure.extendedTried === true}
        className={buttonClass}
        onClick={onRetry}
        aria-label="Reparar diagrama Mermaid"
        title={
          failure.extendedTried
            ? MERMAID_NO_AUTO_REPAIR_MESSAGE
            : "Prueba reparaciones ampliadas y las valida con el parser de Mermaid"
        }
      >
        <Wrench className="h-3.5 w-3.5" aria-hidden />
        Reparar
      </Button>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        disabled={isFixing}
        className={buttonClass}
        onClick={() => onRegenerate(failure)}
        aria-label="Regenerar diagrama Mermaid con IA"
        title="Pide a la IA un diagrama nuevo a partir del error del validador"
      >
        {isFixing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        )}
        {isFixing ? "…" : "Regenerar con IA"}
      </Button>
    </>
  );
}

const STATUS_BADGE_CLASS =
  "inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--muted-foreground)]";

/** Mermaid suele emitir width="100%"; dentro de un inline-block colapsa — usar viewBox/intrínseco. */
export function normalizeMermaidSvgSizing(container: HTMLElement): { width: number; height: number } | null {
  const svg = container.querySelector("svg");
  if (!svg) return null;

  svg.style.maxWidth = "none";
  svg.style.width = "auto";
  svg.style.height = "auto";
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const w = parts[2]!;
      const h = parts[3]!;
      if (w > 0 && h > 0) {
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
      }
    }
  }

  const width = svg.getBoundingClientRect().width || svg.clientWidth || 0;
  const height = svg.getBoundingClientRect().height || svg.clientHeight || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Vista fullscreen: arrastrar para desplazar, rueda para zoom hacia el cursor. */
function MermaidPanZoomViewport({
  children,
  resetKey,
  contentReady,
}: {
  children: ReactNode;
  resetKey: string;
  contentReady: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PanZoomState>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const applyState = useCallback((next: PanZoomState) => {
    setState(next);
  }, []);

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    normalizeMermaidSvgSizing(content);
    const contentW = content.scrollWidth || content.offsetWidth;
    const contentH = content.scrollHeight || content.offsetHeight;
    applyState(
      computeMermaidFitTransform(
        viewport.clientWidth,
        viewport.clientHeight,
        contentW,
        contentH,
      ),
    );
  }, [applyState]);

  const resetView = useCallback(() => {
    fitToView();
  }, [fitToView]);

  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setState((prev) => {
      const nextScale = clampPanZoomScale(prev.scale * factor);
      const ratio = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: anchorX - (anchorX - prev.x) * ratio,
        y: anchorY - (anchorY - prev.y) * ratio,
      };
    });
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(factor, rect.width / 2, rect.height / 2);
    },
    [zoomAt],
  );

  useEffect(() => {
    if (!contentReady) return;
    let cancelled = false;
    const runFit = () => {
      if (!cancelled) fitToView();
    };
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(runFit);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [resetKey, contentReady, fitToView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoomAt(factor, mx, my);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomCenter(1.15);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomCenter(1 / 1.15);
      } else if (e.key === "0") {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetView, zoomCenter]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setState((prev) => {
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: prev.x,
        panY: prev.y,
      };
      return prev;
    });
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setState((prev) => ({
      ...prev,
      x: drag.panX + (e.clientX - drag.startX),
      y: drag.panY + (e.clientY - drag.startY),
    }));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={viewportRef}
      className={cn(
        "absolute inset-0 overflow-hidden touch-none select-none bg-[var(--background)]",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={resetView}
      role="application"
      aria-label="Diagrama con zoom y desplazamiento"
    >
      <div
        className="pointer-events-auto absolute bottom-4 right-4 z-[1] flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)]/95 p-1 shadow-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto h-8 w-8"
          onClick={() => zoomCenter(1 / 1.2)}
          aria-label="Alejar"
        >
          <ZoomOut className="h-4 w-4" aria-hidden />
        </Button>
        <span className="min-w-[3rem] px-1 text-center text-xs tabular-nums text-[var(--muted-foreground)]">
          {Math.round(state.scale * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto h-8 w-8"
          onClick={() => zoomCenter(1.2)}
          aria-label="Acercar"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto h-8 w-8"
          onClick={resetView}
          aria-label="Restablecer zoom"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        ref={contentRef}
        className="absolute left-0 top-0 inline-block will-change-transform"
        style={{
          transform: `translate(${state.x}px, ${state.y}px) scale(${state.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Inline Mermaid block with optional fullscreen overlay.
 *
 * Contrato de remontaje: quien lo monta pone `key={mermaidKey(contenido completo)}` en el
 * `MermaidBlockErrorBoundary`; editar el contenido remonta el bloque (vista, error y regeneración se
 * reinician) y el boundary no se queda atascado en error.
 */
export function MermaidDiagramBlock({
  content,
  blockKey,
  enableFullscreen = true,
  enableRepair = true,
  svgClassName,
}: MermaidDiagramBlockProps) {
  // Regeneración efímera (F1): solo se muestra, no se guarda. Se descarta si cambia `content`.
  const [regenerated, setRegenerated] = useState<{ base: string; text: string } | null>(null);
  const regeneratedActive = regenerated !== null && regenerated.base === content;
  const displayContent = regeneratedActive ? regenerated.text : content;

  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenExcalidrawFallback, setFullscreenExcalidrawFallback] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"svg" | "excalidraw">(defaultMermaidViewMode);

  const diagramType = useMemo(() => detectMermaidDiagramType(displayContent), [displayContent]);
  const excalidrawSupported = isExcalidrawSupported(diagramType);
  const isExcalidrawView = viewMode === "excalidraw" && excalidrawSupported;

  // Render SVG inline y de pantalla completa: dos instancias con ids distintos, para que los
  // `url(#marker)` del SVG no colisionen cuando ambos conviven en el DOM. El inline no se desactiva en
  // vista Excalidraw: su texto final (original o reparado) es lo que se convierte.
  const inline = useMermaidRender(displayContent);
  const inlineState = inline.state;

  /** Texto que Excalidraw convierte; `null` mientras el hook carga o falló (no se convierte texto inválido). */
  const excalidrawText = isExcalidrawView && inlineState.status === "ready" ? inlineState.text : null;
  const excalidrawType = useMemo(
    () => (excalidrawText === null ? diagramType : detectMermaidDiagramType(excalidrawText)),
    [excalidrawText, diagramType],
  );
  const showInlineExcalidraw = excalidrawText !== null;
  const showFullscreenExcalidraw = showInlineExcalidraw && !fullscreenExcalidrawFallback;

  const fullscreen = useMermaidRender(displayContent, {
    enabled: fullscreenOpen && !showFullscreenExcalidraw,
  });
  const fullscreenState = fullscreen.state;

  const rebuildKey = useMemo(
    () => `${blockKey}-${mermaidKey(excalidrawText ?? "")}`,
    [blockKey, excalidrawText],
  );
  const fullscreenExcalidrawRebuildKey = `${rebuildKey}-fs`;

  const handleRetryInline = useCallback(() => {
    setFixError(null);
    inline.retry({ extended: true });
  }, [inline.retry]);

  const handleRetryFullscreen = useCallback(() => {
    setFixError(null);
    fullscreen.retry({ extended: true });
  }, [fullscreen.retry]);

  const handleRegenerate = useCallback(
    async (failure: MermaidErrorState) => {
      setFixError(null);
      setIsFixing(true);
      try {
        const text = await regenerateMermaidDiagram({
          content: failure.text,
          error: failure.message,
        });
        setRegenerated({ base: content, text });
        setViewMode(defaultMermaidViewMode());
      } catch (err) {
        setFixError(err instanceof Error ? err.message : "No se pudo regenerar el diagrama");
      } finally {
        setIsFixing(false);
      }
    },
    [content],
  );

  const handleOpenFullscreen = useCallback(() => {
    setFullscreenExcalidrawFallback(false);
    setFullscreenOpen(true);
  }, []);

  const handleFullscreenOpenChange = useCallback((open: boolean) => {
    setFullscreenOpen(open);
    if (!open) setFullscreenExcalidrawFallback(false);
  }, []);

  const handleFullscreenExcalidrawFallback = useCallback(() => {
    setFullscreenExcalidrawFallback(true);
  }, []);

  const handleFallbackToSvg = useCallback(() => {
    setViewMode("svg");
  }, []);

  const showToolbar =
    inlineState.status === "ready" ||
    inlineState.status === "error" ||
    excalidrawSupported ||
    isExcalidrawView;

  return (
    <>
      <div
        {...{ [MERMAID_BLOCK_MARKER]: "1" }}
        className="group relative my-6 block w-full min-w-0 [isolation:isolate] overflow-x-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_35%,var(--card))] p-3"
        aria-label="Diagrama Mermaid"
      >
        {/* Opaque toolbar — solid card bg so labels stay readable over Excalidraw dark canvas */}
        {showToolbar ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {enableRepair && inlineState.status === "error" ? (
                <MermaidRepairActions
                  variant="inline"
                  failure={inlineState}
                  isFixing={isFixing}
                  onRetry={handleRetryInline}
                  onRegenerate={handleRegenerate}
                />
              ) : null}
              {inlineState.status === "ready" && inlineState.repair === "repaired" ? (
                <span
                  className={STATUS_BADGE_CLASS}
                  title="El diagrama original no pasaba el validador de Mermaid; se muestra una versión corregida automáticamente. El documento no se modificó."
                >
                  Reparado automáticamente
                </span>
              ) : null}
              {regeneratedActive ? (
                <span
                  className={STATUS_BADGE_CLASS}
                  title="El diagrama regenerado solo se muestra aquí; no se guardó en el documento."
                >
                  No guardado
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {excalidrawSupported ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5 border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--foreground)] shadow-md"
                  onClick={() => {
                    setFullscreenExcalidrawFallback(false);
                    setViewMode((v) => (v === "svg" ? "excalidraw" : "svg"));
                  }}
                  aria-label={
                    viewMode === "svg" ? "Cambiar a vista Excalidraw" : "Cambiar a vista SVG"
                  }
                >
                  {viewMode === "svg" ? (
                    <>
                      <PenLine className="h-3.5 w-3.5" aria-hidden />
                      Excalidraw
                    </>
                  ) : (
                    <>
                      <Code className="h-3.5 w-3.5" aria-hidden />
                      SVG
                    </>
                  )}
                </Button>
              ) : null}
              {enableFullscreen ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5 border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--foreground)] shadow-md"
                  onClick={handleOpenFullscreen}
                  aria-label="Ver diagrama a pantalla completa"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  Pantalla completa
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {fixError ? (
          <p className="mb-2 text-xs text-[var(--destructive)]" role="alert">
            {fixError}
          </p>
        ) : null}
        {showInlineExcalidraw ? (
          <ExcalidrawDiagramBlock
            mermaidContent={excalidrawText}
            diagramType={excalidrawType}
            rebuildKey={rebuildKey}
            onFallbackToSvg={handleFallbackToSvg}
          />
        ) : (
          <>
            <MermaidSvgSurface
              svg={inlineState.status === "ready" ? inlineState.svg : ""}
              bindFunctions={inlineState.status === "ready" ? inlineState.bindFunctions : undefined}
              pending={inlineState.status === "idle" || inlineState.status === "loading"}
              className={svgClassName}
            />
            {inlineState.status === "error" ? <MermaidErrorPanel state={inlineState} /> : null}
          </>
        )}
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={handleFullscreenOpenChange}>
        <DialogContent
          showClose
          aria-describedby="mermaid-fullscreen-desc"
          className="fixed inset-0 left-0 top-0 z-[var(--z-modal)] flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none sm:rounded-none"
        >
          <DialogTitle className="sr-only">Diagrama Mermaid — pantalla completa</DialogTitle>
          <DialogDescription id="mermaid-fullscreen-desc" className="sr-only">
            Vista ampliada del diagrama con zoom y desplazamiento. Usa los controles − / + o Esc
            para cerrar.
          </DialogDescription>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {enableRepair && !showFullscreenExcalidraw && fullscreenState.status === "error" ? (
                <MermaidRepairActions
                  variant="fullscreen"
                  failure={fullscreenState}
                  isFixing={isFixing}
                  onRetry={handleRetryFullscreen}
                  onRegenerate={handleRegenerate}
                />
              ) : null}
              {excalidrawSupported ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  onClick={() => {
                    setFullscreenExcalidrawFallback(false);
                    setViewMode((v) => (v === "svg" ? "excalidraw" : "svg"));
                  }}
                  aria-label={
                    viewMode === "svg" ? "Cambiar a vista Excalidraw" : "Cambiar a vista SVG"
                  }
                >
                  {viewMode === "svg" ? (
                    <>
                      <PenLine className="h-3.5 w-3.5" aria-hidden />
                      Excalidraw
                    </>
                  ) : (
                    <>
                      <Code className="h-3.5 w-3.5" aria-hidden />
                      SVG
                    </>
                  )}
                </Button>
              ) : null}
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">Diagrama Mermaid</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {showFullscreenExcalidraw
                    ? "Pinch o Ctrl+rueda = zoom (cursor) · Rueda = pan · −/+ centro · Esc cierra"
                    : "Arrastrar para desplazar · Rueda para zoom · Doble clic restablece"}
                </p>
              </div>
            </div>
            <p className="hidden shrink-0 text-xs text-[var(--muted-foreground)] sm:block">Esc para cerrar</p>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {fullscreenOpen ? (
              showFullscreenExcalidraw ? (
                <ExcalidrawDiagramBlock
                  mermaidContent={excalidrawText}
                  diagramType={excalidrawType}
                  rebuildKey={fullscreenExcalidrawRebuildKey}
                  layout="fullscreen"
                  onFallbackToSvg={handleFullscreenExcalidrawFallback}
                />
              ) : fullscreenState.status === "error" ? (
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <MermaidErrorPanel state={fullscreenState} />
                </div>
              ) : (
                <MermaidPanZoomViewport
                  resetKey={`${blockKey}-${mermaidKey(displayContent)}`}
                  contentReady={fullscreenState.status === "ready"}
                >
                  <MermaidSvgSurface
                    svg={fullscreenState.status === "ready" ? fullscreenState.svg : ""}
                    bindFunctions={
                      fullscreenState.status === "ready" ? fullscreenState.bindFunctions : undefined
                    }
                    pending={fullscreenState.status !== "ready"}
                    normalizeSizing
                    className="block [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:w-auto"
                  />
                </MermaidPanZoomViewport>
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function preWrapsMermaidBlock(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement(child) &&
      typeof child.props === "object" &&
      child.props !== null &&
      MERMAID_BLOCK_MARKER in (child.props as Record<string, unknown>),
  );
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { node?: unknown };

/** Returns a Mermaid SVG block, or null if the fenced block is not Mermaid. */
export function tryRenderMarkdownMermaid(props: MarkdownCodeProps): ReactNode | null {
  const { className, children, node } = props;
  const source = extractCodeBlockSource(className, children, node);
  if (!isMermaidCodeBlock(source, className) || !source.trim()) return null;

  // Fuente crudo (solo envoltorios de fence y espacios Unicode): la reparación la decide el bloque.
  const prepared = prepareMermaidForRender(source);
  if (!prepared.trim()) return null;

  const key = mermaidKey(prepared);
  return (
    <MermaidBlockErrorBoundary key={key} content={prepared} blockKey={key}>
      <MermaidDiagramBlock blockKey={key} content={prepared} />
    </MermaidBlockErrorBoundary>
  );
}

/** Skips the default `<pre>` wrapper when the child is an rendered Mermaid block. */
export function MarkdownMermaidPre({
  children,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  if (preWrapsMermaidBlock(children)) {
    return <>{children}</>;
  }
  return <pre {...props}>{children}</pre>;
}
