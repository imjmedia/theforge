/**
 * @fileoverview Módulo global NestJS de configuración del sistema.
 * Registra {@link SystemConfigService}, {@link SystemConfigController} y {@link PlatformConfigRuntime}.
 */
import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { SystemConfigController } from "./system-config.controller.js";
import { SystemConfigService } from "./system-config.service.js";
import { FxRateService } from "../fx-rate/fx-rate.service.js";

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService, FxRateService],
  exports: [SystemConfigService, FxRateService],
})
export class SystemConfigModule {}
