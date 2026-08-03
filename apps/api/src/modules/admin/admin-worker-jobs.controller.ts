import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AdminStopWorkerJobBody } from "@theforge/shared-types";
import { requireAdmin } from "../../common/guards/role.helpers.js";
import { AdminWorkerJobsService } from "./admin-worker-jobs.service.js";

@Controller("admin/worker-jobs")
export class AdminWorkerJobsController {
  constructor(private readonly workerJobs: AdminWorkerJobsService) {}

  /** Lista workers BullMQ/in-memory y jobs activos o en cola. Solo admin / super_admin. */
  @Get()
  listActiveJobs() {
    requireAdmin();
    return this.workerJobs.listActiveJobs();
  }

  /** Detiene el worker y limpia cola/Redis del job; preserva checkpoint y flujo MDD en BD. */
  @Post(":jobId/stop")
  stopJob(@Param("jobId") jobId: string, @Body() body: AdminStopWorkerJobBody) {
    requireAdmin();
    return this.workerJobs.stopJob(jobId, body);
  }
}
