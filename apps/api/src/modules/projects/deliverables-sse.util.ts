/** Intervalo de sondeo del estado del job durante el stream. */
export const DELIVERABLES_SSE_POLL_MS = 900;
/** Tope de duración de un stream: pasado este tiempo se cierra con un evento `timeout`. */
export const DELIVERABLES_SSE_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** Subconjunto de `express.Response` que usa el stream (facilita las pruebas). */
export interface SseResponseLike {
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
}

export interface SseJobStatusLike {
  status: string;
  progress?: unknown;
  result?: unknown;
  error?: string;
}

export interface DeliverablesSseOptions {
  pollMs?: number;
  maxDurationMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * Emite por SSE el progreso de un job hasta un estado terminal (`completed`, `failed`, `unknown`),
 * un error de lectura, el cierre del cliente o el tope de duración. Tras el cierre del cliente no
 * se escribe más en `res` y se cancelan los timers pendientes.
 */
export function streamDeliverablesJob(
  res: SseResponseLike,
  getStatus: () => Promise<SseJobStatusLike>,
  options: DeliverablesSseOptions = {},
): void {
  const pollMs = options.pollMs ?? DELIVERABLES_SSE_POLL_MS;
  const maxDurationMs = options.maxDurationMs ?? DELIVERABLES_SSE_MAX_DURATION_MS;
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let closed = false;
  let pollTimer: unknown;
  let maxTimer: unknown;

  const cleanup = () => {
    closed = true;
    if (pollTimer !== undefined) clearTimer(pollTimer);
    if (maxTimer !== undefined) clearTimer(maxTimer);
    pollTimer = undefined;
    maxTimer = undefined;
  };

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      cleanup();
    }
  };

  const finish = (): void => {
    if (closed) return;
    cleanup();
    try {
      res.end();
    } catch {
      // socket ya destruido
    }
  };

  res.on("close", cleanup);

  maxTimer = setTimer(() => {
    send("timeout", { message: "Tiempo máximo del stream agotado; vuelve a consultar el estado del job" });
    finish();
  }, maxDurationMs);

  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const s = await getStatus();
      if (closed) return;
      if (s.status === "unknown") {
        send("unknown", { message: "Job no encontrado" });
        finish();
        return;
      }
      send("progress", { state: s.status, progress: s.progress });
      if (s.status === "completed") {
        send("completed", s.result ?? null);
        finish();
        return;
      }
      if (s.status === "failed") {
        send("failed", { message: s.error });
        finish();
        return;
      }
      if (s.status === "retrying") {
        send("retrying", { message: s.error });
        // Seguir sondeando: el worker reintentará.
      }
    } catch (err) {
      send("error", { message: err instanceof Error ? err.message : String(err) });
      finish();
      return;
    }
    if (closed) return;
    pollTimer = setTimer(() => void tick(), pollMs);
  };
  void tick();
}
