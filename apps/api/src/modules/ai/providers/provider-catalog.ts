/**
 * @fileoverview Catálogo central de proveedores LLM: IDs, defaults, modelos por capacidad y metadata.
 * Define {@link PROVIDER_IDS} (6 proveedores) y {@link PROVIDER_CATALOG_MAP} con entry completa por proveedor.
 */
export const PROVIDER_IDS = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "cloudflare",
  "groq",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Plantilla de base URL de Workers AI (sustituir `{accountId}`). */
export const CLOUDFLARE_BASE_URL_TEMPLATE =
  "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1";

export function buildCloudflareBaseUrl(accountId: string): string {
  const id = accountId.trim();
  if (!id) {
    throw new Error("Cloudflare accountId is required to build base URL");
  }
  return CLOUDFLARE_BASE_URL_TEMPLATE.replace("{accountId}", encodeURIComponent(id));
}

/** Extrae account ID de extras o de una baseUrl ya persistida. */
export function resolveCloudflareAccountId(
  extras?: Record<string, unknown> | null,
  baseUrl?: string | null,
): string | null {
  const fromExtras =
    typeof extras?.accountId === "string" ? extras.accountId.trim() : "";
  if (fromExtras) return fromExtras;
  const url = baseUrl?.trim();
  if (!url) return null;
  const match = url.match(/\/accounts\/([^/]+)\/ai\/v1\/?$/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Dimensión conocida por id de modelo de embedding (catálogo). */
export const EMBEDDING_DIMENSION_BY_MODEL: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "openai/text-embedding-3-small": 1536,
  "openai/text-embedding-3-large": 3072,
  "text-embedding-004": 768,
  "text-embedding-ada-002": 1536,
  "@cf/baai/bge-base-en-v1.5": 768,
  "@cf/baai/bge-large-en-v1.5": 1024,
  "@cf/google/embeddinggemma-300m": 768,
};

export interface ProviderExtraFieldSpec {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ImageModelInfo {
  id: string;
  label: string;
  /** Precio aproximado por prompt/token de entrada. */
  priceIn?: string;
  /** Precio aproximado por imagen generada (salida). */
  priceOut?: string;
  description?: string;
  /** Proveedor original del modelo (ej. OpenAI, Google). */
  originProvider?: string;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  label: string;
  /** Enlace a la consola para crear API tokens. */
  apiKeyHelpUrl?: string;
  defaultChatModel: string;
  /** Modelos de chat sugeridos en la UI. */
  chatModels?: string[];
  defaultEmbeddingModel: string | null;
  embeddingModels?: string[];
  /** Dimensión del modelo de embedding por defecto del proveedor. */
  defaultEmbeddingDimension: number | null;
  defaultSttModel: string | null;
  /** Modelo para chat con imágenes (visión). */
  defaultVisionModel: string | null;
  /** Modelos para generación de imágenes (EVD). */
  imageModels?: string[];
  /** Metadatos enriquecidos de cada modelo de imagen (clave = id del modelo). */
  imageModelDetails?: Record<string, ImageModelInfo>;
  /** Modelo por defecto de generación de imágenes. */
  defaultImageModel: string | null;
  defaultBaseUrl: string;
  /** Si el usuario puede editar baseUrl (p. ej. Cloudflare con account_id en la ruta). */
  baseUrlEditable?: boolean;
  /** Campos adicionales en `extras` (accountId, headers, etc.). */
  extraFields?: ProviderExtraFieldSpec[];
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportsStt: boolean;
  supportsImageGeneration: boolean;
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultChatModel: "nousresearch/hermes-3-llama-3.1-405b",
    defaultEmbeddingModel: "openai/text-embedding-3-small",
    defaultEmbeddingDimension: 1536,
    defaultSttModel: "openai/whisper-1",
    defaultVisionModel: "openai/gpt-4o",
    imageModels: [
      "openai/gpt-5-image",
      "openai/gpt-5-image-mini",
      "google/gemini-3-pro-image",
      "google/gemini-3.1-flash-image",
      "google/gemini-3.1-flash-lite-image",
      "google/gemini-2.5-flash-image",
      "openai/gpt-5.4-image-2",
    ],
    imageModelDetails: {
      "openai/gpt-5-image": {
        id: "openai/gpt-5-image",
        label: "GPT-5 Image",
        priceIn: "$0.00002",
        priceOut: "$0.00002",
        description: "OpenAI GPT-5 con generación de imágenes nativa (GPT Image 1). Alta calidad, multimodal.",
        originProvider: "OpenAI",
      },
      "openai/gpt-5-image-mini": {
        id: "openai/gpt-5-image-mini",
        label: "GPT-5 Image Mini",
        priceIn: "$0.00002",
        priceOut: "$0.00002",
        description: "Versión Mini de GPT-5 Image. Más rápido y económico, ideal para iteraciones.",
        originProvider: "OpenAI",
      },
      "google/gemini-3-pro-image": {
        id: "google/gemini-3-pro-image",
        label: "Gemini 3 Pro Image",
        priceIn: "$0.000002",
        priceOut: "$0.000004",
        description: "Google Gemini 3 Pro con generación avanzada de imágenes. La mejor calidad de Google.",
        originProvider: "Google",
      },
      "google/gemini-3.1-flash-image": {
        id: "google/gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image",
        priceIn: "$0.000002",
        priceOut: "$0.000004",
        description: "Google Gemini 3.1 Flash Image ('Nano Banana 2'). Calidad Pro a velocidad Flash.",
        originProvider: "Google",
      },
      "google/gemini-3.1-flash-lite-image": {
        id: "google/gemini-3.1-flash-lite-image",
        label: "Gemini 3.1 Flash Lite Image",
        priceIn: "$0.000001",
        priceOut: "$0.000002",
        description: "Google Gemini 3.1 Flash Lite. El más rápido y económico para exploración visual.",
        originProvider: "Google",
      },
      "google/gemini-2.5-flash-image": {
        id: "google/gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
        priceIn: "$0.0000003",
        priceOut: "$0.0000006",
        description: "Google Gemini 2.5 Flash Image ('Nano Banana'). Modelo de imagen anterior, muy barato.",
        originProvider: "Google",
      },
      "openai/gpt-5.4-image-2": {
        id: "openai/gpt-5.4-image-2",
        label: "GPT-5.4 Image 2",
        priceIn: "$0.00002",
        priceOut: "$0.00002",
        description: "OpenAI GPT-5.4 con GPT Image 2. Mejoras en reasoning, código y generación de imágenes.",
        originProvider: "OpenAI",
      },
    },
    defaultImageModel: "openai/gpt-5-image",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    supportsEmbeddings: true,
    supportsVision: true,
    supportsStt: true,
    supportsImageGeneration: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultChatModel: "gpt-4o",
    defaultEmbeddingModel: "text-embedding-3-small",
    defaultEmbeddingDimension: 1536,
    defaultSttModel: "whisper-1",
    defaultVisionModel: "gpt-4o",
    imageModels: ["dall-e-3", "gpt-image-1"],
    imageModelDetails: {
      "dall-e-3": {
        id: "dall-e-3",
        label: "DALL-E 3",
        priceIn: "$0.02",
        priceOut: "$0.04–0.08",
        description: "Modelo premium de OpenAI para imágenes de alta calidad. Precios dependen de resolución.",
        originProvider: "OpenAI",
      },
      "gpt-image-1": {
        id: "gpt-image-1",
        label: "GPT Image 1",
        priceIn: "$0.02",
        priceOut: "$0.07",
        description: "Nuevo modelo nativo de OpenAI. Mejor comprensión de prompts complejos.",
        originProvider: "OpenAI",
      },
    },
    defaultImageModel: "dall-e-3",
    defaultBaseUrl: "https://api.openai.com/v1",
    supportsEmbeddings: true,
    supportsVision: true,
    supportsStt: true,
    supportsImageGeneration: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultChatModel: "claude-3-5-sonnet-20240620",
    defaultEmbeddingModel: null,
    defaultEmbeddingDimension: null,
    defaultSttModel: null,
    defaultVisionModel: "claude-3-5-sonnet-20240620",
    defaultImageModel: null,
    defaultBaseUrl: "https://api.anthropic.com",
    supportsEmbeddings: false,
    supportsVision: true,
    supportsStt: false,
    supportsImageGeneration: false,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    defaultChatModel: "gemini-1.5-pro",
    defaultEmbeddingModel: "text-embedding-004",
    defaultEmbeddingDimension: 768,
    defaultSttModel: null,
    defaultVisionModel: "gemini-1.5-pro",
    defaultImageModel: null,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    supportsEmbeddings: true,
    supportsVision: true,
    supportsStt: false,
    supportsImageGeneration: false,
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    apiKeyHelpUrl: "https://dash.cloudflare.com/profile/api-tokens",
    defaultChatModel: "@cf/meta/llama-3.1-8b-instruct",
    chatModels: [
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-small-3.1-24b-instruct",
      "@cf/openai/gpt-oss-120b",
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ],
    defaultEmbeddingModel: "@cf/baai/bge-base-en-v1.5",
    embeddingModels: [
      "@cf/baai/bge-base-en-v1.5",
      "@cf/baai/bge-large-en-v1.5",
      "@cf/google/embeddinggemma-300m",
    ],
    defaultEmbeddingDimension: 768,
    defaultSttModel: null,
    defaultVisionModel: null,
    defaultImageModel: null,
    defaultBaseUrl: CLOUDFLARE_BASE_URL_TEMPLATE,
    baseUrlEditable: true,
    extraFields: [
      {
        key: "accountId",
        label: "Account ID",
        required: true,
        placeholder: "32-char hex account id",
        helpText: "Cloudflare dashboard → Workers & Pages → Account details",
      },
      {
        key: "headers",
        label: "Headers (JSON opcional)",
        required: false,
        placeholder: '{"cf-aig-metadata":"..."}',
      },
    ],
    supportsEmbeddings: true,
    supportsVision: false,
    supportsStt: false,
    supportsImageGeneration: false,
  },
  groq: {
    id: "groq",
    label: "Groq",
    apiKeyHelpUrl: "https://console.groq.com/keys",
    defaultChatModel: "llama-3.3-70b-versatile",
    chatModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "qwen/qwen3-32b",
    ],
    defaultEmbeddingModel: null,
    defaultEmbeddingDimension: null,
    defaultSttModel: "whisper-large-v3",
    defaultVisionModel: null,
    defaultImageModel: null,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    supportsEmbeddings: false,
    supportsVision: false,
    supportsStt: true,
    supportsImageGeneration: false,
  },
};

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return PROVIDER_IDS.map((id) => PROVIDER_CATALOG[id]);
}

