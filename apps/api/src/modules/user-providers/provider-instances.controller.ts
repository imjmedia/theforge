/**
 * @fileoverview Controller REST de instancias de proveedor (tenant): CRUD para admin+.
 * Endpoints: GET/POST/PUT/DELETE /provider-instances, GET /provider-instances/enabled.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { requireAdmin, requireSuperAdmin } from "../../common/guards/role.helpers.js";
import {
  ProviderInstancesService,
  type UpdateProviderInstanceDto,
  type UpsertProviderInstanceDto,
} from "./provider-instances.service.js";

@Controller("provider-instances")
export class ProviderInstancesController {
  constructor(private readonly instances: ProviderInstancesService) {}

  /** Instancias habilitadas para el usuario actual (cualquier rol autenticado). */
  @Get("enabled")
  listEnabled() {
    return this.instances.listEnabledForCurrentUser();
  }

  @Get("catalog-models/:providerType")
  catalogModels(@Param("providerType") providerType: string) {
    requireSuperAdmin();
    return this.instances.catalogModelsForType(providerType);
  }

  @Get()
  listForManagement() {
    requireAdmin();
    return this.instances.listForManagement();
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    requireAdmin();
    return this.instances.getById(id);
  }

  @Post()
  create(@Body() body: UpsertProviderInstanceDto) {
    requireAdmin();
    return this.instances.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: UpdateProviderInstanceDto) {
    requireAdmin();
    return this.instances.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    requireAdmin();
    return this.instances.delete(id);
  }
}
