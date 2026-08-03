import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../common/decorators/public.decorator.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import { requireAdmin, requireSuperAdmin } from "../../common/guards/role.helpers.js";
import { UserProvidersService } from "../user-providers/user-providers.service.js";
import { forgeOpsProvisionUserBodySchema } from "@theforge/shared-types";

const requestOtpSchema = z.object({
  email: z.string().email(),
}).strict();

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1).max(32),
}).strict();

const mcpLoginSchema = z.object({
  secret: z.string().min(1),
}).strict();

const ssoLoginSchema = z.object({
  token: z.string().min(1),
}).strict();

const updateUserProfileSchema = z
  .object({
    email: z.string().email(),
    name: z.string().max(200).nullable(),
  })
  .partial()
  .strict()
  .refine((d) => d.email !== undefined || d.name !== undefined, {
    message: "Debes enviar 'email' o 'name'",
  });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.flatten());
  }
  return r.data;
}

@Controller("auth")
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("otp/request")
  @Public()
  @HttpCode(200)
  requestOtp(@Body() body: unknown) {
    const parsed = parseBody(requestOtpSchema, body);
    return this.auth.requestOtp(parsed.email);
  }

  @Post("otp/verify")
  @Public()
  @HttpCode(200)
  verify(@Body() body: unknown) {
    const parsed = parseBody(verifyOtpSchema, body);
    return this.auth.verifyOtp(parsed.email, parsed.code);
  }

  @Post("mcp-login")
  @Public()
  @HttpCode(200)
  mcpLogin(@Body() body: unknown) {
    const parsed = parseBody(mcpLoginSchema, body);
    return this.auth.mcpLogin(parsed.secret);
  }

  /**
   * POST /auth/sso/login
   * Login mediante SSO externo. Solo disponible si SSO_URL está configurada.
   */
  @Post("sso/login")
  @Public()
  @HttpCode(200)
  ssoLogin(@Body() body: unknown) {
    const parsed = parseBody(ssoLoginSchema, body);
    return this.auth.ssoLogin(parsed.token);
  }

  /**
   * POST /auth/forgeops/provision-user
   * Alta M2M desde ForgeOps en instancia compartida. Requiere `Authorization: Bearer <FORGEOPS_PROVISION_SECRET>`.
   */
  @Post("forgeops/provision-user")
  @Public()
  @HttpCode(200)
  provisionUserFromForgeOps(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = parseBody(forgeOpsProvisionUserBodySchema, body);
    return this.auth.provisionUserFromForgeOps(authorization, parsed);
  }

  // Protected endpoints (no @Public() → requires JWT via JwtAuthGuard at class level)

  /** GET /auth/me — Perfil del usuario autenticado. */
  @Get("me")
  getMe() {
    const userId = getRequestUserId();
    return this.auth.getMe(userId);
  }

  @Get("mcp-secret")
  getMcpSecret() {
    const userId = getRequestUserId();
    return this.auth.getMcpSecret(userId);
  }

  @Post("mcp-secret/regenerate")
  @HttpCode(200)
  regenerateMcpSecret() {
    const userId = getRequestUserId();
    return this.auth.regenerateMcpSecret(userId);
  }

  @Get("ariadne-config")
  getAriadneConfig() {
    const userId = getRequestUserId();
    return this.auth.getAriadneConfig(userId);
  }

  @Put("ariadne-config")
  @HttpCode(200)
  async setAriadneConfig(@Body() body: { url?: string; token?: string }) {
    const userId = getRequestUserId();
    return this.auth.setAriadneConfig(userId, body.url ?? "", body.token ?? "");
  }

  @Get("tech-docs-config")
  getTechDocsConfig() {
    const userId = getRequestUserId();
    return this.auth.getTechDocsConfig(userId);
  }

  @Put("tech-docs-config")
  @HttpCode(200)
  async setTechDocsConfig(@Body() body: { url?: string; token?: string }) {
    const userId = getRequestUserId();
    return this.auth.setTechDocsConfig(userId, body.url ?? "", body.token ?? "");
  }

  /** GET /auth/has-users — verifica si hay usuarios registrados (público). */
  @Get("has-users")
  @Public()
  @HttpCode(200)
  async hasUsers(): Promise<{ hasUsers: boolean }> {
    try {
      return await this.auth.hasUsers();
    } catch {
      return { hasUsers: true };
    }
  }

  /** POST /auth/register-first-admin — crea el primer admin (público, solo si no hay usuarios). */
  @Post("register-first-admin")
  @Public()
  @HttpCode(201)
  registerFirstAdmin(@Body() body: unknown) {
    const email = (body != null && typeof body === "object" ? (body as Record<string, unknown>).email : undefined) as string | undefined;
    const name = (body != null && typeof body === "object" ? (body as Record<string, unknown>).name : undefined) as string | undefined;
    if (!email || typeof email !== "string") {
      throw new BadRequestException("email es requerido");
    }
    return this.auth.registerFirstAdmin(email, typeof name === "string" ? name : undefined);
  }
}

/**
 * Controlador de usuarios (admin-only).
 * Rutas bajo /users para gestionar usuarios y roles.
 */
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly userProviders: UserProvidersService,
  ) {}

  @Get()
  listUsers() {
    requireAdmin();
    return this.auth.listUsers(getRequestUserRole());
  }

  @Patch(":id/role")
  updateRole(@Param("id") id: string, @Body() body: { role?: string }) {
    requireAdmin();
    if (!body?.role) throw new BadRequestException("role requerido");
    return this.auth.updateUserRole(id, body.role, getRequestUserId());
  }

  @Post()
  @HttpCode(201)
  createUser(@Body() body: { email?: string; name?: string; role?: string }) {
    requireAdmin();
    if (!body?.email) throw new BadRequestException("email requerido");
    return this.auth.createUser(body.email, body.name, body.role);
  }

  @Patch(":id")
  updateProfile(@Param("id") id: string, @Body() body: unknown) {
    requireAdmin();
    const parsed = parseBody(updateUserProfileSchema, body);
    return this.auth.updateUserProfile(id, parsed);
  }

  @Delete(":id")
  @HttpCode(200)
  deleteUser(@Param("id") id: string) {
    requireAdmin();
    return this.auth.deleteUser(id, getRequestUserId());
  }

  @Get(":id/mcp-secret")
  getMcpSecret(@Param("id") id: string) {
    requireAdmin();
    return this.auth.getUserMcpSecretAdmin(id);
  }

  @Post(":id/mcp-secret/regenerate")
  @HttpCode(200)
  regenerateMcpSecret(@Param("id") id: string) {
    requireAdmin();
    return this.auth.regenerateUserMcpSecretAdmin(id);
  }

  @Get(":id/allowed-chat-models")
  getAllowedChatModels(@Param("id") id: string) {
    requireSuperAdmin();
    return this.userProviders.getUserChatModelGrants(id);
  }

  @Patch(":id/allowed-chat-models")
  updateAllowedChatModels(
    @Param("id") id: string,
    @Body() body: { allowedChatModels?: string },
  ) {
    requireSuperAdmin();
    if (body.allowedChatModels === undefined) {
      throw new BadRequestException("allowedChatModels requerido");
    }
    return this.userProviders.updateUserAllowedChatModels(id, body.allowedChatModels);
  }
}
