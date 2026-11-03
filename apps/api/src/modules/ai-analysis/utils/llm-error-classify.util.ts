/**
 * @fileoverview Clasificación de errores de invocaciones LLM para decidir la política de reintento.
 *
 * Es una función pura y tolerante: lee las formas habituales de error de los SDK de Anthropic,
 * OpenAI y LangChain (`status`, `statusCode`, `response.status`, `headers`, `error.type`, mensaje)
 * y devuelve un veredicto. Ante la duda devuelve `retry` (el comportamiento histórico), salvo
 * los `no_retry` claros (petición inválida, credenciales, cuota, contexto excedido).
 */

export type LlmErrorKind = "no_retry" | "retry" | "retry_after" | "abort";

export type LlmErrorClassification = {
  kind: LlmErrorKind;
  /** Sólo con `retry_after` y cuando el proveedor indicó la espera (cabecera o cuerpo). Tope 30 s. */
  retryAfterMs?: number;
  /** Motivo corto y estable, apto para logs. */
  reason: string;
};

export type ClassifyLlmErrorOptions = {
  /** Reloj inyectable (ms epoch) para resolver `retry-after` en formato fecha HTTP. */
  now?: number;
  /** Señal de cancelación del turno; si está abortada el error se clasifica como `abort`. */
  signal?: AbortSignal;
};

/** Tope de la espera pedida por el proveedor (`retry-after`). */
export const MAX_RETRY_AFTER_MS = 30_000;

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | undefined =>
  v != null && typeof v === "object" ? (v as Rec) : undefined;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function toStatus(v: unknown): number | undefined {
  const n = typeof v === "string" && /^\d{3}$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 100 && n <= 599 ? n : undefined;
}

/** Cadena de objetos donde buscar campos del SDK: el error, su cuerpo, la respuesta y la causa. */
function candidates(err: unknown): Rec[] {
  const out: Rec[] = [];
  const push = (v: unknown): void => {
    const r = asRec(v);
    if (r && !out.includes(r)) out.push(r);
  };
  const root = asRec(err);
  if (!root) return out;
  push(root);
  push(root.error);
  push(asRec(root.error)?.error);
  push(root.response);
  push(asRec(root.response)?.data);
  push(root.cause);
  push(asRec(root.cause)?.error);
  return out;
}

function extractStatus(cands: Rec[], message: string): number | undefined {
  for (const c of cands) {
    const s = toStatus(c.status) ?? toStatus(c.statusCode) ?? toStatus(c.httpStatus);
    if (s !== undefined) return s;
  }
  const m =
    /^\s*(?:[\w.]*Error:?\s*)?(\d{3})\b/.exec(message) ??
    /\[(\d{3})\s+[A-Za-z][A-Za-z ]*\]/.exec(message) ??
    /\b(?:status(?:\s*code)?|http)[\s:=]+(\d{3})\b/i.exec(message);
  return m ? toStatus(m[1]) : undefined;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") {
    try {
      const v = (get as (n: string) => unknown).call(headers, name);
      if (v != null) return String(v);
    } catch {
      /* ignora */
    }
  }
  const rec = asRec(headers);
  if (!rec) return undefined;
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === lower && v != null) return Array.isArray(v) ? String(v[0]) : String(v);
  }
  return undefined;
}

function headerSources(cands: Rec[]): unknown[] {
  const out: unknown[] = [];
  for (const c of cands) {
    out.push(c.headers, c.responseHeaders);
  }
  return out;
}

/** `retry-after-ms` (OpenAI/Anthropic), `retry-after` en segundos o fecha HTTP, o `retry_after` del cuerpo. */
function extractRetryAfterMs(cands: Rec[], now: number): number | undefined {
  const clamp = (ms: number): number => Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(ms)));
  for (const h of headerSources(cands)) {
    const ms = readHeader(h, "retry-after-ms");
    if (ms !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(ms)) return clamp(Number(ms));
    const raw = readHeader(h, "retry-after")?.trim();
    if (!raw) continue;
    if (/^\d+(\.\d+)?$/.test(raw)) return clamp(Number(raw) * 1000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return clamp(date - now);
  }
  for (const c of cands) {
    const body = c.retry_after ?? c.retryAfter;
    if (typeof body === "number" && Number.isFinite(body)) return clamp(body * 1000);
    if (typeof body === "string" && /^\d+(\.\d+)?$/.test(body.trim())) return clamp(Number(body) * 1000);
  }
  return undefined;
}

function collectText(cands: Rec[], message: string): string {
  const parts: string[] = [message];
  for (const c of cands) {
    for (const k of ["message", "type", "code", "lc_error_code", "param"]) {
      const v = str(c[k]);
      if (v) parts.push(v);
    }
  }
  const body = asRec(cands[0])?.error;
  if (typeof body === "string") parts.push(body);
  return parts.join(" | ").toLowerCase();
}

const NETWORK_CODES = /\b(econnreset|etimedout|econnrefused|enotfound|eai_again|epipe|enetunreach|ehostunreach|und_err_\w+)\b/i;
const CONTEXT_RE =
  /context[ _]length|context[ _]window|maximum context|max(?:imum)? (?:input )?tokens? (?:limit|allowed)|too many tokens|prompt is too long|input is too long|reduce the length of the messages|request too large|input length/i;
/** Cuota agotada inequívoca: aplica incluso con 429. */
const QUOTA_STRONG_RE =
  /insufficient[_ ]quota|exceeded your current quota|credit balance|insufficient[_ ]credits?|out of credits|payment required|billing_error/i;
