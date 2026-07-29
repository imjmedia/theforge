import { mergeMddBySection, type MddMergeStats } from "./mdd-section-merge.util.js";

export type OrchestratorMddPersistMerge = {
  content: string;
  stats: MddMergeStats;
  /** true si se aplicó merge defensivo (incoming truncado o parcial). */
  defensiveMerge: boolean;
};

/**
 * Merge seccional antes de persistir MDD desde chat del orquestador.
 * Evita que una respuesta LLM truncada borre §2–§7 ya validadas.
 */
export function mergeMddForOrchestratorPersist(
  existing: string | null | undefined,
  incoming: string,
): OrchestratorMddPersistMerge {
  const result = mergeMddBySection(existing, incoming);
  const defensiveMerge =
    result.stats.truncatedIncoming ||
    (result.stats.sectionsKept.length > 0 && result.stats.sectionsReplaced.length > 0);
  return { content: result.content, stats: result.stats, defensiveMerge };
}
