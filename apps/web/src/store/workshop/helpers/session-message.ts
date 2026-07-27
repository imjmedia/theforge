import type { ChatImagePart, WorkshopChatScope } from "@theforge/shared-types";
import { filterChatForWorkshopView } from "@theforge/shared-types";

export function pickEvaluatorCritique(data: Record<string, unknown>): string | null {
  const c = data.evaluatorCritique;
  return typeof c === "string" && c.trim().length > 0 ? c.trim() : null;
}

/** Body JSON para `POST /sessions/:id/messages` con `stageId` opcional. */
export function sessionMessageBody(
  base: { role: "user" | "assistant"; content: string; tab?: string; images?: ChatImagePart[] },
  stageId: string | null | undefined,
): string {
  return JSON.stringify({
    ...base,
    ...(stageId?.trim() ? { stageId: stageId.trim() } : {}),
  });
}

export function lastMddUserMessageContent(
  log: { role: string; content: string; tab?: string }[] | undefined,
): string | null {
  if (!log?.length) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const m = log[i];
    if (!m) continue;
    if (m.role === "user" && (m.tab ?? "mdd") === "mdd") return m.content;
  }
  return null;
}

/** Mensajes visibles / contexto según tab y alcance por etapa. */
export function filterWorkshopSessionMessages(
  log: { role: string; content: string; tab?: string; stageId?: string }[] | undefined,
  tab: string,
  stageId: string | null | undefined,
  chatScope: WorkshopChatScope,
) {
  return filterChatForWorkshopView((log ?? []) as import("@theforge/shared-types").ChatMessage[], tab, {
    stageId,
    scope: chatScope,
  });
}
