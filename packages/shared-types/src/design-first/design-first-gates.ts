/**
 * Puertas de fase Design-First (I9).
 */
import {
  validateProjectArchitectureGraph,
  type ProjectArchitectureGraph,
} from "../project-architecture-graph.js";
import {
  validateDesignSpecI1,
  validateDesignSpecI2,
  validateDesignSpecI3,
  type DesignSpec,
  type DesignSpecInvariantIssue,
} from "./design-spec.js";

export type DesignFirstPhaseGateIssue = {
  path: string;
  message: string;
};

export type DesignFirstPhaseGateResult = {
  ok: boolean;
  issues: DesignFirstPhaseGateIssue[];
};

export type DesignFirstPhaseGates = {
  phase1: DesignFirstPhaseGateResult;
  phase2: DesignFirstPhaseGateResult;
  phase3: DesignFirstPhaseGateResult;
};

const REMOTE_STATES = ["empty", "error", "loading"] as const;

function mapInvariantIssues(issues: DesignSpecInvariantIssue[]): DesignFirstPhaseGateIssue[] {
  return issues.map((i) => ({
    path: i.path,
    message: `[${i.invariant}] ${i.message}`,
  }));
}

function screenHasDataNeeds(spec: DesignSpec, screenId: string): boolean {
  const entry = spec.dataNeeds.find((d) => d.screenId === screenId);
  if (!entry) return false;
  return entry.components.some((c) => c.needs.length > 0);
}

function statesIncludeRemote(states: readonly string[]): boolean {
  const set = new Set(states.map((s) => s.toLowerCase()));
  return REMOTE_STATES.every((s) => set.has(s));
}

export function evaluatePhase1Gate(spec: DesignSpec): DesignFirstPhaseGateResult {
  const issues: DesignFirstPhaseGateIssue[] = [];

  if (spec.screens.length < 1) {
    issues.push({
      path: "screens",
      message: "Se requiere al menos una pantalla (phase1)",
    });
  }

  issues.push(...mapInvariantIssues(validateDesignSpecI1(spec)));

  for (const screen of spec.screens) {
    const hasComponents = screen.components.length > 0;
    if (!hasComponents && !screen.static) {
      issues.push({
        path: `screens[id=${screen.id}]`,
        message: "La pantalla debe tener al menos un componente o marcarse static: true",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function evaluatePhase2Gate(spec: DesignSpec): DesignFirstPhaseGateResult {
  const issues: DesignFirstPhaseGateIssue[] = [
    ...mapInvariantIssues(validateDesignSpecI2(spec)),
    ...mapInvariantIssues(validateDesignSpecI3(spec)),
  ];

  for (const screen of spec.screens) {
    const hasData = screenHasDataNeeds(spec, screen.id);
    if (!hasData) {
      if (!screen.static) {
        issues.push({
          path: `screens[id=${screen.id}]`,
          message: "Pantalla sin dataNeeds; marque static: true o defina necesidades de datos",
        });
      }
      continue;
    }
    const entry = spec.dataNeeds.find((d) => d.screenId === screen.id)!;
    const states = entry.states.length ? entry.states : screen.states;
    if (!statesIncludeRemote(states)) {
      issues.push({
        path: `dataNeeds[screenId=${screen.id}].states`,
        message: `Pantalla con datos remotos requiere estados ${REMOTE_STATES.join(", ")}`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function evaluatePhase3Gate(input: {
  pag?: ProjectArchitectureGraph | null;
  designSpecHash?: string | null;
  architectureGraphSourceHash?: string | null;
}): DesignFirstPhaseGateResult {
  const issues: DesignFirstPhaseGateIssue[] = [];

  if (!input.pag) {
    issues.push({ path: "pag", message: "No hay PAG compilado" });
    return { ok: false, issues };
  }

  const validation = validateProjectArchitectureGraph(input.pag);
  if (!validation.ok) {
    for (let i = 0; i < validation.errors.length; i++) {
      issues.push({
        path: `pag.validation[${i}]`,
        message: validation.errors[i]!,
      });
    }
  }

  const current = input.designSpecHash?.trim() ?? "";
  const stored = input.architectureGraphSourceHash?.trim() ?? "";
  if (current && stored && current !== stored) {
    issues.push({
      path: "architectureGraphSourceHash",
      message: "Hash de designSpec no coincide con el PAG persistido (stale)",
    });
  }

  return { ok: issues.length === 0, issues };
}

export function evaluateDesignFirstPhaseGates(input: {
  designSpec: DesignSpec;
  pag?: ProjectArchitectureGraph | null;
  designSpecHash?: string | null;
  architectureGraphSourceHash?: string | null;
}): DesignFirstPhaseGates {
  return {
    phase1: evaluatePhase1Gate(input.designSpec),
    phase2: evaluatePhase2Gate(input.designSpec),
    phase3: evaluatePhase3Gate({
      pag: input.pag,
      designSpecHash: input.designSpecHash,
      architectureGraphSourceHash: input.architectureGraphSourceHash,
    }),
  };
}
