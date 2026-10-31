import { UnrecoverableError } from "bullmq";

const USER_CANCEL_MESSAGE = "Cancelado por el usuario";

export function isMddUserCancellationError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes(USER_CANCEL_MESSAGE) ||
    msg.includes("Cancelado por el administrador") ||
    /\b(aborted|abort)\b/i.test(msg)
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const o = err as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const v of [o.status, o.statusCode, o.code]) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{3}$/.test(v) ? Number(v) : undefined;
    if (n != null) return n;
  }
  return undefined;
}

/**
 * Timeouts del LLM (inactividad / tope duro del stream, wall-clock, red).
 * Reintentar BullMQ re-ejecutaría un pipeline de varios minutos para fallar igual.
 */
export function isMddLlmTimeoutError(err: unknown): boolean {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (code === "ETIMEDOUT") return true;
  return /inactividad|tope duro|timed out|timeout|ETIMEDOUT/i.test(errorMessage(err));
}

/** Límite de recursión de LangGraph: el grafo está en bucle, un reintento repite el bucle. */
export function isMddGraphRecursionError(err: unknown): boolean {
  if (err instanceof Error && err.name === "GraphRecursionError") return true;
  return /recursion limit|GRAPH_RECURSION/i.test(errorMessage(err));
}

/** Credenciales inválidas o cuota/billing agotado: no se arreglan reintentando. */
export function isMddProviderAuthOrQuotaError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status === 401 || status === 403 || status === 429) return true;
  const msg = errorMessage(err);
  return (
    /insufficient_quota|exceeded your current quota|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|forbidden/i.test(
      msg,
    ) ||
    /\b(?:status|code|http|error)\D{0,3}(?:401|403|429)\b/i.test(msg) ||
    /\b(?:401|403|429)\s+(?:unauthorized|forbidden|too many requests|rate limit)/i.test(msg)
  );
}

/** Otro turno (stream o job) ya tiene el lease del hilo; reintentar a los 15 s no lo libera. */
export function isMddThreadBusyError(err: unknown): boolean {
  return /THREAD_BUSY|turno en curso para este hilo/i.test(errorMessage(err));
}

/** True si BullMQ no debe reintentar (el reintento repetiría un pipeline caro con el mismo resultado). */
export function isMddNonRetryableJobError(err: unknown): boolean {
  return (
    isMddUserCancellationError(err) ||
    isMddLlmTimeoutError(err) ||
    isMddGraphRecursionError(err) ||
    isMddProviderAuthOrQuotaError(err) ||
    isMddThreadBusyError(err)
  );
}

/**
 * Evita reintentos BullMQ tras cancelación (preserva threadId / checkpoint LangGraph), timeouts del LLM,
 * límite de recursión y errores de auth/cuota del proveedor. Errores transitorios de red
 * (ECONNRESET, 502/503) siguen siendo reintentables.
 */
export function toMddJobError(err: unknown): Error {
  if (isMddNonRetryableJobError(err)) {
    return new UnrecoverableError(errorMessage(err));
  }
  return err instanceof Error ? err : new Error(String(err));
}
