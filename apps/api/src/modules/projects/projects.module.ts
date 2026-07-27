import { Module, forwardRef } from "@nestjs/common";
import { DeliverablesQueueService } from "./deliverables-queue.service.js";
import { ProjectGenerationGuardService } from "./project-generation-guard.service.js";
import { PROJECTS_ORCHESTRATOR_PORT } from "./projects-service.port.js";
import { ProjectsService } from "./projects.service.js";
import { ProjectMergeService } from "./project-merge.service.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectIntegrationController } from "./integration/project-integration.controller.js";
import { ProjectIntegrationService } from "./integration/project-integration.service.js";
import { IntegrationAgentService } from "./integration/integration-agent.service.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import { EngineModule } from "../engine/engine.module.js";
import { AiModule } from "../ai/ai.module.js";
import { Phase0Module } from "../ai-analysis/phase0/phase0.module.js";
import { ScraperModule } from "../scraper/scraper.module.js";
import { TheForgeModule } from "../theforge/theforge.module.js";
import { ChangeLogModule } from "../change-log/change-log.module.js";
import { DocumentSnapshotModule } from "../document-snapshot/document-snapshot.module.js";
import { LegacyFlowModule } from "../legacy-flow/legacy-flow.module.js";
import { DocumentationGapModule } from "../documentation-gap/documentation-gap.module.js";
import { EstimationModule } from "../ai-analysis/estimation/estimation.module.js";
import { AiAnalysisModule } from "../ai-analysis/ai-analysis.module.js";
import { SddIntegrationService } from "./sdd-integration.service.js";
import { PlanValidationService } from "./plan-validation.service.js";
import { ProjectGroupsModule } from "../project-groups/project-groups.module.js";
import { UiMcpModule } from "../ui-mcp/ui-mcp.module.js";
import { TasksGenerationPipelineService } from "./tasks-generation-pipeline.service.js";
import { ProjectMddPersistService } from "./project-mdd-persist.service.js";
import { DeliverablesCascadeService } from "./deliverables-cascade.service.js";
import { ProjectStageService } from "./project-stage.service.js";
import { ProjectUxGuideService } from "./project-ux-guide.service.js";
import { ProjectDeliverableGeneratorsService } from "./project-deliverable-generators.service.js";
import { ProjectDeliverableGateService } from "./project-deliverable-gate.service.js";
import { ProjectConformanceService } from "./project-conformance.service.js";
import { ProjectBrdService } from "./project-brd.service.js";
import { ProjectUpdateService } from "./project-update.service.js";
import { ProjectComplexityService } from "./project-complexity.service.js";
import { ProjectSddReconcileService } from "./project-sdd-reconcile.service.js";
import { ProjectLifecycleService } from "./project-lifecycle.service.js";
import { ProjectPhase0Service } from "./project-phase0.service.js";
import { ProjectNotionPortabilityService } from "./project-notion-portability.service.js";
import { UpstreamPropagateService } from "./upstream-propagate.service.js";
import { PluginModule } from "../../plugins/plugin.module.js";

@Module({
  imports: [
    EngineModule,
    AiModule,
    Phase0Module,
    ScraperModule,
    forwardRef(() => TheForgeModule),
    ChangeLogModule,
    DocumentSnapshotModule,
    forwardRef(() => LegacyFlowModule),
    forwardRef(() => DocumentationGapModule),
    UiMcpModule,
    ProjectGroupsModule,
    EstimationModule,
    forwardRef(() => AiAnalysisModule),
    PluginModule,
  ],
  controllers: [ProjectsController, ProjectIntegrationController],
  providers: [
    ProjectsService,
    ProjectIntegrationService,
    IntegrationAgentService,
    ProjectMergeService,
    SddIntegrationService,
    PlanValidationService,
    { provide: PROJECTS_ORCHESTRATOR_PORT, useExisting: ProjectsService },
    ProjectEstimationRecalcService,
    DeliverablesQueueService,
    ProjectGenerationGuardService,
    TasksGenerationPipelineService,
    ProjectNotionPortabilityService,
    ProjectMddPersistService,
    DeliverablesCascadeService,
    ProjectStageService,
    ProjectUxGuideService,
    ProjectDeliverableGeneratorsService,
    ProjectDeliverableGateService,
    ProjectConformanceService,
    ProjectBrdService,
    ProjectUpdateService,
    ProjectComplexityService,
    ProjectPhase0Service,
    ProjectSddReconcileService,
    ProjectLifecycleService,
    UpstreamPropagateService,
  ],
  exports: [ProjectsService, ProjectIntegrationService, IntegrationAgentService, ProjectMergeService, PROJECTS_ORCHESTRATOR_PORT, DeliverablesQueueService, ProjectGenerationGuardService, PlanValidationService, UpstreamPropagateService],
})
export class ProjectsModule { }
