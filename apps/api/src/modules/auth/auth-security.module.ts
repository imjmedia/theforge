import { Module } from "@nestjs/common";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard.js";
import { AuthRedisStore } from "./auth-redis.store.js";
import { JwtUserCache } from "./jwt-user-cache.js";

/** Almacén Redis de seguridad de auth (OTP, intentos, rate limit) y caché de usuario del JWT. Lo importa `AuthModule`. */
@Module({
  providers: [AuthRedisStore, AuthRateLimitGuard, JwtUserCache],
  exports: [AuthRedisStore, AuthRateLimitGuard, JwtUserCache],
})
export class AuthSecurityModule {}
