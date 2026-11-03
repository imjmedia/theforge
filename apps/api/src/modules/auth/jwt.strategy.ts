import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service.js";
import { JwtUserCache, type JwtCachedUser } from "./jwt-user-cache.js";

export interface JwtValidatedUser {
  userId: string;
  email: string;
  role: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Versión de tokens del usuario al firmar. Ausente en tokens emitidos antes de existir el claim (= 0). */
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly userCache: JwtUserCache,
  ) {
    // En producción JWT_SECRET ya está validado en config/env.schema.ts; el fallback es solo para desarrollo.
    const secret = config.get<string>("JWT_SECRET");
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || "dev-only-insecure-jwt-secret",
    });
  }

  /**
   * La BD es la fuente de verdad del rol y del email (el payload solo identifica al usuario).
   * Un usuario inexistente o con `tokenVersion` distinta a la del token queda rechazado (401).
   */
  async validate(payload: JwtPayload): Promise<JwtValidatedUser> {
    const tokenTv = typeof payload.tv === "number" ? payload.tv : 0;
    let user: JwtCachedUser | undefined = this.userCache.get(payload.sub);
    // Un token con `tv` MAYOR que el cacheado indica caché vieja (p. ej. la rotación se hizo en otra réplica):
    // se relee la BD una vez antes de rechazar. Con `tv` menor el token está revocado y no se consulta la BD.
    if (user && tokenTv > user.tokenVersion) user = undefined;
    if (!user) user = await this.loadUser(payload.sub);

    if (tokenTv !== user.tokenVersion) {
      throw new UnauthorizedException("Sesión revocada");
    }

    return { userId: user.id, email: user.email, role: user.role };
  }

  /** Lee la BD y rellena la caché; la generación se toma antes de leer para descartar el `set` si hubo `invalidate`. */
  private async loadUser(userId: string): Promise<JwtCachedUser> {
    const generation = this.userCache.generation(userId);
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, tokenVersion: true },
    });
    if (!row) throw new UnauthorizedException("Sesión inválida");
    this.userCache.set(row.id, row, generation);
    return row;
  }
}
