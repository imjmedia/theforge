import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AiAnalysisModule } from "../ai-analysis/ai-analysis.module.js";
import { LegacyFlowModule } from "../legacy-flow/legacy-flow.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminWorkerJobsController } from "./admin-worker-jobs.controller.js";
import { AdminWorkerJobsService } from "./admin-worker-jobs.service.js";

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ProjectsModule),
    forwardRef(() => AiAnalysisModule),
    forwardRef(() => LegacyFlowModule),
  ],
  controllers: [AdminController, AdminWorkerJobsController],
  providers: [AdminWorkerJobsService],
})
export class AdminModule {}
