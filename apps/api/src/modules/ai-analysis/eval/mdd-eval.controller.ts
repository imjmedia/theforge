/**
 * @fileoverview REST del eval de MDDs (solo administradores). Contrato en
 * `packages/shared-types/src/mdd-eval-api.ts`. `runs/compare` va ANTES de `runs/:runId` para que
 * Nest no lo interprete como un runId.
 */

import { Body, Controller, Get, Header, Param, Post, Query } from "@nestjs/common";
import type {
  MddEvalCaseDetailDto,
  MddEvalCaseSummaryDto,
  MddEvalCompareDto,
  MddEvalRunDto,
} from "@theforge/shared-types";
import { MDD_EVAL_API_PREFIX } from "@theforge/shared-types";
import { requireAdmin } from "../../../common/guards/role.helpers.js";
import { MddEvalService } from "./mdd-eval.service.js";

@Controller(MDD_EVAL_API_PREFIX)
export class MddEvalController {
  constructor(private readonly evalService: MddEvalService) {}

  @Get("cases")
  listCases(): MddEvalCaseSummaryDto[] {
    requireAdmin();
    return this.evalService.listCases();
  }

  @Get("cases/:id")
  getCase(@Param("id") id: string): MddEvalCaseDetailDto {
    requireAdmin();
    return this.evalService.getCase(id);
  }

  @Post("runs")
  async startRun(@Body() body: unknown): Promise<MddEvalRunDto> {
    requireAdmin();
    return this.evalService.startRun(body);
  }

  @Get("runs")
  async listRuns(): Promise<MddEvalRunDto[]> {
    requireAdmin();
    return this.evalService.listRuns();
  }

  // Debe declararse antes de `runs/:runId`.
  @Get("runs/compare")
  compare(@Query("base") base?: string, @Query("target") target?: string): MddEvalCompareDto {
    requireAdmin();
    return this.evalService.compare(base, target);
  }

  @Get("runs/:runId")
  async getRun(@Param("runId") runId: string): Promise<MddEvalRunDto> {
    requireAdmin();
    return this.evalService.getRun(runId);
  }

  @Post("runs/:runId/cancel")
  async cancelRun(@Param("runId") runId: string): Promise<MddEvalRunDto> {
    requireAdmin();
    return this.evalService.cancelRun(runId);
  }

  @Get("runs/:runId/cases/:caseId/markdown")
  @Header("Content-Type", "text/markdown; charset=utf-8")
  getCaseMarkdown(@Param("runId") runId: string, @Param("caseId") caseId: string): string {
    requireAdmin();
    return this.evalService.getCaseMarkdown(runId, caseId);
  }
}
