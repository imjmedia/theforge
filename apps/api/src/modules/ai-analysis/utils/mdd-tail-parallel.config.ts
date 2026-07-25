/**
 * @fileoverview Nodo tail-parallel — ejecuta procesamiento paralelo final.
 */

/** Activa §5 ∥ §6 ∥ §7 tras Software Architect (§2–§4). Desactivar: `MDD_TAIL_PARALLEL=0`. */
export function isMddTailParallelEnabled(): boolean {
  const raw = process.env.MDD_TAIL_PARALLEL;
  if (raw === "0" || raw === "false") return false;
  return true;
}

export const MDD_SECTION5_TAIL_PLACEHOLDER =
  "(Pendiente: paso dedicado Lógica y Edge Cases)";
