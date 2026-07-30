import type { AgentProgressItem } from "../utils/agentProgress";

/** Pasos mostrados en Workshop al generar/regenerar gobernanza de agentes. */
export const AGENT_GOVERNANCE_GENERATION_STEPS = [
  "Detectar artefactos / analizar MDD",
  "Generar gobernanza (LLM)",
  "Reconciliar scaffold",
  "Persistir scaffold en proyecto",
] as const;

export function createAgentGovernanceProgressItems(): AgentProgressItem[] {
  return AGENT_GOVERNANCE_GENERATION_STEPS.map((step, index) => ({
    agent: step,
    step,
    message: index === 0 ? "⚡ Generando…" : "⚪ Pendiente",
    status: index === 0 ? ("generando" as const) : undefined,
  }));
}

export function advanceAgentGovernanceProgressItems(
  prev: readonly AgentProgressItem[],
): AgentProgressItem[] {
  const activeIndex = prev.findIndex((p) => p.status === "generando" || p.status === "active");
  if (activeIndex < 0 || activeIndex >= AGENT_GOVERNANCE_GENERATION_STEPS.length - 1) {
    return [...prev];
  }

  const currentStep = AGENT_GOVERNANCE_GENERATION_STEPS[activeIndex]!;
  const nextStep = AGENT_GOVERNANCE_GENERATION_STEPS[activeIndex + 1]!;

  return prev.map((item) => {
    if (item.step === currentStep) {
      return { ...item, message: "✅ Terminado", status: "terminado" as const };
    }
    if (item.step === nextStep) {
      return { ...item, message: "⚡ Generando…", status: "generando" as const };
    }
    return item;
  });
}

export function completeAgentGovernanceProgressItems(): AgentProgressItem[] {
  return AGENT_GOVERNANCE_GENERATION_STEPS.map((step) => ({
    agent: step,
    step,
    message: "✅ Terminado",
    status: "terminado" as const,
  }));
}
