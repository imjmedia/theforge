import type { ChatMessage } from "@theforge/shared-types";
import {
  UPSTREAM_IMPACT_MAP,
  assistantOfferedUpstreamPropagate,
  buildUpstreamPropagateConfirmationPrompt,
  isWorkshopUpstreamLevelTab,
  looksLikeUpstreamPropagateConfirmation,
  type WorkshopUpstreamLevelTab,
} from "@theforge/shared-types";

export function maybeAppendUpstreamPropagateOffer(
  assistantContent: string,
  tab: string,
  documentPersisted: boolean,
): string {
  if (!documentPersisted || !isWorkshopUpstreamLevelTab(tab)) return assistantContent;
  if (assistantContent.includes("[UPSTREAM_PROPAGATE_OFFER]")) return assistantContent;
  const siblings = UPSTREAM_IMPACT_MAP[tab];
  return `${assistantContent.trim()}${buildUpstreamPropagateConfirmationPrompt(tab, siblings)}`;
}

export function detectUpstreamPropagateConfirmation(
  userMessage: string,
  history: ChatMessage[],
  activeTab: string,
): { confirmed: true; originTab: WorkshopUpstreamLevelTab } | { confirmed: false } {
  if (!looksLikeUpstreamPropagateConfirmation(userMessage)) return { confirmed: false };
  if (!isWorkshopUpstreamLevelTab(activeTab)) return { confirmed: false };

  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "assistant" && m.tab === activeTab && assistantOfferedUpstreamPropagate(m.content ?? "")) {
      return { confirmed: true, originTab: activeTab };
    }
  }
  return { confirmed: false };
}

export function upstreamPropagateQueuedAssistantMessage(
  planSummary: string,
): string {
  return (
    `**Propagación encolada** en segundo plano.\n\n` +
    `${planSummary}\n\n` +
    `Consulta el estado en el panel Semáforo (generación en curso). ` +
    `Los entregables congelados se actualizarán vía cascada tras sincronizar el MDD.`
  );
}
