/**
 * @fileoverview F2 — §4 en chunks paralelos por tablas §3.
 */

import { processScopedArchitectResponse } from "./mdd-architect-pipeline.util.js";
import {
  extractSection3Body,
  tryMergeSingleArchitectSectionIntoDraft,
} from "./mdd-sanitize/section-merge.js";
import { parseModeloDatosFromSection3Markdown } from "./mdd-sanitize/section-structured.js";

const CREATE_TABLE_BLOCK_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)\s*\([\s\S]*?\)\s*;/gi;

const ENDPOINT_HEADING_RE = /^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/gim;

const COMMON_ROUTE_RE = /\/(health|status|auth\/|login|register|refresh)/i;

/** K = min(4, ceil(tables / 7)). */
export function computeApiContractsChunkCount(tableCount: number): number {
  if (tableCount <= 0) return 1;
  return Math.min(4, Math.ceil(tableCount / 7));
}

/** Nombres de tabla en orden de aparición (dedupe). */
export function extractSqlTableNames(sql: string): string[] {
  const names: string[] = [];
  for (const m of (sql ?? "").matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)/gi)) {
    const name = m[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Bloques CREATE TABLE indexados por nombre. */
export function extractCreateTableBlocks(sql: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const m of (sql ?? "").matchAll(CREATE_TABLE_BLOCK_RE)) {
    const full = m[0]?.trim();
    const name = m[1];
    if (full && name) blocks.set(name, full);
  }
  return blocks;
}

export type ApiContractsTableChunk = {
  index: number;
  tables: string[];
  sqlFragment: string;
};

/** Reparte tablas en K chunks (ceil división). */
export function splitTablesIntoApiContractsChunks(sql: string, k: number): ApiContractsTableChunk[] {
  const tableNames = extractSqlTableNames(sql);
  const chunkCount = Math.max(1, Math.min(k, tableNames.length || 1));
  if (tableNames.length === 0) {
    return [{ index: 0, tables: [], sqlFragment: sql.trim() }];
  }

  const blocks = extractCreateTableBlocks(sql);
  const chunks: ApiContractsTableChunk[] = [];
  const perChunk = Math.ceil(tableNames.length / chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    const tables = tableNames.slice(i * perChunk, (i + 1) * perChunk);
    if (tables.length === 0) continue;
    const sqlFragment = tables
      .map((t) => blocks.get(t))
      .filter((b): b is string => !!b)
      .join("\n\n");
    chunks.push({ index: i, tables, sqlFragment });
  }
  return chunks.length ? chunks : [{ index: 0, tables: tableNames, sqlFragment: sql.trim() }];
}

export type ParsedEndpointHeading = {
  method: string;
  route: string;
};

/** Headings `### MÉTODO /ruta` en cuerpo §4. */
export function extractEndpointHeadingsFromContratosBody(body: string): ParsedEndpointHeading[] {
  const out: ParsedEndpointHeading[] = [];
  const seen = new Set<string>();
  for (const m of (body ?? "").matchAll(ENDPOINT_HEADING_RE)) {
    const method = (m[1] ?? "GET").toUpperCase();
    const route = (m[2] ?? "").replace(/[),.;]+$/, "");
    const key = route.toLowerCase();
    if (!route || seen.has(key)) continue;
    seen.add(key);
    out.push({ method, route });
  }
  return out;
}

/** Tabla «Resumen de endpoints» generada en código (no LLM). */
export function buildContratosSummaryTableFromHeadings(headings: ParsedEndpointHeading[]): string {
  if (!headings.length) {
    return "| Método | Ruta | Descripción | Auth |\n|--------|------|-------------|------|\n| GET | /health | Healthcheck | No |";
  }
  const rows = headings.map((h) => {
    const auth = COMMON_ROUTE_RE.test(h.route) ? "No" : "JWT";
    return `| ${h.method} | ${h.route} | | ${auth} |`;
  });
  return ["| Método | Ruta | Descripción | Auth |", "|--------|------|-------------|------|", ...rows].join("\n");
}