/** Menciones sueltas (p. ej. OpenAI añade "add a payment method ... billing" a rate limits normales): sólo sin 429/5xx. */
const QUOTA_WEAK_RE = /\bbilling\b|\bcredits?\b/i;
const AUTH_RE =
  /invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key|missing credentials|api key (?:is )?(?:missing|not (?:found|provided))|authentication[_ ]error|permission[_ ]error|model[_ ]not[_ ]found|not_found_error/i;
const OVERLOAD_RE = /overloaded|rate[_ ]?limit|too many requests|resource[_ ]exhausted/i;
const TIMEOUT_RE = /timeout|timed out|stream abortado|stream vac[ií]o/i;

const NO_RETRY_STATUS: Record<number, string> = {
  400: "http_400_peticion_invalida",
  401: "http_401_no_autenticado",
  402: "http_402_pago_requerido",
  403: "http_403_prohibido",
  404: "http_404_modelo_o_recurso_no_encontrado",
  405: "http_405",
  413: "http_413_peticion_demasiado_grande",
  422: "http_422_no_procesable",
};

const LC_CODES: Record<string, LlmErrorClassification> = {
  MODEL_RATE_LIMIT: { kind: "retry_after", reason: "langchain_model_rate_limit" },
  MODEL_AUTHENTICATION: { kind: "no_retry", reason: "langchain_model_authentication" },
  MODEL_NOT_FOUND: { kind: "no_retry", reason: "langchain_model_not_found" },
  INVALID_PROMPT_INPUT: { kind: "no_retry", reason: "langchain_invalid_prompt_input" },
  INVALID_TOOL_RESULTS: { kind: "no_retry", reason: "langchain_invalid_tool_results" },
  MESSAGE_COERCION_FAILURE: { kind: "no_retry", reason: "langchain_message_coercion_failure" },
};

/**
 * Clasifica un error de invocación LLM.
 *
 * - `abort`: cancelación (nunca reintentar).
 * - `no_retry`: fallo determinista (400/401/403/404/422, contexto excedido, cuota/billing, validación del SDK).
 * - `retry_after`: 429 / 503 / 529 (sobrecarga); `retryAfterMs` si el proveedor lo indicó.
 * - `retry`: 5xx, red, timeouts y todo lo desconocido.
 */
export function classifyLlmError(err: unknown, opts: ClassifyLlmErrorOptions = {}): LlmErrorClassification {
  const now = opts.now ?? Date.now();
  const root = asRec(err);
  const name = str(root?.name) ?? "";
  const code = str(root?.code);

  if (
    opts.signal?.aborted ||
    name === "AbortError" ||
    name === "APIUserAbortError" ||
    code === "ABORT_ERR" ||
    (name === "" && /request was aborted/i.test(String(root?.message ?? "")))
  ) {
    return { kind: "abort", reason: "abort" };
  }

  const message = err instanceof Error ? err.message : root ? (str(root.message) ?? "") : String(err ?? "");
  const cands = candidates(err);
  const status = extractStatus(cands, message);
  const text = collectText(cands, message);
  const overloadStatus = status === 429 || status === 503 || status === 529;

  const retryAfter = (reason: string): LlmErrorClassification => {
    const ms = extractRetryAfterMs(cands, now);
    return ms === undefined ? { kind: "retry_after", reason } : { kind: "retry_after", retryAfterMs: ms, reason };
  };

  // Validación del propio SDK (zod) y códigos de error de LangChain.
  if (name === "ZodError") return { kind: "no_retry", reason: "validacion_sdk_zod" };
  for (const c of cands) {
    const lc = str(c.lc_error_code);
    const hit = lc ? LC_CODES[lc] : undefined;
    if (hit) return hit.kind === "retry_after" ? retryAfter(hit.reason) : hit;
  }

  // Cuota agotada / billing: gana incluso sobre un 429 (reintentar no ayuda).
  if (QUOTA_STRONG_RE.test(text) || (QUOTA_WEAK_RE.test(text) && (status === undefined || (status < 500 && status !== 429)))) {
    return { kind: "no_retry", reason: "cuota_o_billing" };
  }
  // Contexto/longitud excedidos (no confundir con rate limit por tokens/min, que llega como 429).
  if (!overloadStatus && CONTEXT_RE.test(text)) {
    return { kind: "no_retry", reason: "contexto_excedido" };
  }
  if (AUTH_RE.test(text) && !overloadStatus && !(status !== undefined && status >= 500)) {
    return { kind: "no_retry", reason: "credenciales_o_modelo_invalido" };
  }
  if (/invalid_request_error|request_too_large/.test(text) && !overloadStatus) {
    return { kind: "no_retry", reason: "peticion_invalida" };
  }

  if (status !== undefined) {
    if (overloadStatus) return retryAfter(`http_${status}_sobrecarga`);
    const noRetry = NO_RETRY_STATUS[status];
    if (noRetry) return { kind: "no_retry", reason: noRetry };
    if (status === 408) return { kind: "retry", reason: "http_408_timeout" };
    if (status >= 500) return { kind: "retry", reason: `http_${status}` };
  }

  if (OVERLOAD_RE.test(text)) {
    return retryAfter("sobrecarga_o_rate_limit");
  }

  const net = NETWORK_CODES.exec(`${code ?? ""} ${text}`);
  if (net) return { kind: "retry", reason: `red_${net[1]?.toUpperCase()}` };
  if (/fetch failed|socket hang up|network error|connection error|other side closed/i.test(text)) {
    return { kind: "retry", reason: "red" };
  }
  if (TIMEOUT_RE.test(text) || name === "APIConnectionTimeoutError" || name === "TimeoutError") {
    return { kind: "retry", reason: "timeout" };
  }
  return { kind: "retry", reason: status !== undefined ? `http_${status}` : "desconocido" };
}
