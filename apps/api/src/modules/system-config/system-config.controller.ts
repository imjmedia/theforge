/**
 * @fileoverview Controller REST de configuración del sistema. Solo super_admin.
 * Endpoints: {@link GET /admin/system-config} (snapshot) y {@link PATCH /admin/system-config} (actualizar llaves).
 */
import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { requireSuperAdmin } from "../../common/guards/role.helpers.js";
import {
  SystemConfigService,
  type PatchSystemConfigDto,
} from "./system-config.service.js";

@Controller("admin/system-config")
export class SystemConfigController {
  constructor(private readonly systemConfig: SystemConfigService) {}

  @Get()
  getSnapshot() {
    requireSuperAdmin();
    return this.systemConfig.getSnapshot();
  }

  @Get("reveal/:key")
  revealSecret(@Param("key") key: string) {
    requireSuperAdmin();
    return this.systemConfig.revealSecret(decodeURIComponent(key));
  }

  @Patch()
  patch(@Body() body: PatchSystemConfigDto) {
    requireSuperAdmin();
    return this.systemConfig.patchSettings(body);
  }
}
