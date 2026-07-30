/**
 * Conformance inventario ↔ MDD §3: entidades DBGA faltantes y tablas plataforma sin BRD/DBGA.
 */

import {
  AUTH_ENTITY_FAMILY,
  DBGA_CORE_ENTITIES,
  type DomainInventory,
} from "@theforge/shared-types";
import { extractEntities } from "./conformance.service.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { extractDbgaCanonicalEntities } from "./domain-inventory.util.js";
import {
  isPlatformTableJustified,
  listUnjustifiedPlatformTables,
} from "./platform-table-justify.util.js";

/** Tablas §3 que satisfacen una entidad núcleo DBGA (sinónimos frecuentes). */
export const DBGA_CORE_TABLE_ALIASES: Record<string, readonly string[]> = {
  credentials: [
    "credentials",
    "broker_credentials",
    "api_credentials",
    "user_credentials",
    "tenant_credentials",
  ],
  dashboard_configs: ["dashboard_configs", "dashboards", "user_dashboards"],
  otp_sessions: ["otp_sessions", "otp_codes", "mfa_sessions"],
  operations: ["operations", "trades", "orders"],
  watchlists: ["watchlists", "watchlist_items"],
  strategies: ["strategies", "trading_strategies"],
};

export function mddSection3HasDbgaCoreEntity(
  mddEntities: Set<string>,
  coreEntity: string,
): boolean {
  if (mddEntities.has(coreEntity)) return true;
  const aliases = DBGA_CORE_TABLE_ALIASES[coreEntity];
  if (aliases?.some((a) => mddEntities.has(a))) return true;
  if (coreEntity.includes("credential")) {
    return [...mddEntities].some((e) => e.includes("credential"));
  }
  return false;
}

/** True cuando el corpus apunta a vertical trading/inversión (no KMS puro, etc.). */
export function isTradingVerticalCorpus(corpus: string): boolean {
  return /\b(trading|watchlist|estrategia|strateg(?:y|ies)|operaciones?\s+(?:de\s+)?trading|broker|alpaca|inversi[oó]n|portafolio|señal|recomendaci[oó]n\s+de\s+inversi[oó]n)\b/i.test(
    corpus,
  );
}

/** Entidades núcleo DBGA que deben existir en §3 para este proyecto. */
export function resolveRequiredDbgaCoreEntities(params: {
  dbgaMarkdown?: string | null;
  brdMarkdown?: string | null;
}): string[] {
  const dbgaCanonical = extractDbgaCanonicalEntities(params.dbgaMarkdown ?? "");
  const corpus = `${params.dbgaMarkdown ?? ""}\n${params.brdMarkdown ?? ""}`;
  const tradingVertical = isTradingVerticalCorpus(corpus);
  const required = new Set<string>();

  for (const entity of dbgaCanonical) {
    if ((DBGA_CORE_ENTITIES as readonly string[]).includes(entity)) {
      required.add(entity);
    }
    if (entity.includes("credential")) required.add("credentials");
  }

  for (const entity of DBGA_CORE_ENTITIES) {
    const slug = entity.replace(/_/g, "[\\s_-]*");
    if (new RegExp(`\\b${slug}\\b`, "i").test(corpus)) required.add(entity);
  }

  if (tradingVertical && dbgaCanonical.length >= 3) {
    for (const entity of DBGA_CORE_ENTITIES) required.add(entity);
  }

  return [...required].sort();
}

export type DomainInventoryConformanceReport = {
  missingDbgaCoreInMdd: string[];
  platformTablesWithoutJustification: string[];
  gaps: string[];
};

export function checkMissingDbgaCoreEntitiesInMdd(params: {
  dbgaMarkdown?: string | null;
  brdMarkdown?: string | null;
  mddMarkdown: string;
}): string[] {
  const section3 = extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
  const mddEntities = extractEntities(section3);
  const required = resolveRequiredDbgaCoreEntities(params);
  return required.filter((e) => !mddSection3HasDbgaCoreEntity(mddEntities, e));
}

/** Tablas plataforma en §3 sin ancla en BRD/DBGA/MDD §1 — deben eliminarse o documentarse. */
export function checkPlatformTablesOutsideBrd(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown: string;
  specMarkdown?: string | null;
  inventory?: DomainInventory | null;
}): string[] {
  return listUnjustifiedPlatformTables(params);
}

export function collectDomainInventoryConformanceGaps(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown: string;
  specMarkdown?: string | null;
  inventory?: DomainInventory | null;
}): DomainInventoryConformanceReport {
  const missingDbgaCoreInMdd = checkMissingDbgaCoreEntitiesInMdd({
    dbgaMarkdown: params.dbgaMarkdown,
    brdMarkdown: params.brdMarkdown,
    mddMarkdown: params.mddMarkdown,
  });
  const platformTablesWithoutJustification = checkPlatformTablesOutsideBrd(params);

  const gaps: string[] = [];
  if (missingDbgaCoreInMdd.length > 0) {
    gaps.push(
      `[MDD §3] Entidades DBGA faltantes (${missingDbgaCoreInMdd.length}): ${missingDbgaCoreInMdd.join(", ")} — regenerar §3 o expandir stubs del inventario.`,
    );
  }
  for (const table of platformTablesWithoutJustification) {
    gaps.push(
      `[MDD §3] Tabla plataforma "${table}" sin ancla BRD/DBGA — eliminar de §3 o documentar en Fuera de alcance / decision log.`,
    );
  }

  const inventoryMissing = params.inventory?.suggestedEntities?.filter((e) => {
    const section3 = extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
    return !extractEntities(section3).has(e) && !AUTH_ENTITY_FAMILY.has(e);
  }) ?? [];
  if (inventoryMissing.length > 0 && missingDbgaCoreInMdd.length === 0) {
    gaps.push(
      `[Inventario] Entidades sugeridas ausentes en §3: ${inventoryMissing.slice(0, 8).join(", ")}${inventoryMissing.length > 8 ? "…" : ""}`,
    );
  }

  return { missingDbgaCoreInMdd, platformTablesWithoutJustification, gaps };
}

export function formatDomainInventoryConformanceGaps(report: DomainInventoryConformanceReport, limit = 12): string[] {
  return report.gaps.slice(0, limit);
}

// Re-export for tests
export { isPlatformTableJustified };
