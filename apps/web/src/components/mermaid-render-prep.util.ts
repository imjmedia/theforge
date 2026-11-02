import {
  decodeMermaidHtmlEntities,
  prepareMermaidDiagramForRender,
  repairMermaidBlockBody,
  resolveMermaidBlockForRender,
  stripMermaidFenceWrappers,
} from "@theforge/shared-types/mermaid";
import { proposeMermaidRepairs } from "@theforge/shared-types/mermaid-oracle";

/**
 * Preparación mínima del fuente Mermaid antes de dárselo al bloque: solo transliteración de espacios,
 * nunca heurísticas de sintaxis. La reparación de verdad la decide el bloque con el parser real
 * (`useMermaidRender`: original primero, reparación solo si el parser la acepta).
 *
 * - Quita envoltorios ``` / ```mermaid que el LLM dejó dentro del cuerpo.
 * - CRLF/CR → LF.
 * - NBSP y demás espacios Unicode (U+00A0, U+2000–U+200B, U+202F, U+205F, U+3000) → espacio ASCII:
 *   el parser no los reconoce como separador ni como indentación.
 *
 * No toca tabs, indentación ni espacios finales: son significativos en mindmap, sequence, etc.
 */
export function prepareMermaidForRender(content: string): string {
  return stripMermaidFenceWrappers((content ?? "").replace(/\r\n?/g, "\n")).replace(
    /[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g,
    " ",
  );
}

/** Tope de candidatos que prueba el botón "Reparar" (el oráculo no cuenta el parseo del original). */
export const EXTENDED_REPAIR_MAX_ATTEMPTS = 6;

function safely(transform: (text: string) => string, text: string): string {
  try {
    return transform(text);
  } catch {
    return "";
  }
}

/**
 * Candidatos AMPLIADOS del botón "Reparar", de menos a más invasivos. Son las transformaciones
 * deterministas completas de shared-types (decodificar entidades, preparar para render, resolver bloque)
 * y sus combinaciones con `repairMermaidBlockBody`. No incluye los candidatos que el pase automático ya
 * probó (`proposeMermaidRepairs`), para no gastar intentos. Nunca se pintan sin que el parser real
 * acepte el candidato (`resolveMermaidWithOracle`).
 */
export function proposeExtendedMermaidRepairs(body: string): string[] {
  const original = body ?? "";
  const decoded = safely(decodeMermaidHtmlEntities, original);
  const prepared = safely(prepareMermaidDiagramForRender, original);
  const resolved = safely(resolveMermaidBlockForRender, original);
  const raw = [
    decoded,
    prepared,
    resolved,
    safely(repairMermaidBlockBody, decoded),
    safely(repairMermaidBlockBody, prepared),
    safely(repairMermaidBlockBody, resolved),
    safely(prepareMermaidDiagramForRender, decoded),
    safely(decodeMermaidHtmlEntities, safely(repairMermaidBlockBody, original)),
    safely(resolveMermaidBlockForRender, decoded),
  ];
  const seen = new Set<string>([original, ...proposeMermaidRepairs(original)]);
  const out: string[] = [];
  for (const candidate of raw) {
    if (!candidate.trim() || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
