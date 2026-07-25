/**
 * @fileoverview Pre-renderizado MDD — validación de sintaxis Mermaid.
 */

/**
 * Re-export from engine for use in ai-analysis. Pre-render sanity lives in engine so projects can use it without depending on ai-analysis.
 */
export {
  ERR_MERMAID_SYNTAX,
  ERR_TABLE_SYNTAX,
  preRenderMddSanity,
  sanitizeMermaidBlock,
  sanitizeMermaidInDraft,
  validateApiTablesSyntax,
  validateMermaidSyntax,
  type PreRenderResult,
} from "../../engine/mdd-pre-render.js";
