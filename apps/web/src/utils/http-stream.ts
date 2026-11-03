import { parseNdjsonLine } from "./ndjson";

export type SseStreamEvent = {
  event: string;
  dataStr: string;
};

/** Itera objetos JSON de un cuerpo NDJSON (tolera líneas partidas entre chunks). */
export async function* readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const obj of parseNdjsonLine(line)) yield obj;
      }
    }
    buffer += decoder.decode();
    for (const obj of parseNdjsonLine(buffer)) yield obj;
  } finally {
    void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      /* lectura abortada */
    }
  }
}

/** Parsea bloques SSE (`event:` / `data:` separados por línea en blanco). */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseStreamEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      /* lectura abortada */
    }
  }
}

function parseSseBlock(block: string): SseStreamEvent | null {
  let event = "";
  let dataStr = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
  }
  if (!event || !dataStr) return null;
  return { event, dataStr };
}

/** Emite un evento terminal sintético si el stream se cortó sin `done` / `error`. */
export async function* withSyntheticSseTerminal(
  events: AsyncIterable<SseStreamEvent>,
  terminalEvents: Set<string> = new Set(["done", "error"]),
): AsyncGenerator<SseStreamEvent, void, undefined> {
  let sawTerminal = false;
  for await (const ev of events) {
    if (terminalEvents.has(ev.event)) sawTerminal = true;
    yield ev;
  }
  if (!sawTerminal) {
    yield {
      event: "error",
      dataStr: JSON.stringify({ error: "Conexión interrumpida antes de completar el stream." }),
    };
  }
}
