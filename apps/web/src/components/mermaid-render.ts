/**
 * Render de Mermaid para la web: reducer puro, pipeline asíncrono y hook.
 *
 * Regla de oro (ver `@theforge/shared-types/mermaid-oracle`): primero se intenta renderizar el texto
 * original sin tocarlo; solo si falla se consulta al parser real y, si este propone una reparación que
 * parsea, se renderiza esa. Nada de heurísticas propias: si ni el parser acepta ninguna reparación, el
 * usuario ve el error REAL del parser junto al código ORIGINAL.
 *
 * El pipeline (`runMermaidRenderPipeline`) y el arranque cancelable (`startMermaidRender`) son puros
 * respecto de React para poder probarse con `node:test` sin DOM; `useMermaidRender` solo los cablea.
 */
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import {
  resolveMermaidWithOracle,
  type MermaidParseResult,
  type MermaidParser,
  type MermaidResolution,
  type ResolveMermaidOptions,
} from "@theforge/shared-types/mermaid-oracle";
import {
  parseMermaid,
  renderMermaid,
  type MermaidCallOptions,
  type MermaidRenderOutput,
} from "../lib/mermaid-runtime";
import {
  EXTENDED_REPAIR_MAX_ATTEMPTS,
  proposeExtendedMermaidRepairs,
} from "./mermaid-render-prep.util";

/** Mensaje de la UI cuando el reintento ampliado ("Reparar") no encontró ninguna reparación que el parser acepte. */
export const MERMAID_NO_AUTO_REPAIR_MESSAGE =
  "Sin reparación automática válida; usa Regenerar con IA";

/** Cómo se llegó al texto que se pintó. */
export type MermaidRepairKind = "original" | "repaired" | "unverified";

export type MermaidReadyState = {
  status: "ready";
  svg: string;
  /** Texto que realmente se renderizó (el original o la reparación aceptada por el parser). */
  text: string;
  repair: MermaidRepairKind;
  bindFunctions?: (el: Element) => void;
};

export type MermaidErrorState = {
  status: "error";
  /** Mensaje real del parser/render (sin recortar; la UI lo recorta al mostrarlo). */
  message: string;
  /** Texto ORIGINAL que falló, nunca una reparación. */
  text: string;
  /**
   * `true` si ya se probó el reintento ampliado (botón "Reparar") sobre este texto sin éxito: repetirlo
   * daría lo mismo, así que la UI lo deshabilita hasta que cambie el contenido (un contenido nuevo
   * produce un estado nuevo, sin esta marca).
   */
  extendedTried?: true;
};

export type MermaidRenderState =
  | { status: "idle" }
  | { status: "loading" }
  | MermaidReadyState
  | MermaidErrorState;

export type MermaidRenderAction =
  | { type: "reset" }
  | { type: "start" }
  | { type: "resolved"; state: MermaidReadyState | MermaidErrorState };

export const MERMAID_IDLE_STATE: MermaidRenderState = Object.freeze({ status: "idle" });
const MERMAID_LOADING_STATE: MermaidRenderState = Object.freeze({ status: "loading" });

export function mermaidRenderReducer(
  state: MermaidRenderState,
  action: MermaidRenderAction,
): MermaidRenderState {
  switch (action.type) {
    case "reset":
      return state.status === "idle" ? state : MERMAID_IDLE_STATE;
    case "start":
      return state.status === "loading" ? state : MERMAID_LOADING_STATE;
    case "resolved":
      return action.state;
    default:
      return state;
  }
}

/** Parser que acepta además un `AbortSignal` (compatible con `MermaidParser`). */
export type MermaidSignalParser = (
  text: string,
  options?: MermaidCallOptions,
) => Promise<MermaidParseResult>;

export interface MermaidRenderDeps {
  parse: MermaidSignalParser;
  render: (text: string, id: string, options?: MermaidCallOptions) => Promise<MermaidRenderOutput>;
  resolve: (
    body: string,
    parse: MermaidParser,
    opts?: ResolveMermaidOptions,
  ) => Promise<MermaidResolution>;
}

