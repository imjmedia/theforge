/**
 * Runtime único de Mermaid para la web.
 *
 * Centraliza: carga perezosa del módulo (sin cachear rechazos), una cola FIFO
 * de módulo para serializar toda operación que toque la configuración global de
 * mermaid (`initialize`, `parse`, `render` y, más adelante, la conversión a
 * Excalidraw) y la limpieza de nodos huérfanos que mermaid deja tras un render
 * fallido.
 *
 * `@excalidraw/mermaid-to-excalidraw` llama a `mermaid.initialize` con su propia
 * config y esa llamada no es acumulativa, así que cada operación de este
 * runtime re-inicializa con `WEB_MERMAID_CONFIG` antes de actuar. La librería
 * solo re-inicializa cuando cambia el hash de SU config, de modo que quien la
 * invoque debe aplicar su config con `initializeMermaidFor` antes de convertir
 * (ver `mermaid-excalidraw-convert.ts`).
 *
 * Cada tarea de la cola lleva timeout (la cola se libera aunque la tarea no
 * termine) y `parseMermaid` / `renderMermaid` aceptan un `AbortSignal` que
 * descarta la tarea si ya estaba abortada al empezar.
 */
import type { MermaidConfig } from "mermaid";
import type { MermaidParseResult } from "@theforge/shared-types/mermaid-oracle";

type Mermaid = typeof import("mermaid").default;

export type { MermaidParseResult };

export interface MermaidRenderOutput {
  svg: string;
  bindFunctions?: (el: Element) => void;
}

/** Configuración global de mermaid en la web (tema fijo oscuro, `loose` por decisión de producto). */
export const WEB_MERMAID_CONFIG: Readonly<MermaidConfig> = Object.freeze({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "dark",
  suppressErrorRendering: true,
});

/** Timeout por defecto de una tarea de la cola (render, parse y tareas genéricas). */
export const DEFAULT_MERMAID_TASK_TIMEOUT_MS = 20_000;
/** Timeout de la conversión a Excalidraw dentro de la cola. */
export const EXCALIDRAW_CONVERSION_TIMEOUT_MS = 15_000;

/** La tarea no terminó a tiempo: la cola se liberó, pero la tarea original puede seguir corriendo. */
export class MermaidTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La operación de Mermaid superó el límite de ${Math.round(timeoutMs / 1000)} s.`);
    this.name = "TimeoutError";
  }
}

/** La tarea se descartó porque su pipeline ya había sido abortado. */
export class MermaidAbortError extends Error {
  constructor() {
    super("Operación de Mermaid cancelada.");
    this.name = "AbortError";
  }
}

export interface MermaidExclusiveOptions {
  /** Tope de ejecución de la tarea (cuenta desde que empieza, no desde que se encola). */
  timeoutMs?: number;
}

export interface MermaidCallOptions {
  /** Si ya está abortado al empezar la tarea, esta se descarta con `AbortError` sin tocar mermaid. */
  signal?: AbortSignal;
}

export interface MermaidRuntimeOptions {
  /** Importador del módulo; por defecto `import("mermaid")`. Inyectable en pruebas. */
  importer?: () => Promise<Mermaid>;
  /** Config global aplicada antes de cada operación. */
  config?: Readonly<MermaidConfig>;
  /** Elimina nodos huérfanos de un render fallido; por defecto, DOM real si existe. */
  cleanupOrphans?: (renderId: string) => void;
  /** Timeout por defecto de las tareas de la cola. */
  taskTimeoutMs?: number;
}

export interface MermaidRuntime {
  loadMermaid(): Promise<Mermaid>;
  runExclusive<T>(task: () => Promise<T>, options?: MermaidExclusiveOptions): Promise<T>;
  parseMermaid(text: string, options?: MermaidCallOptions): Promise<MermaidParseResult>;
  renderMermaid(text: string, id: string, options?: MermaidCallOptions): Promise<MermaidRenderOutput>;
  /** Aplica la config web. Solo desde dentro de `runExclusive`. */
  reinitializeMermaid(): Promise<void>;
  /** Aplica una config arbitraria (la de una librería que solo re-inicializa al cambiar su hash). Solo desde `runExclusive`. */
  initializeMermaidFor(config: Readonly<MermaidConfig>): Promise<void>;
}

function defaultImporter(): Promise<Mermaid> {
  return import("mermaid").then((mod) => mod.default);
}

/** Mermaid crea `div#d<id>` en `document.body` al renderizar y lo deja si falla. */
function defaultCleanupOrphans(renderId: string): void {
  if (typeof document === "undefined") return;
  try {
    document.getElementById(`d${renderId}`)?.remove();
  } catch {
    // Sin DOM utilizable: nada que limpiar.
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const { str, message } = err as { str?: unknown; message?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof str === "string" && str) return str;
  }
  return "Error desconocido de Mermaid";
}

/**
 * Un fallo de carga del módulo o de un chunk dinámico (red, despliegue nuevo) no dice nada del
 * diagrama: debe tratarse como `unavailable`, nunca como `invalid`.
 */
