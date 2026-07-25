/**
 * @fileoverview Definición de fases del pipeline MDD de alta complejidad.
 */

/** Fases del pipeline MDD HIGH mostradas en UI (evita acumular decenas de micro-pasos). */
export type MddHighPipelinePhase = {
  index: number;
  total: number;
  label: string;
};

const HIGH_PIPELINE_PHASES: ReadonlyArray<{ label: string; nodes: readonly string[] }> = [
  { label: "Arquitectura y stack", nodes: ["stack_architect"] },
  {
    label: "Modelo de datos",
    nodes: ["data_model", "architect_critic"],
  },
  { label: "Contratos de API", nodes: ["api_contracts"] },
  {
    label: "Cierre y calidad",
    nodes: [
      "format_after_architect",
      "format_after_redactor",
      "format_sec_int",
      "security_integration",
      "tail_parallel",
      "security",
      "integration",
      "cross_consistency_checker",
      "diagram_injector",
      "prepare_output",
      "auditor",
      "graph_populator",
      "section5",
    ],
  },
] as const;

const TOTAL = HIGH_PIPELINE_PHASES.length;

/** Resuelve la fase UI para un nodo LangGraph del pipeline HIGH. */
export function resolveMddHighPipelinePhase(nodeName: string): MddHighPipelinePhase | null {
  for (let i = 0; i < HIGH_PIPELINE_PHASES.length; i++) {
    const phase = HIGH_PIPELINE_PHASES[i]!;
    if (phase.nodes.includes(nodeName)) {
      return { index: i + 1, total: TOTAL, label: phase.label };
    }
  }
  return null;
}

export function formatMddHighPipelinePhaseHeading(phase: MddHighPipelinePhase): string {
  return `Fase ${phase.index}/${phase.total}: ${phase.label}`;
}
