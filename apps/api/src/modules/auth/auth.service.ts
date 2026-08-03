import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomInt, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { PrismaService } from "../../prisma/prisma.service.js";
import { isSuperAdmin } from "../../common/roles.js";
import { UserProvidersService } from "../user-providers/user-providers.service.js";
import type { ForgeOpsProvisionUserBody, ForgeOpsProvisionUserResult } from "@theforge/shared-types";
import { assertForgeOpsProvisionAuthorized } from "./forgeops-provision-auth.util.js";
import {
  resolvePlatformConfigBoolean,
  resolvePlatformConfigNumber,
  resolvePlatformConfigString,
} from "../system-config/platform-config.runtime.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOtpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** Quita comillas envoltorio que a veces vienen en `.env` / Dokploy. */
function stripEnvQuotes(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  let t = s.trim();
  if (t.length >= 2) {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      t = t.slice(1, -1);
    }
  }
  return t;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** 1|true|yes|on — devuelve el OTP en la respuesta sin enviar correo. Con 0 u omitido, se envía email si hay SMTP. */
function otpDevExposeCode(): boolean {
  return resolvePlatformConfigBoolean("otp_dev_expose_code");
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpByEmail = new Map<string, { code: string; expiresAt: number }>();
  private readonly lastOtpRequestAt = new Map<string, number>();
  private transporter: nodemailer.Transporter | null | undefined;
  private smtpTransportCacheKey: string | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly userProviders: UserProvidersService,
  ) {}

  private smtpConfig():
    | { host: string; port: number; secure: boolean; user: string; pass: string }
    | null {
    const host = stripEnvQuotes(resolvePlatformConfigString("smtp_host"));
    if (!host) return null;
    const port = resolvePlatformConfigNumber("smtp_port") || 587;
    const secure = resolvePlatformConfigBoolean("smtp_secure");
    const user = stripEnvQuotes(resolvePlatformConfigString("smtp_user")) ?? "";
    const pass = stripEnvQuotes(resolvePlatformConfigString("smtp_pass")) ?? "";
    if (!user || !pass) return null;
    return { host, port, secure, user, pass };
  }

  /** Gmail / Google Workspace SMTP hosts — used for From + password quirks. */
  private isGoogleSmtpHost(host: string): boolean {
    const h = host.toLowerCase();
    return h.includes("gmail.com") || h.includes("googlemail.com");
  }

  /**
   * Gmail app passwords are often pasted as "xxxx xxxx xxxx xxxx"; SMTP auth expects 16 chars without spaces.
   */
  private normalizeSmtpPassword(pass: string, host: string): string {
    if (this.isGoogleSmtpHost(host)) return pass.replace(/\s+/g, "");
    return pass;
  }

  /**
   * STARTTLS (587) must use secure=false; SSL (465) must use secure=true.
   * Mis-set SMTP_SECURE with port 587 breaks TLS negotiation with many providers (including Gmail).
   */
  private resolveSmtpTls(port: number, secureFromEnv: boolean): { port: number; secure: boolean } {
    if (port === 587) return { port, secure: false };
    if (port === 465) return { port, secure: true };
    return { port, secure: secureFromEnv };
  }

  private smtpTransport(): nodemailer.Transporter | null {
    const cfg = this.smtpConfig();
    if (!cfg) {
      this.transporter = null;
      this.smtpTransportCacheKey = null;
      return null;
    }

    const cacheKey = JSON.stringify(cfg);
    if (this.transporter !== undefined && this.smtpTransportCacheKey === cacheKey) {
      return this.transporter;
    }

    const pass = this.normalizeSmtpPassword(cfg.pass, cfg.host);
    const { port, secure } = this.resolveSmtpTls(cfg.port, cfg.secure);
    if (cfg.port === 587 && cfg.secure) {
      this.logger.warn(
        "SMTP: puerto 587 implica STARTTLS (secure=false). Se fuerza secure=false; revise SMTP — TLS directo en Ajustes → Sistema.",
      );
    }
    if (cfg.port === 465 && !cfg.secure) {
      this.logger.warn(
        "SMTP: puerto 465 suele usar SSL directo (secure=true). Se fuerza secure=true; revise SMTP — TLS directo en Ajustes → Sistema.",
      );
    }

    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure,
      auth: { user: cfg.user, pass },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 25_000,
      greetingTimeout: 25_000,
      socketTimeout: 25_000,
      ...(!secure && port === 587 && this.isGoogleSmtpHost(cfg.host)
        ? { requireTLS: true as const }
        : {}),
    });
    this.smtpTransportCacheKey = cacheKey;
    return this.transporter;
  }

  /**
   * Cabecera From: si SMTP_FROM no incluye @, se usa SMTP_USER como dirección.
   * Gmail SMTP solo acepta envío como la cuenta autenticada (o alias verificado); si SMTP_FROM es otro correo, se ignora.
   */
  private mailFromHeader(): string {
    const cfg = this.smtpConfig();
    const user = cfg?.user ?? stripEnvQuotes(resolvePlatformConfigString("smtp_user")) ?? "";
    const raw = stripEnvQuotes(resolvePlatformConfigString("smtp_from"));
    const display = raw?.trim() ?? "";
    const host = cfg?.host ?? "";

    if (user && cfg && this.isGoogleSmtpHost(host)) {
      if (!display) return `The Forge <${user}>`;
      if (!display.includes("@")) return `"${display.replace(/"/g, "")}" <${user}>`;
      const emailMatch = display.match(/[\w.+-]+@[\w.-]+\.\w+/i);
      const fromAddr = emailMatch ? emailMatch[0].toLowerCase() : "";
      if (fromAddr && fromAddr === user.toLowerCase()) return display;
      this.logger.warn(
        `SMTP_FROM no coincide con SMTP_USER en Gmail; se envía como The Forge <${user}> para evitar rechazo.`,
      );
      return `The Forge <${user}>`;
    }

    if (!display) {
      return user ? `The Forge <${user}>` : "The Forge <noreply@localhost>";
    }
    if (display.includes("@")) return display;
    if (user) return `"${display.replace(/"/g, "")}" <${user}>`;
    return display;
  }

  /** Host público del front para autofill iOS/macOS (`@dominio #code`) y magic link. */
  private resolveWebAppHostname(): string | null {
    const candidates = [
      resolvePlatformConfigString("web_domain"),
      stripEnvQuotes(process.env.WEB_APP_HOST),
      stripEnvQuotes(process.env.HOST),
    ];
    for (const raw of candidates) {
      const host = this.normalizeWebAppHostname(raw);
      if (host) return host;
    }
    return null;
  }

  private normalizeWebAppHostname(raw: string | undefined): string | null {
    if (!raw?.trim()) return null;
    let host = raw.trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/^\./, "");
    if (!host || host.length > 253 || !/^[\w.-]+$/.test(host)) return null;
    if (host.includes("..")) return null;
    return host;
  }

  private resolveWebAppHostnameFromLoginUrl(loginUrl?: string): string | null {
    if (loginUrl?.trim()) {
      return this.normalizeWebAppHostname(loginUrl.trim());
    }
    return this.resolveWebAppHostname();
  }

  private forgeOpsProvisionSecret(): string | undefined {
    const configured = stripEnvQuotes(resolvePlatformConfigString("forgeops_provision_secret"));
    return configured || undefined;
  }

  private assertSmtpAvailableForAccessEmail(): void {
    if (isProduction() && !this.smtpConfig()) {
      this.logger.error(
        "SMTP_HOST, SMTP_USER y SMTP_PASS deben estar definidos en producción para envío de accesos",
      );
      throw new ServiceUnavailableException("Envío de correo no disponible");
    }
  }

  private storeOtp(email: string): string {
    const now = Date.now();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.otpByEmail.set(email, { code, expiresAt: now + OTP_TTL_MS });
    this.lastOtpRequestAt.set(email, now);
    return code;
  }

  private otpThrottleAllowsSend(email: string): boolean {
    const now = Date.now();
    const last = this.lastOtpRequestAt.get(email) ?? 0;
    return now - last >= OTP_RESEND_MS;
  }

  private async sendMailMessage(args: {
    to: string;
    subject: string;
    text: string;
    html: string;
    onFailure?: () => void;
  }): Promise<void> {
    const transport = this.smtpTransport();
    if (!transport) {
      if (isProduction()) {
        throw new ServiceUnavailableException("Envío de correo no disponible");
      }
      throw new ServiceUnavailableException(
        "Envío de correo no disponible. Configure SMTP o OTP_DEV_EXPOSE_CODE=1 en desarrollo.",
      );
    }

    const from = this.mailFromHeader();
    try {
      await transport.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        html: args.html,
      });
    } catch (err) {
      args.onFailure?.();
      const e = err as Error & { responseCode?: number | string; response?: string; command?: string };
      const detail = [e.message, e.responseCode, e.response].filter(Boolean).join(" | ");
      this.logger.error(`Fallo SMTP al enviar correo: ${detail || String(err)}`);
      throw new ServiceUnavailableException("No se pudo enviar el correo de acceso");
    }
  }

  /**
   * Cuerpo HTML y texto del OTP (plantilla alineada al diseño de producto: fondo cálido, tarjeta, código espaciado).
   * Mantiene primera línea con dígitos en texto plano para autofill iOS donde aplique.
   */
  private buildOtpEmailParts(args: {
    code: string;
    email: string;
    appHost: string | null;
  }): { subject: string; text: string; html: string } {
    const { code, email, appHost } = args;
    const domainLine = appHost ? `@${appHost} #${code}` : null;
    const magicLink = appHost
      ? `https://${appHost}/auth/magic-link?otp=${code}&email=${encodeURIComponent(email)}`
      : null;

    const accent = "#a0522d";
    const pageBg = "#f5f0e8";
    const muted = "#6b6b6b";
    const textDark = "#2d2d2d";
    const codeBoxBg = "#f8f8f8";

    // Text/plain: primera línea con dígitos compactos + línea @dominio #code (Safari / Mail autofill).
    const textLines: string[] = [
      "THE FORGE — Código de acceso",
      "",
      code,
      "",
      "Introduce este código en el inicio de sesión. Caduca en 10 minutos.",
      "",
      "Si no solicitaste este correo, ignóralo.",
    ];
    if (domainLine) textLines.push("", domainLine);
    if (magicLink) textLines.push("", `Abrir enlace (opcional): ${magicLink}`);
    const textBody = textLines.join("\n");

    const magicBlock = magicLink
      ? `
          <div style="margin:24px 0 0;text-align:center;">
            <a href="${magicLink}" style="display:inline-block;padding:12px 22px;border-radius:999px;border:1px solid ${accent};color:${accent};font-size:14px;font-weight:600;text-decoration:none;background:#fff;">
              Abrir The Forge
            </a>
            <p style="margin:8px 0 0;font-size:12px;color:#a8a8a8;">O copia el código de la tarjeta superior.</p>
          </div>`
      : "";
    const iosHint = domainLine
      ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-radius:10px;font-size:12px;color:#64748b;word-break:break-all;font-family:ui-monospace,monospace;text-align:center;border:1px solid #e2e8f0;">${domainLine}</p>`
      : "";

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pageBg};padding:28px 16px 40px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;border-radius:16px;background:#ffffff;border:1px solid #e8e4dc;overflow:hidden;box-shadow:0 2px 12px rgba(74,44,28,0.06);">
          <tr><td style="height:3px;background:linear-gradient(90deg,${accent},#c4896e);"></td></tr>
          <tr>
            <td style="padding:28px 26px 26px;font-family:'Segoe UI',Roboto,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;">
              <p style="margin:0;font-size:22px;font-weight:700;color:${accent};letter-spacing:-0.02em;">The Forge</p>
              <p style="margin:6px 0 22px;font-size:14px;color:${muted};">Acceso sin contraseña</p>
              <p style="margin:0 0 8px;font-size:15px;color:#475569;text-align:center;">Tu código de un solo uso es:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;">
                <tr>
                  <td align="center" style="background:${codeBoxBg};border-radius:12px;padding:22px 16px;border:1px solid #eeeae4;">
                    <p style="margin:0;font-family:ui-monospace,Courier New,monospace;font-size:34px;font-weight:700;letter-spacing:0.42em;color:#111111;text-indent:0.42em;">${code}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#64748b;text-align:center;">Introduce este código en la pantalla de inicio de sesión de The Forge.</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#94a3b8;text-align:center;">Caduca en <strong style="color:${textDark};">10 minutos</strong>. Si no solicitaste este acceso, ignora este mensaje.</p>
              ${magicBlock}
              ${iosHint}
              <hr style="border:none;border-top:1px solid #e8e4dc;margin:26px 0 18px;"/>
              <p style="margin:0;font-size:12px;color:#9a9a9a;line-height:1.45;text-align:center;">
                Proyecto de código abierto · Apache License 2.0
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return {
      subject: `The Forge — Tu código de acceso (${code})`,
      text: textBody,
      html: htmlBody.trim(),
    };
  }

  private buildForgeOpsAccessEmailParts(args: {
    code: string;
    email: string;
    appHost: string | null;
    name: string | null;
    created: boolean;
  }): { subject: string; text: string; html: string } {
    const base = this.buildOtpEmailParts({
      code: args.code,
      email: args.email,
      appHost: args.appHost,
    });
    const greeting = args.name?.trim() ? `Hola ${args.name.trim()},` : "Hola,";
    const introText = args.created
      ? `${greeting}\n\nTu cuenta en The Forge ya está lista. Usa el código siguiente para iniciar sesión.`
      : `${greeting}\n\nTe enviamos un nuevo código para acceder a The Forge.`;
    const introHtml = `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#475569;">${
      args.created
        ? `${greeting} Tu cuenta ya está lista. Usa el código de abajo para iniciar sesión.`
        : `${greeting} Te enviamos un nuevo código de acceso.`
    }</p>`;
    const subject = args.created ? "The Forge — Tu acceso está listo" : "The Forge — Acceso a tu cuenta";
    const html = base.html.replace(
      '<p style="margin:6px 0 22px;font-size:14px;color:#6b6b6b;">Acceso sin contraseña</p>',
      `<p style="margin:6px 0 8px;font-size:14px;color:#6b6b6b;">Acceso sin contraseña</p>${introHtml}`,
    );
    return {
      subject,
      text: `${introText}\n\n${base.text}`,
      html,
    };
  }

  private async sendForgeOpsAccessEmail(args: {
    email: string;
    name: string | null;
    created: boolean;
    appHost: string | null;
  }): Promise<{ devCode?: string }> {
    this.assertSmtpAvailableForAccessEmail();

    const code = this.storeOtp(args.email);

    if (otpDevExposeCode()) {
      this.logger.warn(
        `OTP_DEV_EXPOSE_CODE activo: acceso ForgeOps para ${args.email} (no se envía correo)`,
      );
      return { devCode: code };
    }

    const { subject, text, html } = this.buildForgeOpsAccessEmailParts({
      code,
      email: args.email,
      appHost: args.appHost,
      name: args.name,
      created: args.created,
    });

    await this.sendMailMessage({
      to: args.email,
      subject,
      text,
      html,
      onFailure: () => {
        this.otpByEmail.delete(args.email);
        this.lastOtpRequestAt.delete(args.email);
      },
    });
    this.logger.log(`Acceso ForgeOps enviado por SMTP a ${args.email}`);
    return {};
  }

  /**
   * POST /auth/forgeops/provision-user — alta M2M desde ForgeOps en instancia compartida.
   */
  async provisionUserFromForgeOps(
    authorizationHeader: string | undefined,
    input: ForgeOpsProvisionUserBody,
  ): Promise<ForgeOpsProvisionUserResult> {
    assertForgeOpsProvisionAuthorized(authorizationHeader, this.forgeOpsProvisionSecret());

    const email = normalizeEmail(input.email);
    const role = input.role === "admin" ? "admin" : "developer";
    const appHost = this.resolveWebAppHostnameFromLoginUrl(input.loginUrl);
    if (!appHost) {
      this.logger.warn(
        "ForgeOps provision: sin loginUrl ni WEB_DOMAIN — el correo no incluirá magic link ni autofill @dominio.",
      );
    }

    let user = await this.prisma.user.findUnique({ where: { email } });
    let created = false;

    if (user) {
      if (input.resendIfExists === false) {
        return {
          created: false,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
          },
          accessEmailSent: false,
        };
      }
      const trimmedName = input.name?.trim();
      if (trimmedName && trimmedName !== user.name) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { name: trimmedName },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          name: input.name?.trim() || null,
          role,
          mcpSecret: this.generateMcpSecret(),
        },
      });
      created = true;
    }

    const { devCode } = await this.sendForgeOpsAccessEmail({
      email: user.email,
      name: user.name,
      created,
      appHost,
    });

    return {
      created,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      accessEmailSent: true,
      ...(devCode ? { devCode } : {}),
    };
  }

  /**
   * Solicitud de OTP. El email viene del request; solo se envía si existe un usuario registrado con ese email.
   * Si no existe, devuelve ok igualmente (anti-enumeración).
   */
  async requestOtp(rawEmail: string): Promise<{ ok: true; devCode?: string }> {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      throw new BadRequestException("email requerido");
    }

    try {
      // Anti-enumeración: si el usuario no existe, devolvemos ok sin enviar nada.
      const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) {
        this.logger.warn(`OTP solicitado para email no registrado: ${email}`);
        return { ok: true };
      }

      if (!this.otpThrottleAllowsSend(email)) {
        return { ok: true };
      }

      this.assertSmtpAvailableForAccessEmail();

      const code = this.storeOtp(email);

      if (otpDevExposeCode()) {
        this.logger.warn(
          `OTP_DEV_EXPOSE_CODE activo: código para ${email} (no se envía correo)`,
        );
        return { ok: true, devCode: code };
      }

      const appHost = this.resolveWebAppHostname();
      if (!appHost) {
        this.logger.warn(
          "OTP: WEB_DOMAIN (o WEB_APP_HOST) no configurado — el correo no incluirá @dominio #code; autofill desde Mail en iOS/macOS puede no funcionar.",
        );
      }
      const { subject, text, html } = this.buildOtpEmailParts({
        code,
        email,
        appHost,
      });

      await this.sendMailMessage({
        to: email,
        subject,
        text,
        html,
        onFailure: () => {
          this.otpByEmail.delete(email);
          this.lastOtpRequestAt.delete(email);
        },
      });
      this.logger.log(`OTP enviado por SMTP a ${email}`);

      return { ok: true };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`requestOtp falló antes/después de SMTP: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new InternalServerErrorException(
        isProduction()
          ? "Error interno al solicitar el código. Revisa que la API tenga DATABASE_URL y SMTP correctos (logs del servidor)."
          : `Error al solicitar código: ${msg}`,
      );
    }
  }

  async verifyOtp(rawEmail: string, rawCode: string): Promise<{
    accessToken: string;
    user: { id: string; email: string; role: string };
  }> {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      throw new BadRequestException("email requerido");
    }
    const code = normalizeOtpCode(rawCode);
    if (code.length !== 6) {
      throw new BadRequestException("code inválido");
    }

    const entry = this.otpByEmail.get(email);
    if (!entry || Date.now() > entry.expiresAt || entry.code !== code) {
      throw new UnauthorizedException("Código o correo inválido");
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException("Código o correo inválido");
    }

    this.otpByEmail.delete(email);

    // Generar mcpSecret automático si no existe (primera vez) — NO ROMPER
    if (!user.mcpSecret) {
      const mcpSecret = randomBytes(32).toString("hex");
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mcpSecret },
      });
      this.logger.log(`MCP secret generado automáticamente para ${email}`);
    }

    // Usar el role real del usuario desde la DB
    const userRole = user.role ?? "developer";

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: userRole,
      name: user.name ?? undefined,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, role: userRole },
    };
  }

  /**
   * MCP M2M login: intercambia un secreto de usuario por un JWT con el userId real.
   * Cada usuario tiene su propio mcpSecret en la tabla User, que puede ver y rotar desde la UI.
   */
  async mcpLogin(secret: string): Promise<{ accessToken: string; user: { id: string; email: string; role: string } }> {
    const user = await this.prisma.user.findUnique({
      where: { mcpSecret: secret },
    });
    if (!user) {
      throw new UnauthorizedException("Secreto MCP inválido");
    }
    const userRole = user.role ?? "developer";
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: userRole,
      name: user.name ?? undefined,
    });
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: userRole },
    };
  }

  async getMcpSecret(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSecret: true, email: true },
    });
    if (!user) throw new UnauthorizedException("Usuario no encontrado");
    // Si no tiene secret, generarlo automáticamente
    if (!user.mcpSecret) {
      const { mcpSecret } = await this.regenerateMcpSecret(userId);
      return {
        message: "Se generó un nuevo secret para tu cuenta. Guárdalo de inmediato.",
        mcpSecret,
        email: user.email,
      };
    }
    return { mcpSecret: user.mcpSecret, email: user.email };
  }

  async regenerateMcpSecret(userId: string) {
    const mcpSecret = randomBytes(32).toString("hex");

    await this.prisma.user.update({
      where: { id: userId },
      data: { mcpSecret },
    });

    this.logger.log(`MCP secret regenerado para usuario ${userId}`);
    return { mcpSecret };
  }

  /** Obtiene la URL y token del MCP de Ariadne configurados por el usuario. */
  async getAriadneConfig(userId: string): Promise<{ url: string; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ariadneMcpUrl: true, ariadneMcpToken: true },
    });
    return { url: user?.ariadneMcpUrl ?? "", token: user?.ariadneMcpToken ?? "" };
  }

  /** Guarda la URL y token del MCP de Ariadne para el usuario. */
  async setAriadneConfig(userId: string, url: string, token: string): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ariadneMcpUrl: url.trim() || null,
        ariadneMcpToken: token.trim() || null,
      },
    });
    this.logger.log(`Ariadne MCP config actualizada para usuario ${userId}`);
    return { ok: true };
  }

  /** Technology Docs MCP (Context7): URL + API key por usuario. */
  async getTechDocsConfig(userId: string): Promise<{ url: string; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { techDocsMcpUrl: true, techDocsMcpToken: true },
    });
    return { url: user?.techDocsMcpUrl ?? "", token: user?.techDocsMcpToken ?? "" };
  }

  async setTechDocsConfig(userId: string, url: string, token: string): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        techDocsMcpUrl: url.trim() || null,
        techDocsMcpToken: token.trim() || null,
      },
    });
    this.logger.log(`Technology Docs MCP config actualizada para usuario ${userId}`);
    return { ok: true };
  }

  // ─── SSO ───

  /**
   * Login via SSO externo.
   * Valida el token contra SSO_URL/verify, crea/actualiza usuario local y emite JWT.
   */
  async ssoLogin(ssoToken: string): Promise<{
    accessToken: string;
    user: { id: string; email: string; role: string; name: string | null };
    ssoUrl?: string;
  }> {
    const ssoUrl = stripEnvQuotes(this.config.get<string>("SSO_URL"));
    if (!ssoUrl) {
      throw new BadRequestException("SSO no configurado (SSO_URL)");
    }

    const verifyUrl = `${ssoUrl.replace(/\/$/, "")}/verify`;
    const ssoRes = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ssoToken }),
    });

    if (!ssoRes.ok) {
      throw new UnauthorizedException("Token SSO inválido");
    }

    const ssoData = (await ssoRes.json()) as {
      email?: string;
      role?: string;
      name?: string;
    };

    if (!ssoData?.email) {
      throw new BadRequestException("SSO no devolvió email");
    }

    const email = ssoData.email.trim().toLowerCase();
    const role = ssoData.role === "admin" ? "admin" : "developer";
    const name = ssoData.name?.trim() || null;

    // Crear o actualizar usuario local
    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email, name, role },
      update: { name, role },
    });

    // Asegurar mcpSecret (NO ROMPER)
    if (!user.mcpSecret) {
      const mcpSecret = randomBytes(32).toString("hex");
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mcpSecret },
      });
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name ?? undefined,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
      ssoUrl,
    };
  }

  // ─── Users CRUD ───

  /** Obtener perfil del usuario autenticado. */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, name: true, mcpSecret: true, createdAt: true },
    });
    if (!user) throw new NotFoundException("Usuario no encontrado");
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      hasMcpSecret: !!user.mcpSecret,
      createdAt: user.createdAt,
    };
  }

  /** Listar todos los usuarios (admin-only). super_admin recibe grants de modelos. */
  async listUsers(actorRole: string) {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        mcpSecret: true,
        createdAt: true,
        ...(isSuperAdmin(actorRole)
          ? {
              aiSettings: {
                select: {
                  allowedChatModels: true,
                  activeTenantInstanceId: true,
                },
              },
            }
          : {}),
      },
    });
    const mapped = users.map((u) => {
      const base = {
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.name,
        hasMcpSecret: !!u.mcpSecret,
        createdAt: u.createdAt,
      };
      if (!isSuperAdmin(actorRole)) return base;
      const settings = (u as {
        aiSettings?: {
          allowedChatModels: string[];
          activeTenantInstanceId: string | null;
        } | null;
      }).aiSettings;
      return {
        ...base,
        allowedChatModels: settings?.allowedChatModels ?? [],
      };
    });
    if (!isSuperAdmin(actorRole)) return mapped;

    const assignableChatModels = await this.userProviders.buildGlobalGrantAssignableChatModels();
    const enriched = await Promise.all(
      mapped.map(async (row) => {
        const grants = await this.userProviders.getUserChatModelGrants(row.id);
        return {
          ...row,
          allowedChatModels: grants.allowedChatModels,
        };
      }),
    );
    return { users: enriched, assignableChatModels };
  }

  /** Obtener mcpSecret de cualquier usuario (admin-only). Genera uno si falta. */
  async getUserMcpSecretAdmin(userId: string): Promise<{ mcpSecret: string; email: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSecret: true, email: true },
    });
    if (!user) throw new NotFoundException("Usuario no encontrado");
    if (!user.mcpSecret) {
      const mcpSecret = this.generateMcpSecret();
      await this.prisma.user.update({ where: { id: userId }, data: { mcpSecret } });
      this.logger.log(`MCP secret generado por admin para usuario ${userId}`);
      return { mcpSecret, email: user.email };
    }
    return { mcpSecret: user.mcpSecret, email: user.email };
  }

  /** Regenerar mcpSecret de cualquier usuario (admin-only). */
  async regenerateUserMcpSecretAdmin(userId: string): Promise<{ mcpSecret: string; email: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException("Usuario no encontrado");
    const mcpSecret = this.generateMcpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mcpSecret } });
    this.logger.log(`MCP secret regenerado por admin para usuario ${userId}`);
    return { mcpSecret, email: user.email };
  }

  /** Cambiar rol de un usuario (admin-only). No permite degradarse a sí mismo (developer). */
  async updateUserRole(targetUserId: string, role: string, actorUserId: string) {
    if (role !== "admin" && role !== "developer" && role !== "super_admin") {
      throw new BadRequestException("Rol inválido. Use 'super_admin', 'admin' o 'developer'.");
    }
    if (targetUserId === actorUserId && role === "developer") {
      throw new ForbiddenException("No puedes degradar tu propio rol de administrador");
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException("Usuario no encontrado");

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role },
    });

    return { id: targetUserId, email: user.email, role };
  }

  /**
   * PATCH /users/:id — actualizar nombre y/o email de un usuario (admin-only).
   * El email se normaliza (trim + lowercase) y debe ser único.
   */
  async updateUserProfile(
    targetUserId: string,
    patch: { email?: string; name?: string | null },
  ): Promise<{ id: string; email: string; role: string; name: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException("Usuario no encontrado");

    const data: { email?: string; name?: string | null } = {};

    if (patch.email !== undefined) {
      const normalized = patch.email.trim().toLowerCase();
      if (normalized !== user.email) {
        const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
        if (existing && existing.id !== targetUserId) {
          throw new BadRequestException("El email ya está registrado");
        }
        data.email = normalized;
      }
    }

    if (patch.name !== undefined) {
      const trimmed = patch.name?.trim() ?? "";
      data.name = trimmed.length > 0 ? trimmed : null;
    }

    if (Object.keys(data).length === 0) {
      return { id: user.id, email: user.email, role: user.role, name: user.name };
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data,
    });
    return { id: updated.id, email: updated.email, role: updated.role, name: updated.name };
  }

  /** GET /auth/has-users — verifica si hay usuarios registrados. */
  async hasUsers(): Promise<{ hasUsers: boolean }> {
    const count = await this.prisma.user.count();
    return { hasUsers: count > 0 };
  }

  /** POST /auth/register-first-admin — crea el primer admin. */
  async registerFirstAdmin(
    email: string,
    name?: string,
  ): Promise<{
    created: boolean;
    message: string;
    user?: { id: string; email: string; role: string };
    /** Solo al crear el primer admin: permite entrar sin correo vía MCP. */
    mcpSecret?: string;
  }> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.count();
    if (existing > 0) {
      return { created: false, message: "Ya existen usuarios registrados" };
    }
    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalized,
          name: name?.trim() || null,
          role: "super_admin",
          mcpSecret: this.generateMcpSecret(),
        },
      });
      return {
        created: true,
        message: "Administrador creado exitosamente",
        user: { id: user.id, email: user.email, role: user.role },
        mcpSecret: user.mcpSecret ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      return { created: false, message: msg };
    }
  }

  private generateMcpSecret(): string {
    return randomBytes(32).toString("hex");
  }

  /** POST /users — crear usuario manualmente (admin). */
  async createUser(
    email: string,
    name?: string,
    role?: string,
  ): Promise<{ id: string; email: string; role: string }> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      throw new BadRequestException("El email ya está registrado");
    }
    const user = await this.prisma.user.create({
      data: {
        email: normalized,
        name: name?.trim() || null,
        role:
          role === "super_admin" || role === "admin" ? role : "developer",
        mcpSecret: this.generateMcpSecret(),
      },
    });
    return { id: user.id, email: user.email, role: user.role };
  }

  /** DELETE /users/:id — eliminar usuario (admin). No permite borrar la propia cuenta. */
  async deleteUser(targetUserId: string, actorUserId: string): Promise<{ deleted: boolean }> {
    if (targetUserId === actorUserId) {
      throw new ForbiddenException("No puedes eliminar tu propia cuenta");
    }
    try {
      await this.prisma.user.delete({ where: { id: targetUserId } });
      return { deleted: true };
    } catch {
      throw new NotFoundException("Usuario no encontrado");
    }
  }
}
