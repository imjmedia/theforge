import type { ComplexityLevel } from "./project.js";
import type { MddJobProgressStep } from "./mdd-job-progress.js";
import type { MddUpstreamSyncAnalysis } from "./mdd-upstream-sync.js";
import type { SddGraphSyncStatus } from "./sdd-graph-sync.js";
import {
  DELIVERABLE_PROJECT_CONTENT_FIELD,
  DELIVERABLE_WAVES_BY_COMPLEXITY,
  type DeliverableKind,
  type DeliverableWaveStep,
} from "./deliverables-matrix.js";

/** Longitud mínima para considerar un entregable persistido como terminado (alineado con semáforo). */
export const MIN_GENERATION_CONTENT_LEN = 48;

/** Modos de job MDD en cola background (`theforge-mdd`). */
export type MddJobMode = "pipeline" | "manager" | "section" | "legacy" | "upstream-sync";

export const MDD_JOB_MODE_LABELS: Record<MddJobMode, string> = {
  pipeline: "MDD desde benchmark",
  manager: "MDD (Manager)",
  section: "Regeneración de sección MDD",
  legacy: "MDD legacy (codebase)",
  "upstream-sync": "Sincronización MDD desde upstream",
};

export type MddJobSnapshot = {
  jobId: string;
  mode: MddJobMode;
  status: "queued" | "active" | "retrying";
  progressAgent?: string;
  progressMessage?: string;
  progressPhase?: string;
  /** Pasos completados acumulados (no se pierden entre polls). */
  progressSteps?: MddJobProgressStep[];
  /** Paso en ejecución (presente continuo). */
  progressActive?: MddJobProgressStep | null;
  /** Fase agregada pipeline HIGH (p. ej. «Fase 2/4: Modelo de datos»). */
  progressPhaseGroup?: { current: number; total: number; label: string } | null;
};

/** Estado de sincronización incremental MDD ← DBGA/BRD/Benchmark. */
export type MddUpstreamSyncStatus = Pick<
  MddUpstreamSyncAnalysis,
  | "pendingSync"
  | "changedSources"
  | "recommendedSections"
  | "expandedSections"
  | "canSync"
  | "needsFullRegen"
  | "hasBaseline"
> & {
  changes: MddUpstreamSyncAnalysis["changes"];
};

/** Tipos de job de generación soportados por la cola BullMQ / in-memory. */
export type GenerationJobType =
  | "cascade"
  | "cascade-delta"
  | "repair-sdd-gaps"
  | "spec"
  | "blueprint"
  | "api-contracts"
  | "logic-flows"
  | "tasks"
  | "agent-governance"
  | "infra"
  | "architecture"
  | "use-cases"
  | "user-stories"
  | "doc-reconcile-partial"
  | "plugin-artifact"
  | "upstream-propagate";

export const GENERATION_JOB_TYPE_LABELS: Record<GenerationJobType, string> = {
  cascade: "Cascada de entregables",
  "cascade-delta": "Cascada delta (MDD)",
  "repair-sdd-gaps": "Corregir brechas SDD",
  spec: "Spec",
  blueprint: "Blueprint",
  "api-contracts": "Contratos API",
  "logic-flows": "Flujos de lógica",
  tasks: "Tasks",
  "agent-governance": "Gobernanza de agentes",
  infra: "Infraestructura",
  architecture: "Arquitectura",
  "use-cases": "Casos de uso",
  "user-stories": "Historias de usuario",
  "doc-reconcile-partial": "Reconciliación parcial",
  "plugin-artifact": "Artifact de plugin",
  "upstream-propagate": "Propagación upstream (Paso 0/BRD/Benchmark)",
};

/** Mapeo job → entregable (null = especial / no aplica campo único). */
export function generationJobToDeliverableKind(
  type: GenerationJobType,
): DeliverableKind | "cascade" | "doc_reconcile" | null {
  switch (type) {
    case "spec":
      return "spec";
    case "architecture":
      return "architecture";
    case "use-cases":
      return "use_cases";
    case "user-stories":
      return "user_stories";
    case "blueprint":
      return "blueprint";
    case "api-contracts":
      return "api_contracts";
    case "logic-flows":
      return "logic_flows";
    case "tasks":
      return "tasks";
    case "infra":
      return "infra";
    case "agent-governance":
      return "agent_governance";
    case "cascade":
    case "cascade-delta":
    case "repair-sdd-gaps":
      return "cascade";
    case "doc-reconcile-partial":
      return "doc_reconcile";
    default:
      return null;
  }
}

