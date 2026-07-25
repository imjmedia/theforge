/**
 * @fileoverview Integración de handoff-spec con IntegrationAgent.
 */

/**
 * Manager hook for IntegrationAgent (handoff-spec) delegation.
 *
 * The handoff-spec.md is produced by `IntegrationAgentService` (projects module), invoked via
 * `POST /projects/:id/integration/sync-handoff-spec` or the Workshop "Sincronizar Especificación
 * de Handoff" button. The MDD Manager lives in the ai-analysis module; calling the service
 * directly from here would create a circular module dependency, so the Manager surfaces the
 * action (suggestion) instead of triggering it inline. This keeps the seam prepared without
 * destabilizing the LangGraph routing.
 */

/** True when a user message signals a NEW→LEGACY integration / handoff need. */
export function detectLegacyIntegrationIntent(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /\bnew-?leg\b/i.test(t) ||
    /\bhandoff(?:[-\s]?spec)?\b/i.test(t) ||
    /\bintegraci[oó]n\s+(legacy|brownfield|new|entre\s+repos|cross-?project)\b/i.test(t) ||
    /\b(equipo\s+legacy|requerimientos?\s+para\s+(el\s+)?legacy|especificaci[oó]n\s+de\s+handoff|spec\s+de\s+handoff)\b/i.test(t) ||
    /\bmatriz\s+de\s+trazabilidad\b/i.test(t)
  );
}

export const HANDOFF_SPEC_SUGGESTION =
  "\n\n---\n💡 Detecté una necesidad de integración legacy (handoff NEW→LEGACY). Para generar el desglose técnico (§3 Modelo / §4 API) destinado al equipo Brownfield, pulsa **«Sincronizar Especificación de Handoff»** en la pestaña *Handoff Spec* del Workshop (o `POST /projects/:id/integration/sync-handoff-spec`). El IntegrationAgent organiza y profundiza técnicamente los items NEW-LEG ya registrados — no crea items nuevos.";
