import { Injectable } from "@nestjs/common";
import { ComplexityLevel } from "@theforge/database";
import {
  ConformanceService,
  type ApiConformanceResult,
  type ConformanceResult,
} from "../engine/conformance.service.js";
import { AiService } from "../ai/ai.service.js";
import { SemaphoreService } from "../engine/semaphore.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { buildConstitutionMarkdown } from "./constitution-markdown.util.js";
import {
  buildConformanceSummary,
} from "./conformance-gaps.util.js";
import { buildLowMediumConformanceSummary } from "../engine/low-medium-readiness.util.js";
import type { ConformanceSummary } from "../engine/mdd-quality-audit.util.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import { buildUnifiedAuditReport, type UnifiedAuditReport } from "./unified-audit.util.js";
import {
  buildProjectDeliverableSource,
  collectFullCrossArtifactGaps,
  computeConsistencyScoreForProject,
  evaluateCompositeSemaphore,
} from "./project-semaphore-composite.util.js";
import { buildSemaphoreBaseFromProject } from "./project-mdd-persist.util.js";
import { mddJsonStringForSemaphore } from "./project-semaphore.util.js";
import { UNIFIED_AUDIT_GAP_LIMIT } from "@theforge/shared-types";

export type ConformanceLlmVerification = {
  blueprint: ConformanceResult;
  api: ApiConformanceResult;
  logicFlows: ConformanceResult;
  infra: ConformanceResult;
};

export type ConformanceWithReadiness = {
  blueprint: ConformanceResult;
  blueprintDataModel: ConformanceResult;
  api: ApiConformanceResult;
  logicFlows: ConformanceResult;
  infra: ConformanceResult;
  /** Opinión LLM adicional; no anula los badges heurísticos de conformidad. */
  llmVerification?: ConformanceLlmVerification;
  readiness?: UnifiedAuditReport;
};

