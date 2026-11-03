import { api } from "@/utils/apiClient";
import { parseErrorMessageFromResponse } from "@/utils/httpError";
import type {
  UiMcpCompatibilityResult,
  UiMcpInstanceSummary,
  UpsertUiMcpInstanceBody,
} from "@/types/ui-mcp";

const BASE = "/api/ui-mcp";

async function ensureOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, fallback));
  }
}

/** ¿Hay un MCP gráfico compatible activo? (gate para deliverables/UI). */
export async function fetchUiMcpActive(): Promise<{ hasActiveCompatible: boolean }> {
  const res = await api.get(`${BASE}/active`);
  await ensureOk(res, "No se pudo consultar el estado del MCP gráfico");
  return res.json() as Promise<{ hasActiveCompatible: boolean }>;
}

export async function fetchUiMcpInstances(): Promise<UiMcpInstanceSummary[]> {
  const res = await api.get(BASE);
  await ensureOk(res, "No se pudieron cargar las instancias de MCP gráfico");
  return res.json() as Promise<UiMcpInstanceSummary[]>;
}

export async function createUiMcpInstance(
  body: UpsertUiMcpInstanceBody,
): Promise<UiMcpInstanceSummary> {
  const res = await api.post(BASE, body);
  await ensureOk(res, "No se pudo crear la instancia");
  return res.json() as Promise<UiMcpInstanceSummary>;
}

export async function updateUiMcpInstance(
  id: string,
  body: Partial<UpsertUiMcpInstanceBody>,
): Promise<UiMcpInstanceSummary> {
  const res = await api.put(`${BASE}/${id}`, body);
  await ensureOk(res, "No se pudo actualizar la instancia");
  return res.json() as Promise<UiMcpInstanceSummary>;
}

export async function deleteUiMcpInstance(id: string): Promise<void> {
  const res = await api.delete(`${BASE}/${id}`);
  await ensureOk(res, "No se pudo eliminar la instancia");
}

export async function activateUiMcpInstance(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; activeId: string | null }> {
  const res = await api.post(`${BASE}/${id}/activate`, { active });
  await ensureOk(res, "No se pudo activar la instancia");
  return res.json() as Promise<{ ok: boolean; activeId: string | null }>;
}

/** Detecta compatibilidad de una instancia guardada y persiste el resultado. */
export async function detectUiMcpInstance(
  id: string,
): Promise<UiMcpInstanceSummary & { detection: UiMcpCompatibilityResult }> {
  const res = await api.post(`${BASE}/${id}/detect`);
  await ensureOk(res, "No se pudo detectar compatibilidad");
  return res.json() as Promise<UiMcpInstanceSummary & { detection: UiMcpCompatibilityResult }>;
}

/** Prueba/detecta compatibilidad de una URL/token sin persistir. */
export async function testUiMcpConnection(body: {
  url: string;
  token?: string | null;
}): Promise<UiMcpCompatibilityResult> {
  const res = await api.post(`${BASE}/test`, body);
  await ensureOk(res, "No se pudo probar la conexión");
  return res.json() as Promise<UiMcpCompatibilityResult>;
}
