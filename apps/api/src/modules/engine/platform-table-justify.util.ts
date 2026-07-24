/**
 * Justificación de tablas plataforma (messages, mcp_plugins, conversation_memory)
 * alineada con capacidades BRD/DBGA/MDD §1 — evita falsos domain-platform-orphan.
 */

import {
  PLATFORM_ORPHAN_TABLES,
  type DomainInventory,
} from "@theforge/shared-types";
import { extractEntities } from "./conformance.service.js";
import { extractBrdCapabilities } from "./domain-inventory.util.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";

/** Tablas que exigen ancla en BRD/DBGA/Spec — no basta §1 MDD (orquestación Workshop). */
const PLATFORM_BRD_ANCHORED_TABLES = new Set(["messages", "conversation_memory"]);

/** Patrones fuertes de producto (BRD/DBGA/Spec). Evitan falsos positivos por “chat” de taller. */
const PLATFORM_ANCHOR_PATTERNS: Record<string, RegExp> = {
  messages:
    /\b(whatsapp|wasender|inbox|mensajer[ií]a|canal\s+de\s+mensajer[ií]a|historial\s+de\s+mensajes|conversaciones\s+con\s+(?:clientes|usuarios|pacientes)|mensajes\s+(?:entrantes|salientes|persistidos|del\s+canal))\b/i,
  mcp_plugins: /\b(mcp\b|model\s+context\s+protocol|plugins?\b|herramientas?\s+(?:mcp|externas)|integraci[oó]n\s+mcp|multi[- ]?agente|agente\s+ia|bitrix|tooling)\b/i,
  conversation_memory:
    /\b(rag\b|embeddings?\s+(?:vectoriales|sem[aá]nticos)|recuperaci[oó]n\s+sem[aá]ntica|memoria\s+(?:conversacional|de\s+agente)\s+persistente|almacenamiento\s+de\s+contexto\s+(?:rag|conversacional)|base\s+de\s+conocimiento\s+conversacional)\b/i,
};

function businessCorpus(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
}): string {
  return [params.brdMarkdown, params.dbgaMarkdown, params.specMarkdown].filter(Boolean).join("\n");
}

function corpus(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown?: string | null;
  specMarkdown?: string | null;
}): string {
  const section1 = params.mddMarkdown
    ? extractSectionByNumber(params.mddMarkdown, 1) ?? ""
    : "";
  // Solo prosa de negocio — no §3 SQL (los nombres CREATE TABLE no son ancla).
  return [businessCorpus(params), section1].filter(Boolean).join("\n");
}

function brdCapabilitiesAnchor(table: string, brdMarkdown?: string | null): boolean {
  const pattern = PLATFORM_ANCHOR_PATTERNS[table];
  if (!pattern || !brdMarkdown?.trim()) return false;
  const caps = extractBrdCapabilities(brdMarkdown);
  return caps.some((c) => pattern.test(`${c.title} ${c.body}`));
}

function mddSection3HasPlatformTag(section3: string, table: string): boolean {
  if (new RegExp(`\\[platform[_:\\s-]*${table.replace(/_/g, "[_-]*")}\\]`, "i").test(section3)) {
    return true;
  }
  if (
    new RegExp(
      `--\\s*\\[platform[^\\n]*${table.replace(/_/g, "[_-]*")}|platform_infra[^\\n]*${table.replace(/_/g, "[_-]*")}`,
      "i",
    ).test(section3)
  ) {
    return true;
  }
  return false;
}

/** True si la tabla plataforma está anclada en BRD/DBGA/MDD §1, inventario o metadata §3. */
export function isPlatformTableJustified(
  table: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    mddMarkdown?: string | null;
    specMarkdown?: string | null;
    inventory?: DomainInventory | null;
  },
): boolean {
  if (!PLATFORM_ORPHAN_TABLES.has(table)) return true;

  const section3 =
    extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
  if (mddSection3HasPlatformTag(section3, table)) return true;

  const pattern = PLATFORM_ANCHOR_PATTERNS[table];
  if (brdCapabilitiesAnchor(table, params.brdMarkdown)) return true;

  if (PLATFORM_BRD_ANCHORED_TABLES.has(table)) {
    const business = businessCorpus(params);
    if (pattern?.test(business)) return true;
    if (params.inventory?.suggestedEntities?.includes(table) && pattern?.test(business)) {
      return true;
    }
    return false;
  }

  const text = corpus(params);
  if (pattern?.test(text)) return true;

  if (params.inventory?.suggestedEntities?.includes(table)) {
    const invPattern = pattern ?? new RegExp(table.replace(/_/g, "[\\s_-]*"), "i");
    if (invPattern.test(text)) return true;
    const capBodies = (params.inventory.capabilities ?? [])
      .map((c) => `${c.title} ${c.body}`)
      .join("\n");
    if (invPattern.test(capBodies)) return true;
  }

  return false;
}

export function listUnjustifiedPlatformTables(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown: string;
  specMarkdown?: string | null;
  inventory?: DomainInventory | null;
}): string[] {
  const section3 = extractSectionByNumber(params.mddMarkdown ?? "", 3) || params.mddMarkdown || "";
  const mddEntities = extractEntities(section3);
  const orphans: string[] = [];
  for (const table of PLATFORM_ORPHAN_TABLES) {
    if (!mddEntities.has(table)) continue;
    if (isPlatformTableJustified(table, params)) continue;
    orphans.push(table);
  }
  return orphans;
}

const PLATFORM_SQL_COMMENT: Record<string, string> = {
  mcp_plugins:
    "-- [platform:mcp_plugins] Runtime MCP / herramientas externas (anclado BRD capacidades agente-MCP; no entidad de negocio pura).",
  conversation_memory:
    "-- [platform:conversation_memory] Memoria contextual del agente/chat (anclado capacidades conversación/RAG; no entidad de negocio pura).",
  messages:
    "-- [platform:messages] Mensajería/chat operacional (anclado capacidades conversación/canal; no entidad de negocio pura).",
};

/**
 * Antes del delivery gate: anota CREATE TABLE plataforma justificados por BRD/MDD
 * para que auditorías posteriores reconozcan el ancla sin bloquear cascada.
 */
export function annotateJustifiedPlatformTablesInMdd(
  mddMarkdown: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    specMarkdown?: string | null;
    inventory?: DomainInventory | null;
  },
): { markdown: string; annotated: string[] } {
  let out = mddMarkdown ?? "";
  const annotated: string[] = [];
  for (const table of PLATFORM_ORPHAN_TABLES) {
    if (!isPlatformTableJustified(table, { ...params, mddMarkdown: out })) continue;
    const createRe = new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["']?${table}["']?\\s*\\()`,
      "i",
    );
    if (!createRe.test(out)) continue;
    const comment = PLATFORM_SQL_COMMENT[table];
    if (!comment || out.includes(`[platform:${table}]`)) continue;
    out = out.replace(createRe, `${comment}\n$1`);
    annotated.push(table);
  }
  return { markdown: out, annotated };
}
