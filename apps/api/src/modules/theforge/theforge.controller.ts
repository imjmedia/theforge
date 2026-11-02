import { Body, Controller, Get, Logger, Post } from "@nestjs/common";
import { ProjectAccessExempt, ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { ProjectIntegrationService } from "../projects/integration/project-integration.service.js";
import { ProjectAriadneLinkService } from "./project-ariadne-link.service.js";
import { TheForgeService } from "./theforge.service.js";

/**
 * Controlador REST para integración con TheForge (MCP AriadneSpecs).
 * Expone el listado de proyectos indexados para que la web permita crear proyectos legacy vinculados.
 */
@Controller("theforge")
export class TheForgeController {
  private readonly logger = new Logger(TheForgeController.name);

  constructor(
    private readonly theforge: TheForgeService,
    private readonly ariadneLinks: ProjectAriadneLinkService,
    private readonly integration: ProjectIntegrationService,
  ) {}

  /**
   * Lista los proyectos indexados en TheForge (multi-root) y si el servicio está disponible.
   * @returns Lista de proyectos (id, name, roots con id/name/branch por repo) y flag theforgeAvailable.
   */
  @Get("projects")
  async listProjects(): Promise<{
    projects: Array<{ id: string; name: string; roots?: Array<{ id: string; name?: string; branch?: string }>; rootPath?: string; branch?: string }>;
    theforgeAvailable: boolean;
  }> {
    this.logger.log("[TheForge] GET /theforge/projects requested");
    const available = this.theforge.isConfigured();
    if (!available) {
      this.logger.log("[TheForge] GET /theforge/projects: theforgeAvailable=false (no config)");
      return { projects: [], theforgeAvailable: false };
    }
    const projects = await this.theforge.listKnownProjects();
    this.logger.log(`[TheForge] GET /theforge/projects: returning theforgeAvailable=true, projects.length=${projects.length}`);
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        roots: p.roots,
        rootPath: p.rootPath,
        branch: p.branch,
      })),
      theforgeAvailable: true,
    };
  }

  /**
   * Resuelve un proyecto Workshop desde identificadores Ariadne (MCP `resolve_forge_project_for_ariadne`).
   * 404 si no hay match; 409 con `candidates[]` si hay ambigüedad.
   */
  @ProjectAccessExempt("lista filtrada por userId/SHARED en el servicio")
  @Post("resolve-forge-project-for-ariadne")
  async resolveForgeProjectForAriadne(@Body() body: unknown) {
    this.logger.log("[TheForge] POST /theforge/resolve-forge-project-for-ariadne");
    return this.ariadneLinks.resolve(body);
  }

  /**
   * Crea etapa LEGACY o importa pack en etapa existente (MCP `create_stage_from_ariadne_change_pack`).
   * El proyecto viaja en `forgeProjectId` del body; el `stageId` opcional debe ser de ese proyecto.
   */
  @ProjectScoped({
    from: "body",
    key: "forgeProjectId",
    level: "spend",
    stage: { from: "body", key: "stageId", optional: true },
  })
  @Post("create-stage-from-ariadne-change-pack")
  async createStageFromAriadneChangePack(@Body() body: unknown) {
    this.logger.log("[TheForge] POST /theforge/create-stage-from-ariadne-change-pack");
    return this.integration.createStageFromAriadneChangePack(body);
  }
}
