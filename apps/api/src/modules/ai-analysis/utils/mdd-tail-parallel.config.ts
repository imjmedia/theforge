/**
 * Feature flag: post-critic §4∥§6∥§7 en paralelo (F0–F6 perf).
 */
export function isMddTailParallelEnabled(): boolean {
  return process.env.MDD_TAIL_PARALLEL !== "0";
}

export const MDD_SECTION5_TAIL_PLACEHOLDER =
  "(Pendiente: paso dedicado Lógica y Edge Cases)";