/** Elimina endpoints comunes en chunks > 0 y dedupe por ruta. */
export function stripCommonRoutesFromChunkBody(body: string, chunkIndex: number): string {
  if (chunkIndex === 0) return body.trim();
  const parts = body.split(/\n(?=###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+)/i);
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
    if (m && COMMON_ROUTE_RE.test(m[2] ?? "")) continue;
    kept.push(trimmed);
  }
  return kept.join("\n\n").trim();
}

/**
 * Fusiona cuerpos §4 de chunks: dedupe rutas, tabla resumen determinista al inicio.
 */
export function mergeApiContractsChunkBodies(chunkBodies: string[]): string {
  const routeToBlock = new Map<string, string>();
  const headings: ParsedEndpointHeading[] = [];

  for (let i = 0; i < chunkBodies.length; i++) {
    const body = stripCommonRoutesFromChunkBody(chunkBodies[i] ?? "", i);
    for (const block of body.split(/\n(?=###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+)/i)) {
      const t = block.trim();
      if (!t.startsWith("###")) continue;
      const m = t.match(/^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
      if (!m?.[1] || !m[2]) continue;
      const method = m[1].toUpperCase();
      const route = m[2].replace(/[),.;]+$/, "");
      const routeKey = route.toLowerCase();
      if (routeToBlock.has(routeKey)) continue;
      routeToBlock.set(routeKey, t);
      headings.push({ method, route });
    }
  }

  const summary = buildContratosSummaryTableFromHeadings(headings);
  const details = [...routeToBlock.values()].join("\n\n");
  return `## 4. Contratos de API\n\n### Resumen de endpoints\n\n${summary}\n\n${details}`.trim();
}

/** Prompt extra por chunk para el arquitecto §4. */
export function apiContractsChunkPromptBlock(chunk: ApiContractsTableChunk, totalChunks: number): string {
  const tables = chunk.tables.length ? chunk.tables.join(", ") : "(todas las tablas §3)";
  const commonRule =
    chunk.index === 0
      ? "Este chunk **incluye** endpoints comunes: `/health` o `/status` y rutas `auth`/`login` si aplican."
      : "**PROHIBIDO** documentar `/health`, `/status`, `/auth/*`, `/login`, `/register` — ya los cubre el chunk 1.";
  return (
    `**Chunk §4 (${chunk.index + 1}/${totalChunks}):** Genera endpoints **solo** para tablas: ${tables}.\n` +
    `${commonRule}\n` +
    "No generes la tabla «Resumen de endpoints»; el pipeline la construye en código.\n" +
    "Responde solo con bloques `### MÉTODO /ruta` y payloads JSON (sin tabla GFM)."
  );
}

/** Fusiona cuerpo §4 merged en el draft baseline. */
export function mergeApiContractsBodyIntoDraft(baseline: string, mergedSection4: string): string {
  const { fragment } = processScopedArchitectResponse(mergedSection4, "api_contracts");
  const merge = tryMergeSingleArchitectSectionIntoDraft(baseline, fragment, 4);
  return merge.merged ? merge.draft : baseline;
}

/** Planifica chunks desde el draft actual (§3). */
export function planApiContractsChunksFromDraft(draft: string): {
  chunkCount: number;
  chunks: ApiContractsTableChunk[];
} {
  const section3 = extractSection3Body(draft);
  const parsed = section3 ? parseModeloDatosFromSection3Markdown(section3) : null;
  const sql = parsed?.sql ?? "";
  const tableNames = extractSqlTableNames(sql);
  const chunkCount = computeApiContractsChunkCount(tableNames.length);
  const chunks = splitTablesIntoApiContractsChunks(sql, chunkCount);
  return { chunkCount, chunks };
}

/** True si conviene fan-out paralelo (más de 7 tablas). */
export function shouldUseApiContractsChunkParallel(draft: string): boolean {
  const { chunkCount } = planApiContractsChunksFromDraft(draft);
  return chunkCount > 1;
}
