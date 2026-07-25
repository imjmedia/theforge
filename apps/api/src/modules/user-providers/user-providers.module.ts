/**
 * @fileoverview Módulo NestJS de proveedores de usuario: registra servicios, controllers y dependencias (Prisma, Crypto).
 */
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { UserProvidersController } from "./user-providers.controller.js";
import { UserProvidersService } from "./user-providers.service.js";
import { ProviderInstancesController } from "./provider-instances.controller.js";
import { ProviderInstancesService } from "./provider-instances.service.js";

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [UserProvidersController, ProviderInstancesController],
  providers: [UserProvidersService, ProviderInstancesService],
  exports: [UserProvidersService, ProviderInstancesService],
})
export class UserProvidersModule {}
