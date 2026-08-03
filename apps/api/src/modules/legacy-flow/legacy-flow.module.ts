import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AiAnalysisModule } from "../ai-analysis/ai-analysis.module.js";
import { AgentSupervisorModule } from "../agent-supervisor/agent-supervisor.module.js";
import { AiModule } from "../ai/ai.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { TheForgeModule } from "../theforge/theforge.module.js";
import { LegacyFlowController } from "./legacy-flow.controller.js";
import { ChangeInterviewController } from "./change-interview.controller.js";
import { LegacyDeliverablesOrchestratorService } from "./legacy-deliverables-orchestrator.service.js";
import { LegacyMddGenerationService } from "./legacy-mdd-generation.service.js";
import { LegacyStageContextService } from "./legacy-stage-context.service.js";
import { LegacyCoordinatorService } from "./legacy-coordinator.service.js";
import { LegacyReviewerService } from "./legacy-reviewer.service.js";
import { ChangeInterviewService } from "./change-interview.service.js";
import { ResolveChangeToFilesService } from "./resolve-change-to-files.service.js";
import { CheckNavigationImpactService } from "./check-navigation-impact.service.js";
import { LegacyTransitionService } from "./legacy-transition.service.js";
import { LegacyDeliverablesStrategyService } from "./legacy-deliverables-strategy/legacy-deliverables-strategy.service.js";
import { LegacyDeliverablesQueueService } from "./legacy-deliverables-queue.service.js";

@Module({
  imports: [
    PrismaModule,
    AiModule,
    forwardRef(() => ProjectsModule),
    TheForgeModule,
    forwardRef(() => AiAnalysisModule),
    AgentSupervisorModule,
  ],
  controllers: [LegacyFlowController, ChangeInterviewController],
  providers: [
    LegacyCoordinatorService,
    LegacyStageContextService,
    LegacyMddGenerationService,
    LegacyDeliverablesOrchestratorService,
    LegacyDeliverablesQueueService,
    LegacyReviewerService,
    ChangeInterviewService,
    ResolveChangeToFilesService,
    CheckNavigationImpactService,
    LegacyTransitionService,
    LegacyDeliverablesStrategyService,
  ],
  exports: [
    LegacyCoordinatorService,
    LegacyReviewerService,
    ChangeInterviewService,
    ResolveChangeToFilesService,
    CheckNavigationImpactService,
    LegacyTransitionService,
    LegacyDeliverablesQueueService,
  ],
})
export class LegacyFlowModule {}
