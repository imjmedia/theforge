/**
 * Política SSOT de edición en Workshop: qué pestañas admiten persistencia desde chat
 * y cuáles son proyección del MDD (solo regeneración vía cascada).
 */

import type { MddUpstreamSource } from "./mdd-upstream-sync.js";

/** Pestañas editables con chat (persistencia permitida). */
export const WORKSHOP_CHAT_EDITABLE_TABS = [
  "benchmark",
  "phase0",
  "brd",
  "mdd",
  "ux-ui-guide",
] as const;

export type WorkshopChatEditableTab = (typeof WORKSHOP_CHAT_EDITABLE_TABS)[number];

/** Entregables congelados: proyección del MDD — no editar ni persistir desde chat. */
export const WORKSHOP_FROZEN_DELIVERABLE_TABS = [
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
  "adrs",
] as const;

export type WorkshopFrozenDeliverableTab = (typeof WORKSHOP_FROZEN_DELIVERABLE_TABS)[number];

/** Tres niveles upstream que alimentan el MDD (propagación cruzada). */
export const WORKSHOP_UPSTREAM_LEVEL_TABS = ["benchmark", "brd", "phase0"] as const;

export type WorkshopUpstreamLevelTab = (typeof WORKSHOP_UPSTREAM_LEVEL_TABS)[number];

const CHAT_EDITABLE_SET = new Set<string>(WORKSHOP_CHAT_EDITABLE_TABS);
const FROZEN_SET = new Set<string>(WORKSHOP_FROZEN_DELIVERABLE_TABS);
const UPSTREAM_LEVEL_SET = new Set<string>(WORKSHOP_UPSTREAM_LEVEL_TABS);

/** Mapa pestaña Workshop → fuente upstream MDD. */
export const WORKSHOP_TAB_TO_UPSTREAM_SOURCE: Record<WorkshopUpstreamLevelTab, MddUpstreamSource> = {
  benchmark: "dbga",
  brd: "brd",
  phase0: "benchmark",
};

/** Etiquetas UI para niveles upstream. */
export const WORKSHOP_UPSTREAM_LEVEL_LABELS: Record<WorkshopUpstreamLevelTab, string> = {
  benchmark: "Paso 0 / DBGA",
  brd: "BRD",
  phase0: "Benchmark (Deep Research)",
};

/** Impacto inverso: qué pestañas upstream revisar al editar una. */
export const UPSTREAM_IMPACT_MAP: Record<WorkshopUpstreamLevelTab, WorkshopUpstreamLevelTab[]> = {
  benchmark: ["brd", "phase0"],
  brd: ["benchmark", "phase0"],
  phase0: ["benchmark", "brd"],
};

export function isWorkshopChatEditableTab(tab: string | null | undefined): tab is WorkshopChatEditableTab {
  return CHAT_EDITABLE_SET.has((tab ?? "").trim());
}

export function isWorkshopFrozenDeliverableTab(
  tab: string | null | undefined,
): tab is WorkshopFrozenDeliverableTab {
  return FROZEN_SET.has((tab ?? "").trim());
}

export function isWorkshopUpstreamLevelTab(
  tab: string | null | undefined,
): tab is WorkshopUpstreamLevelTab {
  return UPSTREAM_LEVEL_SET.has((tab ?? "").trim());
}

/** true si chat puede persistir edición de documento (edit_document). */
export function canPersistChatDocumentEdit(
  tab: string | null | undefined,
  action: "chat_only" | "edit_document" | "confirm_then_edit",
): boolean {
  const t = (tab ?? "").trim();
  if (action !== "edit_document") return false;
  if (isWorkshopFrozenDeliverableTab(t)) return false;
  return isWorkshopChatEditableTab(t);
}

export function workshopFrozenTabUserMessage(tab: string): string {
  const label =
    tab === "spec"
      ? "Spec"
      : tab === "agent-governance"
        ? "Gobernanza de agentes"
        : tab.replace(/-/g, " ");
  return (
    `**${label}** es proyección del MDD. No se edita desde chat. ` +
    `Regenera desde MDD (cascada) o edita upstream (Paso 0, BRD, Benchmark) y sincroniza.`
  );
}

export function workshopFrozenTabChatSystemNote(tab: string): string {
  return (
    `[Política SSOT — documento congelado]\n` +
    `El panel activo (${tab}) es entregable derivado del MDD. ` +
    `Responde en chat (exploración, preguntas, sugerencias) pero **NO** devuelvas ` +
    `markdown con delimitador ---FIN_*--- ni afirmes que persististe cambios en el panel. ` +
    `Indica que debe editarse el MDD o documentos upstream, o regenerar vía cascada.`
  );
}

/** Marcador en respuesta del asistente cuando ofrece propagación upstream. */
export const UPSTREAM_PROPAGATE_OFFER_MARKER = "[UPSTREAM_PROPAGATE_OFFER]";

export function buildUpstreamPropagateConfirmationPrompt(
  originTab: WorkshopUpstreamLevelTab,
  siblingTabs: WorkshopUpstreamLevelTab[],
): string {
  const originLabel = WORKSHOP_UPSTREAM_LEVEL_LABELS[originTab];
  const targets = siblingTabs.map((t) => WORKSHOP_UPSTREAM_LEVEL_LABELS[t]).join(", ");
  return (
    `\n\n---\n${UPSTREAM_PROPAGATE_OFFER_MARKER}\n` +
    `Cambio aplicado en **${originLabel}**.\n\n` +
    `¿Propagar a **${targets}** y sincronizar secciones afectadas del **MDD**? ` +
    `Responde **sí, propagar** para encolar en segundo plano (no bloquea el Workshop).`
  );
}

const PROPAGATE_CONFIRM_RE =
  /\b(?:s[ií]\s*,?\s*propag(?:ar|a|ue)|propag(?:ar|a|ue)\s+(?:los\s+)?cambios|dale\s*,?\s*propag|confirmo\s+propag)\b/i;

export function looksLikeUpstreamPropagateConfirmation(message: string): boolean {
  return PROPAGATE_CONFIRM_RE.test((message ?? "").trim());
}

export function assistantOfferedUpstreamPropagate(assistantContent: string): boolean {
  return (assistantContent ?? "").includes(UPSTREAM_PROPAGATE_OFFER_MARKER);
}

export type UpstreamPropagatePatchPlan = {
  originTab: WorkshopUpstreamLevelTab;
  originSource: MddUpstreamSource;
  siblingTabs: WorkshopUpstreamLevelTab[];
  siblingSources: MddUpstreamSource[];
  summary: string;
};

export function buildUpstreamPropagatePatchPlan(
  originTab: WorkshopUpstreamLevelTab,
): UpstreamPropagatePatchPlan {
  const siblings = UPSTREAM_IMPACT_MAP[originTab];
  return {
    originTab,
    originSource: WORKSHOP_TAB_TO_UPSTREAM_SOURCE[originTab],
    siblingTabs: siblings,
    siblingSources: siblings.map((t) => WORKSHOP_TAB_TO_UPSTREAM_SOURCE[t]),
    summary: `Origen: ${WORKSHOP_UPSTREAM_LEVEL_LABELS[originTab]} → revisar ${siblings.map((t) => WORKSHOP_UPSTREAM_LEVEL_LABELS[t]).join(", ")} + MDD`,
  };
}