export function isMermaidLoadError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = errorMessage(err);
  if (name === "ChunkLoadError") return true;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload|Failed to load module script|ChunkLoadError|Loading (CSS )?chunk [^\s]+ failed/i.test(
    message,
  );
}

function withTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finite = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const timer = finite ? setTimeout(() => reject(new MermaidTimeoutError(timeoutMs)), timeoutMs) : null;
    const done = (): void => {
      if (timer !== null) clearTimeout(timer);
    };
    // `resolve(task())` convierte un throw síncrono en rechazo.
    new Promise<T>((res) => res(task())).then(
      (value) => {
        done();
        resolve(value);
      },
      (err) => {
        done();
        reject(err);
      },
    );
  });
}

export function createMermaidRuntime(options: MermaidRuntimeOptions = {}): MermaidRuntime {
  const importer = options.importer ?? defaultImporter;
  const config = options.config ?? WEB_MERMAID_CONFIG;
  const cleanupOrphans = options.cleanupOrphans ?? defaultCleanupOrphans;
  const defaultTimeoutMs = options.taskTimeoutMs ?? DEFAULT_MERMAID_TASK_TIMEOUT_MS;

  let loadPromise: Promise<Mermaid> | null = null;
  // La cola nunca se rechaza: cada eslabón absorbe el fallo de su tarea.
  let tail: Promise<unknown> = Promise.resolve();

  function loadMermaid(): Promise<Mermaid> {
    if (!loadPromise) {
      const attempt = new Promise<Mermaid>((resolve) => resolve(importer()));
      loadPromise = attempt;
      // Solo se cachea si resuelve: ante un rechazo se limpia para reintentar.
      attempt.catch(() => {
        if (loadPromise === attempt) loadPromise = null;
      });
    }
    return loadPromise;
  }

  /**
   * Serializa `task` tras las anteriores. El timeout cuenta desde que la tarea empieza y, al vencer,
   * rechaza y libera la cola; la tarea original no se puede cancelar y puede terminar después (su
   * resultado se descarta).
   */
  function runExclusive<T>(
    task: () => Promise<T>,
    opts: MermaidExclusiveOptions = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
    const run = tail.then(() => withTimeout(task, timeoutMs));
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function applyConfig(mermaid: Mermaid): void {
    mermaid.initialize({ ...config });
  }

  function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new MermaidAbortError();
  }

  /**
   * Restaura la config web. No usa la cola: está pensada para llamarse desde
   * dentro de `runExclusive` (p. ej. tras convertir a Excalidraw).
   */
  async function reinitializeMermaid(): Promise<void> {
    applyConfig(await loadMermaid());
  }

  async function initializeMermaidFor(custom: Readonly<MermaidConfig>): Promise<void> {
    (await loadMermaid()).initialize({ ...custom });
  }

  async function parseMermaid(
    text: string,
    callOptions: MermaidCallOptions = {},
  ): Promise<MermaidParseResult> {
    const { signal } = callOptions;
    throwIfAborted(signal);
    let mermaid: Mermaid;
    try {
      mermaid = await loadMermaid();
    } catch (err) {
      return { status: "unavailable", error: errorMessage(err) };
    }
    return runExclusive(async (): Promise<MermaidParseResult> => {
      throwIfAborted(signal);
      try {
        applyConfig(mermaid);
      } catch (err) {
        return { status: "unavailable", error: errorMessage(err) };
      }
      try {
        const result = await mermaid.parse(text, { suppressErrors: false });
        const diagramType = result?.diagramType;
        return diagramType ? { status: "ok", diagramType } : { status: "ok" };
      } catch (err) {
        // Solo lo que lanza `mermaid.parse` sobre el texto es `invalid`; un fallo de carga de chunk no.
        return isMermaidLoadError(err)
          ? { status: "unavailable", error: errorMessage(err) }
          : { status: "invalid", error: errorMessage(err) };
      }
    });
  }

  async function renderMermaid(
    text: string,
    id: string,
    callOptions: MermaidCallOptions = {},
  ): Promise<MermaidRenderOutput> {
    const { signal } = callOptions;
    throwIfAborted(signal);
    const mermaid = await loadMermaid();
    return runExclusive(async () => {
      throwIfAborted(signal);
      applyConfig(mermaid);
      try {
        const { svg, bindFunctions } = await mermaid.render(id, text);
        return bindFunctions ? { svg, bindFunctions } : { svg };
      } catch (err) {
        cleanupOrphans(id);
        throw err;
      }
    });
  }

  return {
    loadMermaid,
    runExclusive,
    parseMermaid,
    renderMermaid,
    reinitializeMermaid,
    initializeMermaidFor,
  };
}

const defaultRuntime = createMermaidRuntime();

export const loadMermaid = defaultRuntime.loadMermaid;
export const runExclusive = defaultRuntime.runExclusive;
export const parseMermaid = defaultRuntime.parseMermaid;
export const renderMermaid = defaultRuntime.renderMermaid;
export const reinitializeMermaid = defaultRuntime.reinitializeMermaid;
export const initializeMermaidFor = defaultRuntime.initializeMermaidFor;
