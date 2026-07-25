/**
 * Elimina tablas ruido TheForge/chat de §3 cuando el alcance del proyecto no es plataforma conversacional.
 */

import { PLATFORM_ORPHAN_TABLES } from "@theforge/shared-types";
import type { DomainInventory } from "@theforge/shared-types";
import { corpusExcludesMultiTenantSaaS } from "./mdd-brd-scope.util.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { isPlatformTableJustified } from "./platform-table-justify.util.js";

/** Tablas típicas de plataforma chat/LLM que no deben contaminar dominios ajenos (KMS, catálogo, etc.). */
export const THEFORGE_PLATFORM_NOISE_TABLES = new Set([
  ...PLATFORM_ORPHAN_TABLES,
  "conversation_memory",
  "messages",
  "mcp_plugins",
  "llm_configs",
  "agent_runs",
  "channels",
  "conversations",
]);

/** Tablas SaaS multi-tenant TheForge; quitar si BRD las excluye explícitamente. */
export const MULTI_TENANT_SAAS_NOISE_TABLES = new Set([
  "tenants",
  "tenant_quotas",
  "tenant_subscriptions",
]);

function buildCorpus(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
  mddMarkdown?: string | null;
}): string {
  const section1 = params.mddMarkdown
    ? extractSectionByNumber(params.mddMarkdown, 1) ?? ""
    : "";
  return [params.brdMarkdown, params.dbgaMarkdown, params.specMarkdown, section1]
    .filter(Boolean)
    .join("\n");
}

/** True si el corpus afirma producto chat/MCP/LLM (no basta negación «sin MCP»). */
export function isChatLlmPlatformScope(corpus: string): boolean {
  const text = corpus ?? "";
  if (
    /\b(sin\s+(?:chat|mcp)|no\s+(?:chat|mcp)|fuera\s+de\s+alcance[^\n]{0,48}(?:chat|mcp|panel\s+web))\b/i.test(
      text,
    ) &&
    !/\b(integraci[oó]n\s+mcp|plataforma\s+mcp|chat\s+operacional|mensajer[ií]a|whatsapp)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(integraci[oó]n\s+mcp|model\s+context\s+protocol|\bmcp\s+(?:server|plugins?|tools?)|\bchat\b|mensajer[ií]a|whatsapp|conversaci[oó]n(?:es)?|agente\s+ia|multi[- ]?agente|memoria\s+de\s+conversaci[oó]n|plataforma\s+mcp)\b/i.test(
    text,
  );
}

function shouldStripPlatformTable(
  table: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    specMarkdown?: string | null;
    mddMarkdown?: string | null;
    inventory?: DomainInventory | null;
  },
): boolean {
  const corpus = buildCorpus(params);
  if (MULTI_TENANT_SAAS_NOISE_TABLES.has(table) && corpusExcludesMultiTenantSaaS(corpus)) {
    return true;
  }
  if (!THEFORGE_PLATFORM_NOISE_TABLES.has(table)) return false;
  if (!isChatLlmPlatformScope(corpus)) return true;
  return !isPlatformTableJustified(table, { ...params, mddMarkdown: params.mddMarkdown ?? "" });
}

function stripCreateTableFromSql(sql: string, tableName: string): string {
  const re = new RegExp(
    `(?:^|\\n)(?:--[^\\n]*\\n)*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["']?${tableName}["']?\\s*\\([\\s\\S]*?\\);`,
    "gi",
  );
  return sql.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function replaceSection3Sql(section3: string, newSql: string): string {
  const sqlFence = /```sql\n([\s\S]*?)```/i;
  if (!sqlFence.test(section3)) return section3;
  return section3.replace(sqlFence, `\`\`\`sql\n${newSql.trimEnd()}\n\`\`\``);
}

/**
 * Quita CREATE TABLE de tablas plataforma no justificadas en BRD/§1.
 * Idempotente; no toca tablas con ancla MCP/chat en corpus.
 */
export function stripUnjustifiedPlatformTablesFromMdd(
  mddMarkdown: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    specMarkdown?: string | null;
    inventory?: DomainInventory | null;
  },
): { markdown: string; stripped: string[] } {
  const draft = (mddMarkdown ?? "").trim();
  if (!draft) return { markdown: draft, stripped: [] };

  const section3 = extractSectionByNumber(draft, 3);
  if (!section3) return { markdown: draft, stripped: [] };

  const sqlMatch = section3.match(/```sql\n([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return { markdown: draft, stripped: [] };

  let sql = sqlMatch[1];
  const stripped: string[] = [];

  const tablesToScan = new Set([...THEFORGE_PLATFORM_NOISE_TABLES, ...MULTI_TENANT_SAAS_NOISE_TABLES]);
  for (const table of tablesToScan) {
    const createRe = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["']?${table}["']?\\s*\\(`,
      "i",
    );
    if (!createRe.test(sql)) continue;
    if (!shouldStripPlatformTable(table, { ...params, mddMarkdown: draft })) continue;
    sql = stripCreateTableFromSql(sql, table);
    stripped.push(table);
  }

  if (stripped.length === 0) return { markdown: draft, stripped: [] };

  const newSection3 = replaceSection3Sql(section3, sql);
  return { markdown: draft.replace(section3, newSection3), stripped };
}
