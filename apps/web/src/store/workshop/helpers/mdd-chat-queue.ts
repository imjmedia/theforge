import { apiFetch, API_BASE } from "../../../utils/apiClient";
import {
  clearMddChatJob,
  consumeMddChatEvents,
  saveMddChatJob,
  type MddChatEventsOutcome,
} from "../../../utils/mddChatJob";
import { throwStreamHttpError } from "./store-errors";
import type { MddChatEventOutcome, MddChatStreamEvent, WorkshopGet, WorkshopSet } from "./mdd-chat-event";

/**
 * Transporte "cola" del chat MDD: el turno corre en el worker BullMQ (`POST ai-analysis/mdd/jobs`) y los
 * eventos se consumen con cursor (`GET ai-analysis/mdd/jobs/:jobId/events`). El manejo por evento es el
 * mismo `handleMddChatEvent` que usa el NDJSON legacy.
 */

const CONFIG_TTL_MS = 5 * 60_000;
let configCache: { value: boolean; at: number } | null = null;

/**
 * Flag del API (`GET ai-analysis/mdd/config` → `{ chatViaQueue }`, env `MDD_CHAT_VIA_QUEUE`, default activo).
 * Ante cualquier fallo (API antiguo sin endpoint, red) cae al NDJSON legacy y no cachea el fallo.
 */
export async function isMddChatViaQueueEnabled(): Promise<boolean> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.value;
  try {
    const r = await apiFetch(`${API_BASE}/ai-analysis/mdd/config`);
    if (!r.ok) return false;
    const data = (await r.json()) as { chatViaQueue?: unknown };
    const value = data.chatViaQueue === true;
    configCache = { value, at: now };
    return value;
  } catch {
    return false;
  }
}

/** Solo tests. */
export function resetMddChatConfigCacheForTests(): void {
  configCache = null;
}

/** Encola el turno (`mode` manager o resume) y devuelve el jobId. Un 409 (turno en curso) se propaga como error. */
export async function enqueueMddChatJob(body: Record<string, unknown>): Promise<string> {
  const r = await apiFetch(`${API_BASE}/ai-analysis/mdd/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) await throwStreamHttpError(r, "Error al encolar el turno del chat MDD");
  const data = (await r.json()) as { queued?: boolean; jobId?: string };
  if (!data.queued || !data.jobId) throw new Error("Respuesta inesperada al encolar el chat MDD");
  return data.jobId;
}

export type MddChatJobStatusLite = {
  status: string;
  projectId?: string;
  mode?: string | null;
  result?: { status?: string; outcome?: string; threadId?: string };
};

/** `null` si el job ya no existe (400/404); lanza en errores de red / 5xx. */
export async function fetchMddChatJobStatus(jobId: string): Promise<MddChatJobStatusLite | null> {
  const r = await apiFetch(`${API_BASE}/ai-analysis/mdd/jobs/${encodeURIComponent(jobId)}`);
  if (r.status === 400 || r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as MddChatJobStatusLite;
}

/** Consumidor activo del proceso (uno por pestaña): evita doble suscripción y permite cancelar. */
const activeConsumer: { jobId: string | null; abort: AbortController | null } = { jobId: null, abort: null };

export function hasActiveMddChatConsumer(): boolean {
  return activeConsumer.jobId != null;
}

/** Deja de leer eventos del job (cancelación del usuario); no cancela el job en el servidor. */
export function detachMddChatConsumer(jobId?: string): void {
  if (jobId && activeConsumer.jobId !== jobId) return;
  activeConsumer.abort?.abort();
}

export type ConsumeChatJobArgs = {
  set: WorkshopSet;
  get: WorkshopGet;
  projectId: string;
  stageId: string | null | undefined;
  jobId: string;
  cursor: number;
  handleMddChatEvent: (event: MddChatStreamEvent) => Promise<MddChatEventOutcome>;
};

/**
 * Consume los eventos del job y los entrega a `handleMddChatEvent`. Mantiene `activeChatJobId` y el cursor
 * en el store y en `localStorage` (clave proyecto+etapa) para reanudar tras recargar la página.
 * - `terminal`: se borra el estado persistido.
 * - Cancelación (`CANCELLED`): se limpia el spinner sin mostrar error (conserva `managerThreadId`).
 * - Error de red agotado: se relanza conservando el estado persistido (el job puede seguir vivo).
 */
export async function consumeMddChatJobIntoStore(args: ConsumeChatJobArgs): Promise<MddChatEventsOutcome> {
  const { set, projectId, stageId, jobId, handleMddChatEvent } = args;
  const abort = new AbortController();
  activeConsumer.jobId = jobId;
  activeConsumer.abort = abort;
  set({ activeChatJobId: jobId, activeChatJobCursor: args.cursor });
  saveMddChatJob(projectId, stageId, { jobId, cursor: args.cursor });
  let jobGone = false;
  try {
    const outcome = await consumeMddChatEvents({
      jobId,
      cursor: args.cursor,
      signal: abort.signal,
      openStream: async (cursor, signal) => {
        const qs = new URLSearchParams({ projectId, cursor: String(cursor) });
        const r = await apiFetch(
          `${API_BASE}/ai-analysis/mdd/jobs/${encodeURIComponent(jobId)}/events?${qs.toString()}`,
          { signal },
        );
        return { ok: r.ok, status: r.status, body: r.body };
      },
      onEvent: async (event) => {
        if (event.type === "error" && event.code === "CANCELLED") {
          set({
            loading: false,
            loadingReason: null,
            agentProgress: [],
            streamingUserMessage: null,
            streamingUserImages: null,
            streamingContent: null,
            pendingPlanApproval: null,
            evaluatorCritique: null,
          });
          return "terminal";
        }
        return handleMddChatEvent(event as MddChatStreamEvent);
      },
      onCursor: (cursor) => {
        set({ activeChatJobCursor: cursor });
        saveMddChatJob(projectId, stageId, { jobId, cursor });
      },
    });
    if (outcome === "terminal") clearMddChatJob(projectId, stageId);
    return outcome;
  } catch (err) {
    if (err instanceof Error && (err as { fatal?: boolean }).fatal) jobGone = true;
    throw err;
  } finally {
    if (jobGone) clearMddChatJob(projectId, stageId);
    activeConsumer.jobId = null;
    activeConsumer.abort = null;
    set({ activeChatJobId: null, activeChatJobCursor: 0 });
  }
}
