import type { ComplexityLevel, Project } from "@theforge/database";
import { ComplexityLevel as ComplexityLevelEnum } from "@theforge/database";
import type { DeliverableWaveStep } from "@theforge/shared-types";
import {
  checkApiVsMdd,
  checkBlueprintDataModelVsMdd,
  checkBlueprintSectionHeaders,
  checkBlueprintSelfContained,
  checkInfraVsMdd,
  checkLogicFlowsVsMdd,
} from "../engine/conformance.service.js";
import { collectSddPrecisionGaps } from "../engine/sdd-precision-checks.util.js";
import { lowMediumGapsForCascadeStep } from "../engine/low-medium-readiness.util.js";
import type { ProjectDeliverableSource } from "./conformance-gaps.util.js";

function formatGapsForStep(gaps: string[]): string | undefined {
  const trimmed = gaps.filter(Boolean);
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 24).join("\n");
}

function projectAsDeliverableSource(project: Project): ProjectDeliverableSource {
  return {
    blueprintContent: project.blueprintContent,
    apiContractsContent: project.apiContractsContent,
    logicFlowsContent: project.logicFlowsContent,
    infraContent: project.infraContent,
    architectureContent: project.architectureContent,
    tasksContent: project.tasksContent,
    useCasesContent: project.useCasesContent,
    userStoriesContent: project.userStoriesContent,
    uiScreensContent: project.uiScreensContent,
    phase0SummaryContent: project.phase0SummaryContent,
    specContent: project.specContent,
    uxUiGuideContent: project.uxUiGuideContent,
  };
}

function precisionGapsForDeliverable(
  step: DeliverableWaveStep,
  mdd: string,
  project: Project,
): string[] {
  const all = collectSddPrecisionGaps({
    mdd,
    architecture: project.architectureContent,
    blueprint: project.blueprintContent,
    tasks: project.tasksContent,
    logicFlows: project.logicFlowsContent,
    userStories: project.userStoriesContent,
    useCases: project.useCasesContent,
    apiContracts: project.apiContractsContent,
    pantallas: project.uiScreensContent,
    phase0Summary: project.phase0SummaryContent,
  });
  const map: Record<string, RegExp> = {
    architecture: /\[Architecture\]/i,
    blueprint: /\[Blueprint\]/i,
    api_contracts: /\[API|\[Research M\*\]|\[Integración|\[Spec↔API\]/i,
    logic_flows: /\[Flujos\]|\[Scheduler\]|\[Spec↔UX\]/i,
    infra: /\[Infra\]/i,
    tasks: /\[Tasks\]|\[Research→Tasks\]|\[Events\]|\[HU↔Tasks\]|\[Entregables\].*Tasks/i,
    use_cases: /\[LLM JSON\]/i,
    spec: /\[Spec↔MDD\]|\[Spec↔API\]|\[Spec↔UX\]|\[Entregables\].*Spec/i,
    user_stories: /\[HU↔UC\]|\[Entregables\].*Historias/i,
    ux_ui_guide: /\[Spec↔UX\]|\[Entregables\].*UX/i,
  };
  const re = map[step];
  if (!re) return [];
  return all.filter((g) => re.test(g));
}

/** Gaps de conformidad heurística + precisión SDD por paso de oleada (feedback inline en cascada). */
export function buildExistingConformanceGapsMap(
  projectFresh: Project,
  mddContent: string,
  steps: DeliverableWaveStep[],
  complexity: ComplexityLevel = ComplexityLevelEnum.HIGH,
): Map<string, string> {
  const gapsMap = new Map<string, string>();
  const useLowMedium =
    complexity === ComplexityLevelEnum.LOW || complexity === ComplexityLevelEnum.MEDIUM;
  const source = projectAsDeliverableSource(projectFresh);

  for (const step of steps) {
    if (step === "ui_screens_sync" || step === "design_screens_render") continue;
    const stepKey = step as string;

    if (useLowMedium) {
      const lmGaps = lowMediumGapsForCascadeStep(complexity, stepKey, source);
      const combined = formatGapsForStep(lmGaps);
      if (combined) gapsMap.set(stepKey, combined);
      continue;
    }

    const precision = precisionGapsForDeliverable(step, mddContent, projectFresh);
    let heuristic: string[] = [];

    if (stepKey === "blueprint") {
      const bp = projectFresh?.blueprintContent ?? "";
      if (bp.trim().length > 80) {
        const entityCheck = checkBlueprintDataModelVsMdd(mddContent, bp);
        const sectionCheck = checkBlueprintSectionHeaders(bp);
        const selfCheck = checkBlueprintSelfContained(bp);
        heuristic = entityCheck.gaps.concat(sectionCheck.gaps, selfCheck.gaps);
      }
    } else if (stepKey === "api_contracts") {
      const api = projectFresh?.apiContractsContent ?? "";
      if (api.trim().length > 80) {
        const apiCheck = checkApiVsMdd(mddContent, api);
        heuristic = [...apiCheck.missingInApi, ...apiCheck.extraInApi];
      }
    } else if (stepKey === "logic_flows") {
      const lf = projectFresh?.logicFlowsContent ?? "";
      if (lf.trim().length > 80) {
        heuristic = checkLogicFlowsVsMdd(mddContent, lf).gaps;
      }
    } else if (stepKey === "infra") {
      const infra = projectFresh?.infraContent ?? "";
      if (infra.trim().length > 80) {
        heuristic = checkInfraVsMdd(mddContent, infra).gaps;
      }
    } else if (
      stepKey === "architecture" ||
      stepKey === "tasks" ||
      stepKey === "use_cases" ||
      stepKey === "spec" ||
      stepKey === "user_stories"
    ) {
      heuristic = [];
    }

    const combined = formatGapsForStep([...heuristic, ...precision]);
    if (combined) gapsMap.set(stepKey, combined);
  }
  return gapsMap;
}