/** Dimensión de embedding: override de usuario > catálogo por modelo > default del proveedor. */
export function resolveEmbeddingDimensionForModel(
  providerId: ProviderId,
  embeddingModel: string | null,
  userOverride?: number | null,
): number | null {
  if (userOverride != null && userOverride > 0) return userOverride;
  if (embeddingModel) {
    const byModel = EMBEDDING_DIMENSION_BY_MODEL[embeddingModel];
    if (byModel) return byModel;
    for (const [key, dim] of Object.entries(EMBEDDING_DIMENSION_BY_MODEL)) {
      if (embeddingModel.endsWith(key) || embeddingModel.includes(key)) return dim;
    }
  }
  return PROVIDER_CATALOG[providerId].defaultEmbeddingDimension;
}

/** Modelos de chat publicados en catálogo (whitelist base cuando la instancia no define lista). */
export function catalogChatModels(providerId: ProviderId): string[] {
  const c = PROVIDER_CATALOG[providerId];
  return [...new Set([c.defaultChatModel, ...(c.chatModels ?? [])])];
}

/** Modelos de embedding publicados en catálogo. */
export function catalogEmbeddingModels(providerId: ProviderId): string[] {
  const c = PROVIDER_CATALOG[providerId];
  const models = [...(c.embeddingModels ?? [])];
  if (c.defaultEmbeddingModel) models.push(c.defaultEmbeddingModel);
  return [...new Set(models)];
}

