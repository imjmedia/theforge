/**
 * Coherencia §3↔§4 inferida del markdown MDD (sin FalkorDB).
 */

import type { DomainInventory } from "@theforge/shared-types";
import type { SddStageSnapshot } from "../../legacy-flow/legacy-index-sdd-alignment.util.js";
import { extractMddSection4Endpoints } from "../conformance.service.js";
import { markdownToMddStructured } from "../../ai-analysis/utils/mdd-markdown-to-structured.js";
import {
  buildInfraOnlyEntitySet,
  isExemptEntityTable,
  isExemptPlatformEndpoint,
  isFkChildCoveredByConsumedParent,
} from "./mdd-coherence-exemptions.util.js";
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

export type MddCoherenceEvalOptions = {
  inventory?: DomainInventory | null;
};

export type MddCoherenceOrphans = {
  orphanEntityBareNames: string[];
  orphanEndpointPaths: string[];
};

function parseSection3Sql(mddMarkdown: string): string {
  const structured = markdownToMddStructured(mddMarkdown ?? "");
  return structured.modeloDatos?.sql ?? "";
}

function extractCoherenceEndpoints(mddMarkdown: string): Array<{ method: string; path: string }> {
  return extractMddSection4Endpoints(mddMarkdown ?? "").filter((e) => (e.path ?? "").trim().length > 0);
}

/** Huérfanos endpoint↔tabla con exenciones plataforma/auth/infra. */
export function findMddCoherenceOrphans(
  mddMarkdown: string,
  options: MddCoherenceEvalOptions = {},
): MddCoherenceOrphans {
  const sql = parseSection3Sql(mddMarkdown);
  const tables = extractTableRefsFromSql(sql);
  const fkByTable = extractForeignKeyTargetsByTable(sql);
  const endpoints = extractCoherenceEndpoints(mddMarkdown);
  const infraOnly = buildInfraOnlyEntitySet(options.inventory);

  const consumedTables = new Set<string>();
  const orphanEndpointPaths: string[] = [];

  for (const ep of endpoints) {
    const path = (ep.path ?? "").trim();
    if (isExemptPlatformEndpoint(path)) continue;
    const consumed = inferConsumedTableStorageNames(path, tables, fkByTable);
    if (consumed.length === 0) {
      orphanEndpointPaths.push(path);
    } else {
      for (const t of consumed) consumedTables.add(t);
    }
  }

  const orphanEntityBareNames: string[] = [];
  const consumedBareNames = new Set<string>();
  for (const storage of consumedTables) {
    const bare = tables.find((t) => t.storageName === storage)?.bareName;
    if (bare) consumedBareNames.add(bare);
  }

  for (const table of tables) {
    if (isExemptEntityTable(table.bareName, infraOnly)) continue;
    if (consumedTables.has(table.storageName)) continue;
    if (isFkChildCoveredByConsumedParent(table.bareName, consumedBareNames)) continue;
    orphanEntityBareNames.push(table.bareName);
  }

  return { orphanEntityBareNames, orphanEndpointPaths };
}

/** Snapshot §3/§4 para legacy index gate y telemetría. */
export function buildSddStageSnapshotFromMdd(mddMarkdown: string): SddStageSnapshot {
  const sql = parseSection3Sql(mddMarkdown);
  const tables = extractTableRefsFromSql(sql);
  const entityNames = [...new Set(tables.map((t) => t.bareName).filter(Boolean))];
  const endpoints = extractCoherenceEndpoints(mddMarkdown).map((e) => ({
    method: (e.method ?? "GET").trim().toUpperCase(),
    path: (e.path ?? "").trim(),
  }));
  return { entityNames, endpoints };
}

/** Evalúa huérfanos endpoint↔tabla desde SQL §3 y rutas §4 (tabla + H3). */
export function evaluateMddCoherenceFromMarkdown(
  mddMarkdown: string,
  options: MddCoherenceEvalOptions = {},
): MddCoherenceHealth {
  const sql = parseSection3Sql(mddMarkdown);
  const tables = extractTableRefsFromSql(sql);
  const endpoints = extractCoherenceEndpoints(mddMarkdown);
  const { orphanEntityBareNames, orphanEndpointPaths } = findMddCoherenceOrphans(mddMarkdown, options);

  const entityCount = tables.length;
  const endpointCount = endpoints.length;
  const orphanEntityCount = orphanEntityBareNames.length;
  const orphanEndpointCount = orphanEndpointPaths.length;
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
