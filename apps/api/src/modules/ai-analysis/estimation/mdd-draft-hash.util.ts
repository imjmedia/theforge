import { createHash } from "node:crypto";

/**
 * Hash normalizado de un borrador MDD (trim + colapso de espacios en blanco + sha1).
 * Sirve para saber si las `auditorGaps` del Auditor LLM siguen describiendo el contenido que ve el usuario.
 */
export function hashMddDraft(md: string | null | undefined): string {
  const normalized = (md ?? "").trim().replace(/\s+/g, " ");
  return createHash("sha1").update(normalized).digest("hex");
}