/** Lista separada por comas, punto y coma o saltos de línea. */
export function parseChatModelList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
}

/** Todos los modelos de chat publicados en catálogo (todos los proveedores). */
export function allCatalogChatModels(): string[] {
  return [
    ...new Set(
      (Object.keys(PROVIDER_CATALOG) as ProviderId[]).flatMap((id) => catalogChatModels(id)),
    ),
  ];
}

/** Pool de modelos que super_admin puede asignar a un usuario (catálogo + proveedores del equipo). */
export function globalGrantAssignableChatModels(
  teamInstances: Array<{
    providerType: string;
    chatModel: string;
    chatModelFallbacks: string[];
    allowedChatModels: string[];
  }>,
): string[] {
  const fromTeam = teamInstances.flatMap((inst) => tenantInstanceAssignableChatModels(inst));
  return [...new Set([...allCatalogChatModels(), ...fromTeam])];
}

/** Pool de modelos que super_admin puede asignar a un usuario sobre una instancia tenant. */
export function tenantInstanceAssignableChatModels(instance: {
  providerType: string;
  chatModel: string;
  chatModelFallbacks: string[];
  allowedChatModels: string[];
}): string[] {
  if (!isProviderId(instance.providerType)) return [];
  const providerId = instance.providerType;
  const base =
    instance.allowedChatModels.length > 0
      ? instance.allowedChatModels
      : catalogChatModels(providerId);
  return [
    ...new Set([
      instance.chatModel,
      ...instance.chatModelFallbacks,
      ...base,
    ]),
  ];
}

