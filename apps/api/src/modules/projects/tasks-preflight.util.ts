/**
 * Pre-flight checks antes de generar Tasks (sin LLM + gates upstream).
 */

import {
  CASCADE_ACCURACY_THRESHOLD,
  TASKS_PREFLIGHT_DOC_ACCURACY_BLOCK_THRESHOLD,
  type DomainInventory,
  detectWebSurfaces,
} from "@theforge/shared-types";
import { evaluateMddDeliveryGatePrepared } from "../ai-analysis/utils/mdd-delivery-gate-guard.util.js";
import { computeDocAccuracy } from "../engine/cascade-accuracy.util.js";
import {
  deriveTasksUpstreamActions,
  formatTasksUpstreamHints,
  prepareSpecMarkdownForTasks,
} from "./tasks-upstream-prep.util.js";

export type TasksPreflightResult = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  upstreamHints?: string[];
  docAccuracyScore?: number;
};

export function runTasksPreflight(params: {
  mddMarkdown: string;
  blueprintMarkdown?: string | null;
  specMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  hasUxTeam?: boolean;
  uiScreensMarkdown?: string | null;
}): TasksPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasWebSurfaces = detectWebSurfaces(params.mddMarkdown, params.blueprintMarkdown);
  const uiScreensRequired = hasWebSurfaces || params.hasUxTeam === true;

  const mdd = (params.mddMarkdown ?? "").trim();
  if (mdd.length < 200) {
    blockers.push("MDD insuficiente (< 200 caracteres). Completa la constitución antes de Tasks.");
  }
  if (!/##\s*1[\.\s]/i.test(mdd) && !/##\s*2[\.\s]/i.test(mdd)) {
    warnings.push("MDD sin secciones §1/§2 reconocibles; la cobertura Tasks puede ser incompleta.");
  }

  const blueprint = (params.blueprintMarkdown ?? "").trim();
  if (blueprint.length < 80) {
    warnings.push("Blueprint vacío o muy corto; Tasks dependerá casi solo del MDD.");
  }

  const spec = (params.specMarkdown ?? "").trim();
  if (spec.length < 80) {
    warnings.push("Spec vacío; trazabilidad Story: puede quedar genérica.");
  }

  const api = (params.apiContractsMarkdown ?? "").trim();
  if (api.length < 80 && /##\s*4[\.\s]/i.test(mdd)) {
    warnings.push("MDD describe §4 API pero api-contracts está vacío; revisa coherencia upstream.");
  }

  if (uiScreensRequired && (params.uiScreensMarkdown ?? "").trim().length < 80) {
    warnings.push(
      hasWebSurfaces
        ? "Superficie web declarada pero sin pantallas; Frontend tasks serán heurísticas hasta sync W2b."
        : "Proyecto con UX team pero sin pantallas MCP; Frontend tasks serán heurísticas.",
    );
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  };
}

function evaluateDocAccuracyForTasksPreflight(params: {
  mddMarkdown: string;
  blueprintMarkdown?: string | null;
  specMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  logicFlowsMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  inventory?: DomainInventory | null;
  hasUxTeam?: boolean;
}): ReturnType<typeof computeDocAccuracy> {
  const specPrep = prepareSpecMarkdownForTasks(params.specMarkdown);
  const uiScreensRequired =
    detectWebSurfaces(params.mddMarkdown, params.blueprintMarkdown) ||
    params.hasUxTeam === true;
  return computeDocAccuracy({
    mddMarkdown: params.mddMarkdown,
    specMarkdown: specPrep.normalized || params.specMarkdown,
    apiContractsMarkdown: params.apiContractsMarkdown,
    logicFlowsMarkdown: params.logicFlowsMarkdown,
    uiScreensMarkdown: params.uiScreensMarkdown,
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    inventory: params.inventory ?? undefined,
    uiScreensRequired,
  });
}