export type GenerationJobSnapshot = {
  jobId: string;
  type: GenerationJobType;
  status: "queued" | "active" | "retrying";
};

export type GenerationGateBlockReason =
  | "project_busy"
  | "mdd_stream"
  | "missing_upstream"
  | "upstream_job";

export type GenerationGateEntry = {
  allowed: boolean;
  reason?: string;
  blockReason?: GenerationGateBlockReason;
};

export type ProjectGenerationStatus = {
  busy: boolean;
  mddStreamActive: boolean;
  mddJobs: MddJobSnapshot[];
  activeJob: GenerationJobSnapshot | null;
  queuedJobs: GenerationJobSnapshot[];
  gates: Partial<Record<GenerationJobType, GenerationGateEntry>>;
  /** Cambios upstream pendientes de reflejar en el MDD (si hay MDD y baseline). */
  mddUpstreamSync?: MddUpstreamSyncStatus | null;
  /** Coherencia §3/§4 del MDD (inferida del markdown de la etapa). */
  sddGraph?: SddGraphSyncStatus | null;
};

/** Resumen ligero para el panel de proyectos (sin gates ni upstream sync). */
export type ProjectGenerationDashboardSummary = {
  busy: boolean;
  label: string | null;
};

export function primaryMddJob(
  status: ProjectGenerationStatus | null | undefined,
): MddJobSnapshot | null {
  if (!status?.mddJobs?.length) return null;
  return status.mddJobs.find((j) => j.status === "active") ?? status.mddJobs[0] ?? null;
}

/** Etiqueta humana del job/generación en curso (Workshop banner y carpetas del dashboard). */
export function activeGenerationLabel(status: ProjectGenerationStatus | null | undefined): string | null {
  if (!status?.busy) return null;
  const mddJob = primaryMddJob(status);
  const mddBusy = status.mddStreamActive || (status.mddJobs?.length ?? 0) > 0;
  if (mddBusy) {
    if (mddJob?.progressActive?.agent) {
      return `${mddJob.progressActive.agent}…`;
    }
    if (mddJob?.progressAgent && mddJob.progressPhase === "active") {
      return `${mddJob.progressAgent}…`;
    }
    if (mddJob) {
      return `${MDD_JOB_MODE_LABELS[mddJob.mode]}…`;
    }
    return "Regenerando MDD…";
  }
  const job = status.activeJob ?? status.queuedJobs[0];
  if (!job) return "Generación en curso…";
  return `Generando ${GENERATION_JOB_TYPE_LABELS[job.type]}…`;
}

function substantial(content: string | null | undefined): boolean {
  return (content ?? "").trim().length >= MIN_GENERATION_CONTENT_LEN;
}

function isDeliverableKind(step: DeliverableWaveStep): step is DeliverableKind {
  return step !== "ui_screens_sync";
}

/** Entregables de oleadas anteriores que deben estar persistidos antes de generar `target`. */
export function deliverableKindsRequiredBefore(
  target: DeliverableKind,
  complexity: ComplexityLevel,
): DeliverableKind[] {
  const waves = DELIVERABLE_WAVES_BY_COMPLEXITY[complexity];
  const required: DeliverableKind[] = [];
  for (const wave of waves) {
    const waveKinds = wave.filter(isDeliverableKind);
    if (waveKinds.includes(target)) break;
    for (const kind of waveKinds) {
      if (!required.includes(kind)) required.push(kind);
    }
  }
  return required;
}

/** Snapshot de entregables listos según campos persistidos del proyecto. */
export function buildDeliverableReadiness(
  project: Record<string, unknown>,
): Record<DeliverableKind, boolean> {
  const out = {} as Record<DeliverableKind, boolean>;
  for (const [kind, field] of Object.entries(DELIVERABLE_PROJECT_CONTENT_FIELD) as Array<
    [DeliverableKind, string | null]
  >) {
    if (!field) {
      out[kind] = false;
      continue;
    }
    const value = project[field];
    out[kind] = substantial(typeof value === "string" ? value : null);
  }
  return out;
}

