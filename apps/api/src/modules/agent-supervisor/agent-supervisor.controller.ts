import { Controller, Get, Param } from "@nestjs/common";
import { AgentSupervisorService } from "./agent-supervisor.service.js";
import { ProjectScoped } from "../../common/access/index.js";

/**
 * Inspección de memoria episódica por proyecto (Workshop / debugging).
 */
@Controller("agent-supervisor")
export class AgentSupervisorController {
  constructor(private readonly supervisor: AgentSupervisorService) { }

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("episodic/:projectId")
  async getEpisodic(@Param("projectId") projectId: string) {
    const route = await this.supervisor.resolveRoute(projectId);
    const items = await this.supervisor.getRecentEpisodicMemory(route.stageId, 40);
    return {
      projectId: route.projectId,
      stageId: route.stageId,
      flow: route.flow,
      items,
    };
  }
}
