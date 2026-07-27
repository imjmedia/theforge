import { Module, forwardRef } from "@nestjs/common";
import { ChangeLogModule } from "../change-log/change-log.module.js";
import { EngineModule } from "../engine/engine.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { UiMcpModule } from "../ui-mcp/ui-mcp.module.js";
import { AgentSessionLogController } from "./agent-session-log.controller.js";
import { AgentSessionLogService } from "./agent-session-log.service.js";
import { ArchitectureDecisionService } from "./architecture-decision.service.js";
import { DocReconcileService } from "./doc-reconcile.service.js";
import { DocumentationGapController } from "./documentation-gap.controller.js";
import { DocumentationGapService } from "./documentation-gap.service.js";

@Module({
  imports: [ChangeLogModule, EngineModule, UiMcpModule, forwardRef(() => ProjectsModule)],
  controllers: [DocumentationGapController, AgentSessionLogController],
  providers: [
    DocumentationGapService,
    AgentSessionLogService,
    ArchitectureDecisionService,
    DocReconcileService,
  ],
  exports: [
    DocumentationGapService,
    AgentSessionLogService,
    ArchitectureDecisionService,
    DocReconcileService,
  ],
})
export class DocumentationGapModule {}