export function resolveMermaidRenderDeps(overrides: Partial<MermaidRenderDeps> = {}): MermaidRenderDeps {
  return {
    parse: overrides.parse ?? parseMermaid,
    render: overrides.render ?? renderMermaid,
    resolve: overrides.resolve ?? resolveMermaidWithOracle,
  };
}

export type MermaidPipelineResult = MermaidReadyState | MermaidErrorState | { status: "aborted" };

export interface MermaidPipelineOptions {
  /** Aborta el pipeline: el resultado pasa a `aborted` y nadie debe pintarlo. */
  signal?: AbortSignal;
  /** Genera un id de render único por intento (evita colisiones de `url(#marker)` entre instancias). */
  nextId?: () => string;
  /**
   * Reintento ampliado (botón "Reparar"): ante un fallo consulta al oráculo con candidatos ampliados
   * (`proposeExtendedMermaidRepairs`, hasta `EXTENDED_REPAIR_MAX_ATTEMPTS`), siempre validados por el parser.
   */
  extended?: boolean;
}

/** Texto legible de un fallo de mermaid (puede ser `Error`, string u objeto con `str`/`message`). */
export function describeMermaidError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const { message, str } = err as { message?: unknown; str?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof str === "string" && str) return str;
  }
  return "Error desconocido de Mermaid";
}

