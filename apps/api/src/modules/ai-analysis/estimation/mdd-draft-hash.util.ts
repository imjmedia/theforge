import { createHash } from "node:crypto";
import { normalizeMddForHash } from "@theforge/shared-types";

/**
 * Hash canónico del MDD persistido (mismo normalizador que el snapshot del Auditor).
 */
export function hashMddDraft(md: string | null | undefined): string {
  const normalized = normalizeMddForHash(md ?? "");
  return createHash("sha1").update(normalized).digest("hex");
}
