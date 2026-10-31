/**
 * @fileoverview NDJSON de larga duración con heartbeat para los streams MDD manager/resume/pipeline.
 *
 * Un nodo LangGraph silencioso (>10 min) dejaba el socket sin escribir y Node cerraba la respuesta por su
 * timeout de 600 s (y Traefik/nginx por idle). Cada `heartbeatMs` sin evento se emite una línea
 * `{"type":"heartbeat"}`: el cliente Workshop ignora tipos desconocidos, así que es un keep-alive puro.
 */

export const NDJSON_HEARTBEAT_MS = 15_000;

export type NdjsonHeartbeatOptions = {
  /** Etiqueta para logs. */
  tag: string;
  heartbeatMs?: number;
  /** Convierte un error del generador en el payload del evento `error` final. */
  formatError: (err: unknown) => Record<string, unknown>;
};

type Step =
  | { kind: "event"; result: IteratorResult<unknown> }
  | { kind: "error"; error: unknown }
  | { kind: "tick" };

/**
 * Serializa los eventos de `source` como líneas NDJSON intercalando heartbeats mientras el siguiente
 * evento tarda. Los errores del generador se emiten como evento `error` (no rompen el pipe).
 * Al cerrarse el consumidor (cliente desconectado) cierra el generador origen sin esperar su promesa
 * pendiente: la cancelación real la hace la `AbortSignal` que el controller pasó al servicio.
 */
export async function* ndjsonLinesWithHeartbeat(
  source: AsyncIterable<unknown>,
  options: NdjsonHeartbeatOptions,
): AsyncGenerator<string, void, undefined> {
  const heartbeatMs = options.heartbeatMs ?? NDJSON_HEARTBEAT_MS;
  const iterator = source[Symbol.asyncIterator]();
  const startedAt = Date.now();
  let pending: Promise<IteratorResult<unknown>> | null = null;
  try {
    for (;;) {
      pending ??= iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<Step>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "tick" }), heartbeatMs);
      });
      const next: Promise<Step> = pending.then(
        (result): Step => ({ kind: "event", result }),
        (error: unknown): Step => ({ kind: "error", error }),
      );
      const step = await Promise.race([next, tick]);
      if (timer) clearTimeout(timer);

      if (step.kind === "tick") {
        yield JSON.stringify({ type: "heartbeat", elapsedMs: Date.now() - startedAt }) + "\n";
        continue;
      }
      pending = null;
      if (step.kind === "error") {
        const payload = options.formatError(step.error);
        console.error(`[${options.tag}] error:`, payload.message ?? step.error);
        yield JSON.stringify({ type: "error", ...payload }) + "\n";
        return;
      }
      if (step.result.done) return;
      yield JSON.stringify(step.result.value) + "\n";
    }
  } finally {
    if (pending) pending.catch(() => undefined);
    // Sin await: si el generador está a mitad de un `await` largo, `return()` queda en cola hasta que
    // la AbortSignal lo haga terminar; no debe bloquear el cierre de la respuesta.
    void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
  }
}
