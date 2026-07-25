/**
 * @fileoverview Controller REST de configuración BYOK del usuario: settings, catálogo y CRUD de configs personales.
 */
import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { getRequestUserId } from "../../common/request-user.store.js";
import {
  UserProvidersService,
  type UpdateAISettingsDto,
  type UpsertProviderConfigDto,
} from "./user-providers.service.js";

@Controller("user-providers")
export class UserProvidersController {
  constructor(private readonly userProviders: UserProvidersService) {}

  @Get("catalog")
  getCatalog() {
    return this.userProviders.getCatalog();
  }

  @Get("status")
  getStatus() {
    return this.userProviders.getProviderStatus(getRequestUserId());
  }

  @Get("settings")
  getSettings() {
    return this.userProviders.getSettings();
  }

  @Put("settings")
  updateSettings(@Body() body: UpdateAISettingsDto) {
    return this.userProviders.updateSettings(body);
  }

  @Get("configs")
  listConfigs() {
    return this.userProviders.listConfigs();
  }

  @Put("configs/:provider")
  upsertConfig(@Param("provider") provider: string, @Body() body: UpsertProviderConfigDto) {
    return this.userProviders.upsertConfig(provider, body);
  }

  @Delete("configs/:provider")
  deleteConfig(@Param("provider") provider: string) {
    return this.userProviders.deleteConfig(provider);
  }
}
