import { peelTheforgeDocStamp } from "./theforge-doc-stamp.js";

/** Documentos upstream que alimentan el MDD greenfield. */
export type MddUpstreamSource = "dbga" | "brd" | "benchmark";

export const MDD_UPSTREAM_SOURCE_LABELS: Record<MddUpstreamSource, string> = {
  dbga: "Fase 0 (DBGA)",
  brd: "BRD",
  benchmark: "Benchmark (Deep Research)",
};

/** Baseline persistido al finalizar un MDD (hashes + snapshots truncados para diff). */
export type MddUpstreamBaseline = {
  capturedAt: string;
  dbgaContentHash: string;
  brdContentHash: string;
  benchmarkContentHash: string;
  mddContentHash: string;
  dbgaLength: number;
  brdLength: number;
  benchmarkLength: number;
  mddLength: number;
  dbgaContentSnapshot: string;
  brdContentSnapshot: string;
  benchmarkContentSnapshot: string;
};

export type MddUpstreamChangeItem = {
  source: MddUpstreamSource;
  label: string;
  summary: string;
  /** Líneas añadidas vs baseline (aprox.). */
  linesAdded: number;
  linesRemoved: number;
};

export type MddUpstreamSyncAnalysis = {
  hasBaseline: boolean;
  hasMdd: boolean;
  baselineCapturedAt: string | null;
  changedSources: MddUpstreamSource[];
  changes: MddUpstreamChangeItem[];
  /** Secciones MDD 1–7 recomendadas por reglas de impacto. */
  recommendedSections: number[];
  /** Secciones tras expandir dependencias (§3⇒§4, §2⇒§7, …). */
  expandedSections: number[];
  canSync: boolean;
  /** true si no hay MDD o el usuario debe usar pipeline completo. */
  needsFullRegen: boolean;
  pendingSync: boolean;
};

/** Subconjunto de análisis expuesto al Workshop / generation-status. */
export function toMddUpstreamSyncStatus(analysis: MddUpstreamSyncAnalysis): Pick<
  MddUpstreamSyncAnalysis,
  | "pendingSync"
  | "changedSources"
  | "recommendedSections"
  | "expandedSections"
  | "canSync"
  | "needsFullRegen"
  | "hasBaseline"
> & { changes: MddUpstreamSyncAnalysis["changes"] } {
  return {
    pendingSync: analysis.pendingSync,
    changedSources: analysis.changedSources,
    recommendedSections: analysis.recommendedSections,
    expandedSections: analysis.expandedSections,
    canSync: analysis.canSync,
    needsFullRegen: analysis.needsFullRegen,
    hasBaseline: analysis.hasBaseline,
    changes: analysis.changes,
  };
}

export const MDD_SECTION_TITLES: Record<number, string> = {
  1: "§1 Contexto y alcance",
  2: "§2 Arquitectura y stack",
  3: "§3 Modelo de datos",
  4: "§4 Contratos de API",
  5: "§5 Lógica y edge cases",
  6: "§6 Seguridad",
  7: "§7 Infraestructura",
};

/**
 * Normaliza texto para hashing estable: finales de línea, trim y sin cabecera de fechas
 * (stamp `theforge-doc`) para no marcar desincronización por metadatos solamente.
 */
export function normalizeUpstreamDocumentBody(text: string | null | undefined): string {
  let body = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return body;
  for (let i = 0; i < 4; i++) {
    const next = peelTheforgeDocStamp(body).body.trim();
    if (!next || next === body) break;
    body = next;
  }
  return body.trim();
}

/** Normaliza JSON de benchmark/phase0Summary para hashing estable (orden de claves). */
export function normalizeBenchmarkDocumentBody(text: string | null | undefined): string {
  const body = normalizeUpstreamDocumentBody(text);
  if (!body) return body;
  const first = body.trimStart()[0];
  if (first !== "{" && first !== "[") return body;
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body;
  }
}

/** Expande dependencias entre secciones MDD antes de ejecutar agentes. */
export function expandMddSectionsForSync(sections: readonly number[]): number[] {
  const set = new Set(sections.filter((n) => n >= 1 && n <= 7));
  if (set.has(3)) set.add(4);
  if (set.has(4)) set.add(3);
  if (set.has(2)) set.add(7);
  if (set.has(6) && (set.has(3) || set.has(4))) {
    /* security often needs model/api alignment */
  }
  return [1, 2, 3, 4, 5, 6, 7].filter((n) => set.has(n));
}

export function buildUpstreamChangeSummaryForPipeline(analysis: MddUpstreamSyncAnalysis): string {
  if (!analysis.changes.length) return "Sincronizar MDD con documentos upstream sin diff detectado.";
  const lines = analysis.changes.map(
    (c) => `- **${c.label}:** ${c.summary}`,
  );
  return [
    "Actualizar el MDD existente para reflejar cambios en documentos upstream (no reescribir secciones no afectadas).",
    "",
    "**Cambios detectados:**",
    ...lines,
    "",
    `**Secciones a actualizar:** ${analysis.expandedSections.map((n) => MDD_SECTION_TITLES[n] ?? `§${n}`).join(", ")}`,
  ].join("\n");
}
