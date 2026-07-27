import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AiModule } from "../ai/ai.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { TheForgeModule } from "../theforge/theforge.module.js";
import { AgentSupervisorModule } from "../agent-supervisor/agent-supervisor.module.js";
import { LegacyFlowModule } from "../legacy-flow/legacy-flow.module.js";
import { AiAnalysisController } from "./ai-analysis.controller.js";
import { AiAnalysisService } from "./ai-analysis.service.js";
import { CheckpointerService } from "./checkpoint/checkpointer.service.js";
import { NodeCacheService } from "./checkpoint/node-cache.service.js";
import { EstimationModule } from "./estimation/estimation.module.js";
import { MddManualAuditService } from "./mdd/mdd-manual-audit.service.js";
import { MddQueueService } from "./mdd/mdd-queue.service.js";
import { MddUpstreamSyncService } from "./mdd/mdd-upstream-sync.service.js";
import { TraceabilitySuggestService } from "./traceability/traceability-suggest.service.js";
import { TokenUsageService } from "./token-usage/token-usage.service.js";
import { Phase0Module } from "./phase0/phase0.module.js";
import { UiMcpModule } from "../ui-mcp/ui-mcp.module.js";
import { MddCoherenceModule } from "../engine/mdd-coherence/mdd-coherence.module.js";

@Module({
  imports: [
    PrismaModule,
    AiModule,
    forwardRef(() => ProjectsModule),
    forwardRef(() => LegacyFlowModule),
    TheForgeModule,
    AgentSupervisorModule,
    MddCoherenceModule,
    Phase0Module,
    UiMcpModule,
    EstimationModule,
  ],
  controllers: [AiAnalysisController],
  providers: [
    NodeCacheService,
    CheckpointerService,
    AiAnalysisService,
    MddManualAuditService,
    MddQueueService,
    MddUpstreamSyncService,
    TraceabilitySuggestService,
    TokenUsageService,
  ],
  exports: [
    AiAnalysisService,
    EstimationModule,
    MddCoherenceModule,
    Phase0Module,
    MddManualAuditService,
    MddQueueService,
    MddUpstreamSyncService,
    TraceabilitySuggestService,
    TokenUsageService,
  ],
})
export class AiAnalysisModule { }
