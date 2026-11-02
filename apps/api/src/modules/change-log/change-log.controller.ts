import { Controller, Get, Param, Query } from "@nestjs/common";
import { ChangeLogService } from "./change-log.service.js";
import { ProjectScoped } from "../../common/access/index.js";

@ProjectScoped({ key: "projectId", level: "read" })
@Controller("projects/:projectId/change-log")
export class ChangeLogController {
  constructor(private readonly changeLog: ChangeLogService) {}

  /**
   * Lista los cambios recientes de un proyecto, más recientes primero.
   */
  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("limit") limit?: string,
  ) {
    const max = limit ? parseInt(limit, 10) : undefined;
    return this.changeLog.listByProject(projectId, { limit: max });
  }
}
