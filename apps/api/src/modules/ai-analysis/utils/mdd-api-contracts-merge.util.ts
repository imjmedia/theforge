/**
 * @fileoverview Merge §4 con reparación de fences §3, heading pegado y recuperación desde §3 inflada.
 */

import { processScopedArchitectResponse } from "./mdd-architect-pipeline.util.js";
import {
  draftHasPersistableSection4,
} from "./mdd-section-preserve.util.js";
import {
  CONTRATOS_HAS_ENDPOINTS,
  extractContratosSectionBody,
  normalizeGluedSection4HeadingInDraft,
  stripEmbeddedTailSectionsFromContratosBody,
} from "./mdd-sanitize/contratos-format.js";
import { closeUnclosedCodeFencesInDraft } from "./mdd-sanitize/persist-format.util.js";
import {
  extractSection3Body,
  insertMddSection4Block,
  replaceMddSection3Body,
  replaceMddSection4Body,
} from "./mdd-sanitize/section-merge.js";
import { closeUnclosedFencesBeforeCanonicalH2 } from "./mdd-sanitize/section-fence.util.js";
import { repairSection3SqlFenceBeforeJsonBlock } from "./mdd-sanitize/sql-repair.js";

/** Cierra fences §3 y normaliza §4 antes de cualquier merge api_contracts (chunks o scoped). */
export function repairMergeBaselineBeforeApiContractsMerge(baseline: string): string {
  let out = closeUnclosedFencesBeforeCanonicalH2(baseline);
  out = closeUnclosedCodeFencesInDraft(out);
  out = repairSection3SqlFenceBeforeJsonBlock(out);
  out = normalizeGluedSection4HeadingInDraft(out);
  return out;
}

const MISPLACED_S4_IN_S3_RE = /\n##\s*4\.\s*Contratos\s+de\s+API\b/i;
const ENDPOINT_BLOCK_START_RE = /^###\s+(GET|POST|PUT|DELETE|PATCH)\s+/im;

/** Promueve §4 absorbida en el cuerpo §3 (fence abierto o heading embebido). */
export function recoverMisplacedContratosFromSection3(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed || draftHasPersistableSection4(trimmed)) return trimmed;

  const section3 = extractSection3Body(trimmed);
  if (!section3) return trimmed;

  const misplaced = section3.match(MISPLACED_S4_IN_S3_RE);
  if (misplaced?.index != null) {
    const cutAt = misplaced.index;
    const promotedBody = section3
      .slice(cutAt)
      .replace(/^[\s\n]*##\s*4\.\s*Contratos\s+de\s+API[^\n]*\n?/i, "")
      .trim();
    if (promotedBody.length >= 80 && CONTRATOS_HAS_ENDPOINTS.test(promotedBody)) {
      const trimmedS3 = section3.slice(0, cutAt).trim();
      let out = replaceMddSection3Body(trimmed, trimmedS3);
      out = insertMddSection4Block(out, promotedBody);
      return normalizeGluedSection4HeadingInDraft(out);
    }
  }

  const sqlFenceMatch = section3.match(/```sql[\s\S]*?```/i);
  const afterSqlStart = sqlFenceMatch
    ? (sqlFenceMatch.index ?? 0) + sqlFenceMatch[0].length
    : section3.search(/```sql/i) >= 0
      ? section3.indexOf("\n", section3.indexOf("```sql")) + 1
      : -1;
  if (afterSqlStart >= 0) {
    const afterSql = section3.slice(afterSqlStart).trim();
    if (
      afterSql.length >= 80 &&
      ENDPOINT_BLOCK_START_RE.test(afterSql) &&
      CONTRATOS_HAS_ENDPOINTS.test(afterSql)
    ) {
      const trimmedS3 = section3.slice(0, afterSqlStart).trim();
      let out = replaceMddSection3Body(trimmed, trimmedS3);
      out = insertMddSection4Block(out, afterSql);
      return normalizeGluedSection4HeadingInDraft(out);
    }
  }

  return trimmed;
}

/** Quita cola de endpoints/API absorbida en §3 cuando §4 ya está persistible. */
export function trimAbsorbedContratosTailFromSection3(draft: string): string {
  const trimmed = (draft ?? "").trim();
  const section3 = extractSection3Body(trimmed);
  if (!section3) return trimmed;
  const sqlFenceMatch = section3.match(/```sql[\s\S]*?```/i);
  if (!sqlFenceMatch) return trimmed;
  const afterSqlStart = (sqlFenceMatch.index ?? 0) + sqlFenceMatch[0].length;
  const afterSql = section3.slice(afterSqlStart).trim();
  if (
    afterSql.length >= 80 &&
    ENDPOINT_BLOCK_START_RE.test(afterSql) &&
    CONTRATOS_HAS_ENDPOINTS.test(afterSql)
  ) {
    return replaceMddSection3Body(trimmed, section3.slice(0, afterSqlStart).trim());
  }
  return trimmed;
}

/** Fusiona cuerpo §4 en baseline con reparación, verificación y recuperación. */
export function mergeApiContractsBodyIntoDraft(baseline: string, mergedSection4: string): string {
  const base = repairMergeBaselineBeforeApiContractsMerge(baseline);
  const { fragment } = processScopedArchitectResponse(mergedSection4, "api_contracts");
  const fragmentBody =
    extractContratosSectionBody(fragment) ??
    fragment.replace(/^##\s*4\.[^\n]*\n?/i, "").trim();

  let draft = base;
  if (fragmentBody.length >= 80 && CONTRATOS_HAS_ENDPOINTS.test(fragmentBody)) {
    draft = normalizeGluedSection4HeadingInDraft(
      replaceMddSection4Body(base, stripEmbeddedTailSectionsFromContratosBody(fragmentBody)),
    );
  }

  if (!draftHasPersistableSection4(draft)) {
    draft = recoverMisplacedContratosFromSection3(draft);
  }

  if (!draftHasPersistableSection4(draft) && fragmentBody.length >= 80) {
    draft = normalizeGluedSection4HeadingInDraft(
      insertMddSection4Block(base, stripEmbeddedTailSectionsFromContratosBody(fragmentBody)),
    );
  }

  if (draftHasPersistableSection4(draft)) {
    draft = trimAbsorbedContratosTailFromSection3(draft);
  }

  return draft;
}
