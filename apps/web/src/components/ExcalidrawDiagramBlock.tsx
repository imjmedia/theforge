/**
 * Renders Mermaid diagrams as Excalidraw canvas with lazy loading.
 * Tipos ofrecidos: ver `isExcalidrawSupported`. La vista por defecto es SVG; esto es un toggle.
 * Falls back to SVG view for unsupported types or conversion failures.
 *
 * La conversión corre en la cola exclusiva del runtime de Mermaid y restaura al final la config web
 * (la librería pisa `mermaid.initialize` con tema `default` y `securityLevel: strict`).
 *
 * Gestures: fullscreen uses native Excalidraw (zoom at cursor + pan). Inline
 * preview uses center-based wheel zoom and drag-to-pan so the diagram cannot
 * drift off-screen in the small embed.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Download,
  Edit3,
  Eye,
  Loader2,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { stripMermaidFenceWrappers } from "@theforge/shared-types/mermaid";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  initializeMermaidFor,
  reinitializeMermaid,
  runExclusive,
} from "@/lib/mermaid-runtime";
import {
  buildExcalidrawLibraryMermaidConfig,
  convertMermaidToExcalidrawExclusive,
} from "@/lib/mermaid-excalidraw-convert";
import { isExcalidrawSupported, type MermaidDiagramType } from "./mermaid-diagram-type.util";

import "@excalidraw/excalidraw/index.css";
import "./ExcalidrawDiagramBlock.css";

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");
type ExcalidrawComponent = ExcalidrawModule["Excalidraw"];
type OrderedExcalidrawElement = ReturnType<ExcalidrawModule["convertToExcalidrawElements"]>[number];

/** Align with Excalidraw native `MIN_ZOOM` / `MAX_ZOOM` (0.1–30). */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 30;
const ZOOM_STEP = 0.15;

/** Resolve a CSS color (incl. oklch vars) to `#rrggbb` for Excalidraw appState. */
function cssColorToHex(cssColor: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.color = cssColor;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return fallback;
  const hex = [m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/** Match Workshop markdown preview paper (muted∩card), not Excalidraw default black. */
function workshopCanvasBackground(): string {
  return cssColorToHex(
    "color-mix(in oklch, var(--muted) 35%, var(--card))",
    "#f4f1ea",
  );
}

function workshopExcalidrawTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

// Lazy-loaded Excalidraw (no SSR, ~45MB JS)
const LazyExcalidraw = lazy<ExcalidrawComponent>(() =>
  import("@excalidraw/excalidraw").then((mod) => ({ default: mod.Excalidraw })),
);

type ConvertedScene = {
  elements: OrderedExcalidrawElement[];
  files: BinaryFiles | null;
};

/**
 * Suppress expected parse noise — the library falls back to SVG-as-image internally.
 * Restaura `console.error` en `finally` aunque la conversión lance; debe llamarse solo desde dentro de
 * `runExclusive` para que dos conversiones nunca se solapen ni dejen el parche pegado.
 */
async function withQuietMermaidConversion<T>(run: () => Promise<T>): Promise<T> {
  const prevError = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("Error processing Mermaid diagram:")) {
      return;
    }
    prevError.apply(console, args);
  };
  try {
    return await run();
  } finally {
    console.error = prevError;
  }
}

