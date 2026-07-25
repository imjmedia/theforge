/**
 * @fileoverview Servicio CRUD de instancias de proveedor (tenant): crear, listar, actualizar y eliminar
 * instancias compartidas de proveedores LLM para el equipo. Solo admin+.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isAdminOrAbove, isSuperAdmin } from "../../common/roles.js";
import { Prisma } from "@theforge/database";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TokenCryptoService } from "../crypto/token-crypto.service.js";
import {
  catalogChatModels,
  catalogEmbeddingModels,
  isProviderId,
} from "../ai/providers/provider-catalog.js";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import {
  buildModelFields,
  maskApiKeyHint,
  normalizeProviderExtras,
  resolveConfigBaseUrl,
} from "./provider-config.helpers.js";
import { UserProvidersService } from "./user-providers.service.js";

export interface UpsertProviderInstanceDto {
  providerType: string;
  slug: string;
  displayName: string;
  apiKey: string;
  chatModel?: string;
  chatModelFallbacks?: string[];
  auditorChatModel?: string | null;
  highComplexityChatModel?: string | null;
  embeddingModel?: string | null;
  embeddingDimension?: number | null;
  sttModel?: string | null;
  visionModel?: string | null;
  imageModel?: string | null;
  baseUrl?: string | null;
  extras?: Record<string, unknown> | null;
  enabledForUsers?: boolean;
  allowedChatModels?: string[];
  allowedEmbeddingModels?: string[];
  isTenantDefault?: boolean;
}

export interface UpdateProviderInstanceDto extends Partial<Omit<UpsertProviderInstanceDto, "apiKey">> {
  apiKey?: string;
}

function mapInstanceRow(
  row: {
    id: string;
    providerType: string;
    slug: string;
    displayName: string;
    chatModel: string;
    chatModelFallbacks: string[];
    auditorChatModel: string | null;
    highComplexityChatModel: string | null;
    embeddingModel: string | null;
    embeddingDimension: number | null;
    sttModel: string | null;
    visionModel: string | null;
    imageModel: string | null;
    baseUrl: string | null;
    extras: unknown;
    enabledForUsers: boolean;
    allowedChatModels: string[];
    allowedEmbeddingModels: string[];
    isTenantDefault: boolean;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  apiKeyHint?: string,
) {
  return {
    id: row.id,
    providerType: row.providerType,
    slug: row.slug,
    displayName: row.displayName,
    createdByUserId: row.createdByUserId,
    chatModel: row.chatModel,
    chatModelFallbacks: row.chatModelFallbacks,
    auditorChatModel: row.auditorChatModel,
    highComplexityChatModel: row.highComplexityChatModel,
    embeddingModel: row.embeddingModel,
    embeddingDimension: row.embeddingDimension,
    sttModel: row.sttModel,
    visionModel: row.visionModel,
    imageModel: row.imageModel,
    baseUrl: row.baseUrl,
    extras: row.extras,
    enabledForUsers: row.enabledForUsers,
    allowedChatModels: row.allowedChatModels,
    allowedEmbeddingModels: row.allowedEmbeddingModels,
    isTenantDefault: row.isTenantDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(apiKeyHint !== undefined ? { apiKeyHint } : {}),
  };
}

@Injectable()
export class ProviderInstancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly userProviders: UserProvidersService,
  ) {}

  private assertCanManageInstances(role: string) {
    if (!isAdminOrAbove(role)) {
      throw new ForbiddenException("Se requiere rol admin o super_admin");
    }
  }

  private assertCanMutateRow(
    row: { createdByUserId: string },
    actorUserId: string,
    role: string,
  ) {
    if (isSuperAdmin(role)) return;
    if (row.createdByUserId !== actorUserId) {
      throw new ForbiddenException("Solo puedes modificar instancias que creaste");
    }
  }

  /** super_admin: todas; admin: propias + instancias visibles para el equipo. */
  async listForManagement(actorUserId = getRequestUserId(), role = getRequestUserRole()) {
    this.assertCanManageInstances(role);
    const where = isSuperAdmin(role)
      ? undefined
      : {
          OR: [{ createdByUserId: actorUserId }, { enabledForUsers: true }],
        };
    const rows = await this.prisma.providerInstance.findMany({
      where,
      orderBy: [{ providerType: "asc" }, { slug: "asc" }],
    });
    return rows.map((r) =>
      mapInstanceRow(
        r,
        maskApiKeyHint(this.tokenCrypto.decrypt(r.tokenCiphertext, r.tokenKeyVersion)),
      ),
    );
  }

  /** Instancias que el usuario puede elegir: equipo (visible) + personales propias. */
  async listEnabledForCurrentUser(userId = getRequestUserId()) {
    const rows = await this.prisma.providerInstance.findMany({
      where: {
        OR: [
          { enabledForUsers: true },
          { createdByUserId: userId, enabledForUsers: false },
        ],
      },
      orderBy: [{ isTenantDefault: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        providerType: true,
        slug: true,
        displayName: true,
        chatModel: true,
        chatModelFallbacks: true,
        auditorChatModel: true,
        highComplexityChatModel: true,
        embeddingModel: true,
        embeddingDimension: true,
        sttModel: true,
        visionModel: true,
        imageModel: true,
        baseUrl: true,
        extras: true,
        enabledForUsers: true,
        allowedChatModels: true,
        allowedEmbeddingModels: true,
        isTenantDefault: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => mapInstanceRow(r));
  }

  async getById(id: string, actorUserId = getRequestUserId(), role = getRequestUserRole()) {
    this.assertCanManageInstances(role);
    const row = await this.prisma.providerInstance.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Instancia de proveedor no encontrada");
    this.assertCanMutateRow(row, actorUserId, role);
    return mapInstanceRow(
      row,
      maskApiKeyHint(this.tokenCrypto.decrypt(row.tokenCiphertext, row.tokenKeyVersion)),
    );
  }

  async create(dto: UpsertProviderInstanceDto, actorUserId = getRequestUserId()) {
    const role = getRequestUserRole();
    this.assertCanManageInstances(role);
    const teamVisible = isSuperAdmin(role) ? (dto.enabledForUsers ?? false) : false;
    return this.upsertInternal(
      null,
      {
        ...dto,
        enabledForUsers: teamVisible,
        isTenantDefault: teamVisible && isSuperAdmin(role) ? (dto.isTenantDefault ?? false) : false,
      },
      actorUserId,
    );
  }

  async update(id: string, dto: UpdateProviderInstanceDto, actorUserId = getRequestUserId()) {
    const role = getRequestUserRole();
    this.assertCanManageInstances(role);
    const existing = await this.prisma.providerInstance.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Instancia de proveedor no encontrada");
    this.assertCanMutateRow(existing, actorUserId, role);
    const teamVisible = isSuperAdmin(role)
      ? (dto.enabledForUsers ?? existing.enabledForUsers)
      : false;
    return this.upsertInternal(
      id,
      {
        providerType: existing.providerType,
        slug: existing.slug,
        displayName: dto.displayName ?? existing.displayName,
        apiKey: dto.apiKey ?? "",
        chatModel: dto.chatModel,
        chatModelFallbacks: dto.chatModelFallbacks,
        auditorChatModel: dto.auditorChatModel,
        highComplexityChatModel: dto.highComplexityChatModel,
        embeddingModel: dto.embeddingModel,
        embeddingDimension: dto.embeddingDimension,
        sttModel: dto.sttModel,
        visionModel: dto.visionModel,
        imageModel: dto.imageModel,
        baseUrl: dto.baseUrl,
        extras: dto.extras,
        enabledForUsers: teamVisible,
        allowedChatModels: dto.allowedChatModels,
        allowedEmbeddingModels: dto.allowedEmbeddingModels,
        isTenantDefault:
          teamVisible && isSuperAdmin(role) ? (dto.isTenantDefault ?? existing.isTenantDefault) : false,
      },
      actorUserId,
      existing,
    );
  }

  async delete(id: string, actorUserId = getRequestUserId()) {
    const role = getRequestUserRole();
    this.assertCanManageInstances(role);
    const existing = await this.prisma.providerInstance.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Instancia de proveedor no encontrada");
    this.assertCanMutateRow(existing, actorUserId, role);
    await this.prisma.userAISettings.updateMany({
      where: { activeTenantInstanceId: id },
      data: { activeTenantInstanceId: null },
    });
    await this.prisma.userAISettings.updateMany({
      where: { mddAuditorTenantInstanceId: id },
      data: { mddAuditorTenantInstanceId: null },
    });
    await this.prisma.providerInstance.delete({ where: { id } });
    if (existing.isTenantDefault) {
      const next = await this.prisma.providerInstance.findFirst({
        where: { enabledForUsers: true },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await this.prisma.providerInstance.update({
          where: { id: next.id },
          data: { isTenantDefault: true },
        });
      }
    }
    return { ok: true };
  }

  private async upsertInternal(
    id: string | null,
    dto: UpsertProviderInstanceDto,
    actorUserId: string,
    existing?: {
      tokenCiphertext: string;
      tokenKeyVersion: number;
      providerType: string;
      slug: string;
      displayName: string;
      chatModel: string;
      chatModelFallbacks: string[];
      auditorChatModel: string | null;
      highComplexityChatModel: string | null;
      embeddingModel: string | null;
      embeddingDimension: number | null;
      sttModel: string | null;
      visionModel: string | null;
      imageModel: string | null;
      baseUrl: string | null;
      extras: unknown;
      enabledForUsers: boolean;
      allowedChatModels: string[];
      allowedEmbeddingModels: string[];
      isTenantDefault: boolean;
    },
  ) {
    const providerType = (dto.providerType ?? existing?.providerType ?? "").trim();
    if (!isProviderId(providerType)) {
      throw new BadRequestException("Tipo de proveedor no válido");
    }
    const slug = (dto.slug ?? existing?.slug ?? "").trim().toLowerCase();
    if (!slug || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
      throw new BadRequestException("El slug debe ser alfanumérico (a-z, 0-9, _, -)");
    }
    const displayName = (dto.displayName ?? existing?.displayName ?? "").trim();
    if (!displayName) {
      throw new BadRequestException("El nombre para mostrar es obligatorio");
    }

    const apiKey = dto.apiKey?.trim() || undefined;
    if (!id && !apiKey) {
      throw new BadRequestException("La clave API es obligatoria");
    }

    const models = buildModelFields(providerType, {
      chatModel: dto.chatModel ?? existing?.chatModel,
      chatModelFallbacks: dto.chatModelFallbacks ?? existing?.chatModelFallbacks,
      auditorChatModel:
        dto.auditorChatModel !== undefined ? dto.auditorChatModel : existing?.auditorChatModel,
      highComplexityChatModel:
        dto.highComplexityChatModel !== undefined
          ? dto.highComplexityChatModel
          : existing?.highComplexityChatModel,
      embeddingModel:
        dto.embeddingModel !== undefined ? dto.embeddingModel : existing?.embeddingModel,
      embeddingDimension:
        dto.embeddingDimension !== undefined
          ? dto.embeddingDimension
          : existing?.embeddingDimension,
      sttModel: dto.sttModel !== undefined ? dto.sttModel : existing?.sttModel,
      visionModel: dto.visionModel !== undefined ? dto.visionModel : existing?.visionModel,
      imageModel: dto.imageModel !== undefined ? dto.imageModel : existing?.imageModel,
    });
    if (isProviderId(providerType)) {
      await this.userProviders.validateUserMayUseChatModels(actorUserId, providerType, [
        models.chatModel,
        ...models.chatModelFallbacks,
        ...(models.auditorChatModel ? [models.auditorChatModel] : []),
        ...(models.highComplexityChatModel ? [models.highComplexityChatModel] : []),
      ]);
    }
    const extras = normalizeProviderExtras(providerType, dto.extras ?? (existing?.extras as Record<string, unknown>));
    const baseUrl = resolveConfigBaseUrl(providerType, dto.baseUrl ?? existing?.baseUrl, extras);

    let tokenCiphertext = existing?.tokenCiphertext;
    let tokenKeyVersion = existing?.tokenKeyVersion ?? 1;
    let apiKeyHint: string | undefined;
    if (apiKey) {
      const enc = this.tokenCrypto.encrypt(apiKey);
      tokenCiphertext = enc.ciphertext;
      tokenKeyVersion = enc.keyVersion;
      apiKeyHint = maskApiKeyHint(apiKey);
    } else if (existing) {
      apiKeyHint = maskApiKeyHint(
        this.tokenCrypto.decrypt(existing.tokenCiphertext, existing.tokenKeyVersion),
      );
    }

    const enabledForUsers = dto.enabledForUsers ?? existing?.enabledForUsers ?? false;
    const allowedChatModels = dto.allowedChatModels ?? existing?.allowedChatModels ?? [];
    const allowedEmbeddingModels =
      dto.allowedEmbeddingModels ?? existing?.allowedEmbeddingModels ?? [];
    let isTenantDefault = dto.isTenantDefault ?? existing?.isTenantDefault ?? false;

    if (isTenantDefault) {
      await this.prisma.providerInstance.updateMany({
        where: { isTenantDefault: true, ...(id ? { NOT: { id } } : {}) },
        data: { isTenantDefault: false },
      });
    }

    const data = {
      providerType,
      slug,
      displayName,
      tokenCiphertext: tokenCiphertext!,
      tokenKeyVersion,
      ...models,
      baseUrl,
      extras: extras as Prisma.InputJsonValue,
      enabledForUsers,
      allowedChatModels,
      allowedEmbeddingModels,
      isTenantDefault,
      createdByUserId: actorUserId,
    };

    const row = id
      ? await this.prisma.providerInstance.update({ where: { id }, data })
      : await this.prisma.providerInstance.create({ data });

    if (enabledForUsers && isTenantDefault) {
      await this.prisma.providerInstance.updateMany({
        where: { isTenantDefault: true, NOT: { id: row.id } },
        data: { isTenantDefault: false },
      });
    }

    return mapInstanceRow(row, apiKeyHint);
  }

  /** Catálogo de modelos sugeridos para checkboxes en UI super_admin. */
  catalogModelsForType(providerType: string) {
    if (!isProviderId(providerType)) {
      throw new BadRequestException("Tipo de proveedor no válido");
    }
    return {
      chatModels: catalogChatModels(providerType),
      embeddingModels: catalogEmbeddingModels(providerType),
    };
  }
}
