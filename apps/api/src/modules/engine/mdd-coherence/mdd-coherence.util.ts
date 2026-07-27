/**
 * Coherencia §3↔§4 inferida del markdown MDD (sin FalkorDB).
 */

import type { SddStageSnapshot } from "../../legacy-flow/legacy-index-sdd-alignment.util.js";
import { parseMddGraphExpectations } from "./mdd-graph-expectations.util.js";
import {
  extractForeignKeyTargetsByTable,
  extractTableRefsFromSql,
  inferConsumedTableStorageNames,
} from "./sdd-consumes-link.util.js";

export type MddCoherenceHealth = {
  entityCount: number;
  endpointCount: number;
  orphanEntityCount: number;
  orphanEndpointCount: number;
  isCoherent: boolean;
};

/** Snapshot §3/§4 para legacy index gate y telemetría. */
export function buildSddStageSnapshotFromMdd(mddMarkdown: string): SddStageSnapshot {
  const { structured } = parseMddGraphExpectations(mddMarkdown);
  const tables = extractTableRefsFromSql(structured.modeloDatos?.sql ?? "");
  const entityNames = [...new Set(tables.map((t) => t.bareName).filter(Boolean))];
  const endpoints = (structured.contratosApi?.endpoints ?? [])
    .filter((e) => (e.path ?? "").trim().length > 0)
    .map((e) => ({
      method: (e.method ?? "GET").trim().toUpperCase(),
      path: (e.path ?? "").trim(),
    }));
  return { entityNames, endpoints };
}

/** Evalúa huérfanos endpoint↔tabla desde SQL §3 y rutas §4. */
export function evaluateMddCoherenceFromMarkdown(mddMarkdown: string): MddCoherenceHealth {
  const { structured } = parseMddGraphExpectations(mddMarkdown);
  const sql = structured.modeloDatos?.sql ?? "";
  const tables = extractTableRefsFromSql(sql);
  const fkByTable = extractForeignKeyTargetsByTable(sql);
  const endpoints = (structured.contratosApi?.endpoints ?? []).filter(
    (e) => (e.path ?? "").trim().length > 0,
  );

  const consumedTables = new Set<string>();
  let orphanEndpointCount = 0;
  for (const ep of endpoints) {
    const consumed = inferConsumedTableStorageNames(ep.path ?? "", tables, fkByTable);
    if (consumed.length === 0) {
      orphanEndpointCount++;
    } else {
      for (const t of consumed) consumedTables.add(t);
    }
  }

  let orphanEntityCount = 0;
  for (const table of tables) {
    if (!consumedTables.has(table.storageName)) orphanEntityCount++;
  }

  const entityCount = tables.length;
  const endpointCount = endpoints.length;
  const isCoherent =
    entityCount > 0 &&
    endpointCount > 0 &&
    orphanEndpointCount === 0 &&
    orphanEntityCount === 0;

  return {
    entityCount,
    endpointCount,
    orphanEntityCount,
    orphanEndpointCount,
    isCoherent,
  };
}
