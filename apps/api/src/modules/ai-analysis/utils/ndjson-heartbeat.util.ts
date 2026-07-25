/**
 * @fileoverview Heartbeat NDJSON para streams de larga duración.
 */

const DEFAULT_HEARTBEAT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta una promesa larga (p. ej. LLM) emitiendo eventos de progreso periódicos
 * para evitar timeouts idle de Traefik/nginx durante regenerate-section.
 */
export async function* awaitWithNdjsonHeartbeat<T>(
  work: Promise<T>,
  tick: () => { type: "progress"; agent: string; message: string },
  intervalMs = DEFAULT_HEARTBEAT_MS,
): AsyncGenerator<{ type: "progress"; agent: string; message: string }, T, undefined> {
  let settled = false;
  let result!: T;
  let error: unknown;
  const tracked = work.then(
    (value) => {
      settled = true;
      result = value;
    },
    (err) => {
      settled = true;
      error = err;
    },
  );

  while (!settled) {
    const winner = await Promise.race([
      tracked.then(() => "done" as const),
      sleep(intervalMs).then(() => "tick" as const),
    ]);
    if (winner === "tick" && !settled) {
      yield tick();
    }
  }

  await tracked;
  if (error !== undefined) throw error;
  return result;
}
