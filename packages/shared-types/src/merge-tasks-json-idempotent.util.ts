import type { StoredTasksJsonV2 } from "./hydrate-tasks-from-ariadne-pack.util.js";

function readTaskId(task: Record<string, unknown>): string {
  return String(task.id ?? "").trim();
}

function readTaskStatus(task: Record<string, unknown>): string {
  return String(task.status ?? "pending").toLowerCase();
}

function readGeneratedAtMs(tasksJson: unknown): number | null {
  if (tasksJson == null || typeof tasksJson !== "object") return null;
  const raw = (tasksJson as Record<string, unknown>).generatedAt;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Idempotent merge for re-import: merge by task id; Ariadne wins when existing status is pending.
 * Replaces wholesale when forceRefresh or incoming generatedAt is newer.
 */
export function mergeTasksJsonIdempotent(
  existing: StoredTasksJsonV2 | null | undefined,
  incoming: StoredTasksJsonV2,
  options?: {
    forceRefresh?: boolean;
    incomingGeneratedAt?: string | null;
    existingGeneratedAt?: string | null;
  },
): StoredTasksJsonV2 {
  if (options?.forceRefresh) return incoming;
  if (!existing?.tasks?.length) return incoming;

  const existingMs =
    options?.existingGeneratedAt != null
      ? Date.parse(options.existingGeneratedAt)
      : readGeneratedAtMs(existing);
  const incomingMs =
    options?.incomingGeneratedAt != null
      ? Date.parse(options.incomingGeneratedAt)
      : readGeneratedAtMs(incoming);

  if (
    incomingMs != null &&
    Number.isFinite(incomingMs) &&
    (existingMs == null || !Number.isFinite(existingMs) || incomingMs > existingMs)
  ) {
    return incoming;
  }

  const merged = new Map<string, Record<string, unknown>>();
  for (const raw of existing.tasks) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = readTaskId(t);
    if (id) merged.set(id, t);
  }

  for (const raw of incoming.tasks) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = readTaskId(t);
    if (!id) continue;
    const prev = merged.get(id);
    if (!prev) {
      merged.set(id, t);
      continue;
    }
    const prevStatus = readTaskStatus(prev);
    if (prevStatus === "pending" || prevStatus === "") {
      merged.set(id, t);
    }
  }

  return {
    ...incoming,
    tasks: [...merged.values()],
  };
}
