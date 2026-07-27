import type { SddGraphSyncStatus } from "@theforge/shared-types";
import { mddGraphFingerprint } from "@theforge/shared-types";

export type StoredSddGraphContext = {
  lastSyncedAt?: number | null;
  mddFingerprint?: string | null;
};

export function readSddGraphContext(
  shortTermContext: unknown,
): { snapshot: SddGraphSyncStatus | null; context: StoredSddGraphContext | null } {
  if (!shortTermContext || typeof shortTermContext !== "object" || Array.isArray(shortTermContext)) {
    return { snapshot: null, context: null };
  }
  const raw = (shortTermContext as Record<string, unknown>).sddGraph;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { snapshot: null, context: null };
  }
  const o = raw as Record<string, unknown>;
  const snapshot = raw as SddGraphSyncStatus;
  return {
    snapshot,
    context: {
      lastSyncedAt: typeof o.lastSyncedAt === "number" ? o.lastSyncedAt : null,
      mddFingerprint: typeof o.mddFingerprint === "string" ? o.mddFingerprint : null,
    },
  };
}

export function mergeSddGraphIntoShortTermContext(
  prev: Record<string, unknown>,
  status: SddGraphSyncStatus,
  mddMarkdown: string,
): Record<string, unknown> {
  return {
    ...prev,
    sddGraph: {
      ...status,
      mddFingerprint: mddGraphFingerprint(mddMarkdown),
    },
  };
}
