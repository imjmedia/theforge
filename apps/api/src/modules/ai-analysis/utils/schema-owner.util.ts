/**
 * @fileoverview Resolución de propiedad de campos de schema por agente.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import { regenerateErDiagramFromSql } from "./mdd-diagram-suggestions.js";
import {
  applyDeterministicCrossConsistencyFixes,
  detectCrossConsistencyIssues,
  ensureSecurityTableStubsFromSection6,
  fixJwtAlgorithmCoherence,
  fixSection7OutboxNarrative,
  sanitizeAllSqlBlocksInDraft,
} from "./mdd-sanitize.js";
import { ensureCredentialStorageInSection6 } from "./mdd-credential-storage.util.js";

const SECTION3_BLOCKER_RE =
  /§3|SQL|outbox|prosa inválida|security_events|refresh_tokens|mfa_backup|totp_secret|TechnicalMetadata/i;

/** Blockers del gate atribuibles a composición §3 (SQL, outbox, tablas §6). */
export function detectSection3CompositionBlockers(draft: string): string[] {
  return detectCrossConsistencyIssues(draft).filter((issue) => SECTION3_BLOCKER_RE.test(issue));
}

/**
 * Paso determinista único de ownership §3: sanitiza SQL, deduplica outbox, stubs §6 y regenera ER.
 * Los agentes emiten slices; este paso compone el DDL+ER canónico antes del delivery gate.
 */
export function composeSection3FromStructured(
  draft: string,
  _mddStructured?: MddStructured | null,
): string {
  if (!draft?.trim()) return draft;
  let out = sanitizeAllSqlBlocksInDraft(draft);
  out = applyDeterministicCrossConsistencyFixes(out);
  out = ensureSecurityTableStubsFromSection6(out);
  out = ensureCredentialStorageInSection6(out);
  out = fixSection7OutboxNarrative(out);
  out = fixJwtAlgorithmCoherence(out);
  return regenerateErDiagramFromSql(out) ?? out;
}