/** Recorta un mensaje de error largo para mostrarlo en la UI. */
export function truncateMermaidError(message: string, max = 300): string {
  const clean = message.trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

function makeIdFactory(): () => string {
  let n = 0;
  return () => `mermaid-render-${++n}`;
}

/**
 * Orquesta el render: `render(raw)`; si falla, `resolve(raw, parse)` y, si el oráculo propone una
 * reparación (`repaired`) o el parser no estuvo disponible (`unverified`), `render(res.text)`. Un `invalid`
 * produce `error` con el mensaje del parser y el texto original; un `original` (el parser acepta el texto
 * pero el render falló) produce `error` con el fallo real del render, sin repetir el mismo render.
 */
export async function runMermaidRenderPipeline(
  raw: string,
  deps: MermaidRenderDeps,
  options: MermaidPipelineOptions = {},
): Promise<MermaidPipelineResult> {
  const { signal, extended = false } = options;
  const nextId = options.nextId ?? makeIdFactory();
  const aborted = (): boolean => signal?.aborted === true;
  const ABORTED = { status: "aborted" } as const;
  const callOptions: MermaidCallOptions | undefined = signal ? { signal } : undefined;
  const parse: MermaidParser = (text) => deps.parse(text, callOptions);
  const failure = (message: string, markExtended = false): MermaidErrorState => ({
    status: "error",
    message,
    text: raw,
    ...(extended && markExtended ? { extendedTried: true as const } : {}),
  });

  if (!raw.trim()) {
    return { status: "error", message: "El diagrama está vacío.", text: raw };
  }

  let renderError: string;
  try {
    const out = await deps.render(raw, nextId(), callOptions);
    if (aborted()) return ABORTED;
    return {
      status: "ready",
      svg: out.svg,
      text: raw,
      repair: "original",
      ...(out.bindFunctions ? { bindFunctions: out.bindFunctions } : {}),
    };
  } catch (err) {
    if (aborted()) return ABORTED;
    renderError = describeMermaidError(err);
  }

  const resolveOptions: ResolveMermaidOptions = {
    ...(signal ? { signal } : {}),
    ...(extended
      ? { propose: proposeExtendedMermaidRepairs, maxAttempts: EXTENDED_REPAIR_MAX_ATTEMPTS }
      : {}),
  };
  let resolution: MermaidResolution;
  try {
    resolution = await deps.resolve(raw, parse, resolveOptions);
  } catch (err) {
    if (aborted()) return ABORTED;
    return failure(describeMermaidError(err));
  }
  if (aborted()) return ABORTED;

  if (resolution.status === "invalid") {
    return failure(resolution.error || renderError, true);
  }
  // El parser acepta el texto tal cual y aun así el render falló: renderizarlo otra vez falla igual.
  if (resolution.status === "original") {
    return failure(renderError, true);
  }

  try {
    const out = await deps.render(resolution.text, nextId(), callOptions);
    if (aborted()) return ABORTED;
    return {
      status: "ready",
      svg: out.svg,
      text: resolution.text,
      repair: resolution.status,
      ...(out.bindFunctions ? { bindFunctions: out.bindFunctions } : {}),
    };
  } catch (err) {
    if (aborted()) return ABORTED;
    return failure(describeMermaidError(err), resolution.status === "repaired");
  }
}

/**
 * Lanza un render y publica su resultado con `dispatch`. Devuelve la función de cancelación: un render
 * cancelado (porque cambió `raw`, se desmontó o se reintentó) NUNCA publica su resultado, así un
 * resultado tardío no pisa al vigente.
 */
export function startMermaidRender(
  raw: string,
  deps: MermaidRenderDeps,
  dispatch: (action: MermaidRenderAction) => void,
  nextId?: () => string,
  extended = false,
): () => void {
  const controller = new AbortController();
  dispatch({ type: "start" });
  void runMermaidRenderPipeline(raw, deps, {
    signal: controller.signal,
    nextId,
    extended,
  }).then((result) => {
    if (controller.signal.aborted || result.status === "aborted") return;
    dispatch({ type: "resolved", state: result });
  });
  return () => controller.abort();
}

export interface UseMermaidRenderOptions extends Partial<MermaidRenderDeps> {
  /** `false` deja el hook en reposo (p. ej. vista Excalidraw o diálogo cerrado). Por defecto `true`. */
  enabled?: boolean;
}

export interface MermaidRetryOptions {
  /** Reintento ampliado (botón "Reparar"): candidatos extra validados por el parser. */
  extended?: boolean;
}

export interface UseMermaidRenderResult {
  state: MermaidRenderState;
  /**
   * Vuelve a ejecutar el pipeline sobre el mismo texto. Con `{ extended: true }` prueba además los
   * candidatos ampliados; esa opción vale solo para el texto vigente (si `raw` cambia, se descarta).
   */
  retry: (options?: MermaidRetryOptions) => void;
}

/** Id de render único por instancia del hook y por intento. */
function renderIdPrefix(instanceId: string): string {
  return `m${instanceId.replace(/[^a-zA-Z0-9]/g, "")}`;
}

export function useMermaidRender(
  raw: string,
  options: UseMermaidRenderOptions = {},
): UseMermaidRenderResult {
  const { enabled = true, parse, render, resolve } = options;
  const [state, dispatch] = useReducer(mermaidRenderReducer, MERMAID_IDLE_STATE);
  const [attempt, setAttempt] = useState<{ n: number; extended: boolean; raw: string }>({
    n: 0,
    extended: false,
    raw: "",
  });
  const instanceId = useId();
  const counterRef = useRef(0);
  // Las dependencias inyectables se leen por ref: su identidad no debe relanzar el render.
  const depsRef = useRef<Partial<MermaidRenderDeps>>({});
  depsRef.current = { parse, render, resolve };

  // Efecto legítimo: sincroniza con un sistema externo (mermaid), no deriva estado.
  useEffect(() => {
    if (!enabled || !raw.trim()) {
      dispatch({ type: "reset" });
      return undefined;
    }
    const prefix = renderIdPrefix(instanceId);
    return startMermaidRender(
      raw,
      resolveMermaidRenderDeps(depsRef.current),
      dispatch,
      () => `${prefix}r${++counterRef.current}`,
      attempt.extended && attempt.raw === raw,
    );
  }, [raw, enabled, attempt, instanceId]);

  const retry = useCallback(
    (retryOptions?: MermaidRetryOptions) =>
      setAttempt((prev) => ({ n: prev.n + 1, extended: retryOptions?.extended === true, raw })),
    [raw],
  );
  return { state, retry };
}

/**
 * Clave estable de un bloque Mermaid: hash FNV-1a de TODO el contenido (+ longitud). Se usa como `key`
 * del `MermaidBlockErrorBoundary` para que cualquier edición remonte el bloque y limpie errores pegados.
 */
export function mermaidKey(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `mermaid-${(h >>> 0).toString(36)}-${content.length.toString(36)}`;
}
