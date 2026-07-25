/**
 * @fileoverview Helpers de configuración de proveedores: builders de base URL, resolución de account IDs,
 * validación de dimensiones de embeddings y whitelist de modelos.
 */
import { BadRequestException } from "@nestjs/common";
import {
  buildCloudflareBaseUrl,
  PROVIDER_CATALOG,
  resolveCloudflareAccountId,
  resolveEmbeddingDimensionForModel,
  type ProviderId,
} from "../ai/providers/provider-catalog.js";

export function normalizeFallbacks(raw?: string[]): string[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  return raw
    .map((m) => m.trim())
    .filter((m) => {
      if (!m || seen.has(m)) return false;
      seen.add(m);
      return true;
    });
}

export function maskApiKeyHint(key: string): string {
  const t = key.trim();
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export function normalizeProviderExtras(
  provider: ProviderId,
  raw?: Record<string, unknown> | null,
): Record<string, unknown> {
  const extras: Record<string, unknown> = { ...(raw ?? {}) };

  if (provider === "cloudflare") {
    const accountId =
      (typeof extras.accountId === "string" && extras.accountId.trim()) ||
      (typeof raw?.accountId === "string" && raw.accountId.trim()) ||
      "";
    if (!accountId) {
      throw new BadRequestException(
        "Cloudflare requiere accountId en extras (Account ID de tu cuenta Cloudflare)",
      );
    }
    extras.accountId = accountId;
  }

  return extras;
}

export function resolveConfigBaseUrl(
  provider: ProviderId,
  dtoBaseUrl: string | null | undefined,
  extras: Record<string, unknown>,
): string {
  const catalog = PROVIDER_CATALOG[provider];
  const trimmed = dtoBaseUrl?.trim();

  if (provider === "cloudflare") {
    const accountId = resolveCloudflareAccountId(extras, trimmed);
    if (!accountId) {
      throw new BadRequestException(
        "Cloudflare requiere accountId en extras o una baseUrl con /accounts/{id}/ai/v1",
      );
    }
    if (trimmed && !trimmed.includes("{accountId}")) {
      return trimmed;
    }
    return buildCloudflareBaseUrl(accountId);
  }

  return trimmed || catalog.defaultBaseUrl;
}

export function resolveRuntimeBaseUrl(
  provider: ProviderId,
  storedBaseUrl: string | null | undefined,
  extras: Record<string, unknown>,
): string {
  const catalog = PROVIDER_CATALOG[provider];
  const trimmed = storedBaseUrl?.trim();

  if (provider === "cloudflare") {
    const accountId = resolveCloudflareAccountId(extras, trimmed);
    if (accountId) {
      if (trimmed && !trimmed.includes("{accountId}")) {
        return trimmed;
      }
      return buildCloudflareBaseUrl(accountId);
    }
    throw new BadRequestException(
      "Configuración Cloudflare incompleta: falta accountId en extras",
    );
  }

  return trimmed || catalog.defaultBaseUrl;
}

export function resolveVisionModelForRuntime(params: {
  visionModel?: string | null;
  chatModel: string;
  extras?: Record<string, unknown> | null;
  catalogDefaultVisionModel?: string | null;
  supportsVision: boolean;
}): string {
  if (!params.supportsVision) return params.chatModel;
  const extras = (params.extras ?? {}) as Record<string, unknown>;
  const legacyExtras =
    typeof extras.visionModel === "string" ? extras.visionModel.trim() : "";
  return (
    params.visionModel?.trim() ||
    legacyExtras ||
    params.catalogDefaultVisionModel?.trim() ||
    params.chatModel
  );
}

export function buildModelFields(
  provider: ProviderId,
  dto: {
    chatModel?: string;
    chatModelFallbacks?: string[];
    auditorChatModel?: string | null;
    highComplexityChatModel?: string | null;
    embeddingModel?: string | null;
    embeddingDimension?: number | null;
    sttModel?: string | null;
    visionModel?: string | null;
    imageModel?: string | null;
  },
) {
  const catalog = PROVIDER_CATALOG[provider];
  const chatModel = dto.chatModel?.trim() || catalog.defaultChatModel;
  const chatModelFallbacks = normalizeFallbacks(dto.chatModelFallbacks);
  const embeddingModel =
    dto.embeddingModel === null
      ? null
      : (dto.embeddingModel?.trim() || catalog.defaultEmbeddingModel);
  const embeddingDimension =
    dto.embeddingDimension === null
      ? null
      : dto.embeddingDimension !== undefined
        ? dto.embeddingDimension
        : resolveEmbeddingDimensionForModel(provider, embeddingModel);
  const sttModel =
    dto.sttModel === null ? null : (dto.sttModel?.trim() || catalog.defaultSttModel);
  if (sttModel && !catalog.supportsStt) {
    throw new BadRequestException(`El proveedor «${provider}» no soporta transcripción de audio`);
  }
  let visionModel: string | null | undefined;
  if (dto.visionModel === undefined) {
    visionModel = undefined;
  } else if (dto.visionModel === null) {
    visionModel = null;
  } else {
    visionModel = dto.visionModel.trim() || catalog.defaultVisionModel;
  }
  if (visionModel && !catalog.supportsVision) {
    throw new BadRequestException(`El proveedor «${provider}» no soporta visión (imágenes)`);
  }
  const auditorRaw = dto.auditorChatModel;
  const auditorChatModel =
    auditorRaw === null || auditorRaw === undefined
      ? null
      : auditorRaw.trim() || null;

  const highComplexityRaw = dto.highComplexityChatModel;
  const highComplexityChatModel =
    highComplexityRaw === null || highComplexityRaw === undefined
      ? null
      : highComplexityRaw.trim() || null;

  let imageModel: string | null | undefined;
  if (dto.imageModel === undefined) {
    imageModel = undefined;
  } else if (dto.imageModel === null) {
    imageModel = null;
  } else {
    imageModel = dto.imageModel.trim() || null;
  }

  return {
    chatModel,
    chatModelFallbacks,
    auditorChatModel,
    highComplexityChatModel,
    embeddingModel,
    embeddingDimension,
    sttModel,
    visionModel,
    imageModel,
  };
}
