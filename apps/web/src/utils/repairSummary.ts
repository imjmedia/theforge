/**
 * @module repairSummary
 * Resumen de «Corregir auto/LLM» (`result.repair` del job repair-sdd-gaps):
 * normaliza el payload del API y lo formatea como una línea en español.
 */

/** Motivos de parada del bucle de convergencia (espejo del API). */
export type RepairStoppedReason = "converged" | "human_only" | "max_iterations" | "budget" | "no_mdd";

/** Resumen de la reparación tal como lo devuelve el API. */
export type RepairSummary = {
  fixed: string[];
  remaining: { auto: number; llm: number; human: number };
  errors: Array<{ step: string; message: string }>;
  stoppedReason: RepairStoppedReason;
};

const STEP_LABELS: Record<string, string> = {
  blueprint: "Blueprint",
  api_contracts: "API",
  logic_flows: "Flujos",
  infra: "Infra",
  architecture: "Arquitectura",
  tasks: "Tasks",
  spec: "Spec",
  use_cases: "Casos de uso",
  user_stories: "Historias",
  ux_ui_guide: "Guía UX",
};

const STOPPED_REASONS: readonly RepairStoppedReason[] = [
  "converged",
  "human_only",
  "max_iterations",
  "budget",
  "no_mdd",
];

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Extrae `repair` del `result` de un job; `null` si falta o no tiene la forma esperada
 * (jobs antiguos o de otro tipo).
 */
export function parseRepairSummary(result: unknown): RepairSummary | null {
  if (!result || typeof result !== "object") return null;
  const repair = (result as { repair?: unknown }).repair;
  if (!repair || typeof repair !== "object") return null;
  const r = repair as Record<string, unknown>;
  const rem = (r.remaining ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(r.errors)
    ? r.errors
        .filter((e): e is { step: string; message: string } => !!e && typeof (e as { step?: unknown }).step === "string")
        .map((e) => ({ step: e.step, message: String(e.message ?? "") }))
    : [];
  return {
    fixed: Array.isArray(r.fixed) ? r.fixed.filter((g): g is string => typeof g === "string") : [],
    remaining: { auto: num(rem.auto), llm: num(rem.llm), human: num(rem.human) },
    errors,
    stoppedReason: STOPPED_REASONS.includes(r.stoppedReason as RepairStoppedReason)
      ? (r.stoppedReason as RepairStoppedReason)
      : "converged",
  };
}

/** Línea de resumen, p. ej. «Corregidas 2 · Quedan 1 LLM, 2 humanas (requieren editar el BRD) · 1 error al regenerar Flujos». */
export function formatRepairSummary(summary: RepairSummary): string {
  if (summary.stoppedReason === "no_mdd") return "No se pudo reparar: falta el MDD";
  const parts: string[] = [];
  const fixed = summary.fixed.length;
  parts.push(
    fixed === 0 ? "No se corrigió ninguna brecha" : fixed === 1 ? "Corregida 1" : `Corregidas ${fixed}`,
  );

  const { auto, llm, human } = summary.remaining;
  const rest: string[] = [];
  if (auto > 0) rest.push(`${auto} auto`);
  if (llm > 0) rest.push(`${llm} LLM`);
  if (human > 0) rest.push(`${human} ${human === 1 ? "humana" : "humanas"} (requieren editar el BRD)`);
  parts.push(rest.length > 0 ? `Quedan ${rest.join(", ")}` : "Sin brechas pendientes");

  const nErr = summary.errors.length;
  if (nErr > 0) {
    const steps = [...new Set(summary.errors.map((e) => STEP_LABELS[e.step] ?? e.step))].join(", ");
    parts.push(`${nErr} ${nErr === 1 ? "error" : "errores"} al regenerar ${steps}`);
  }
  if (summary.stoppedReason === "budget") parts.push("límite de reintentos alcanzado");
  return parts.join(" · ");
}