function applyDocAccuracyPreflightGates(
  docAcc: ReturnType<typeof computeDocAccuracy>,
  params: {
    acknowledgeGaps?: boolean;
    specMarkdown?: string | null;
    apiContractsMarkdown?: string | null;
    logicFlowsMarkdown?: string | null;
    uiScreensMarkdown?: string | null;
    hasUxTeam?: boolean;
    mddMarkdown: string;
    blueprintMarkdown?: string | null;
  },
  blockers: string[],
  warnings: string[],
): { upstreamHints: string[]; docAccuracyScore: number } {
  const mddHasApiSection = /##\s*4[\.\s]/i.test(params.mddMarkdown);
  const upstreamActions = deriveTasksUpstreamActions(docAcc, {
    hasUxTeam: params.hasUxTeam,
    mddMarkdown: params.mddMarkdown,
    blueprintMarkdown: params.blueprintMarkdown,
    specMarkdown: params.specMarkdown,
    apiContractsMarkdown: params.apiContractsMarkdown,
    logicFlowsMarkdown: params.logicFlowsMarkdown,
    uiScreensMarkdown: params.uiScreensMarkdown,
    mddHasApiSection,
  });
  const upstreamHints = formatTasksUpstreamHints(upstreamActions);

  const authSkewBlockers = docAcc.blockers.filter((b) => /solo auth|auth-only|domain-auth/i.test(b));
  for (const b of authSkewBlockers) {
    blockers.push(`MDD delivery gate: ${b}`);
  }

  const score = docAcc.score;
  const minBlockScore = params.acknowledgeGaps
    ? Math.min(TASKS_PREFLIGHT_DOC_ACCURACY_BLOCK_THRESHOLD, 50)
    : TASKS_PREFLIGHT_DOC_ACCURACY_BLOCK_THRESHOLD;

  if (score < minBlockScore) {
    const hint = upstreamHints.slice(0, 3).join("; ") || docAcc.components.flatMap((c) => c.gaps).slice(0, 3).join("; ");
    blockers.push(
      `DocAccuracy upstream ${score}/${CASCADE_ACCURACY_THRESHOLD}${hint ? `: ${hint}` : ""}`,
    );
  } else if (score < CASCADE_ACCURACY_THRESHOLD) {
    const hint = upstreamHints.slice(0, 4).join("; ");
    warnings.push(
      `DocAccuracy upstream ${score}/${CASCADE_ACCURACY_THRESHOLD} (calidad media; Tasks se generará con advertencias).` +
        (hint ? ` Sugerido: ${hint}` : ""),
    );
  }

  return { upstreamHints, docAccuracyScore: score };
}

export async function runTasksPreflightStrict(params: {
  mddMarkdown: string;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  blueprintMarkdown?: string | null;
  specMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  hasUxTeam?: boolean;
  uiScreensMarkdown?: string | null;
  logicFlowsMarkdown?: string | null;
  inventory?: DomainInventory | null;
  /** Legacy AS-IS / ingeniería inversa: relaja gate MDD y Spec/Blueprint obligatorios. */
  legacyBaselineStage?: boolean;
  /** Cascada/Workshop: relaja gate MDD delivery y umbral bajo de DocAccuracy. */
  acknowledgeGaps?: boolean;
}): Promise<TasksPreflightResult> {
  const base = runTasksPreflight(params);
  const blockers = [...base.blockers];
  const warnings = [...base.warnings];
  let upstreamHints: string[] | undefined;
  let docAccuracyScore: number | undefined;

  const spec = (params.specMarkdown ?? "").trim();
  const blueprint = (params.blueprintMarkdown ?? "").trim();
  const api = (params.apiContractsMarkdown ?? "").trim();
  const legacy = params.legacyBaselineStage === true;
  const acknowledgeGaps = params.acknowledgeGaps === true;

  if (!legacy) {
    const gate = await evaluateMddDeliveryGatePrepared(params.mddMarkdown, {
      brdMarkdown: params.brdMarkdown,
      dbgaMarkdown: params.dbgaMarkdown,
    });
    if (!gate.ok) {
      const gateMessages =
        gate.blockers.length > 0
          ? gate.blockers.map((b) => `MDD delivery gate: ${b}`)
          : [`MDD delivery gate: score ${gate.score}/100 insuficiente para Tasks.`];
      if (acknowledgeGaps) {
        warnings.push(...gateMessages);
      } else {
        blockers.push(...gateMessages);
      }
    }
    for (const w of gate.warnings) warnings.push(`MDD gate: ${w}`);

    if (spec.length < 80) {
      blockers.push("Spec vacío: genera Spec antes de Tasks.");
    }
    if (blueprint.length < 80) {
      blockers.push("Blueprint vacío: genera Blueprint antes de Tasks.");
    }
  }

  if (api.length < 80 && /##\s*4[\.\s]/i.test(params.mddMarkdown)) {
    if (legacy) {
      warnings.push("MDD §4 sin api-contracts persistidos (legacy baseline).");
    } else {
      blockers.push("MDD describe §4 API pero api-contracts está vacío.");
    }
  }

  if (!legacy && spec.length >= 80) {
    const docAcc = evaluateDocAccuracyForTasksPreflight(params);
    const applied = applyDocAccuracyPreflightGates(
      docAcc,
      {
        acknowledgeGaps,
        specMarkdown: params.specMarkdown,
        apiContractsMarkdown: params.apiContractsMarkdown,
        logicFlowsMarkdown: params.logicFlowsMarkdown,
        uiScreensMarkdown: params.uiScreensMarkdown,
        hasUxTeam: params.hasUxTeam,
        mddMarkdown: params.mddMarkdown,
        blueprintMarkdown: params.blueprintMarkdown,
      },
      blockers,
      warnings,
    );
    upstreamHints = applied.upstreamHints;
    docAccuracyScore = applied.docAccuracyScore;
  }

  if (legacy) {
    warnings.push("Modo legacy baseline: pre-flight MDD delivery gate y Spec/Blueprint relajados.");
  }

  if (acknowledgeGaps) {
    warnings.push("Modo acknowledgeGaps: gate MDD y DocAccuracy bajo relajados para Tasks.");
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    upstreamHints,
    docAccuracyScore,
  };
}