async function convertMermaidToExcalidraw(content: string): Promise<ConvertedScene> {
  const prepared = stripMermaidFenceWrappers(content).trim();
  const [mermaidMod, excalidrawMod, libConstants] = await Promise.all([
    import("@excalidraw/mermaid-to-excalidraw"),
    import("@excalidraw/excalidraw"),
    import("@excalidraw/mermaid-to-excalidraw/dist/constants.js"),
  ]);
  // La librería llama a `mermaid.initialize` con su propia config y solo cuando cambia su hash interno:
  // se aplica su config ANTES de cada conversión (dentro de la cola exclusiva) y se restaura la web
  // después, falle o no. Flowchart es nativo (elementos editables); sequence también en 2.2.2. `files`
  // solo trae dataURLs si la librería cae a imagen.
  const { elements: skeletons, files } = await convertMermaidToExcalidrawExclusive({
    runExclusive,
    initializeFor: initializeMermaidFor,
    restoreWebConfig: reinitializeMermaid,
    libraryConfig: buildExcalidrawLibraryMermaidConfig(libConstants.MERMAID_CONFIG),
    convert: () => withQuietMermaidConversion(() => mermaidMod.parseMermaidToExcalidraw(prepared)),
  });
  const elements = excalidrawMod.convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  });
  return { elements, files: files ?? null };
}

