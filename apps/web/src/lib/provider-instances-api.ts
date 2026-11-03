import { api } from "@/utils/apiClient";
import { parseErrorMessageFromResponse } from "@/utils/httpError";
import type {
  ProviderId,
  ProviderInstanceSummary,
  UpsertProviderInstanceBody,
} from "@/types/user-providers";

const BASE = "/api/provider-instances";

async function ensureOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, fallback));
  }
}

export async function fetchEnabledProviderInstances(): Promise<ProviderInstanceSummary[]> {
  const res = await api.get(`${BASE}/enabled`);
  await ensureOk(res, "No se pudieron cargar las instancias del equipo");
  return res.json() as Promise<ProviderInstanceSummary[]>;
}

export async function fetchAllProviderInstances(): Promise<ProviderInstanceSummary[]> {
  const res = await api.get(BASE);
  await ensureOk(res, "No se pudieron cargar las instancias de proveedor");
  return res.json() as Promise<ProviderInstanceSummary[]>;
}

export async function fetchProviderInstanceCatalogModels(providerType: ProviderId): Promise<{
  chatModels: string[];
  embeddingModels: string[];
}> {
  const res = await api.get(`${BASE}/catalog-models/${providerType}`);
  await ensureOk(res, "No se pudo cargar el catálogo de modelos");
  return res.json() as Promise<{ chatModels: string[]; embeddingModels: string[] }>;
}

export async function createProviderInstance(
  body: UpsertProviderInstanceBody,
): Promise<ProviderInstanceSummary> {
  const res = await api.post(BASE, body);
  await ensureOk(res, "No se pudo crear la instancia");
  return res.json() as Promise<ProviderInstanceSummary>;
}

export async function updateProviderInstance(
  id: string,
  body: Partial<UpsertProviderInstanceBody>,
): Promise<ProviderInstanceSummary> {
  const res = await api.put(`${BASE}/${id}`, body);
  await ensureOk(res, "No se pudo actualizar la instancia");
  return res.json() as Promise<ProviderInstanceSummary>;
}

export async function deleteProviderInstance(id: string): Promise<void> {
  const res = await api.delete(`${BASE}/${id}`);
  await ensureOk(res, "No se pudo eliminar la instancia");
}
