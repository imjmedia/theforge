/**
 * Cliente tipado del API de evaluación MDD (solo admin). Contrato en
 * `packages/shared-types/src/mdd-eval-api.ts`.
 */
import {
  MDD_EVAL_API_PREFIX,
  type MddEvalCaseDetailDto,
  type MddEvalCaseSummaryDto,
  type MddEvalCompareDto,
  type MddEvalRunDto,
  type MddEvalStartRunDto,
} from "@theforge/shared-types";
import { API_BASE, apiFetch } from "@/utils/apiClient";
import { getPollIntervalMs, isTerminalRunStatus } from "@/utils/mddEvalFormat";

const BASE = `${API_BASE}/${MDD_EVAL_API_PREFIX}`;

export class MddEvalApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MddEvalApiError";
    this.status = status;
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 403) return "Se requiere rol admin o super_admin.";
  if (res.status === 404) return `${fallback} (no encontrado).`;
  try {
    const payload = (await res.json()) as { message?: string | string[] };
    const msg = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message;
    if (msg) return msg;
  } catch {
    /* cuerpo no JSON */
  }
  return `${fallback} (HTTP ${res.status}).`;
}

async function requestJson<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${BASE}/${path}`, init);
  if (!res.ok) throw new MddEvalApiError(await readErrorMessage(res, fallback), res.status);
  return (await res.json()) as T;
}

function jsonPost(body?: unknown): RequestInit {
  return {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function fetchMddEvalCases(): Promise<MddEvalCaseSummaryDto[]> {
  return requestJson("cases", "No se pudieron cargar los casos");
}

export function fetchMddEvalCase(id: string): Promise<MddEvalCaseDetailDto> {
  return requestJson(`cases/${encodeURIComponent(id)}`, "No se pudo cargar el caso");
}

export function startMddEvalRun(body: MddEvalStartRunDto): Promise<MddEvalRunDto> {
  return requestJson("runs", "No se pudo iniciar la evaluación", jsonPost(body));
}

export function fetchMddEvalRuns(): Promise<MddEvalRunDto[]> {
  return requestJson("runs", "No se pudieron cargar las corridas");
}

export function fetchMddEvalRun(runId: string): Promise<MddEvalRunDto> {
  return requestJson(`runs/${encodeURIComponent(runId)}`, "No se pudo cargar la corrida");
}

export function cancelMddEvalRun(runId: string): Promise<MddEvalRunDto> {
  return requestJson(`runs/${encodeURIComponent(runId)}/cancel`, "No se pudo cancelar la corrida", jsonPost());
}

export async function fetchMddEvalCaseMarkdown(runId: string, caseId: string): Promise<string> {
  const res = await apiFetch(
    `${BASE}/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}/markdown`,
  );
  if (!res.ok) throw new MddEvalApiError(await readErrorMessage(res, "No se pudo cargar el MDD"), res.status);
  return res.text();
}

export function compareMddEvalRuns(base: string, target: string): Promise<MddEvalCompareDto> {
  const qs = new URLSearchParams({ base, target }).toString();
  return requestJson(`runs/compare?${qs}`, "No se pudo comparar las corridas");
}

export interface PollMddEvalRunOptions {
  /** Se invoca con cada snapshot recibido (incluido el terminal). */
  onUpdate: (run: MddEvalRunDto) => void;
  signal?: AbortSignal;
  /** Fallos de red consecutivos tolerados antes de abandonar. */
  maxConsecutiveErrors?: number;
  /** Errores transitorios (se siguen reintentando). */
  onTransientError?: (error: Error) => void;
  /** Inyectables para pruebas. */
  fetchRun?: (runId: string) => Promise<MddEvalRunDto>;
  now?: () => number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Sondea `GET runs/:runId` cada 3 s (10 s tras 5 min de seguimiento) hasta un estado
 * terminal. Resuelve con el último snapshot, o `null` si se abortó. Errores 403/404 son
 * fatales; los demás se reintentan hasta `maxConsecutiveErrors`.
 */
export async function pollMddEvalRun(
  runId: string,
  options: PollMddEvalRunOptions,
): Promise<MddEvalRunDto | null> {
  const {
    onUpdate,
    signal,
    maxConsecutiveErrors = 5,
    onTransientError,
    fetchRun = fetchMddEvalRun,
    now = Date.now,
  } = options;
  const startedAt = now();
  let consecutiveErrors = 0;

  while (!signal?.aborted) {
    try {
      const run = await fetchRun(runId);
      if (signal?.aborted) return null;
      consecutiveErrors = 0;
      onUpdate(run);
      if (isTerminalRunStatus(run.status)) return run;
    } catch (err) {
      if (signal?.aborted) return null;
      const error = err instanceof Error ? err : new Error(String(err));
      const fatal = error instanceof MddEvalApiError && (error.status === 403 || error.status === 404);
      consecutiveErrors += 1;
      if (fatal || consecutiveErrors >= maxConsecutiveErrors) throw error;
      onTransientError?.(error);
    }
    await sleep(getPollIntervalMs(now() - startedAt), signal);
  }
  return null;
}
