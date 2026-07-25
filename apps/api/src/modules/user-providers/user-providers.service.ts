/**
 * @fileoverview Servicio central de proveedores LLM del usuario: resolución de runtime BYOK/tenant,
 * gestión de settings ({@link UserAISettings}), CRUD de configuraciones personales, y catálogo de proveedores.
 * Orden de resolución: instancia activa → tenant default → primera disponible → BYOK personal.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@theforge/database";
import type { ProviderInstance } from "@theforge/database";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TokenCryptoService } from "../crypto/token-crypto.service.js";
import {
  PROVIDER_CATALOG,
  catalogChatModels,
  globalGrantAssignableChatModels,
  isChatModelAllowedForTenantUser,
  isEmbeddingModelWhitelisted,
  isProviderId,
  listProviderCatalog,
  parseChatModelList,
  resolveEmbeddingDimensionForModel,
  resolveInstanceChatModelWhitelist,
  type ProviderId,
} from "../ai/providers/provider-catalog.js";
import { isSuperAdmin } from "../../common/roles.js";
import type { UserLLMRuntime } from "../ai/providers/llm-runtime.types.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import {
  buildModelFields,
  maskApiKeyHint,
  normalizeProviderExtras,
  resolveConfigBaseUrl,
  resolveRuntimeBaseUrl,
  resolveVisionModelForRuntime,
} from "./provider-config.helpers.js";
import { isLlmDebugEnabled, llmDebug, summarizeRuntimeForLog } from "../ai/config/llm-debug.util.js";

export interface ProviderStatusResult {
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
}

export interface UpsertProviderConfigDto {
  apiKey: string;
  chatModel?: string;
  chatModelFallbacks?: string[];
  embeddingModel?: string | null;
  embeddingDimension?: number | null;
  sttModel?: string | null;
  visionModel?: string | null;
  imageModel?: string | null;
  baseUrl?: string | null;
  extras?: Record<string, unknown> | null;
}

export interface UpdateAISettingsDto {
  activeProvider?: string;
  activeTenantInstanceId?: string | null;
  /** @deprecated Rechazado; configurar `auditorChatModel` en la instancia activa. */
  mddAuditorTenantInstanceId?: string | null;
  embeddingProvider?: string | null;
  embeddingsEnabled?: boolean;
  imageModel?: string | null;
  imageQuality?: string;
  imageStyle?: string;
}

