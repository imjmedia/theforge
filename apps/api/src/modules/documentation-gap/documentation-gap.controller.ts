import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { DocumentationGapService } from "./documentation-gap.service.js";
import { ProjectScoped } from "../../common/access/index.js";

@Controller("projects/:projectId/stages/:stageId/documentation-gaps")
export class DocumentationGapController {
  constructor(private readonly documentationGap: DocumentationGapService) {}

  @ProjectScoped({ key: "projectId", level: "read", stage: { key: "stageId" } })
  @Get()
  listGaps(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Query("status") status?: string,
  ) {
    return this.documentationGap.listGaps(projectId, stageId, status);
  }

  @ProjectScoped({ key: "projectId", level: "contribute", stage: { key: "stageId" } })
  @Post()
  reportGap(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Body() body: unknown,
  ) {
    return this.documentationGap.reportGap(projectId, stageId, body);
  }

  @ProjectScoped({ key: "projectId", level: "spend", stage: { key: "stageId" } })
  @Post(":gapId/approve")
  approveGap(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Param("gapId") gapId: string,
  ) {
    return this.documentationGap.approveGap(projectId, stageId, gapId);
  }

  @ProjectScoped({ key: "projectId", level: "contribute", stage: { key: "stageId" } })
  @Post(":gapId/reject")
  rejectGap(
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Param("gapId") gapId: string,
    @Body() body: unknown,
  ) {
    return this.documentationGap.rejectGap(projectId, stageId, gapId, body);
  }
}
