/**
 * @fileoverview Nodo manager — orquesta el pipeline completo de generación MDD.
 */

import type { AuditorGapsState } from "../state/mdd-state.schema.js";

const SECTION_AGENT_MAP: Array<{ pattern: RegExp; agent: string }> = [
  { pattern: /secci[oó]n\s*1|contexto|alcance|constituci|clarifier/i, agent: "clarifier" },
  {
    pattern: /secci[oó]n\s*(2|3|4)|modelo|sql|api|contrato|arquitectura|endpoint|tabla|mermaid|erdiagram|payload/i,
    agent: "software_architect",
  },
  { pattern: /secci[oó]n\s*6|seguridad|auth|mfa|rbac|totp|password/i, agent: "security" },
  { pattern: /secci[oó]n\s*7|infra|docker|despliegue|manifest|kubernetes|ci\/cd/i, agent: "integration" },
  { pattern: /secci[oó]n\s*5|l[oó]gica|edge\s*case/i, agent: "software_architect" },
];

/**
 * Maps structured critical_gaps from the Auditor to graph agent node names.
 */
export function inferAgentsFromCriticalGaps(
  gaps: AuditorGapsState["critical_gaps"],
): string[] {
  const agents = new Set<string>();
  for (const g of gaps) {
    const blob = [...(g.sections ?? []), g.issue, g.fix].join(" ");
    for (const { pattern, agent } of SECTION_AGENT_MAP) {
      if (pattern.test(blob)) agents.add(agent);
    }
  }
  if (agents.size === 0) return ["software_architect"];
  return [...agents];
}

/** Prefer structured gaps; fallback to free-text auditor feedback regex. */
export function resolveCorrectionAgents(
  auditorGaps: AuditorGapsState | null | undefined,
  auditorFeedback: string | undefined,
  inferFromFeedback: (feedback: string) => string[],
): string[] {
  const structured = auditorGaps?.critical_gaps ?? [];
  if (structured.length > 0) return inferAgentsFromCriticalGaps(structured);
  const fb = auditorFeedback?.trim();
  if (fb) return inferFromFeedback(fb);
  return ["software_architect"];
}
