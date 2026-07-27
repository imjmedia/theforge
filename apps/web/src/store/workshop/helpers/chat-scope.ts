import {
  resolveWorkshopChatScope,
  type WorkshopChatScope,
} from "@theforge/shared-types";

const STORAGE_PREFIX = "workshop-chat-scope:";

export function loadWorkshopChatScopePreference(projectId: string): WorkshopChatScope | null {
  if (!projectId.trim()) return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${projectId.trim()}`);
    return raw === "stage" || raw === "global" ? raw : null;
  } catch {
    return null;
  }
}

export function saveWorkshopChatScopePreference(projectId: string, scope: WorkshopChatScope): void {
  if (!projectId.trim()) return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${projectId.trim()}`, scope);
  } catch {
    // ignore quota / private mode
  }
}

export function resolveWorkshopChatScopeForProject(
  projectType: "NEW" | "LEGACY" | undefined,
  stageCount: number,
  projectId: string | null | undefined,
): WorkshopChatScope {
  const saved = projectId ? loadWorkshopChatScopePreference(projectId) : null;
  return resolveWorkshopChatScope(projectType, stageCount, saved);
}