@Injectable()
export class ProjectConformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conformance: ConformanceService,
    private readonly semaphore: SemaphoreService,
    private readonly ai: AiService,
  ) {}

  /** Auditoría integral: conformidad heurística + métricas en vivo + gaps SDD unificados. */
  async auditDocuments(projectId: string, options?: { useLlm?: boolean }) {
    const unified = await this.buildUnifiedAudit(projectId, options);
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = pickPrimaryStage(project.stages ?? []);
    return {
      projectId,
      projectName: project.name,
      stageStatus: stage?.status ?? null,
      precisionScore: stage?.precisionScore ?? null,
      conformance: unified.conformance,
      conformanceSummary: unified.conformanceSummary,
      crossArtifactGaps: unified.crossArtifactGaps,
      readiness: unified,
      auditedAt: unified.generatedAt,
    };
  }

  async getConformance(
    projectId: string,
    options?: { useLlm?: boolean },
  ): Promise<ConformanceWithReadiness> {
    const unified = await this.buildUnifiedAudit(projectId, options);
    return {
      ...unified.conformance,
      llmVerification: unified.llmVerification,
      readiness: unified,
    };
  }

  private async buildUnifiedAudit(
    projectId: string,
    options?: { useLlm?: boolean },
  ): Promise<UnifiedAuditReport> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = pickPrimaryStage(project.stages ?? []);
    const mdd = buildConstitutionMarkdown(project);
    const complexity = project.complexity ?? ComplexityLevel.HIGH;
    const deliverableSource = buildProjectDeliverableSource(project, stage);
    const { conformance, llmVerification } = await this.resolveConformanceHeuristicOrLlm(
      projectId,
      mdd,
      project,
      options,
    );
    const useLowMediumPath =
      complexity === ComplexityLevel.LOW || complexity === ComplexityLevel.MEDIUM;
    const conformanceSummary = useLowMediumPath
      ? lowMediumConformanceSummaryAsUnified(complexity, deliverableSource)
      : buildConformanceSummary(this.conformance, mdd, deliverableSource);
    const crossArtifactGaps = collectFullCrossArtifactGaps(
      this.conformance,
      mdd,
      deliverableSource,
      complexity,
    );
    const consistencyScore = computeConsistencyScoreForProject(mdd, deliverableSource, complexity);
    const compositeEval = evaluateCompositeSemaphore(this.semaphore, {
      ...buildSemaphoreBaseFromProject(project),
      mddJsonString: mddJsonStringForSemaphore(mdd),
      mddMarkdown: mdd,
      project,
      conformance: this.conformance,
      deliverableSource,
    });

    return buildUnifiedAuditReport({
      conformance,
      llmVerification,
      conformanceSummary,
      crossArtifactGaps,
      compositeReadiness: compositeEval.composite,
      consistencyScore,
      gapLimit: UNIFIED_AUDIT_GAP_LIMIT,
    });
  }

  private async resolveConformanceHeuristicOrLlm(
    _projectId: string,
    mdd: string,
    project: Awaited<ReturnType<typeof loadAccessibleProjectWithStages>>,
    options?: { useLlm?: boolean },
  ): Promise<{
    conformance: ConformanceWithReadiness;
    llmVerification?: ConformanceLlmVerification;
  }> {
    const blueprintDataModel = this.conformance.checkBlueprintDataModel(mdd, project.blueprintContent);
    const heuristic: ConformanceWithReadiness = {
      blueprint: this.conformance.checkBlueprint(mdd, project.blueprintContent),
      blueprintDataModel,
      api: this.conformance.checkApi(mdd, project.apiContractsContent),
      logicFlows: this.conformance.checkLogicFlows(mdd, project.logicFlowsContent),
      infra: this.conformance.checkInfra(mdd, project.infraContent),
    };

    if (!options?.useLlm) {
      return { conformance: heuristic };
    }

    const mddTrim = mdd.trim();
    if (mddTrim.length < 200) {
      return { conformance: heuristic };
    }

    const [blueprintLlm, apiLlm, logicFlowsLlm, infraLlm] = await Promise.all([
      this.ai.conformanceCheck(mddTrim, (project.blueprintContent ?? "").trim(), "blueprint"),
      this.ai.conformanceCheck(mddTrim, (project.apiContractsContent ?? "").trim(), "api"),
      this.ai.conformanceCheck(mddTrim, (project.logicFlowsContent ?? "").trim(), "logicFlows"),
      this.ai.conformanceCheck(mddTrim, (project.infraContent ?? "").trim(), "infra"),
    ]);

    return {
      conformance: heuristic,
      llmVerification: {
        blueprint: blueprintLlm.ok ? { ok: true, gaps: [] } : { ok: false, gaps: blueprintLlm.gaps },
        api: apiLlm.ok
          ? { ok: true, missingInApi: [], extraInApi: [] }
          : { ok: false, missingInApi: apiLlm.gaps, extraInApi: [] },
        logicFlows: logicFlowsLlm.ok ? { ok: true, gaps: [] } : { ok: false, gaps: logicFlowsLlm.gaps },
        infra: infraLlm.ok ? { ok: true, gaps: [] } : { ok: false, gaps: infraLlm.gaps },
      },
    };
  }

  async verifyDeliverable(
    projectId: string,
    deliverable: "blueprint" | "api" | "infra" | "logicFlows",
  ): Promise<string> {
    const p = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const doc =
      deliverable === "blueprint"
        ? p.blueprintContent
        : deliverable === "api"
          ? p.apiContractsContent
          : deliverable === "logicFlows"
            ? p.logicFlowsContent
            : p.infraContent;
    return this.ai.verifyDeliverable(buildConstitutionMarkdown(p), doc ?? "", deliverable);
  }
}

function lowMediumConformanceSummaryAsUnified(
  complexity: Extract<ComplexityLevel, "LOW" | "MEDIUM">,
  source: ReturnType<typeof buildProjectDeliverableSource>,
): ConformanceSummary {
  const lm = buildLowMediumConformanceSummary(complexity, source);
  return {
    ok: lm.ok,
    api: { ok: lm.apiOk, missingCount: 0, extraCount: 0, aliasWarnings: [] },
    infra: { ok: true, gapCount: 0, gaps: [] },
    blueprint: { ok: true },
    logicFlows: { ok: lm.uxOrFlowsOk },
  };
}