@Injectable()
export class UserProvidersService {
  private readonly logger = new Logger(UserProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  getCatalog() {
    return listProviderCatalog();
  }

  async getSettings(userId = getRequestUserId()) {
    const row = await this.prisma.userAISettings.findUnique({ where: { userId } });
    return {
      activeProvider: row?.activeProvider ?? null,
      activeTenantInstanceId: row?.activeTenantInstanceId ?? null,
      mddAuditorTenantInstanceId: row?.mddAuditorTenantInstanceId ?? null,
      embeddingProvider: row?.embeddingProvider ?? null,
      embeddingsEnabled: row?.embeddingsEnabled ?? true,
      allowedChatModels: row?.allowedChatModels ?? [],
    };
  }

  /** Catálogo + modelos/fallbacks de proveedores visibles para el equipo. */
  async buildGlobalGrantAssignableChatModels(): Promise<string[]> {
    const teamRows = await this.prisma.providerInstance.findMany({
      where: { enabledForUsers: true },
      select: {
        providerType: true,
        chatModel: true,
        chatModelFallbacks: true,
        allowedChatModels: true,
      },
    });
    return globalGrantAssignableChatModels(teamRows);
  }

  /** super_admin: grants de modelos por usuario (vista de usuarios). */
  async getUserChatModelGrants(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException("Usuario no encontrado");
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId: targetUserId } });
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      allowedChatModels: settings?.allowedChatModels ?? [],
      assignableChatModels: await this.buildGlobalGrantAssignableChatModels(),
    };
  }

  /** super_admin: modelos permitidos solo para admins (sin cambiar su proveedor activo). */
  async updateUserAllowedChatModels(targetUserId: string, modelsRaw: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException("Usuario no encontrado");
    if (target.role === "super_admin") {
      throw new BadRequestException("No se asignan grants de modelos a otro super_admin");
    }
    if (target.role === "developer") {
      throw new BadRequestException(
        "Los developers usan el proveedor del equipo; no se asignan modelos individuales",
      );
    }

    const models = parseChatModelList(modelsRaw);
    for (const model of models) {
      if (model.length < 2 || model.length > 256) {
        throw new BadRequestException(
          `Nombre de modelo no válido: «${model}». Usa entre 2 y 256 caracteres.`,
        );
      }
    }

    const existing = await this.prisma.userAISettings.findUnique({ where: { userId: targetUserId } });
    const row = await this.prisma.userAISettings.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        activeProvider: existing?.activeProvider ?? "openrouter",
        activeTenantInstanceId: existing?.activeTenantInstanceId ?? undefined,
        allowedChatModels: models,
      },
      update: { allowedChatModels: models },
    });
    return {
      userId: targetUserId,
      allowedChatModels: row.allowedChatModels,
    };
  }

  /** Admin: solo modelos que el super_admin compartió o los del catálogo del proveedor. */
  async validateUserMayUseChatModels(
    userId: string,
    provider: ProviderId,
    modelIds: string[],
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || isSuperAdmin(user.role)) return;
    if (user.role === "developer") return;

    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const grants = settings?.allowedChatModels ?? [];
    const toCheck = modelIds.filter((m) => m.trim().length > 0);

    if (grants.length > 0) {
      const invalid = toCheck.filter((m) => !grants.includes(m));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Modelo no autorizado: ${invalid.join(", ")}. El super_admin te permitió: ${grants.join(", ")}`,
        );
      }
      return;
    }

    const catalog = catalogChatModels(provider);
    const invalid = toCheck.filter((m) => !catalog.includes(m));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Modelo no válido para «${provider}»: ${invalid.join(", ")}. Usa un modelo del catálogo o pide al super_admin que te habilite modelos.`,
      );
    }
  }

  async updateSettings(dto: UpdateAISettingsDto, userId = getRequestUserId()) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (dto.mddAuditorTenantInstanceId !== undefined) {
      throw new BadRequestException(
        "El Auditor MDD se configura en la instancia activa (modelo de auditor en el modal de la instancia)",
      );
    }
    if (user?.role === "developer") {
      if (dto.activeTenantInstanceId !== undefined || dto.activeProvider !== undefined) {
        throw new ForbiddenException(
          "Los developers usan el proveedor predeterminado configurado por el super_admin",
        );
      }
    }
    const superAdmin = isSuperAdmin(user?.role ?? "developer");
    for (const instanceId of [dto.activeTenantInstanceId]) {
      if (instanceId === undefined || instanceId === null) continue;
      const inst = await this.prisma.providerInstance.findFirst({
        where: {
          id: instanceId,
          ...(superAdmin ? {} : this.instanceAccessibleByUser(userId)),
        },
      });
      if (!inst) {
        throw new BadRequestException("Instancia de proveedor no disponible");
      }
    }
    if (dto.activeProvider !== undefined) {
      if (!isProviderId(dto.activeProvider)) {
        throw new BadRequestException("Proveedor activo no válido");
      }
      const cfg = await this.prisma.userProviderConfig.findUnique({
        where: { userId_provider: { userId, provider: dto.activeProvider } },
      });
      if (!cfg) {
        throw new BadRequestException(
          `Configura primero el proveedor «${dto.activeProvider}» con tu clave API`,
        );
      }
    }
    if (dto.embeddingProvider !== undefined && dto.embeddingProvider !== null) {
      if (!isProviderId(dto.embeddingProvider)) {
        throw new BadRequestException("Proveedor de embeddings no válido");
      }
      const embCfg = await this.prisma.userProviderConfig.findUnique({
        where: { userId_provider: { userId, provider: dto.embeddingProvider } },
      });
      if (!embCfg) {
        throw new BadRequestException(
          `Configura primero el proveedor de embeddings «${dto.embeddingProvider}» con tu clave API`,
        );
      }
      const catalog = PROVIDER_CATALOG[dto.embeddingProvider];
      if (!catalog.supportsEmbeddings) {
        throw new BadRequestException(
          `El proveedor «${dto.embeddingProvider}» no soporta embeddings`,
        );
      }
    }
    const row = await this.prisma.userAISettings.upsert({
      where: { userId },
      create: {
        userId,
        activeProvider: dto.activeProvider ?? "openrouter",
        activeTenantInstanceId: dto.activeTenantInstanceId ?? undefined,
        mddAuditorTenantInstanceId: dto.mddAuditorTenantInstanceId ?? undefined,
        embeddingProvider: dto.embeddingProvider ?? undefined,
        embeddingsEnabled: dto.embeddingsEnabled ?? true,
        imageModel: dto.imageModel ?? undefined,
        imageQuality: dto.imageQuality ?? "standard",
        imageStyle: dto.imageStyle ?? "abstract",
      },
      update: {
        ...(dto.activeProvider !== undefined ? { activeProvider: dto.activeProvider } : {}),
        ...(dto.activeTenantInstanceId !== undefined
          ? { activeTenantInstanceId: dto.activeTenantInstanceId }
          : {}),
        ...(dto.mddAuditorTenantInstanceId !== undefined
          ? { mddAuditorTenantInstanceId: dto.mddAuditorTenantInstanceId }
          : {}),
        ...(dto.embeddingProvider !== undefined
          ? { embeddingProvider: dto.embeddingProvider }
          : {}),
        ...(dto.embeddingsEnabled !== undefined ? { embeddingsEnabled: dto.embeddingsEnabled } : {}),
        ...(dto.imageModel !== undefined ? { imageModel: dto.imageModel } : {}),
        ...(dto.imageQuality !== undefined ? { imageQuality: dto.imageQuality } : {}),
        ...(dto.imageStyle !== undefined ? { imageStyle: dto.imageStyle } : {}),
      },
    });
    return {
      activeProvider: row.activeProvider,
      activeTenantInstanceId: row.activeTenantInstanceId,
      mddAuditorTenantInstanceId: row.mddAuditorTenantInstanceId,
      embeddingProvider: row.embeddingProvider,
      embeddingsEnabled: row.embeddingsEnabled,
      imageModel: row.imageModel,
      imageQuality: row.imageQuality,
      imageStyle: row.imageStyle,
    };
  }

  async listConfigs(userId = getRequestUserId()) {
    const rows = await this.prisma.userProviderConfig.findMany({
      where: { userId },
      orderBy: { provider: "asc" },
    });
    return rows.map((r) => ({
      provider: r.provider,
      chatModel: r.chatModel,
      chatModelFallbacks: r.chatModelFallbacks,
      embeddingModel: r.embeddingModel,
      embeddingDimension: r.embeddingDimension,
      sttModel: r.sttModel,
      visionModel: r.visionModel,
      imageModel: r.imageModel,
      baseUrl: r.baseUrl,
      extras: r.extras,
      configured: true,
      apiKeyHint: maskApiKeyHint(this.tokenCrypto.decrypt(r.tokenCiphertext, r.tokenKeyVersion)),
    }));
  }

  async upsertConfig(provider: string, dto: UpsertProviderConfigDto, userId = getRequestUserId()) {
    if (!isProviderId(provider)) {
      throw new BadRequestException("Proveedor no válido");
    }
    const key = dto.apiKey?.trim();
    if (!key) {
      throw new BadRequestException("La clave API es obligatoria");
    }
    const models = buildModelFields(provider, dto);
    await this.validateUserMayUseChatModels(userId, provider, [
      models.chatModel,
      ...models.chatModelFallbacks,
    ]);
    const extras = normalizeProviderExtras(provider, dto.extras);
    const baseUrl = resolveConfigBaseUrl(provider, dto.baseUrl, extras);
    const { ciphertext, keyVersion } = this.tokenCrypto.encrypt(key);

    const row = await this.prisma.userProviderConfig.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        tokenCiphertext: ciphertext,
        tokenKeyVersion: keyVersion,
        ...models,
        baseUrl,
        extras: extras as Prisma.InputJsonValue,
      },
      update: {
        tokenCiphertext: ciphertext,
        tokenKeyVersion: keyVersion,
        ...models,
        baseUrl,
        extras: extras as Prisma.InputJsonValue,
      },
    });

    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    if (!settings) {
      await this.prisma.userAISettings.create({
        data: { userId, activeProvider: provider, embeddingsEnabled: true },
      });
    }

    return {
      provider: row.provider,
      chatModel: row.chatModel,
      chatModelFallbacks: row.chatModelFallbacks,
      embeddingModel: row.embeddingModel,
      embeddingDimension: row.embeddingDimension,
      sttModel: row.sttModel,
      visionModel: row.visionModel,
      imageModel: row.imageModel,
      baseUrl: row.baseUrl,
      extras: row.extras,
      configured: true,
      apiKeyHint: maskApiKeyHint(key),
    };
  }

  async deleteConfig(provider: string, userId = getRequestUserId()) {
    if (!isProviderId(provider)) {
      throw new BadRequestException("Proveedor no válido");
    }
    const existing = await this.prisma.userProviderConfig.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!existing) {
      throw new NotFoundException("Configuración de proveedor no encontrada");
    }
    await this.prisma.userProviderConfig.delete({
      where: { userId_provider: { userId, provider } },
    });
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    if (settings?.activeProvider === provider) {
      const next = await this.prisma.userProviderConfig.findFirst({ where: { userId } });
      if (next) {
        await this.prisma.userAISettings.update({
          where: { userId },
          data: { activeProvider: next.provider },
        });
      } else {
        await this.prisma.userAISettings.delete({ where: { userId } }).catch(() => undefined);
      }
    }
    if (settings?.embeddingProvider === provider) {
      await this.prisma.userAISettings.update({
        where: { userId },
        data: { embeddingProvider: null },
      });
    }
    return { ok: true };
  }

  /** Indica si el usuario tiene proveedor configurado y si el runtime resuelve. */
  async getProviderStatus(userId: string): Promise<ProviderStatusResult> {
    const configured = await this.hasProviderConfiguration(userId);
    if (!configured) {
      this.logger.debug(`[ProviderStatus] userId=${userId} sin instancia tenant ni BYOK`);
      return { usable: false, configured: false };
    }
    try {
      const tenant = await this.resolveTenantInstanceForUser(userId);
      const runtime = tenant
        ? await this.runtimeFromTenantInstance(userId, tenant)
        : await this.resolveRuntimeForProvider(userId, await this.activeProviderId(userId));
      const result: ProviderStatusResult = {
        usable: true,
        configured: true,
        runtime: {
          providerId: runtime.providerId,
          chatModel: runtime.chatModel,
          fallbacks: runtime.chatModelFallbacks ?? [],
          source: tenant ? "tenant" : "byok",
          instanceName: tenant?.displayName,
        },
      };
      this.logger.debug(
        `[ProviderStatus] OK userId=${userId} ${JSON.stringify(result.runtime)}`,
      );
      llmDebug("UserProviders", "getProviderStatus OK", { userId, ...result.runtime });
      return result;
    } catch (err) {
      const resolveError = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[ProviderStatus] userId=${userId} configurado pero resolveRuntime falló: ${resolveError}`,
      );
      llmDebug("UserProviders", "getProviderStatus resolveRuntime error", { userId, resolveError });
      // Hay configuración: no mostrar banner «configura proveedor» por un fallo de modelo/permiso.
      return { usable: false, configured: true, resolveError };
    }
  }

  /** @deprecated Usar getProviderStatus. Mantenido por compatibilidad interna. */
  async hasUsableProvider(userId: string): Promise<boolean> {
    const status = await this.getProviderStatus(userId);
    return status.configured;
  }

  private async hasProviderConfiguration(userId: string): Promise<boolean> {
    const tenant = await this.resolveEffectiveTenantInstanceForUser(userId);
    if (tenant) return true;
    const count = await this.prisma.userProviderConfig.count({ where: { userId } });
    return count > 0;
  }

  /** Runtime para chat/visión: tenant primero, luego BYOK personal. */
  async resolveRuntime(userId: string): Promise<UserLLMRuntime> {
    llmDebug("UserProviders", "resolveRuntime inicio", { userId });
    const tenant = await this.resolveTenantInstanceForUser(userId);
    if (tenant) {
      this.logger.debug(
        `[resolveRuntime] userId=${userId} tenant=${tenant.displayName} (${tenant.id}) chatModel=${tenant.chatModel} fallbacks=[${tenant.chatModelFallbacks.join(",")}]`,
      );
      const runtime = await this.runtimeFromTenantInstance(userId, tenant);
      llmDebug("UserProviders", "resolveRuntime tenant OK", {
        userId,
        instanceId: tenant.id,
        instanceName: tenant.displayName,
        ...summarizeRuntimeForLog(runtime),
      });
      return runtime;
    }
    const provider = await this.activeProviderId(userId);
    this.logger.debug(`[resolveRuntime] userId=${userId} BYOK provider=${provider}`);
    const runtime = await this.resolveRuntimeForProvider(userId, provider);
    llmDebug("UserProviders", "resolveRuntime BYOK OK", {
      userId,
      ...summarizeRuntimeForLog(runtime),
    });
    return runtime;
  }

  /**
   * Runtime del agente Auditor (grafo MDD) y del pipeline Tasks (Planner + Auditor LLM).
   * Usa la instancia activa del usuario; `auditorChatModel` en la instancia es opcional.
   * Si no hay override, mismo runtime que `resolveRuntime`.
   */
  async resolveAuditorRuntime(userId: string): Promise<UserLLMRuntime> {
    const tenant = await this.resolveTenantInstanceForUser(userId);
    if (tenant) return this.runtimeFromTenantInstanceForAuditor(userId, tenant);
    return this.resolveRuntime(userId);
  }

  /**
   * Runtime para §3 (modelo de datos) en pipeline MDD HIGH.
   * Usa `highComplexityChatModel` en la instancia activa; si no hay override, `resolveRuntime`.
   */
  async resolveHighComplexityRuntime(userId: string): Promise<UserLLMRuntime> {
    const tenant = await this.resolveTenantInstanceForUser(userId);
    if (tenant) return this.runtimeFromTenantInstanceForHighComplexity(userId, tenant);
    return this.resolveRuntime(userId);
  }

  private async runtimeFromTenantInstanceForAuditor(
    userId: string,
    instance: ProviderInstance,
  ): Promise<UserLLMRuntime> {
    const override = instance.auditorChatModel?.trim();
    if (override) {
      return this.runtimeFromTenantInstance(userId, instance, {
        chatModelOverride: override,
      });
    }
    return this.runtimeFromTenantInstance(userId, instance);
  }

  private async runtimeFromTenantInstanceForHighComplexity(
    userId: string,
    instance: ProviderInstance,
  ): Promise<UserLLMRuntime> {
    const override = instance.highComplexityChatModel?.trim();
    if (override) {
      return this.runtimeFromTenantInstance(userId, instance, {
        chatModelOverride: override,
      });
    }
    return this.runtimeFromTenantInstance(userId, instance);
  }

  async resolveEmbeddingRuntime(userId: string): Promise<UserLLMRuntime> {
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    if (!settings?.embeddingsEnabled) {
      throw new BadRequestException("Los embeddings están desactivados en tus ajustes de IA");
    }

    const tenant = await this.resolveTenantInstanceForUser(userId);
    if (tenant && isProviderId(tenant.providerType)) {
      const tenantProvider = tenant.providerType;
      const catalog = PROVIDER_CATALOG[tenantProvider];
      const bypass = await this.userBypassesModelPolicy(userId);
      const embModel = tenant.embeddingModel ?? catalog.defaultEmbeddingModel;
      if (
        catalog.supportsEmbeddings &&
        embModel &&
        isEmbeddingModelWhitelisted(
          tenantProvider,
          embModel,
          tenant.allowedEmbeddingModels,
          bypass,
        )
      ) {
        return this.runtimeFromTenantInstance(userId, tenant, { forEmbeddings: true });
      }
    }

    const active = await this.activeProviderId(userId);
    const embProvider =
      settings?.embeddingProvider && isProviderId(settings.embeddingProvider)
        ? settings.embeddingProvider
        : active;
    const catalog = PROVIDER_CATALOG[embProvider];
    if (!catalog.supportsEmbeddings) {
      throw new BadRequestException(
        `El proveedor «${embProvider}» no expone embeddings. Configura «embeddingProvider» en ajustes de IA con un proveedor que sí (p. ej. openai u openrouter).`,
      );
    }
    return this.resolveRuntimeForProvider(userId, embProvider);
  }

  async resolveSttRuntime(userId: string): Promise<UserLLMRuntime & { sttModel: string }> {
    const runtime = await this.resolveRuntime(userId);
    const catalog = PROVIDER_CATALOG[runtime.providerId];
    if (!catalog.supportsStt) {
      throw new BadRequestException(
        `El proveedor activo «${runtime.providerId}» no soporta transcripción de audio. Usa OpenRouter, OpenAI o Groq.`,
      );
    }
    const sttModel = runtime.sttModel?.trim() || catalog.defaultSttModel || null;
    if (!sttModel) {
      throw new BadRequestException(
        "Configura el modelo de transcripción (STT) en la instancia activa en Ajustes → Gestionar instancias.",
      );
    }
    return { ...runtime, sttModel };
  }

  /**
   * Modelo de visión de la instancia activa (columna `visionModel` o respaldo en extras).
   * No usa variables de entorno; misma resolución que el runtime de chat.
   */
  async resolveVisionRuntime(userId: string): Promise<UserLLMRuntime & { visionModel: string }> {
    const runtime = await this.resolveRuntime(userId);
    const catalog = PROVIDER_CATALOG[runtime.providerId];
    if (!catalog.supportsVision) {
      throw new BadRequestException(
        `El proveedor activo «${runtime.providerId}» no soporta imágenes. Usa OpenRouter, OpenAI, Anthropic o Gemini.`,
      );
    }
    const instance = await this.resolveEffectiveTenantInstanceForUser(userId);
    let visionModel = runtime.visionModel?.trim() || "";
    if (instance && isProviderId(instance.providerType)) {
      const instCatalog = PROVIDER_CATALOG[instance.providerType];
      const extras = (instance.extras ?? {}) as Record<string, unknown>;
      visionModel =
        resolveVisionModelForRuntime({
          visionModel: instance.visionModel,
          chatModel: instance.chatModel,
          extras,
          catalogDefaultVisionModel: instCatalog.defaultVisionModel,
          supportsVision: instCatalog.supportsVision,
        })?.trim() || visionModel;
    }
    visionModel = visionModel.trim();
    if (!visionModel) {
      throw new BadRequestException(
        "Configura el modelo de visión en la instancia activa (Ajustes → Gestionar instancias → Modelo de visión).",
      );
    }
    return { ...runtime, visionModel };
  }

  /**
   * Resuelve el modelo de imagen para generación visual (plugins comerciales, p. ej. EVD).
   * Cadena: pluginUserSettings.imageModel → legacy UserAISettings/Instance/Config.imageModel → null.
   * @deprecated Preferir lectura directa desde PluginUserSettingsService en el plugin.
   */
  async resolveImageRuntime(userId: string): Promise<(UserLLMRuntime & { imageModel: string }) | null> {
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const pluginMap = settings?.pluginUserSettings as Record<string, Record<string, unknown>> | null;
    if (pluginMap) {
      for (const pluginSettings of Object.values(pluginMap)) {
        const model =
          typeof pluginSettings?.imageModel === "string"
            ? pluginSettings.imageModel.trim()
            : "";
        if (model) {
          const runtime = await this.resolveRuntime(userId);
          return { ...runtime, imageModel: model };
        }
      }
    }

    const imageModelSetting = settings?.imageModel?.trim() || null;

    // Try tenant instance first
    const instance = await this.resolveEffectiveTenantInstanceForUser(userId);
    if (instance) {
      const instanceImageModel = (instance as { imageModel?: string | null }).imageModel?.trim() || null;
      const model = imageModelSetting || instanceImageModel;
      if (model) {
        const runtime = await this.resolveRuntime(userId);
        return { ...runtime, imageModel: model };
      }
    }

    // Try BYOK config
    if (settings?.activeProvider) {
      const cfg = await this.prisma.userProviderConfig.findUnique({
        where: { userId_provider: { userId, provider: settings.activeProvider } },
      });
      if (cfg?.imageModel) {
        const runtime = await this.resolveRuntime(userId);
        return { ...runtime, imageModel: cfg.imageModel.trim() };
      }
    }

    return null;
  }

  /** STT y visión resueltos desde instancia tenant o BYOK (para UI del chat). */
  async getRuntimeMediaConfig(userId: string): Promise<{
    sttModel: string | null;
    visionModel: string | null;
    supportsVision: boolean;
    supportsStt: boolean;
    activeInstanceId: string | null;
  }> {
    try {
      const instance = await this.resolveEffectiveTenantInstanceForUser(userId);
      if (instance && isProviderId(instance.providerType)) {
        const catalog = PROVIDER_CATALOG[instance.providerType];
        const extras = (instance.extras ?? {}) as Record<string, unknown>;
        return {
          activeInstanceId: instance.id,
          supportsVision: catalog.supportsVision,
          supportsStt: catalog.supportsStt,
          sttModel: catalog.supportsStt
            ? instance.sttModel?.trim() || catalog.defaultSttModel || null
            : null,
          visionModel: catalog.supportsVision
            ? resolveVisionModelForRuntime({
                visionModel: instance.visionModel,
                chatModel: instance.chatModel,
                extras,
                catalogDefaultVisionModel: catalog.defaultVisionModel,
                supportsVision: true,
              }) || null
            : null,
        };
      }
      const runtime = await this.resolveRuntime(userId);
      const catalog = PROVIDER_CATALOG[runtime.providerId];
      return {
        activeInstanceId: null,
        sttModel:
          catalog.supportsStt
            ? runtime.sttModel?.trim() || catalog.defaultSttModel || null
            : null,
        visionModel:
          catalog.supportsVision ? runtime.visionModel?.trim() || null : null,
        supportsVision: catalog.supportsVision,
        supportsStt: catalog.supportsStt,
      };
    } catch {
      return {
        sttModel: null,
        visionModel: null,
        supportsVision: false,
        supportsStt: false,
        activeInstanceId: null,
      };
    }
  }

  /** super_admin: sin límites de grants, whitelist ni filtrado de respaldos. */
  private async userBypassesModelPolicy(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return isSuperAdmin(user?.role ?? "developer");
  }

  private async isSuperAdminUser(userId: string): Promise<boolean> {
    return this.userBypassesModelPolicy(userId);
  }

  private instanceAccessibleByUser(userId: string): Prisma.ProviderInstanceWhereInput {
    return {
      OR: [
        { enabledForUsers: true },
        { createdByUserId: userId, enabledForUsers: false },
      ],
    };
  }

  /**
   * Proveedor activo del usuario:
   * 1) Instancia marcada como «Activa» (activeTenantInstanceId).
   * 2) Si no hay selección, la del equipo con isTenantDefault.
   * 3) Si no hay default, la primera visible del equipo.
   * Las instancias personales solo aplican si el usuario las eligió en el paso 1.
   */
  async resolveEffectiveTenantInstanceForUser(userId: string): Promise<ProviderInstance | null> {
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const superAdmin = await this.isSuperAdminUser(userId);
    const access = superAdmin ? {} : this.instanceAccessibleByUser(userId);
    if (settings?.activeTenantInstanceId) {
      const chosen = await this.prisma.providerInstance.findFirst({
        where: { id: settings.activeTenantInstanceId, ...access },
      });
      if (chosen) return chosen;
    }
    const tenantDefault = await this.prisma.providerInstance.findFirst({
      where: { enabledForUsers: true, isTenantDefault: true },
    });
    if (tenantDefault) return tenantDefault;
    return this.prisma.providerInstance.findFirst({
      where: { enabledForUsers: true },
      orderBy: { displayName: "asc" },
    });
  }

  private async resolveTenantInstanceForUser(userId: string): Promise<ProviderInstance | null> {
    return this.resolveEffectiveTenantInstanceForUser(userId);
  }

  private async runtimeFromTenantInstance(
    userId: string,
    instance: ProviderInstance,
    opts?: { forEmbeddings?: boolean; chatModelOverride?: string },
  ): Promise<UserLLMRuntime> {
    if (!isProviderId(instance.providerType)) {
      throw new BadRequestException("Instancia tenant con tipo de proveedor no válido");
    }
    const provider = instance.providerType;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const role = user?.role ?? "developer";
    const superAdmin = isSuperAdmin(role);
    const bypass = superAdmin;
    const catalog = PROVIDER_CATALOG[provider];
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const userGrants =
      superAdmin || role === "developer" ? [] : (settings?.allowedChatModels ?? []);
    const chatModel = opts?.chatModelOverride?.trim() || instance.chatModel;
    const modelRole = opts?.chatModelOverride ? "auditor" : "activo";

    const apiKey = this.tokenCrypto.decrypt(instance.tokenCiphertext, instance.tokenKeyVersion);
    const extras = (instance.extras ?? {}) as Record<string, unknown>;
    const legacyFallbacks = extras.chatModelFallbacks;
    const chatModelFallbacks =
      instance.chatModelFallbacks.length > 0
        ? instance.chatModelFallbacks
        : Array.isArray(legacyFallbacks)
          ? legacyFallbacks.filter((m): m is string => typeof m === "string" && m.length > 0)
          : [];

    const instanceModelWhitelist = resolveInstanceChatModelWhitelist({
      chatModel: instance.chatModel,
      chatModelFallbacks,
      allowedChatModels: instance.allowedChatModels,
      auditorChatModel: instance.auditorChatModel,
      highComplexityChatModel: instance.highComplexityChatModel,
      extras,
    });

    if (
      !isChatModelAllowedForTenantUser(
        chatModel,
        userGrants,
        provider,
        instanceModelWhitelist,
        bypass,
      )
    ) {
      const hint =
        userGrants.length > 0
          ? `Modelos permitidos para ti: ${userGrants.join(", ")}. Activa un proveedor cuyo modelo esté en esa lista.`
          : `Modelos de la instancia «${instance.displayName}»: ${instanceModelWhitelist.join(", ") || chatModel}. Pide al super_admin modelos en Usuarios si necesitas otro.`;
      throw new BadRequestException(
        `El modelo «${chatModel}» del proveedor ${modelRole} «${instance.displayName}» no está autorizado. ${hint}`,
      );
    }

    const embeddingModel = instance.embeddingModel ?? catalog.defaultEmbeddingModel;
    if (
      opts?.forEmbeddings &&
      embeddingModel &&
      !isEmbeddingModelWhitelisted(
        provider,
        embeddingModel,
        instance.allowedEmbeddingModels,
        bypass,
      )
    ) {
      throw new BadRequestException(
        `El modelo de embeddings «${embeddingModel}» no está permitido en la instancia tenant`,
      );
    }

    const effectiveFallbacks =
      superAdmin || userGrants.length === 0
        ? chatModelFallbacks
        : chatModelFallbacks.filter((m) => userGrants.includes(m));

    if (isLlmDebugEnabled()) {
      llmDebug("UserProviders", "runtimeFromTenantInstance", {
        userId,
        instanceId: instance.id,
        instanceName: instance.displayName,
        role,
        superAdmin,
        chatModel,
        chatModelFallbacks,
        effectiveFallbacks,
        userGrants,
        bypass,
        instanceModelWhitelist,
      });
    }

    for (const fallbackModel of effectiveFallbacks) {
      if (
        !isChatModelAllowedForTenantUser(
          fallbackModel,
          userGrants,
          provider,
          instanceModelWhitelist,
          bypass,
        )
      ) {
        throw new BadRequestException(
          `El modelo de respaldo «${fallbackModel}» no está autorizado.`,
        );
      }
    }

    return {
      providerId: provider,
      apiKey,
      baseURL: resolveRuntimeBaseUrl(provider, instance.baseUrl, extras),
      chatModel,
      chatModelFallbacks: effectiveFallbacks,
      embeddingModel,
      embeddingDimension: resolveEmbeddingDimensionForModel(
        provider,
        embeddingModel,
        instance.embeddingDimension,
      ),
      embeddingsEnabled: settings?.embeddingsEnabled ?? true,
      sttModel: instance.sttModel ?? catalog.defaultSttModel,
      visionModel: resolveVisionModelForRuntime({
        visionModel: instance.visionModel,
        chatModel,
        extras,
        catalogDefaultVisionModel: catalog.defaultVisionModel,
        supportsVision: catalog.supportsVision,
      }),
      imageModel: instance.imageModel ?? null,
      extras,
    };
  }

  private async activeProviderId(userId: string): Promise<ProviderId> {
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const active = settings?.activeProvider;
    if (!active || !isProviderId(active)) {
      throw new BadRequestException(
        "Configura un proveedor de IA en Ajustes (instancia tenant o clave API personal)",
      );
    }
    return active;
  }

  private async resolveRuntimeForProvider(
    userId: string,
    provider: ProviderId,
  ): Promise<UserLLMRuntime> {
    const cfg = await this.prisma.userProviderConfig.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!cfg) {
      throw new BadRequestException(`No hay clave API configurada para el proveedor «${provider}»`);
    }
    const settings = await this.prisma.userAISettings.findUnique({ where: { userId } });
    const catalog = PROVIDER_CATALOG[provider];
    const apiKey = this.tokenCrypto.decrypt(cfg.tokenCiphertext, cfg.tokenKeyVersion);
    const extras = (cfg.extras ?? {}) as Record<string, unknown>;
    const legacyFallbacks = extras.chatModelFallbacks;
    const chatModelFallbacks =
      cfg.chatModelFallbacks.length > 0
        ? cfg.chatModelFallbacks
        : Array.isArray(legacyFallbacks)
          ? legacyFallbacks.filter((m): m is string => typeof m === "string" && m.length > 0)
          : [];

    const embeddingModel = cfg.embeddingModel ?? catalog.defaultEmbeddingModel;
    const embeddingDimension = resolveEmbeddingDimensionForModel(
      provider,
      embeddingModel,
      cfg.embeddingDimension,
    );

    return {
      providerId: provider,
      apiKey,
      baseURL: resolveRuntimeBaseUrl(provider, cfg.baseUrl, extras),
      chatModel: cfg.chatModel,
      chatModelFallbacks,
      embeddingModel,
      embeddingDimension,
      embeddingsEnabled: settings?.embeddingsEnabled ?? true,
      sttModel: cfg.sttModel ?? catalog.defaultSttModel,
      visionModel: resolveVisionModelForRuntime({
        visionModel: cfg.visionModel,
        chatModel: cfg.chatModel,
        extras,
        catalogDefaultVisionModel: catalog.defaultVisionModel,
        supportsVision: catalog.supportsVision,
      }),
      imageModel: cfg.imageModel ?? null,
      extras,
    };
  }
}
