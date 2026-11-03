import { api } from "@/utils/apiClient";
import { parseErrorMessageFromResponse } from "@/utils/httpError";
import type {
  ProviderCatalogEntry,
  UpdateAISettingsBody,
  UpsertProviderConfigBody,
  UserAISettings,
  UserProviderConfigSummary,
  ProviderId,
} from "@/types/user-providers";

const BASE = "/api/user-providers";

async function ensureOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, fallback));
  }
}

export async function fetchProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  const res = await api.get(`${BASE}/catalog`);
  await ensureOk(res, "No se pudo cargar el catálogo de proveedores");
  return res.json() as Promise<ProviderCatalogEntry[]>;
}

export async function fetchUserProviderConfigs(): Promise<UserProviderConfigSummary[]> {
  const res = await api.get(`${BASE}/configs`);
  await ensureOk(res, "No se pudieron cargar tus proveedores");
  return res.json() as Promise<UserProviderConfigSummary[]>;
}

export async function fetchUserAISettings(): Promise<UserAISettings> {
  const res = await api.get(`${BASE}/settings`);
  await ensureOk(res, "No se pudieron cargar los ajustes de IA");
  return res.json() as Promise<UserAISettings>;
}

export async function upsertProviderConfig(
  provider: ProviderId,
  body: UpsertProviderConfigBody,
): Promise<UserProviderConfigSummary> {
  const res = await api.put(`${BASE}/configs/${provider}`, body);
  await ensureOk(res, "No se pudo guardar la configuración del proveedor");
  return res.json() as Promise<UserProviderConfigSummary>;
}

export async function deleteProviderConfig(provider: ProviderId): Promise<void> {
  const res = await api.delete(`${BASE}/configs/${provider}`);
  await ensureOk(res, "No se pudo eliminar la configuración");
}

export async function updateUserAISettings(
  body: UpdateAISettingsBody,
): Promise<UserAISettings> {
  const res = await api.put(`${BASE}/settings`, body);
  await ensureOk(res, "No se pudieron actualizar los ajustes de IA");
  return res.json() as Promise<UserAISettings>;
}

export async function fetchProviderStatus(): Promise<{
  usable: boolean;
  configured: boolean;
  resolveError?: string;
  runtime?: {
    providerId: string;
    chatModel: string;
    fallbacks: string[];
    source: "tenant" | "byok";
    instanceName?: string;
  };
}> {
  const res = await api.get(`${BASE}/status`);
  await ensureOk(res, "No se pudo comprobar el proveedor de IA");
  return res.json() as Promise<{
    usable: boolean;
    configured: boolean;
    resolveError?: string;
    runtime?: {
      providerId: string;
      chatModel: string;
      fallbacks: string[];
      source: "tenant" | "byok";
      instanceName?: string;
    };
  }>;
}