/** Whitelist efectiva al validar runtime: lista explícita de la instancia o modelos configurados en ella. */
export function resolveInstanceChatModelWhitelist(instance: {
  chatModel: string;
  chatModelFallbacks: string[];
  allowedChatModels: string[];
  auditorChatModel?: string | null;
  highComplexityChatModel?: string | null;
  extras?: Record<string, unknown> | null;
}): string[] {
  if (instance.allowedChatModels.length > 0) {
    return [...new Set(instance.allowedChatModels)];
  }
  const legacyFallbacks = instance.extras?.chatModelFallbacks;
  const fallbacks =
    instance.chatModelFallbacks.length > 0
      ? instance.chatModelFallbacks
      : Array.isArray(legacyFallbacks)
        ? legacyFallbacks.filter((m): m is string => typeof m === "string" && m.length > 0)
        : [];
  const configured = [
    instance.chatModel,
    ...fallbacks,
    ...(instance.auditorChatModel?.trim() ? [instance.auditorChatModel.trim()] : []),
    ...(instance.highComplexityChatModel?.trim()
      ? [instance.highComplexityChatModel.trim()]
      : []),
  ].filter((m): m is string => typeof m === "string" && m.trim().length > 0);
  return [...new Set(configured)];
}

/** Unión instancia + grants por usuario para validar runtime. */
export function mergedTenantChatModelWhitelist(
  instance: { allowedChatModels: string[] },
  userAllowedChatModels: string[] | null | undefined,
): string[] {
  return [...new Set([...instance.allowedChatModels, ...(userAllowedChatModels ?? [])])];
}

/**
 * Con grants del super_admin, solo cuenta la lista del usuario.
 * Sin grants, aplica whitelist de la instancia (modelos configurados o lista explícita).
 */
export function isChatModelAllowedForTenantUser(
  model: string,
  userGrants: string[],
  providerId: ProviderId,
  instanceAllowedChatModels: string[],
  bypassWhitelist: boolean,
): boolean {
  if (bypassWhitelist) return true;
  if (userGrants.length > 0) return userGrants.includes(model);
  return isChatModelWhitelisted(providerId, model, instanceAllowedChatModels, false);
}

export function isChatModelWhitelisted(
  providerId: ProviderId,
  model: string,
  allowedChatModels: string[],
  bypassWhitelist: boolean,
): boolean {
  if (bypassWhitelist) return true;
  if (allowedChatModels.length > 0) return allowedChatModels.includes(model);
  return catalogChatModels(providerId).includes(model);
}

export function isEmbeddingModelWhitelisted(
  providerId: ProviderId,
  model: string | null,
  allowedEmbeddingModels: string[],
  bypassWhitelist: boolean,
): boolean {
  if (!model) return true;
  if (bypassWhitelist) return true;
  if (allowedEmbeddingModels.length > 0) return allowedEmbeddingModels.includes(model);
  return catalogEmbeddingModels(providerId).includes(model);
}