async function exportToPng(scene: ConvertedScene) {
  const mod: ExcalidrawModule = await import("@excalidraw/excalidraw");
  return mod.exportToBlob({
    elements: scene.elements,
    files: scene.files,
    mimeType: "image/png",
  });
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function asNormalizedZoom(value: number): NormalizedZoomValue {
  return clampZoom(value) as NormalizedZoomValue;
}

type ExcalidrawDiagramBlockProps = {
  mermaidContent: string;
  diagramType: MermaidDiagramType;
  /** Key that changes when source content is edited — triggers rebuild. */
  rebuildKey?: string;
  /** Called when conversion fails; consumer should fall back to SVG. */
  onFallbackToSvg?: () => void;
  /** Inline preview vs modal pantalla completa (altura y auto-fit). */
  layout?: "inline" | "fullscreen";
  /** Additional CSS classes for the outer container. */
  className?: string;
};

type ConversionResult =
  | { status: "ok"; scene: ConvertedScene }
  | { status: "fallback" }
  | { status: "error"; message: string };

export function ExcalidrawDiagramBlock({
  mermaidContent,
  diagramType,
  rebuildKey,
  onFallbackToSvg,
  layout = "inline",
  className,
}: ExcalidrawDiagramBlockProps) {
  const isFullscreenLayout = layout === "fullscreen";
  const [scene, setScene] = useState<ConvertedScene | null>(null);
  /** Remount Excalidraw when scene changes — `initialData` is mount-only. */
  const [sceneRev, setSceneRev] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [canvasBg] = useState(() => workshopCanvasBackground());
  const [excalidrawTheme] = useState(() => workshopExcalidrawTheme());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cancelledRef = useRef(false);
  const onFallbackRef = useRef(onFallbackToSvg);
  onFallbackRef.current = onFallbackToSvg;

  const excalidrawSupported = isExcalidrawSupported(diagramType);

  const applyScene = useCallback((next: ConvertedScene) => {
    setScene(next);
    setSceneRev((n) => n + 1);
    setLoading(false);
    setError(null);
    setZoomPct(100);
  }, []);

  const failToSvg = useCallback((message?: string) => {
    setLoading(false);
    if (message) setError(message);
    onFallbackRef.current?.();
  }, []);

  // Convert Mermaid → Excalidraw elements (+ files for image fallbacks)
  useEffect(() => {
    if (!excalidrawSupported) {
      failToSvg();
      return;
    }

    cancelledRef.current = false;
    let active = true;

    async function convert(): Promise<ConversionResult> {
      try {
        const converted = await convertMermaidToExcalidraw(mermaidContent);
        if (cancelledRef.current) return { status: "fallback" };
        if (Array.isArray(converted.elements) && converted.elements.length > 0) {
          return { status: "ok", scene: converted };
        }
        return { status: "fallback" };
      } catch (err) {
        if (cancelledRef.current) return { status: "fallback" };
        return {
          status: "error",
          message: err instanceof Error ? err.message : "Conversion failed",
        };
      }
    }

    setLoading(true);
    setError(null);

    convert().then((result) => {
      if (!active) return;
      if (result.status === "ok") {
        applyScene(result.scene);
      } else if (result.status === "fallback") {
        failToSvg();
      } else {
        failToSvg(result.message);
      }
    });

    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [mermaidContent, rebuildKey, excalidrawSupported, applyScene, failToSvg]);

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      requestAnimationFrame(() => {
        api.scrollToContent(undefined, { fitToContent: true });
        requestAnimationFrame(() => {
          const z = api.getAppState().zoom.value;
          setZoomPct(Math.round(z * 100));
        });
      });
    },
    [],
  );

  /** Button zoom: scale about the viewport center (native pinch already uses cursor). */
  const zoomAboutViewportCenter = useCallback(async (factor: number) => {
    const api = apiRef.current;
    if (!api) return;
    const { viewportCoordsToSceneCoords } = await import("@excalidraw/excalidraw");
    const appState = api.getAppState();
    const nextZoom = asNormalizedZoom(appState.zoom.value * factor);
    const clientX = appState.offsetLeft + appState.width / 2;
    const clientY = appState.offsetTop + appState.height / 2;
    const scenePoint = viewportCoordsToSceneCoords({ clientX, clientY }, appState);
    const scrollX = (clientX - appState.offsetLeft) / nextZoom - scenePoint.x;
    const scrollY = (clientY - appState.offsetTop) / nextZoom - scenePoint.y;
    api.updateScene({
      appState: {
        zoom: { value: nextZoom },
        scrollX,
        scrollY,
      },
    });
    setZoomPct(Math.round(nextZoom * 100));
  }, []);

  const fitToView = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.scrollToContent(undefined, { fitToContent: true });
    requestAnimationFrame(() => {
      const z = api.getAppState().zoom.value;
      setZoomPct(Math.round(z * 100));
    });
  }, []);

  // Refit when scene mounts or container size changes (inline + fullscreen).
  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    const runFit = () => {
      if (!cancelled) fitToView();
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(runFit));
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [scene, sceneRev, fitToView]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !scene) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitToView());
    });
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [scene, sceneRev, fitToView]);

  // Inline embed: center zoom + drag pan (native cursor-zoom loses the diagram in a small box).
  useEffect(() => {
    if (isFullscreenLayout || isEditing || !scene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wheelFactor = (deltaY: number) =>
      deltaY > 0 ? 1 / (1 + ZOOM_STEP) : 1 + ZOOM_STEP;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void zoomAboutViewportCenter(wheelFactor(e.deltaY));
    };

    let panning = false;
    let panPointerId = -1;
    let panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const api = apiRef.current;
      if (!api) return;
      e.stopPropagation();
      panning = true;
      panPointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("is-panning");
      const appState = api.getAppState();
      panStart = {
        x: e.clientX,
        y: e.clientY,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning || e.pointerId !== panPointerId) return;
      const api = apiRef.current;
      if (!api) return;
      e.preventDefault();
      e.stopPropagation();
      const zoom = api.getAppState().zoom.value;
      const dx = (e.clientX - panStart.x) / zoom;
      const dy = (e.clientY - panStart.y) / zoom;
      api.updateScene({
        appState: {
          scrollX: panStart.scrollX - dx,
          scrollY: panStart.scrollY - dy,
        },
      });
    };

    const endPan = (e: PointerEvent) => {
      if (!panning || e.pointerId !== panPointerId) return;
      panning = false;
      panPointerId = -1;
      canvas.releasePointerCapture(e.pointerId);
      canvas.classList.remove("is-panning");
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      fitToView();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false, capture: true });
    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove, { capture: true });
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      canvas.removeEventListener("wheel", onWheel, { capture: true });
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove, { capture: true });
      canvas.removeEventListener("pointerup", endPan);
      canvas.removeEventListener("pointercancel", endPan);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.classList.remove("is-panning");
    };
  }, [
    isFullscreenLayout,
    isEditing,
    scene,
    sceneRev,
    fitToView,
    zoomAboutViewportCenter,
  ]);

  // Manual rebuild
  const handleRebuild = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const converted = await convertMermaidToExcalidraw(mermaidContent);
      if (Array.isArray(converted.elements) && converted.elements.length > 0) {
        applyScene(converted);
      } else {
        failToSvg();
      }
    } catch (err) {
      failToSvg(err instanceof Error ? err.message : "Rebuild failed");
    }
  }, [mermaidContent, applyScene, failToSvg]);

  // Export PNG
  const handleExport = useCallback(async () => {
    if (!scene) return;
    try {
      const blob = await exportToPng(scene);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `diagram-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [scene]);

  // Loading state (only when no scene yet)
  if (loading && !scene) {
    return (
      <div
        className={cn(
          "flex items-center justify-center",
          isFullscreenLayout ? "h-full min-h-0" : "min-h-[180px]",
        )}
      >
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        <span className="ml-2 text-sm text-[var(--muted-foreground)]">
          Convirtiendo a Excalidraw…
        </span>
      </div>
    );
  }

  // Error or no scene — caller falls back to SVG
  if (error || !scene) return null;

  const bg = isEditing ? "bg-[var(--background)]" : "bg-transparent";

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative w-full",
        isFullscreenLayout
          ? "h-full min-h-0"
          : "h-[min(420px,55vh)] min-h-[220px]",
        "excalidraw-embed-host",
        isFullscreenLayout && "excalidraw-embed-host--fullscreen",
        bg,
        className,
      )}
    >
      <div
        ref={canvasRef}
        className="excalidraw-embed-canvas absolute inset-0 overflow-hidden rounded-md [&_.excalidraw]:h-full [&_.excalidraw]:w-full"
      >
        <Suspense
          fallback={
            <div className="flex h-full min-h-[180px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          }
        >
          <LazyExcalidraw
            key={sceneRev}
            excalidrawAPI={handleApi}
            initialData={{
              elements: scene.elements,
              files: scene.files ?? undefined,
              scrollToContent: true,
              appState: {
                // Keep Excalidraw chrome collapsed; CSS also hides leftovers.
                openMenu: null,
                openSidebar: null,
                // Align canvas with Workshop document paper (not default black).
                viewBackgroundColor: canvasBg,
              },
            }}
            theme={excalidrawTheme}
            renderTopRightUI={() => null}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
                saveAsImage: false,
              },
              tools: {
                image: false,
              },
            }}
            viewModeEnabled={!isEditing}
            onScrollChange={(_x, _y, zoom) => {
              setZoomPct(Math.round(zoom.value * 100));
            }}
          />
        </Suspense>
      </div>

      <div
        className="pointer-events-auto absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] p-1 text-[var(--foreground)] shadow-md"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void zoomAboutViewportCenter(1 / (1 + ZOOM_STEP))}
          aria-label="Alejar"
          title="Alejar (centro del canvas)"
        >
          <ZoomOut className="h-4 w-4" aria-hidden />
        </Button>
        <span className="min-w-[3rem] px-1 text-center text-xs tabular-nums text-[var(--muted-foreground)]">
          {zoomPct}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void zoomAboutViewportCenter(1 + ZOOM_STEP)}
          aria-label="Acercar"
          title="Acercar (centro del canvas)"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={fitToView}
          aria-label="Ajustar al contenido"
          title="Ajustar al contenido (doble clic en el canvas en vista embebida)"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-[var(--border)]" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={loading}
          onClick={() => void handleRebuild()}
          aria-label="Reconstruir desde Mermaid"
          title="Reconstruir desde Mermaid"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsEditing((e) => !e)}
          aria-label={isEditing ? "Modo vista" : "Modo edición"}
          title={isEditing ? "Modo vista" : "Modo edición"}
        >
          {isEditing ? (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Edit3 className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void handleExport()}
          aria-label="Exportar PNG"
          title="Exportar PNG"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
