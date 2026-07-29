/**
 * Trazabilidad explícita: entidad DBGA/inventario → tabla MDD §3 → endpoint API.
 */

import type { DomainInventory } from "@theforge/shared-types";
import { AUTH_ENTITY_FAMILY } from "@theforge/shared-types";
import { extractHttpEndpointsFromMarkdown } from "../ui-mcp/api-contract-endpoints.util.js";
import { extractEntities } from "./conformance.service.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { markdownToMddStructured } from "../ai-analysis/utils/mdd-markdown-to-structured.js";
import {
  buildInfraOnlyEntitySet,
  isExemptEntityTable,
  isExemptPlatformEndpoint,
  isFkChildCoveredByConsumedParent,
} from "./mdd-coherence/mdd-coherence-exemptions.util.js";
import {
  extractForeignKeyTargetsByTable,
  extractTableRefsFromSql,
  inferConsumedTableStorageNames,
  type SddTableRef,
} from "./mdd-coherence/sdd-consumes-link.util.js";

export type EntityApiTraceRow = {
  entity: string;
  inMdd: boolean;
  inInventory: boolean;
  endpointHint?: string;
  matchedEndpoints: string[];
  gap?: string;
};

export type EntityApiTraceReport = {
  rows: EntityApiTraceRow[];
  gaps: string[];
  coverageRatio: number;
};

function parseSection3Sql(mddMarkdown: string): string {
  const structured = markdownToMddStructured(mddMarkdown ?? "");
  return structured.modeloDatos?.sql ?? "";
}

function storageToBareName(storageName: string, tables: SddTableRef[]): string {
  const hit = tables.find((t) => t.storageName === storageName);
  return hit?.bareName ?? storageName.split(".").pop()?.toLowerCase() ?? storageName.toLowerCase();
}

function buildConsumedBareNames(
  endpoints: Array<{ method: string; path: string }>,
  tables: SddTableRef[],
  fkByTable: Map<string, Set<string>>,
): Set<string> {
  const consumed = new Set<string>();
  for (const ep of endpoints) {
    const path = (ep.path ?? "").trim();
    if (isExemptPlatformEndpoint(path)) continue;
    for (const storage of inferConsumedTableStorageNames(path, tables, fkByTable)) {
      consumed.add(storageToBareName(storage, tables));
    }
  }
  return consumed;
}

function endpointsConsumingEntity(
  entity: string,
  tables: SddTableRef[],
  fkByTable: Map<string, Set<string>>,
  endpoints: Array<{ method: string; path: string }>,
  endpointHint?: string,
): string[] {
  const entityBare = entity.toLowerCase();
  const entityStorage =
    tables.find((t) => t.bareName === entityBare)?.storageName ?? entityBare;

  const matched = endpoints
    .filter((ep) => {
      const path = (ep.path ?? "").trim();
      if (isExemptPlatformEndpoint(path)) return false;
      const consumed = inferConsumedTableStorageNames(path, tables, fkByTable);
      return consumed.some(
        (storage) => storageToBareName(storage, tables) === entityBare || storage === entityStorage,
      );
    })
    .map((ep) => `${ep.method} ${ep.path}`);

  if (matched.length > 0) return matched;

  if (endpointHint?.trim()) {
    const hintNorm = endpointHint.replace(/\s+/g, " ").trim();
    const hintMatch = endpoints.find(
      (ep) => `${ep.method} ${ep.path}`.toLowerCase() === hintNorm.toLowerCase(),
    );
    if (hintMatch) return [`${hintMatch.method} ${hintMatch.path}`];
  }

  return [];
}

function entityHasApiCoverage(
  entity: string,
  tables: SddTableRef[],
  fkByTable: Map<string, Set<string>>,
  endpoints: Array<{ method: string; path: string }>,
  consumedBareNames: Set<string>,
  endpointHint?: string,
  infraOnly?: boolean,
): boolean {
  if (infraOnly) return true;
  if (isExemptEntityTable(entity)) return true;
  if (isFkChildCoveredByConsumedParent(entity, consumedBareNames)) return true;
  return endpointsConsumingEntity(entity, tables, fkByTable, endpoints, endpointHint).length > 0;
}

/** Matriz entidad → §3 → API para audit_documents y W4. */
export function buildEntityApiTraceReport(params: {
  mddMarkdown: string;
  inventory?: DomainInventory | null;
  apiContractsMarkdown?: string | null;
}): EntityApiTraceReport {
  const section3 = extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
  const mddEntities = extractEntities(section3);
  const inventoryEntities = new Set<string>([
    ...(params.inventory?.suggestedEntities ?? []),
    ...(params.inventory?.crudMatrix ?? []).map((r) => r.entity),
  ]);
  const allEntities = new Set([...mddEntities, ...inventoryEntities]);
  const endpoints = extractHttpEndpointsFromMarkdown(params.apiContractsMarkdown ?? "");
  const crudByEntity = new Map(
    (params.inventory?.crudMatrix ?? []).map((r) => [r.entity.toLowerCase(), r]),
  );
  const infraOnly = buildInfraOnlyEntitySet(params.inventory);

  const sql = parseSection3Sql(params.mddMarkdown ?? "");
  const tables = extractTableRefsFromSql(sql);
  const fkByTable = extractForeignKeyTargetsByTable(sql);
  const consumedBareNames = buildConsumedBareNames(endpoints, tables, fkByTable);

  const rows: EntityApiTraceRow[] = [];
  const gaps: string[] = [];

  for (const entity of [...allEntities].sort()) {
    const inMdd = mddEntities.has(entity);
    const inInventory = inventoryEntities.has(entity);
    const crud = crudByEntity.get(entity.toLowerCase());
    const matchedEndpoints = endpointsConsumingEntity(
      entity,
      tables,
      fkByTable,
      endpoints,
      crud?.endpointHint,
    );
    let gap: string | undefined;

    if (inInventory && !inMdd && !AUTH_ENTITY_FAMILY.has(entity.toLowerCase())) {
      gap = "entidad inventario/DBGA ausente en MDD §3";
    } else if (
      inMdd &&
      !entityHasApiCoverage(
        entity,
        tables,
        fkByTable,
        endpoints,
        consumedBareNames,
        crud?.endpointHint,
        crud?.infraOnly || infraOnly.has(entity.toLowerCase()),
      )
    ) {
      gap = "tabla §3 sin endpoint API trazable";
    }

    if (gap) gaps.push(`${entity}: ${gap}`);

    rows.push({
      entity,
      inMdd,
      inInventory,
      endpointHint: crud?.endpointHint,
      matchedEndpoints,
      gap,
    });
  }

  const domainRows = rows.filter((r) => !r.gap || r.inMdd);
  const withApi = domainRows.filter(
    (r) =>
      r.inMdd &&
      (r.matchedEndpoints.length > 0 ||
        crudByEntity.get(r.entity.toLowerCase())?.infraOnly ||
        isExemptEntityTable(r.entity, infraOnly) ||
        isFkChildCoveredByConsumedParent(r.entity, consumedBareNames)),
  );
  const coverageRatio =
    domainRows.filter((r) => r.inMdd).length === 0
      ? 1
      : withApi.length / domainRows.filter((r) => r.inMdd).length;

  return { rows, gaps, coverageRatio };
}

export function formatEntityApiTraceGaps(report: EntityApiTraceReport, limit = 12): string[] {
  return report.gaps.slice(0, limit).map((g) => `[Trazabilidad] ${g}`);
}
