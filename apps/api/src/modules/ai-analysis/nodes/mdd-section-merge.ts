/**
 * @fileoverview Utilidad de merge de secciones MDD — reemplaza o añade secciones.
 */

/**
 * Reemplaza una sección del MDD por título (ej. Seguridad, Integración) o la añade al final si no existe.
 * Evita duplicar secciones cuando Security/Integration se ejecutan en iteraciones o sobre un borrador ya completo.
 */
export function replaceOrAppendSection(
  draft: string,
  sectionKeyword: string,
  newContent: string,
): string {
  const trimmed = (draft || "").trim();
  if (!trimmed) return newContent.trim();

  // Buscar inicio de sección: línea que empiece con # o "N." y contenga la palabra (ej. Seguridad, Integración)
  const escaped = sectionKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(
    `\\n(#{1,6}\\s+.*${escaped}|\\d+\\.\\s+.*${escaped})`,
    "i",
  );
  const match = trimmed.match(headingRe);
  if (!match || match.index == null) {
    return trimmed + "\n\n" + newContent.trim();
  }

  const startIndex = match.index; // índice del \n antes del heading
  const afterStart = startIndex + 1;
  const idxNext2 = trimmed.indexOf("\n## ", afterStart);
  const idxNext1 = trimmed.indexOf("\n# ", afterStart);
  let endIndex = trimmed.length;
  if (idxNext2 !== -1) endIndex = Math.min(endIndex, idxNext2);
  if (idxNext1 !== -1) endIndex = Math.min(endIndex, idxNext1);

  const before = trimmed.slice(0, startIndex).trimEnd();
  const after = endIndex < trimmed.length ? trimmed.slice(endIndex) : "";
  return (
    before +
    "\n\n" +
    newContent.trim() +
    (after ? "\n\n" + after.trimStart() : "")
  );
}
