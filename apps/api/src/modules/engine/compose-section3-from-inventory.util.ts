/**
 * Deterministic §3 CREATE TABLE stubs from domain inventory (PLAN-CASCADE-90 P0).
 * Fills gaps when MDD is auth-skewed or missing business entities — does not invent columns beyond id + timestamps.
 */

import { AUTH_ENTITY_FAMILY, type DomainInventory } from "@theforge/shared-types";
import { extractEntities } from "./conformance.service.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { checkMissingDbgaCoreEntitiesInMdd } from "./domain-inventory-conformance.util.js";
import { entityHasRichProseInSection3 } from "./mdd-quality-audit.util.js";
import {
  isChatLlmPlatformScope,
  MULTI_TENANT_SAAS_NOISE_TABLES,
  THEFORGE_PLATFORM_NOISE_TABLES,
} from "./mdd-platform-table-strip.util.js";

function stubCreateTable(entity: string): string {
  return `CREATE TABLE ${entity} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;
}

/** §3 con SQL sustancial aunque extract falle por `(Pendiente)` pegado al heading. */
function section3BodyHasSubstantialSql(mddMarkdown: string): boolean {
  const region = mddMarkdown.match(
    /##\s*3\.\s*Modelo[^\n]*[\s\S]*?(?=\n##\s+\d+\.|\n##\s+Seguridad\b|\n##\s+UI\/UX|$)/i,
  );
  if (!region?.[0]) return false;
  const body = region[0].replace(/^##[^\n]+\n?/, "").trim();
  const stripped = body.replace(/^\s*\(?\s*Pendiente[^)]*\)?\s*(?:\n+|---\s*\n+)?/i, "").trim();
  return /CREATE\s+TABLE/i.test(stripped) && stripped.length >= 200;
}

function section3ExtractBodyLen(mddMarkdown: string): number {
  const section3 = extractSectionByNumber(mddMarkdown, 3);
  if (!section3) return 0;
  return section3.replace(/^##[^\n]+\n?/, "").trim().length;
}

function isPlatformNoiseEntityForMerge(entity: string, mddMarkdown: string): boolean {
  const e = entity.toLowerCase();
  if (MULTI_TENANT_SAAS_NOISE_TABLES.has(e)) return true;
  if (!THEFORGE_PLATFORM_NOISE_TABLES.has(e)) return false;
  const section1 = extractSectionByNumber(mddMarkdown, 1) ?? "";
  const corpus = section1;
  return !isChatLlmPlatformScope(corpus);
}

/** Business entities from inventory missing in MDD §3. */
export function missingDomainEntities(
  inventory: DomainInventory,
  mddMarkdown: string,
): string[] {
  const section3 = extractSectionByNumber(mddMarkdown, 3) || mddMarkdown;
  const existing = extractEntities(section3);
  return inventory.suggestedEntities.filter((e) => {
    if (AUTH_ENTITY_FAMILY.has(e)) return false;
    if (isPlatformNoiseEntityForMerge(e, mddMarkdown)) return false;
    if (existing.has(e)) return false;
    if (entityHasRichProseInSection3(section3, e)) return false;
    return true;
  });
}

/**
 * Builds a SQL appendix of CREATE TABLE stubs for missing domain entities.
 */
export function composeDomainTableStubsSql(
  inventory: DomainInventory,
  mddMarkdown: string,
): string {
  const missing = missingDomainEntities(inventory, mddMarkdown);
  if (missing.length === 0) return "";
  return missing.map(stubCreateTable).join("\n\n");
}

/**
 * Merges stub CREATE TABLE statements into the first ```sql fence of §3, or appends a new fence.
 * Idempotent: skips entities already present as CREATE TABLE.
 */
export function mergeDomainTablesIntoMdd(
  mddMarkdown: string,
  inventory: DomainInventory,
): { markdown: string; injected: string[] } {
  const draft = (mddMarkdown ?? "").trim();
  if (!draft) return { markdown: draft, injected: [] };
  const stubs = composeDomainTableStubsSql(inventory, draft);
  if (!stubs) return { markdown: draft, injected: [] };

  const injected = missingDomainEntities(inventory, draft);
  const section3 = extractSectionByNumber(draft, 3);
  if ((!section3 || section3ExtractBodyLen(draft) < 20) && !section3BodyHasSubstantialSql(draft)) {
    const appendix =
      `\n\n## 3. Modelo de Datos\n\n\`\`\`sql\n${stubs}\n\`\`\`\n\n` +
      "```TechnicalMetadata\n[domain_inventory_stubs]\n```\n";
    return { markdown: draft + appendix, injected };
  }

  const sqlFence = /```sql\n([\s\S]*?)```/i;
  const match = section3.match(sqlFence);
  if (match) {
    const existingSql = match[1] ?? "";
    const mergedSql = `${existingSql.trimEnd()}\n\n-- Domain inventory stubs (deterministic)\n${stubs}\n`;
    const newSection3 = section3.replace(sqlFence, `\`\`\`sql\n${mergedSql}\`\`\``);
    return { markdown: draft.replace(section3, newSection3), injected };
  }

  const injection = `\n\n\`\`\`sql\n${stubs}\n\`\`\`\n`;
  const newSection3 = section3.trimEnd() + injection;
  return { markdown: draft.replace(section3, newSection3), injected };
}

/** Inyecta stubs CREATE TABLE para entidades núcleo DBGA ausentes en §3. */
export function mergeDbgaCoreGapsIntoMdd(
  mddMarkdown: string,
  params: { dbgaMarkdown?: string | null; brdMarkdown?: string | null },
): { markdown: string; injected: string[] } {
  const missing = checkMissingDbgaCoreEntitiesInMdd({
    dbgaMarkdown: params.dbgaMarkdown,
    brdMarkdown: params.brdMarkdown,
    mddMarkdown: mddMarkdown,
  }).filter((entity) => {
    const section3 = extractSectionByNumber(mddMarkdown, 3) || mddMarkdown;
    return !entityHasRichProseInSection3(section3, entity);
  });
  if (missing.length === 0) return { markdown: mddMarkdown, injected: [] };

  const stubs = missing.map(stubCreateTable).join("\n\n");
  const draft = (mddMarkdown ?? "").trim();
  if (!draft) return { markdown: draft, injected: [] };

  const section3 = extractSectionByNumber(draft, 3);
  if ((!section3 || section3ExtractBodyLen(draft) < 20) && !section3BodyHasSubstantialSql(draft)) {
    const appendix =
      `\n\n## 3. Modelo de Datos\n\n\`\`\`sql\n${stubs}\n\`\`\`\n\n` +
      "```TechnicalMetadata\n[dbga_core_stubs]\n```\n";
    return { markdown: draft + appendix, injected: missing };
  }

  const sqlFence = /```sql\n([\s\S]*?)```/i;
  const match = section3.match(sqlFence);
  if (match) {
    const existingSql = match[1] ?? "";
    const mergedSql = `${existingSql.trimEnd()}\n\n-- DBGA core stubs (deterministic)\n${stubs}\n`;
    const newSection3 = section3.replace(sqlFence, `\`\`\`sql\n${mergedSql}\`\`\``);
    return { markdown: draft.replace(section3, newSection3), injected: missing };
  }

  const injection = `\n\n\`\`\`sql\n${stubs}\n\`\`\`\n`;
  const newSection3 = section3.trimEnd() + injection;
  return { markdown: draft.replace(section3, newSection3), injected: missing };
}

/** Prompt block forcing SA to expand stubs into real columns. */
export function domainSchemaCompositionPromptBlock(
  inventory: DomainInventory,
  mddMarkdown: string,
): string {
  const missing = missingDomainEntities(inventory, mddMarkdown);
  if (missing.length === 0 && inventory.suggestedEntities.length === 0) return "";
  const lines = [
    "**Composición determinista de §3 (inventario de dominio):**",
    `Entidades de negocio obligatorias: ${inventory.suggestedEntities
      .filter((e) => !AUTH_ENTITY_FAMILY.has(e))
      .slice(0, 30)
      .join(", ")}`,
  ];
  if (missing.length > 0) {
    lines.push(
      `Faltan en el borrador (debe crearlas o expandir stubs): ${missing.slice(0, 20).join(", ")}`,
    );
    lines.push(
      "Si ves stubs `id/created_at/updated_at` para esas tablas, **expándelas** con columnas de dominio derivadas del BRD/§1; no las borres.",
    );
  }
  return lines.join("\n");
}
