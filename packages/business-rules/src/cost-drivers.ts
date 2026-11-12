/**
 * Contador único de drivers de costo (entidades, pantallas, endpoints) desde MDD markdown o JSON.
 */

export type CostDriverCounts = {
  entityCount: number;
  screenCount: number;
  extraEndpointCount: number;
};

const HTTP_VERB_ENDPOINT = /\b(GET|POST|PUT|PATCH|DELETE)\s+\//gi;
const CREATE_TABLE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;

/** Ancla §4 Contratos de API (heading numerado). */
const SECTION_4_HEADING = /^##\s+4\./im;

function tryParseJsonCounts(mdd: string): CostDriverCounts | null {
  const trimmed = mdd.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const json = JSON.parse(trimmed) as {
      db_entities?: unknown[];
      entities?: unknown[];
      screens?: unknown[];
      pantallas?: unknown[];
      extra_endpoints?: number;
      api_contracts?: unknown[];
    };
    let entityCount = json.db_entities?.length ?? json.entities?.length ?? 0;
    let screenCount = json.screens?.length ?? json.pantallas?.length ?? 0;
    let extraEndpointCount =
      typeof json.extra_endpoints === "number" && Number.isFinite(json.extra_endpoints)
        ? Math.max(0, json.extra_endpoints)
        : 0;
    if (Array.isArray(json.api_contracts)) {
      extraEndpointCount += json.api_contracts.length;
    }
    const inferredScreensFromApi =
      extraEndpointCount > 0 ? Math.min(28, Math.max(4, Math.ceil(extraEndpointCount * 0.55))) : 0;
    const finalScreenCount =
      extraEndpointCount > 0
        ? Math.max(screenCount, inferredScreensFromApi)
        : entityCount > 0
          ? Math.max(screenCount, Math.min(entityCount * 2, 20))
          : screenCount;
    return { entityCount, screenCount: finalScreenCount, extraEndpointCount };
  } catch {
    return null;
  }
}

function extractSection4Block(md: string): string {
  const match = md.match(SECTION_4_HEADING);
  if (!match || match.index === undefined) return "";
  const start = match.index;
  const afterHeading = md.slice(start);
  const nextMajor = afterHeading.slice(match[0].length).search(/^##\s+\d+\./m);
  if (nextMajor >= 0) {
    return afterHeading.slice(0, match[0].length + nextMajor);
  }
  return afterHeading;
}

function countEntitiesFromCreateTable(md: string): number {
  const names = new Set<string>();
  for (const m of md.matchAll(CREATE_TABLE)) {
    if (m[1]) names.add(m[1].toLowerCase());
  }
  return names.size;
}

function countEndpointsInSection4(section4: string): number {
  let count = 0;
  for (const _ of section4.matchAll(HTTP_VERB_ENDPOINT)) {
    count += 1;
  }
  return count;
}

function inferScreenCount(entityCount: number, extraEndpointCount: number): number {
  if (extraEndpointCount > 0) {
    return Math.min(28, Math.max(4, Math.ceil(extraEndpointCount * 0.55)));
  }
  if (entityCount > 0) {
    return Math.min(entityCount * 2, 20);
  }
  return 0;
}

/**
 * Cuenta entidades (CREATE TABLE), pantallas inferidas y endpoints HTTP solo dentro de §4 anclado.
 */
export function countCostDrivers(mdd: string | null | undefined): CostDriverCounts {
  if (!mdd?.trim()) {
    return { entityCount: 0, screenCount: 0, extraEndpointCount: 0 };
  }

  const fromJson = tryParseJsonCounts(mdd);
  if (fromJson && (fromJson.entityCount > 0 || fromJson.screenCount > 0 || fromJson.extraEndpointCount > 0)) {
    return fromJson;
  }

  const entityCount = countEntitiesFromCreateTable(mdd);
  const section4 = extractSection4Block(mdd);
  const extraEndpointCount = countEndpointsInSection4(section4);
  const screenCount = inferScreenCount(entityCount, extraEndpointCount);

  return { entityCount, screenCount, extraEndpointCount };
}
