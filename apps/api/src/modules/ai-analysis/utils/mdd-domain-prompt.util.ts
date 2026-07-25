/**
 * @fileoverview Builder de prompts con contexto de dominio.
 */

/**
 * Domain inventory injection for MDD LangGraph nodes (PLAN-CASCADE-90-ACCURACY).
 */

import { extractEntities } from "../../engine/conformance.service.js";
import {
  buildDomainInventory,
  detectAuthOnlySkew,
  formatDomainInventoryForPrompt,
} from "../../engine/domain-inventory.util.js";
import { extractSectionByNumber } from "../../engine/mdd-markdown-parser.js";
import type { MDDStateType } from "../state/index.js";

/** Resolve BRD text: explicit state.brdContent, else preamble embedded by composeBrdPreamble. */
export function resolveBrdFromMddState(state: MDDStateType): string {
  const explicit = (state.brdContent ?? "").trim();
  if (explicit) return explicit;
  const dbga = (state.dbgaContent ?? "").trim();
  const preamble = dbga.match(
    /##\s*Contexto\s*[—\-]\s*BRD[\s\S]*?(?=\n---\n\n\*\*Instrucci[oó]n:\*\*|\n##\s+(?!Contexto))/i,
  );
  if (preamble?.[0]) {
    const body = preamble[0]
      .replace(/^##\s*Contexto\s*[—\-]\s*BRD[^\n]*\n+/i, "")
      .trim();
    if (body.length >= 40) return body.slice(0, 24_000);
  }
  if (/##\s*3\.\s*Capacidad|##\s*3\.\s*Capabilities/i.test(dbga) && dbga.length > 400) {
    return dbga.slice(0, 24_000);
  }
  return "";
}

export function buildInventoryFromMddState(state: MDDStateType) {
  const brd = resolveBrdFromMddState(state);
  const dbga = (state.dbgaContent ?? "").trim();
  const draft = (state.mddDraft ?? "").trim();
  const mddEntities = extractEntities(extractSectionByNumber(draft, 3) || draft);
  return {
    brd,
    dbga,
    inventory: buildDomainInventory({
      brdMarkdown: brd || null,
      dbgaMarkdown: dbga || null,
      mddMarkdown: draft || null,
      mddEntities,
    }),
    mddEntities,
  };
}

/** Prompt appendix when BRD/DBGA yields a non-empty inventory. */
export function domainInventoryPromptBlock(state: MDDStateType): string {
  const { brd, dbga, inventory } = buildInventoryFromMddState(state);
  if (!brd && !dbga) return "";
  if (inventory.capabilities.length === 0 && inventory.suggestedEntities.length === 0) return "";
  return "\n\n" + formatDomainInventoryForPrompt(inventory);
}

/** True when §3 is auth-only while BRD has substantial domain capabilities. */
export function mddStateHasDomainAuthSkew(state: MDDStateType): boolean {
  const { inventory, mddEntities } = buildInventoryFromMddState(state);
  if (inventory.capabilities.filter((c) => !c.isAuthRelated).length < 3) return false;
  if (mddEntities.size === 0) return false;
  return detectAuthOnlySkew(mddEntities, inventory.capabilities).skewed;
}
