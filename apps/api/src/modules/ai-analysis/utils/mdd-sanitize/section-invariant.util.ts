/**
 * Invariante: un reemplazo de cuerpo H2 nunca puede hacer desaparecer otras secciones canónicas.
 *
 * Job 84: un fence §3 sin cerrar hacía que el cuerpo extraído fuese el resto del documento, y el
 * `replace` posterior sepultaba §4–§7 dentro de §3 (§3 20k→69k→99k, §4 invisible para gate y UI).
 * El cierre de fence corrige la causa; esta guarda evita que cualquier ruta futura con el mismo
 * patrón vuelva a perder secciones en silencio.
 */

import { closeUnclosedFencesBeforeCanonicalH2 } from "./section-fence.util.js";

const CANONICAL_H2_LINE_RE = /^##\s+(?:([1-7])\.|UI\/UX)/i;

/** Etiquetas de secciones canónicas (`1`…`7`, `ui-ux`) presentes como H2 real fuera de fences. */
export function canonicalH2LabelsOutsideFences(draft: string): Set<string> {
  const labels = new Set<string>();
  let insideFence = false;
  for (const line of (draft ?? "").split("\n")) {
    if (!insideFence) {
      const match = line.match(CANONICAL_H2_LINE_RE);
      if (match) labels.add(match[1] ?? "ui-ux");
    }
    if (((line.match(/```/g) ?? []).length % 2) === 1) insideFence = !insideFence;
  }
  return labels;
}

/** Secciones canónicas presentes en `before` y ausentes en `after`. */
export function canonicalH2LabelsLost(before: string, after: string): string[] {
  const afterLabels = canonicalH2LabelsOutsideFences(after);
  return [...canonicalH2LabelsOutsideFences(before)].filter((label) => !afterLabels.has(label));
}

/**
 * Devuelve `after` si no perdió secciones canónicas. Si perdió, intenta repararlo cerrando el
 * fence §3; si sigue perdiendo, descarta el cambio y devuelve `before` (fail-safe, con log).
 */
export function guardCanonicalH2Loss(before: string, after: string, label: string): string {
  if (!before?.trim() || !after?.trim()) return after;
  const lost = canonicalH2LabelsLost(before, after);
  if (lost.length === 0) return after;

  const repaired = closeUnclosedFencesBeforeCanonicalH2(after);
  const lostAfterRepair = canonicalH2LabelsLost(before, repaired);
  if (lostAfterRepair.length === 0) {
    console.warn(`[MDD:invariant] ${label}: §${lost.join(",")} recuperadas cerrando fence abierto`);
    return repaired;
  }

  console.warn(
    `[MDD:invariant] ${label}: descartado — perdería §${lostAfterRepair.join(",")} (len ${before.length}→${after.length})`,
  );
  return before;
}
