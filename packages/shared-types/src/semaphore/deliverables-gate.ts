import type { SemaphoreProfile } from "./completeness-phase.js";
import type { DeliverablesGateRule, MddSemaphoreVerdict } from "./verdict.schema.js";

export type DeliverablesGateInput = {
  profile: SemaphoreProfile;
  verdict: Pick<MddSemaphoreVerdict, "status" | "reasons">;
  hasSpec: boolean;
  hasBootstrap: boolean;
  legacyHasDoc: boolean;
  designFirstGateOk: boolean;
};

export type DeliverablesGateResult = {
  allowed: boolean;
  rule: DeliverablesGateRule;
  reasons: string[];
};

function ruleForProfile(profile: SemaphoreProfile): DeliverablesGateRule {
  if (profile === "HIGH") return "high";
  if (profile === "DESIGN_FIRST") return "design_first";
  if (profile === "LEGACY") return "legacy";
  return "low_medium";
}

/**
 * Regla pura de puerta de entregables (RF-14). No consulta flags ni Prisma.
 */
export function evaluateDeliverablesGate(input: DeliverablesGateInput): DeliverablesGateResult {
  const rule = ruleForProfile(input.profile);
  const reasons: string[] = [];

  if (input.profile === "HIGH") {
    if (input.verdict.status !== "green") {
      reasons.push("Se requiere semáforo verde para generar entregables en proyectos HIGH.");
    }
    if (!input.hasSpec) {
      reasons.push("falta Spec");
    }
    const allowed = input.verdict.status === "green" && input.hasSpec;
    return { allowed, rule, reasons };
  }

  if (input.profile === "LOW" || input.profile === "MEDIUM") {
    const bootstrap = input.hasBootstrap;
    const greenWithSpec = input.verdict.status === "green" && input.hasSpec;
    const allowed = bootstrap || greenWithSpec;
    if (!allowed) {
      if (!bootstrap) reasons.push("Se requiere DBGA/MDD de arranque o semáforo verde con Spec.");
    }
    return { allowed, rule, reasons };
  }

  if (input.profile === "DESIGN_FIRST") {
    const allowed = input.designFirstGateOk;
    if (!allowed) reasons.push("Puerta Design-First no satisfecha.");
    return { allowed, rule, reasons };
  }

  // LEGACY
  const allowed = input.legacyHasDoc;
  if (!allowed) reasons.push("Se requiere MDD o codebaseDoc.");
  return { allowed, rule, reasons };
}
