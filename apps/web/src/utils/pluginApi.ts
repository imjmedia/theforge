/**
 * API utilities for plugin artifact types and data.
 */

import type {
  ArtifactTypeDefinition,
  PluginArtifactProgress,
  PluginInstallResult,
  PluginInstalledListResponse,
  PluginReloadResult,
  PluginSettingsPanelDefinition,
  PluginUninstallResult,
  PluginUserSettingsMap,
} from "@theforge/shared-types";
import { MIN_GENERATION_CONTENT_LEN } from "@theforge/shared-types";
import { apiFetch, API_BASE } from "./apiClient";

let cachedArtifacts: ArtifactTypeDefinition[] | null = null;

const POLL_MAX_ATTEMPTS = 10_800;
const POLL_INTERVAL_MS = 2_000;

export async function fetchPluginArtifacts(): Promise<ArtifactTypeDefinition[]> {
  if (cachedArtifacts) return cachedArtifacts;
  const res = await apiFetch(`${API_BASE}/plugins/artifacts`);
  if (!res.ok) return [];
  const data: ArtifactTypeDefinition[] = await res.json();
  cachedArtifacts = data;
  return data;
}

export async function fetchPluginSettingsPanels(): Promise<PluginSettingsPanelDefinition[]> {
  const res = await apiFetch(`${API_BASE}/plugins/settings-panels`);
  if (!res.ok) return [];
  return res.json();
}

export function clearPluginArtifactsCache(): void {
  cachedArtifacts = null;
}

export async function fetchInstalledPlugins(): Promise<PluginInstalledListResponse> {
  const res = await apiFetch(`${API_BASE}/plugins/installed`);
  if (!res.ok) throw new Error("No se pudo obtener plugins instalados");
  return res.json();
}

export async function installPluginFromFile(file: File): Promise<PluginInstallResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(`${API_BASE}/plugins/install`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof (err as { message?: string }).message === "string"
        ? (err as { message: string }).message
        : "Error al instalar el plugin",
    );
  }
  return res.json();
}

export async function uninstallPlugin(pluginId: string): Promise<PluginUninstallResult> {
  const res = await apiFetch(
    `${API_BASE}/plugins/installed/${encodeURIComponent(pluginId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof (err as { message?: string }).message === "string"
        ? (err as { message: string }).message
        : "Error al desinstalar",
    );
  }
  return res.json();
}

export async function reloadPlugins(): Promise<PluginReloadResult> {
  const res = await apiFetch(`${API_BASE}/plugins/reload`, { method: "POST" });
  if (!res.ok) throw new Error("Error al recargar plugins");
  return res.json();
}

export async function fetchPluginUserSettings(
  pluginId: string,
): Promise<Record<string, unknown>> {
  const encoded = encodeURIComponent(pluginId);
  const res = await apiFetch(`${API_BASE}/plugins/${encoded}/user-settings`);
  if (!res.ok) return {};
  return res.json();
}

export async function savePluginUserSettings(
  pluginId: string,
  settings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const encoded = encodeURIComponent(pluginId);
  const res = await apiFetch(`${API_BASE}/plugins/${encoded}/user-settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err?.message === "string" ? err.message : "No se pudieron guardar los ajustes del plugin",
    );
  }
  return res.json();
}

export async function fetchAllPluginUserSettings(): Promise<PluginUserSettingsMap> {
  const res = await apiFetch(`${API_BASE}/plugins/user-settings`);
  if (!res.ok) return {};
  return res.json();
}

export async function getPluginData(
  projectId: string,
  pluginId: string,
): Promise<unknown> {
  const res = await apiFetch(
    `${API_BASE}/plugins/projects/${projectId}/plugin-data/${pluginId}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export async function setPluginData(
  projectId: string,
  pluginId: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  const res = await apiFetch(
    `${API_BASE}/plugins/projects/${projectId}/plugin-data/${pluginId}`,
    { method: "PUT", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error("Failed to save plugin data");
  return res.json();
}

/** Mensaje si faltan entregables core requeridos por el artifact (client-side guard). */
export function pluginArtifactRequirementsMessage(
  requires: string[] | undefined,
  deliverables: Record<string, string | null | undefined>,
): string | null {
  if (!requires?.length) return null;
  const missing = requires.filter(
    (field) => (deliverables[field] ?? "").trim().length < MIN_GENERATION_CONTENT_LEN,
  );
  if (missing.length === 0) return null;
  return `Faltan entregables requeridos: ${missing.join(", ")}`;
}

/** Poll BullMQ / in-memory job hasta completed o failed. */
export async function pollDeliverablesJob<T>(
  jobId: string,
  opts?: { signal?: AbortSignal; onProgress?: (progress: PluginArtifactProgress) => void },
): Promise<T> {
  const pollUrl = `${API_BASE}/projects/jobs/${jobId}`;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (opts?.signal?.aborted) throw new Error("Cancelado por el usuario");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pr = await apiFetch(pollUrl);
    if (!pr.ok) {
      if (pr.status === 404) throw new Error("Job no encontrado");
      continue;
    }
    const status = (await pr.json()) as {
      status: string;
      progress?: PluginArtifactProgress | number | unknown;
      result?: T;
      error?: string;
    };
    if (status.progress && opts?.onProgress) {
      const p = status.progress;
      if (typeof p === "object" && p !== null && "percent" in p) {
        opts.onProgress(p as PluginArtifactProgress);
      }
    }
    if (status.status === "completed") return status.result as T;
    if (status.status === "failed") throw new Error(status.error ?? "Error en la generación");
  }
  throw new Error(
    "Tiempo de espera agotado (6 h). Recarga el proyecto; el job puede haber terminado en el servidor.",
  );
}

export async function generatePluginArtifact(
  projectId: string,
  pluginId: string,
  artifactId: string,
  opts?: { queue?: boolean; stageId?: string | null; signal?: AbortSignal },
): Promise<{ queued: boolean; jobId?: string; data?: unknown }> {
  const res = await apiFetch(
    `${API_BASE}/plugins/projects/${projectId}/generate/${encodeURIComponent(pluginId)}/${encodeURIComponent(artifactId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue: opts?.queue ?? true, stageId: opts?.stageId ?? undefined }),
      signal: opts?.signal,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof (err as { message?: string }).message === "string"
        ? (err as { message: string }).message
        : "Error al generar artifact del plugin",
    );
  }
  return res.json();
}

/** Encola (por defecto) y hace polling hasta obtener `data` del artifact. */
export async function generateAndPollPluginArtifact(
  projectId: string,
  pluginId: string,
  artifactId: string,
  opts?: {
    stageId?: string | null;
    signal?: AbortSignal;
    onProgress?: (progress: PluginArtifactProgress) => void;
  },
): Promise<unknown> {
  const res = await generatePluginArtifact(projectId, pluginId, artifactId, {
    queue: true,
    stageId: opts?.stageId,
    signal: opts?.signal,
  });
  if (!res.queued) return res.data;
  if (!res.jobId) throw new Error("Cola no devolvió jobId");
  const result = await pollDeliverablesJob<{ data?: unknown }>(res.jobId, {
    signal: opts?.signal,
    onProgress: opts?.onProgress,
  });
  return result?.data ?? result;
}
