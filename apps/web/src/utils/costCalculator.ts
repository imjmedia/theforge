/**
 * Orquestación de estimación para el Workshop: parseo de MDD + delegación a `@theforge/business-rules`.
 */

import {
  computeCostEstimation,
  countCostDrivers,
  getDefaultTeamStructure,
  KNOWN_METADATA_TAGS,
  parseInfraFixedHours,
  RATES_MXN_PER_ROLE,
  type Status,
  type TeamStructure,
} from "@theforge/business-rules";

export type { Status, TeamStructure };

/** Alias histórico: tarifas por rol (referencia / vista de equipo). */
export const RATES_MXN: Record<string, number> = { ...RATES_MXN_PER_ROLE };

export interface CostResult {
  totalHours: number;
  /** Nómina ponderada por rol (post-buffer en `computeCostEstimation`). */
  totalMxn: number;
  /** Referencia venta horas × tarifa única (sin desglose por rol). */
  referenceSaleMxn: number;
  teamStructure: TeamStructure;
  rolesHours: Record<string, number>;
}

export type SemaphoreStatus = Status;

function extractTechnicalMetadataTags(mddContent: string | null): string[] {
  if (!mddContent?.trim()) return [];
  const content = mddContent.trim();
  const blockMatch = content.match(
    /(?:```\s*TechnicalMetadata|###\s*TechnicalMetadata|TechnicalMetadata\s*:?\s*)\s*([\s\S]*?)(?:```|$)/i,
  );
  const search = (blockMatch?.[1] ?? content) as string;
  const tags: string[] = [];
  const tagRegex = /\[\s*([a-z0-9_]+)\s*]/gi;
  const known = new Set<string>(KNOWN_METADATA_TAGS);
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(search)) !== null) {
    const tag = (m[1] ?? "").toLowerCase();
    if (known.has(tag) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Parsea mddContent (JSON o markdown) para extraer entidades, pantallas y endpoints extra.
 */
export function parseMddCounts(mddContent: string | null): {
  entityCount: number;
  screenCount: number;
  extraEndpointCount: number;
} {
  return countCostDrivers(mddContent);
}

/**
 * Calcula la estimación final a partir del MDD (y opcionalmente infra y semáforo).
 */
export function calculateCostFromMdd(
  mddContent: string | null,
  options?: { status?: SemaphoreStatus; infraContent?: string | null },
): CostResult {
  const { entityCount, screenCount, extraEndpointCount } = parseMddCounts(mddContent);
  const metadataTags = extractTechnicalMetadataTags(mddContent);
  const infraFixedHours = parseInfraFixedHours(options?.infraContent ?? null);
  const status = options?.status ?? "ROJO";

  const { totalHours, totalMxn, referenceSaleMxn, teamStructure, rolesHours } = computeCostEstimation({
    entityCount,
    screenCount,
    extraEndpointCount,
    metadataTags,
    infraFixedHours,
    status,
  });

  return {
    totalHours,
    totalMxn,
    referenceSaleMxn,
    teamStructure,
    rolesHours,
  };
}

export { getDefaultTeamStructure };
