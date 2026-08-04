import {
  buildTasksPreviewMarkdownFromTasksJson,
  hasValidTasksJson,
  resolveTasksForConsume,
} from "@theforge/shared-types";

/** Preview Tasks: prefer SSOT tasksJson (Ariadne seed) sobre checklist handoff markdown. */
export function resolveWorkshopTasksPreviewContent(input: {
  tasksContent?: string | null;
  tasksJson?: unknown;
  stageTasksJson?: unknown;
}): string | null {
  const tasksJson = input.stageTasksJson ?? input.tasksJson;
  const resolved = resolveTasksForConsume({
    tasksContent: input.tasksContent ?? null,
    tasksJson,
  });
  if (resolved.hasTasksJson && resolved.tasksJson) {
    const fromJson = buildTasksPreviewMarkdownFromTasksJson(resolved.tasksJson).trim();
    if (fromJson.length > 0) return fromJson;
  }
  const md = input.tasksContent?.trim();
  return md && md.length > 0 ? md : null;
}

export function workshopHasHydratedTasksJson(input: {
  tasksJson?: unknown;
  stageTasksJson?: unknown;
}): boolean {
  return hasValidTasksJson(input.stageTasksJson ?? input.tasksJson);
}
