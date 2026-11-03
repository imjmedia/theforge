import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import type { SignOptions } from "jsonwebtoken";
import { AuthController, UsersController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtStrategy } from "./jwt.strategy.js";
import { UserProvidersModule } from "../user-providers/user-providers.module.js";
import { AuthSecurityModule } from "./auth-security.module.js";

@Module({
  imports: [
    AuthSecurityModule,
    UserProvidersModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const expiresIn = (config.get<string>("JWT_EXPIRES_IN") ?? "7d") as SignOptions["expiresIn"];
        // En producción JWT_SECRET ya está validado en config/env.schema.ts; el fallback es solo para desarrollo.
        const secret = config.get<string>("JWT_SECRET") || "dev-only-insecure-jwt-secret";
        return {
          secret,
          signOptions: { expiresIn },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
