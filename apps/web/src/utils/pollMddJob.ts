import { apiFetch, API_BASE, fetchWithRetry } from "./apiClient";

const POLL_MAX_ATTEMPTS = 10_800;
const POLL_INTERVAL_MS = 2_000;
/** Poll MDD job cada 5s (F5: menos ruido mientras stream/job activo). */
const POLL_INTERVAL_MDD_ACTIVE_MS = 5_000;
/** Tras N fallos de red seguidos al hacer poll, avisamos (≈75 s con intervalo 5 s). */
const MAX_CONSECUTIVE_POLL_NETWORK_ERRORS = 15;

export type MddJobStatusResponse = {
  status: string;
  progress?:
    | {
        steps?: Array<{ agent: string; message: string }>;
        active?: { agent: string; message: string } | null;
        latest?: {
          agent?: string;
          message?: string;
          phase?: string;
          mddLength?: number;
          section?: number;
        };
        agent?: string;
        message?: string;
        phase?: string;
        mddLength?: number;
        section?: number;
      }
    | number;
  result?: {
    ok?: boolean;
    outcome?: "done" | "interrupt";
    threadId?: string;
    mddLength?: number;
    mddUpstreamSync?: {
      pendingSync?: boolean;
      changedSources?: string[];
      expandedSections?: number[];
      canSync?: boolean;
      hasBaseline?: boolean;
      changes?: unknown[];
    };
    interrupt?: {
      reply?: string;
      questions?: string[];
      planMessage?: string;
    };
  };
  error?: string;
};

export type PollMddJobOptions = {
  onProgress?: (progress: MddJobStatusResponse["progress"]) => void;
  signal?: AbortSignal;
  /**
   * Intervalo de poll en ms. Default 5s (job MDD activo). Pasar `pollIntervalMs: 2000` para legacy.
   */
  pollIntervalMs?: number;
  /**
   * Dispara justo después de que el POST a `/ai-analysis/mdd/jobs` devuelve
   * un `jobId` válido (es decir, cuando el job ya está encolado en el servidor).
   * Útil para refrescar `generationStatus` y arrancar el polling del banner
   * "Puedes cerrar el navegador" sin esperar a que termine el job.
   */
  onEnqueued?: (jobId: string) => void;
};

/**
 * Polls an MDD background job until completed or failed.
 */
export async function pollMddJob(
  jobId: string,
  projectId: string,
  options?: PollMddJobOptions,
): Promise<MddJobStatusResponse> {
  const pollUrl = `${API_BASE}/projects/${projectId}/mdd-jobs/${jobId}`;
  let consecutiveNetworkErrors = 0;
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MDD_ACTIVE_MS;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (options?.signal?.aborted) throw new Error("Cancelado por el usuario");
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const pr = await fetchWithRetry(pollUrl, undefined, 2);
      consecutiveNetworkErrors = 0;
      if (!pr.ok) {
        if (pr.status === 404) throw new Error("Job MDD no encontrado");
        continue;
      }
      const status = (await pr.json()) as MddJobStatusResponse;
      if (status.progress && options?.onProgress) {
        options.onProgress(status.progress);
      }
      if (status.status === "completed") return status;
      if (status.status === "failed") {
        throw new Error(status.error ?? "Error al generar MDD en background");
      }
    } catch (e) {
      if (e instanceof Error && (e.message.includes("Job MDD no encontrado") || e.message.includes("Error al generar MDD"))) {
        throw e;
      }
      consecutiveNetworkErrors += 1;
      if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_POLL_NETWORK_ERRORS) {
        throw new Error(
          "Error de conexión con el servidor. La regeneración puede seguir en background; recarga el proyecto en unos minutos.",
        );
      }
    }
  }
  throw new Error(
    "Tiempo de espera agotado (6 h). Recarga el proyecto; el job puede haber terminado en el servidor.",
  );
}

/**
 * POST ai-analysis/mdd/jobs and poll until done.
 */
export async function enqueueAndPollMddJob(
  body: Record<string, unknown>,
  projectId: string,
  options?: PollMddJobOptions,
): Promise<MddJobStatusResponse> {
  const r = await fetchWithRetry(`${API_BASE}/ai-analysis/mdd/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "Error al encolar MDD");
  }
  const data = (await r.json()) as { queued?: boolean; jobId?: string };
  if (!data.queued || !data.jobId) {
    throw new Error("Respuesta inesperada al encolar MDD");
  }
  options?.onEnqueued?.(data.jobId);
  return pollMddJob(data.jobId, projectId, options);
}

/**
 * POST legacy/generate-mdd (queued by default) and poll.
 */
export async function enqueueAndPollLegacyMdd(
  projectId: string,
  stageId: string | undefined,
  options?: PollMddJobOptions,
): Promise<MddJobStatusResponse> {
  const body: Record<string, unknown> = {};
  if (stageId?.trim()) body.stageId = stageId.trim();
  const r = await apiFetch(`${API_BASE}/projects/${projectId}/legacy/generate-mdd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "Error al encolar MDD legacy");
  }
  const data = (await r.json()) as { queued?: boolean; jobId?: string; ok?: boolean };
  if (data.queued && data.jobId) {
    options?.onEnqueued?.(data.jobId);
    return pollMddJob(data.jobId, projectId, options);
  }
  return { status: "completed", result: { ok: data.ok ?? true, outcome: "done" } };
}
