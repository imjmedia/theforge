import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { integrationProjectPickerQuerySchema } from "@theforge/shared-types";
import { ProjectScoped } from "../../../common/access/project-scoped.decorator.js";
import { ProjectIntegrationService } from "./project-integration.service.js";
import { IntegrationAgentService } from "./integration-agent.service.js";

@Controller("projects/:projectId/integration")
export class ProjectIntegrationController {
  constructor(
    private readonly integration: ProjectIntegrationService,
    private readonly integrationAgent: IntegrationAgentService,
  ) {}

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get()
  getStatus(@Param("projectId") projectId: string) {
    return this.integration.getStatus(projectId);
  }

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("picker")
  listPicker(
    @Param("projectId") _projectId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const { targetType, q } = integrationProjectPickerQuerySchema.parse(query);
    return this.integration.listPickerProjects(targetType, q);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Patch("link")
  patchLink(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.integration.patchLink(projectId, body);
  }

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("context")
  getContext(@Param("projectId") projectId: string) {
    return this.integration.getLegacyContextForNew(projectId);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Post("handoff/items")
  createItem(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.integration.createHandoffItem(projectId, body);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Patch("handoff/items/:itemId")
  updateItem(
    @Param("projectId") projectId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    return this.integration.updateHandoffItem(projectId, itemId, body);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Delete("handoff/items/:itemId")
  deleteItem(@Param("projectId") projectId: string, @Param("itemId") itemId: string) {
    return this.integration.deleteHandoffItem(projectId, itemId);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Post("handoff/send")
  sendHandoff(@Param("projectId") projectId: string) {
    return this.integration.sendHandoff(projectId);
  }

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("traces")
  listTraces(@Param("projectId") projectId: string) {
    return this.integration.getStatus(projectId).then((s) => s.traces);
  }

  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Patch("traces/:traceId")
  updateTrace(
    @Param("projectId") projectId: string,
    @Param("traceId") traceId: string,
    @Body() body: unknown,
  ) {
    return this.integration.updateTrace(projectId, traceId, body);
  }

  @ProjectScoped({ key: "projectId", level: "spend" })
  @Post("promote-to-stage")
  promoteToStage(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.integration.promoteHandoffToStage(projectId, body);
  }

  @ProjectScoped({ key: "projectId", level: "spend", stage: { key: "stageId" } })
  @Post("stages/:stageId/import-handoff")
  importHandoff(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
  ) {
    return this.integration.importHandoffToStage(projectId, stageId);
  }

  @ProjectScoped({ key: "projectId", level: "spend", stage: { key: "stageId" } })
  @Post("stages/:stageId/reconcile-handoff")
  reconcileHandoff(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Body() body: unknown,
  ) {
    return this.integration.reconcileHandoffStage(projectId, stageId, body);
  }

  @ProjectScoped({ key: "projectId", level: "contribute", stage: { key: "stageId" } })
  @Post("stages/:stageId/abandon-handoff")
  abandonHandoff(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Body() body: unknown,
  ) {
    return this.integration.abandonIntegrationHandoffStage(projectId, stageId, body);
  }

  /** IntegrationAgent: (re)generate handoff-spec.md for a specific stage. */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { key: "stageId" } })
  @Post("stages/:stageId/sync-handoff-spec")
  syncHandoffSpecForStage(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
  ) {
    return this.integrationAgent.syncHandoffSpec(projectId, stageId);
  }

  /** IntegrationAgent: (re)generate handoff-spec.md for the primary (active) stage. */
  @ProjectScoped({ key: "projectId", level: "spend" })
  @Post("sync-handoff-spec")
  syncHandoffSpec(@Param("projectId") projectId: string) {
    return this.integrationAgent.syncHandoffSpec(projectId);
  }
}
