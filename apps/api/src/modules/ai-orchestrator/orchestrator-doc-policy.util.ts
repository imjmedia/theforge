import { isWorkshopFrozenDeliverableTab, canPersistChatDocumentEdit } from "@theforge/shared-types";
import type { WorkshopChatAction } from "../ai/intent-route.types.js";

export function orchestratorTabAllowsDocPersist(
  tab: string,
  intentAction: WorkshopChatAction = "edit_document",
): boolean {
  const t = tab.trim();
  if (isWorkshopFrozenDeliverableTab(t)) return false;
  return canPersistChatDocumentEdit(t, intentAction);
}

export function stripFrozenDeliverableFromDonePayload(
  tab: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!isWorkshopFrozenDeliverableTab(tab)) return payload;
  const frozenKeys = [
    "specContent",
    "blueprintContent",
    "apiContractsContent",
    "logicFlowsContent",
    "tasksContent",
    "infraContent",
    "architectureContent",
    "useCasesContent",
    "userStoriesContent",
    "documentPersisted",
  ];
  const out = { ...payload };
  for (const key of frozenKeys) {
    if (key in out) delete out[key];
  }
  out.documentPersisted = false;
  return out;
}
