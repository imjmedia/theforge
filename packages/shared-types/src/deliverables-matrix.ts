import type { ComplexityLevel } from "./project.js";
import { detectWebSurfaces } from "./web-surfaces.util.js";

/** Claves de entregables para despacho dinámico (backend). */
export type DeliverableKind =
  | "mdd_canonical"
  | "spec"
  | "architecture"
  | "use_cases"
  | "blueprint"
  | "api_contracts"
  | "logic_flows"
  | "ux_ui_guide"
  | "user_stories"
  | "agent_governance"
  | "tasks"
  | "infra";

/** Etiquetas legibles para progreso de cascada y UI Workshop. */
export const DELIVERABLE_STEP_LABELS: Record<DeliverableKind, string> = {
  mdd_canonical: "MDD Canonical",
  spec: "Spec",
  architecture: "Arquitectura",
  use_cases: "Casos de Uso",
  blueprint: "Blueprint",
  api_contracts: "Contratos API",
  logic_flows: "Flujos de Lógica",
  ux_ui_guide: "Guía UX/UI",
  user_stories: "Historias de Usuario",
  agent_governance: "Gobernanza de agentes",
  tasks: "Tareas",
  infra: "Infraestructura",
};

/** Campo `Project` donde persiste cada entregable (null = no aplica). */
export const DELIVERABLE_PROJECT_CONTENT_FIELD: Record<DeliverableKind, string | null> = {
  mdd_canonical: "mddContent",
  spec: "specContent",
  architecture: "architectureContent",
  use_cases: "useCasesContent",
  blueprint: "blueprintContent",
  api_contracts: "apiContractsContent",
  logic_flows: "logicFlowsContent",
  ux_ui_guide: "uxUiGuideContent",
  user_stories: "userStoriesContent",
  agent_governance: "agentGovernanceContent",
  tasks: "tasksContent",
  infra: "infraContent",
};

/** Labels de pasos de cascada según complejidad (orden de `DELIVERABLES_BY_COMPLEXITY`). */
export function deliverableStepLabelsForComplexity(
  complexity: ComplexityLevel,
): string[] {
  return DELIVERABLES_BY_COMPLEXITY[complexity].map((k) => DELIVERABLE_STEP_LABELS[k]);
}

/**
 * Entregables legacy en cascada bulk: omite solo `mdd_canonical` si ya hay MDD
 * (regeneración manual vía «Regenerar MDD»). El resto se genera o regenera siempre.
 */
export function planLegacyDeliverablesToGenerate(params: {
  complexity: ComplexityLevel;
  hasMddContent: boolean;
  /** Kinds to omit from the cascade (e.g. tasks pre-imported from integration handoff). */
  skipKinds?: readonly DeliverableKind[];
}): DeliverableKind[] {
  const skip = new Set(params.skipKinds ?? []);
  return DELIVERABLES_BY_COMPLEXITY[params.complexity].filter((kind) => {
    if (kind === "mdd_canonical") return !params.hasMddContent;
    if (skip.has(kind)) return false;
    return true;
  });
}

export function deliverableStepLabelsForKinds(kinds: readonly DeliverableKind[]): string[] {
  return kinds.map((k) => DELIVERABLE_STEP_LABELS[k]);
}

/**
 * Matriz por complejidad: orden de ejecución. `mdd_canonical` no invoca LLM (el MDD vive en Stage/chat).
 */
export const DELIVERABLES_BY_COMPLEXITY: Record<ComplexityLevel, DeliverableKind[]> = {
  LOW: ["user_stories", "tasks", "agent_governance"],
  MEDIUM: ["spec", "api_contracts", "ux_ui_guide", "tasks", "agent_governance"],
  HIGH: [
    "mdd_canonical",
    "blueprint",
    "spec",
    "architecture",
    "use_cases",
    "user_stories",
    "ux_ui_guide",
    "api_contracts",
    "logic_flows",
    "tasks",
    "agent_governance",
    "infra",
  ],
};

/** Sync pantallas MCP en oleada W2b (no es DeliverableKind). */
export const DELIVERABLE_UI_SCREENS_SYNC_STEP = "ui_screens_sync" as const;

/** Post-pase W4: reintentos de precisión tras oleadas principales (no es DeliverableKind). */
export const CASCADE_POST_PASS_STEP = "post_pass_w4" as const;
export const CASCADE_POST_PASS_STEP_LABEL = "Refinando precisión (W4)";

/** Pasos de cascada: entregables LLM + sync de pantallas (no es DeliverableKind). */
export type DeliverableWaveStep = DeliverableKind | typeof DELIVERABLE_UI_SCREENS_SYNC_STEP;

/**
 * Oleadas secuenciales por complejidad. Cada oleada puede ejecutar pasos en paralelo;
 * entre oleadas se refresca el proyecto desde DB antes de continuar.
 */
export const DELIVERABLE_WAVES_BY_COMPLEXITY: Record<ComplexityLevel, DeliverableWaveStep[][]> = {
  LOW: [["user_stories"], ["tasks", "agent_governance"]],
  MEDIUM: [["spec", "api_contracts", "ux_ui_guide"], ["tasks", "agent_governance"]],
  HIGH: [
    ["mdd_canonical"],
    ["spec", "architecture"],
    ["use_cases", "user_stories", "api_contracts", "logic_flows", "ux_ui_guide", "blueprint"],
    ["ui_screens_sync"],
    ["tasks", "infra", "agent_governance"],
  ],
};

export type DeliverableWaveOptions = {
  /** When true, MEDIUM complexity includes W2b ui_screens_sync before tasks. */
  hasWebSurfaces?: boolean;
  mddMarkdown?: string | null;
  blueprintMarkdown?: string | null;
};

/** Resolves oleadas; MEDIUM + web surface injects ui_screens_sync before tasks. */
export function resolveDeliverableWaves(
  complexity: ComplexityLevel,
  opts?: DeliverableWaveOptions,
): DeliverableWaveStep[][] {
  const base = DELIVERABLE_WAVES_BY_COMPLEXITY[complexity].map((w) => [...w]);
  const hasWeb =
    opts?.hasWebSurfaces ??
    detectWebSurfaces(opts?.mddMarkdown, opts?.blueprintMarkdown);
  if (complexity === "MEDIUM" && hasWeb) {
    const tasksIdx = base.findIndex((w) => w.includes("tasks"));
    const alreadyHas = base.some((w) => w.includes(DELIVERABLE_UI_SCREENS_SYNC_STEP));
    if (tasksIdx >= 0 && !alreadyHas) {
      base.splice(tasksIdx, 0, [DELIVERABLE_UI_SCREENS_SYNC_STEP]);
    }
  }
  return base;
}

/** Aplanado de oleadas (orden de progreso UI). */
export function flattenDeliverableWaves(
  complexity: ComplexityLevel,
  opts?: DeliverableWaveOptions,
): DeliverableWaveStep[] {
  return resolveDeliverableWaves(complexity, opts).flat();
}

export function deliverableWaveStepLabel(
  step: DeliverableWaveStep | typeof CASCADE_POST_PASS_STEP,
): string {
  if (step === DELIVERABLE_UI_SCREENS_SYNC_STEP) return "Pantallas (UI MCP)";
  if (step === CASCADE_POST_PASS_STEP) return CASCADE_POST_PASS_STEP_LABEL;
  return DELIVERABLE_STEP_LABELS[step];
}
