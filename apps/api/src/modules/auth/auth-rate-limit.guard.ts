/**
 * @fileoverview Límite de peticiones para las rutas públicas de auth (OTP, login M2M/SSO, alta inicial).
 *
 * Ventana fija en Redis (`AuthRedisStore.hit`), por IP (`req.ip`, fiable con `trust proxy`) y, si el body trae
 * `email`, también por email normalizado. Al superar el límite responde 429 con `Retry-After`. Si Redis no
 * está disponible en producción el store lanza 503: el guard falla cerrado.
 *
 * Perfil `mcp-login`: el servidor MCP hace todas sus llamadas desde la misma IP interna, así que la cubeta
 * por IP es amplia (solo frena abuso grosero) y el límite fino va por `sha256(secret)` (el secret es
 * aleatorio de 64 hex: la fuerza bruta no es viable; el límite solo frena reintentos). Nunca se guarda el
 * secret en claro en las claves de Redis.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { AuthRedisStore } from "./auth-redis.store.js";

export const AUTH_RATE_LIMIT_IP = { limit: 20, windowSeconds: 60 } as const;
// Trade-off aceptado (H10): al ser por email, quien conozca un correo puede agotar su cubeta (5 `otp/request`
// por 10 min) desde IPs rotadas y retrasar el login de esa cuenta; a cambio no se puede inundar de OTP a la víctima.
export const AUTH_RATE_LIMIT_EMAIL = { limit: 5, windowSeconds: 10 * 60 } as const;
export const AUTH_RATE_LIMIT_EMAIL_VERIFY = { limit: 10, windowSeconds: 10 * 60 } as const;
/** `mcp-login`: cubeta por IP amplia (todo el tráfico MCP comparte IP interna). */
export const AUTH_RATE_LIMIT_IP_MCP = { limit: 600, windowSeconds: 60 } as const;
/** `mcp-login`: reintentos por secret (clave = sha256 del secret). */
export const AUTH_RATE_LIMIT_MCP_SECRET = { limit: 20, windowSeconds: 60 } as const;

export type AuthRateLimitProfile = "default" | "verify" | "mcp-login";
export const AUTH_RATE_LIMIT_PROFILE_KEY = "auth:rate-limit-profile";
export const AUTH_RATE_LIMIT_MESSAGE = "Demasiadas solicitudes. Intenta de nuevo más tarde.";

/** Perfil del límite por email de la ruta (`verify` admite más intentos que el resto). */
export const AuthRateLimitProfileOf = (profile: AuthRateLimitProfile) =>
  SetMetadata(AUTH_RATE_LIMIT_PROFILE_KEY, profile);

type RequestLike = { ip?: string; socket?: { remoteAddress?: string }; body?: unknown };
type ResponseLike = { setHeader?: (name: string, value: string) => unknown };

function readEmail(body: unknown): string | null {
  if (body == null || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).email;
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email ? email.slice(0, 320) : null;
}

/** Digest del `secret` del body (campo `secret` de `POST /auth/mcp-login`), o null si no viene. */
function readSecretDigest(body: unknown): string | null {
  if (body == null || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).secret;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return createHash("sha256").update(raw.slice(0, 512)).digest("hex");
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly store: AuthRedisStore,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();
    const profile =
      this.reflector.get<AuthRateLimitProfile | undefined>(AUTH_RATE_LIMIT_PROFILE_KEY, context.getHandler()) ??
      "default";

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const ipCfg = profile === "mcp-login" ? AUTH_RATE_LIMIT_IP_MCP : AUTH_RATE_LIMIT_IP;
    const ipKey = profile === "mcp-login" ? `auth:rl:ip-mcp:${ip}` : `auth:rl:ip:${ip}`;
    const ipHit = await this.store.hit(ipKey, ipCfg.limit, ipCfg.windowSeconds);
    if (!ipHit.allowed) this.reject(res, ipHit.retryAfterSeconds);

    if (profile === "mcp-login") {
      const digest = readSecretDigest(req.body);
      if (digest) {
        const secretHit = await this.store.hit(
          `auth:rl:mcp-secret:${digest}`,
          AUTH_RATE_LIMIT_MCP_SECRET.limit,
          AUTH_RATE_LIMIT_MCP_SECRET.windowSeconds,
        );
        if (!secretHit.allowed) this.reject(res, secretHit.retryAfterSeconds);
      }
      return true;
    }

    const email = readEmail(req.body);
    if (email) {
      const cfg = profile === "verify" ? AUTH_RATE_LIMIT_EMAIL_VERIFY : AUTH_RATE_LIMIT_EMAIL;
      const emailHit = await this.store.hit(`auth:rl:email:${profile}:${email}`, cfg.limit, cfg.windowSeconds);
      if (!emailHit.allowed) this.reject(res, emailHit.retryAfterSeconds);
    }
    return true;
  }

  private reject(res: ResponseLike, retryAfterSeconds: number): never {
    res.setHeader?.("Retry-After", String(retryAfterSeconds));
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: AUTH_RATE_LIMIT_MESSAGE, retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