function upstreamJobBlocks(
  requiredKinds: DeliverableKind[],
  activeJobs: GenerationJobSnapshot[],
): GenerationGateEntry | null {
  for (const job of activeJobs) {
    const jobKind = generationJobToDeliverableKind(job.type);
    if (jobKind === "cascade" || jobKind === "doc_reconcile") {
      return {
        allowed: false,
        blockReason: "upstream_job",
        reason: `Hay un job en curso (${GENERATION_JOB_TYPE_LABELS[job.type]}). Espera a que termine al 100 %.`,
      };
    }
    if (jobKind && requiredKinds.includes(jobKind)) {
      return {
        allowed: false,
        blockReason: "upstream_job",
        reason: `${GENERATION_JOB_TYPE_LABELS[job.type]} está en cola o ejecutándose; no puedes generar downstream hasta que termine.`,
      };
    }
    if (jobKind === "mdd_canonical" as never) {
      continue;
    }
  }
  return null;
}

function missingUpstreamMessage(kind: DeliverableKind): string {
  return `Falta el entregable upstream «${kind}» persistido y completo.`;
}

/** Evalúa si se puede encolar `requestedType` respetando orden de oleadas y jobs activos. */
export function evaluateGenerationGate(params: {
  complexity: ComplexityLevel;
  contentReady: Record<DeliverableKind, boolean>;
  mddStreamActive: boolean;
  activeJobs: GenerationJobSnapshot[];
  requestedType: GenerationJobType;
}): GenerationGateEntry {
  const { complexity, contentReady, mddStreamActive, activeJobs, requestedType } = params;

  if (mddStreamActive) {
    return {
      allowed: false,
      blockReason: "mdd_stream",
      reason: "Hay una generación o regeneración de MDD en curso. Espera a que termine.",
    };
  }

  if (activeJobs.some((j) => j.type === "cascade" || j.type === "cascade-delta" || j.type === "repair-sdd-gaps")) {
    return {
      allowed: false,
      blockReason: "project_busy",
      reason: "La cascada o reparación de brechas SDD está en curso. No encoles otra generación.",
    };
  }

  const otherJobs = activeJobs.filter((j) => j.type !== requestedType);
  if (otherJobs.length > 0) {
    const labels = otherJobs.map((j) => GENERATION_JOB_TYPE_LABELS[j.type]).join(", ");
    return {
      allowed: false,
      blockReason: "project_busy",
      reason: `Ya hay generación en curso (${labels}). Solo un job por proyecto a la vez.`,
    };
  }

  const targetKind = generationJobToDeliverableKind(requestedType);
  if (targetKind === "cascade") {
    if (complexity === "HIGH" && !contentReady.mdd_canonical) {
      return {
        allowed: false,
        blockReason: "missing_upstream",
        reason: "La cascada HIGH requiere MDD persistido y completo antes de continuar.",
      };
    }
    const jobBlock = upstreamJobBlocks([], activeJobs);
    if (jobBlock) return jobBlock;
    return { allowed: true };
  }

  if (targetKind === "doc_reconcile") {
    return { allowed: otherJobs.length === 0 };
  }

  if (!targetKind) {
    return { allowed: true };
  }

  const required = deliverableKindsRequiredBefore(targetKind, complexity);
  const jobBlock = upstreamJobBlocks(required, activeJobs);
  if (jobBlock) return jobBlock;

  for (const kind of required) {
    if (!contentReady[kind]) {
      return {
        allowed: false,
        blockReason: "missing_upstream",
        reason: missingUpstreamMessage(kind),
      };
    }
  }

  return { allowed: true };
}

/** Gates para todos los tipos encolables (UI Workshop). */
export function buildGenerationGates(params: {
  complexity: ComplexityLevel;
  contentReady: Record<DeliverableKind, boolean>;
  mddStreamActive: boolean;
  activeJobs: GenerationJobSnapshot[];
}): Partial<Record<GenerationJobType, GenerationGateEntry>> {
  const types: GenerationJobType[] = [
    "cascade",
    "cascade-delta",
    "repair-sdd-gaps",
    "spec",
    "architecture",
    "use-cases",
    "user-stories",
    "blueprint",
    "api-contracts",
    "logic-flows",
    "tasks",
    "infra",
    "agent-governance",
    "plugin-artifact",
  ];
  const gates: Partial<Record<GenerationJobType, GenerationGateEntry>> = {};
  for (const type of types) {
    gates[type] = evaluateGenerationGate({ ...params, requestedType: type });
  }
  return gates;
}
