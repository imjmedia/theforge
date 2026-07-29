/**
 * Auditoría determinista de calidad MDD (agnóstica al dominio).
 * Usado por delivery gate, auditor y sanitize.
 */

import { extractSection } from "./conformance.service.js";
import { extractSectionByNumber } from "./mdd-markdown-parser.js";
import { detectTruncatedMddTail } from "@theforge/shared-types";

const PLACEHOLDER_NOISE_RE = /(?:^|\n)#+\s*[^\n]*(?:---\s*){3,}/m;

const SQL_COLUMN_TYPE_RE =
  /\b(UUID|VARCHAR|TEXT|JSONB|TIMESTAMPTZ|BOOLEAN|INTEGER|INT|BIGINT|NUMERIC|INET|DECIMAL)\b/i;

/** True si la entidad tiene definición rica en prosa §3 (columnas con tipos SQL). */
export function entityHasRichProseInSection3(section3Body: string, tableName: string): boolean {
  const body = (section3Body ?? "").trim();
  const name = tableName.toLowerCase();
  if (!body || !name) return false;

  const entityPatterns = [
    new RegExp(`^#{2,5}\\s+\`?${name}\`?\\b`, "im"),
    new RegExp(`\\*\\*\`?${name}\`?\\*\\*`, "i"),
    new RegExp(`^\\|\\s*\`?${name}\`?\\s*\\|`, "im"),
    new RegExp(`^[-*]\\s+\`?${name}\`?\\b`, "im"),
  ];
  for (const pattern of entityPatterns) {
    const match = body.match(pattern);
    if (!match || match.index == null) continue;
    const slice = body.slice(match.index, match.index + 1_200);
    if (SQL_COLUMN_TYPE_RE.test(slice)) return true;
    if ((slice.match(/\|\s*[a-z_][a-z0-9_]*\s*\|/gi) ?? []).length >= 2) return true;
  }
  return false;
}

/** Elimina CREATE TABLE mínimos cuando la misma entidad ya está definida en prosa §3. */
export function removeThinSqlStubsWhenProseRich(draft: string): string {
  const section3 = extractSectionByNumber(draft, 3) ?? extractSection(
    draft,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+(?:de\s+)?datos)/im,
  );
  if (!section3) return draft;

  const sqlMatch = section3.match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return draft;

  const createRe =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?\s*\(([\s\S]*?)\)\s*;/gi;
  let sql = sqlMatch[1];
  let changed = false;
  let m: RegExpExecArray | null;
  const toRemove: string[] = [];

  while ((m = createRe.exec(sqlMatch[1])) !== null) {
    const tableName = m[1]!.toLowerCase();
    const body = m[2] ?? "";
    const colLines = body
      .split(/,\s*\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(primary\s+key|constraint|unique|check|foreign\s+key)/i.test(l));
    const businessCols = colLines.filter(
      (l) => !/^(id|created_at|updated_at)\b/i.test(l.split(/\s+/)[0] ?? ""),
    );
    const isThin = businessCols.length <= 1 && colLines.length <= 4;
    if (isThin && entityHasRichProseInSection3(section3, tableName)) {
      toRemove.push(m[0]);
    }
  }

  for (const block of toRemove) {
    sql = sql.replace(block, "");
    changed = true;
  }
  if (!changed) return draft;

  sql = sql
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
  const newSection3 = section3.replace(sqlMatch[0], `\`\`\`sql\n${sql}\n\`\`\``);
  return draft.replace(section3, newSection3);
}

/** Bloque UI/UX genérico (columnas id,name,status repetidas) fuera de §1–§7. */
export function stripGenericUiUxDesignIntent(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!/##\s*UI\/UX\s+Design\s+Intent/i.test(trimmed)) return draft;
  const generic = (trimmed.match(/\bid,\s*name,\s*status\b/gi) ?? []).length >= 4;
  if (!generic) return draft;
  return trimmed.replace(/\n##\s*UI\/UX\s+Design\s+Intent[\s\S]*$/i, "").trimEnd() + "\n";
}

/** §4: bloques ```json con fences desbalanceados. */
export function detectUnbalancedJsonFences(draft: string): string | null {
  const section4 = extractSection(
    draft,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  if (!section4) return null;
  const fences = (section4.match(/```/g) ?? []).length;
  if (fences % 2 !== 0) {
    return "§4 Contratos de API: bloques ```json con fences desbalanceados (respuestas intercaladas).";
  }
  const jsonBlocks = section4.match(/```json[\s\S]*?```/gi) ?? [];
  for (const block of jsonBlocks) {
    const inner = block.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    if (!inner) continue;
    try {
      JSON.parse(inner);
    } catch {
      return "§4 Contratos de API: bloque ```json con JSON inválido o truncado.";
    }
  }
  return null;
}

/** Diagramas Mermaid sin fence ```mermaid. */
export function detectBareMermaidBlocks(draft: string): string[] {
  const issues: string[] = [];
  const lines = (draft ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^mermaid\s*$/i.test(line)) {
      const next = lines[i + 1]?.trim() ?? "";
      if (/^(flowchart|sequenceDiagram|erDiagram|graph\s)/i.test(next)) {
        issues.push(`Línea ${i + 1}: diagrama Mermaid sin fence \`\`\`mermaid.`);
      }
    }
    if (/^(flowchart|sequenceDiagram)\s/i.test(line)) {
      const prev = lines[i - 1]?.trim() ?? "";
      if (!/^```\s*mermaid/i.test(prev) && prev !== "mermaid") {
        issues.push(`Línea ${i + 1}: ${line.split(/\s/)[0]} suelto sin \`\`\`mermaid.`);
      }
    }
  }
  return issues.slice(0, 6);
}

/** Tablas SQL con ≤2 columnas de negocio y sin FK referenciada en el ER. */
export function detectOrphanSqlTables(draft: string): string[] {
  const sqlMatch = draft.match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return [];
  const sql = sqlMatch[1];
  const orphans: string[] = [];
  const createRe = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql)) !== null) {
    const name = m[1]!.toLowerCase();
    const body = m[2] ?? "";
    const colLines = body
      .split(/,\s*\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(primary\s+key|constraint|unique|check|foreign\s+key)/i.test(l));
    const businessCols = colLines.filter(
      (l) => !/^(id|created_at|updated_at)\b/i.test(l.split(/\s+/)[0] ?? ""),
    );
    if (businessCols.length <= 1 && colLines.length <= 3) {
      orphans.push(name);
    }
  }
  if (orphans.length === 0) return [];
  const erBlock = draft.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? "";
  const unreferenced = orphans.filter((t) => {
    const inEr = new RegExp(`\\b${t}\\b`, "i").test(erBlock);
    const fkRef = new RegExp(`references\\s+${t}\\b`, "i").test(sql);
    return !inEr && !fkRef;
  });
  return unreferenced.map((t) => `Tabla huérfana en §3: \`${t}\` (sin columnas de negocio ni relaciones útiles).`);
}

/** Manifest JSON en §7 truncado o inválido. */
export function detectInvalidInfraManifest(draft: string): string | null {
  const section7 = extractSection(
    draft,
    /^#+\s*(?:7\.\s*)?(?:infraestructura|infra|integraci[oó]n)/im,
  );
  if (!section7 || section7.length < 80) return null;
  const jsonMatch = section7.match(/```json\s*\n([\s\S]*?)```/);
  if (!jsonMatch?.[1]) {
    if (/manifest\s+de\s+infraestructura/i.test(section7) && /"stack"\s*:/i.test(section7)) {
      return "§7: Manifest de Infraestructura presente pero sin bloque ```json válido.";
    }
    return null;
  }
  try {
    const obj = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    const stack = obj.stack;
    if (stack == null || (typeof stack === "object" && Object.keys(stack as object).length === 0)) {
      return "§7: Manifest JSON sin objeto `stack` definido.";
    }
    const security = (stack as Record<string, unknown>)?.security ?? obj.security;
    if (security && typeof security === "object" && "hashing_algorithm" in (security as object)) {
      return null;
    }
    if (/hashing_algorithm|Argon2/i.test(section7) && !/"hashing_algorithm"/i.test(jsonMatch[1])) {
      return "§7: Manifest JSON truncado (falta security.hashing_algorithm u otros campos).";
    }
  } catch {
    return "§7: Manifest de Infraestructura con JSON inválido o truncado.";
  }
  return null;
}

/** Placeholders tipo `--- ---` en §1. */
export function detectPlaceholderNoise(draft: string): string | null {
  const section1 = extractSection(
    draft,
    /^#+\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im,
  );
  if (!section1) return null;
  if (PLACEHOLDER_NOISE_RE.test(section1)) {
    return "§1 Contexto: línea placeholder con guiones repetidos (---); completar objetivos comerciales.";
  }
  if (/^#+\s*[^\n]*\s+---\s+---/m.test(section1)) {
    return "§1 Contexto: heading con separadores --- sin contenido sustancial.";
  }
  if (/(?:^|\n)[^\n]*---\s+---\s+---/m.test(section1)) {
    return "§1 Contexto: placeholder con guiones repetidos (---); completar contenido.";
  }
  return null;
}

const AUTO_REPAIRABLE_QUALITY_RE =
  /fences desbalanceados|JSON inválido|Tabla huérfana|Manifest de Infraestructura|placeholder con guiones|Mermaid sin fence/i;

const AUTO_REPAIRABLE_CROSS_CONSISTENCY_RE =
  /§6\/§7|api_prefix|outbox-like|outbox pattern|prosa inválida|versión Node distinta|node:|hashing_algorithm|microservicios pero §2|second_approver|approve-first|segundo_aprobador|§6 menciona tabla|Manifest §7|Tabla solicitudes_exportacion|approved_by|aprobación dual|Bloque SQL contiene|```sql sin cerrar|TechnicalMetadata|repite headings de §5|Diagrama Mermaid inválido|ERR_MERMAID|ERR_TABLE_SYNTAX|tabla markdown/i;

/** True si el issue puede intentar repararse sin intervención del usuario. */
export function isAutoRepairableMddQualityIssue(issue: string): boolean {
  return AUTO_REPAIRABLE_QUALITY_RE.test(issue);
}

/** Coherencia cruzada §2–§7 reparable determinísticamente o por agente (no bloquear al usuario). */
export function isAutoRepairableCrossConsistencyIssue(issue: string): boolean {
  return AUTO_REPAIRABLE_CROSS_CONSISTENCY_RE.test(issue);
}

/** Warnings del delivery gate que no deben bloquear persistencia ni agobiar al usuario. */
export function isAutoRepairableDeliveryGateWarning(issue: string): boolean {
  return (
    isAutoRepairableMddQualityIssue(issue) ||
    isAutoRepairableCrossConsistencyIssue(issue)
  );
}

/** Nombres de tablas §3 marcadas como huérfanas (misma heurística que detectOrphanSqlTables). */
export function listOrphanSqlTableNames(draft: string): string[] {
  const section3 = extractSectionByNumber(draft, 3) ?? extractSection(
    draft,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+(?:de\s+)?datos)/im,
  );
  const sqlMatch = (section3 ?? draft).match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return [];
  const sql = sqlMatch[1];
  const orphans: string[] = [];
  const createRe =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql)) !== null) {
    const name = m[1]!.toLowerCase();
    const body = m[2] ?? "";
    const colLines = body
      .split(/,\s*\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(primary\s+key|constraint|unique|check|foreign\s+key)/i.test(l));
    const businessCols = colLines.filter(
      (l) => !/^(id|created_at|updated_at)\b/i.test(l.split(/\s+/)[0] ?? ""),
    );
    if (businessCols.length <= 1 && colLines.length <= 3) orphans.push(name);
  }
  if (orphans.length === 0) return [];
  const erBlock = draft.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? "";
  return orphans.filter((t) => {
    if (section3 && entityHasRichProseInSection3(section3, t)) return false;
    const inEr = new RegExp(`\\b${t}\\b`, "i").test(erBlock);
    const fkRef = new RegExp(`references\\s+${t}\\b`, "i").test(sql);
    return !inEr && !fkRef;
  });
}

function suggestOrphanTableColumns(tableName: string): string[] {
  const n = tableName.toLowerCase();
  const byName: Record<string, string[]> = {
    conversation_memory: [
      "session_id UUID NOT NULL",
      "content TEXT NOT NULL",
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    ],
    messages: [
      "conversation_id UUID NOT NULL",
      "role VARCHAR(32) NOT NULL",
      "content TEXT NOT NULL",
    ],
    requests: [
      "method VARCHAR(8) NOT NULL",
      "path TEXT NOT NULL",
      "status_code INT",
      "request_payload JSONB",
    ],
    llm_configs: [
      "provider VARCHAR(64) NOT NULL",
      "model VARCHAR(128) NOT NULL",
      "parameters JSONB NOT NULL DEFAULT '{}'::jsonb",
    ],
    mcp_plugins: [
      "plugin_key VARCHAR(128) NOT NULL",
      "enabled BOOLEAN NOT NULL DEFAULT true",
      "config JSONB NOT NULL DEFAULT '{}'::jsonb",
    ],
  };
  if (byName[n]) return byName[n];
  if (n.endsWith("_configs") || n.endsWith("_settings")) {
    return ["label VARCHAR(255) NOT NULL", "config JSONB NOT NULL DEFAULT '{}'::jsonb"];
  }
  if (n.includes("memory")) {
    return ["context_key VARCHAR(128) NOT NULL", "content TEXT NOT NULL"];
  }
  return ["name VARCHAR(255) NOT NULL", "payload JSONB NOT NULL DEFAULT '{}'::jsonb"];
}

function findSqlParentTable(sql: string): string | null {
  const tables = [
    ...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
  for (const preferred of ["tenants", "users", "organizations", "projects", "workspaces"]) {
    if (tables.includes(preferred)) return preferred;
  }
  return tables[0] ?? null;
}

/** Añade columnas de negocio y FK opcional a tablas §3 huérfanas (determinista). */
export function enrichOrphanSqlTablesInDraft(draft: string): string {
  const section3 = extractSectionByNumber(draft, 3) ?? extractSection(
    draft,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+(?:de\s+)?datos)/im,
  );
  const sqlMatch = (section3 ?? draft).match(/```sql\s*([\s\S]*?)```/i);
  if (!sqlMatch?.[1]) return draft;
  const orphanNames = listOrphanSqlTableNames(draft);
  if (orphanNames.length === 0) return draft;

  let sql = sqlMatch[1];
  const parent = findSqlParentTable(sql);
  for (const tableName of orphanNames) {
    if (section3 && entityHasRichProseInSection3(section3, tableName)) continue;
    const createRe = new RegExp(
      `(\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["\`]?${tableName}["\`]?\\s*\\()([\\s\\S]*?)(\\)\\s*;)`,
      "i",
    );
    sql = sql.replace(createRe, (_full, open: string, body: string, close: string) => {
      const cols = suggestOrphanTableColumns(tableName);
      const fk =
        parent && parent !== tableName.toLowerCase()
          ? `${parent.slice(0, -1)}_id UUID REFERENCES ${parent}(id)`
          : null;
      const additions = [...cols, ...(fk ? [fk] : [])];
      const trimmedBody = body.trimEnd();
      const sep = trimmedBody.endsWith(",") || trimmedBody.length === 0 ? "\n  " : ",\n  ";
      return `${open}${trimmedBody}${sep}${additions.join(",\n  ")}${close}`;
    });
  }
  return draft.replace(sqlMatch[0], `\`\`\`sql\n${sql.trimEnd()}\n\`\`\``);
}

/** Elimina placeholders `--- ---` en §1 y normaliza headings ruidosos. */
export function stripContextPlaceholderDashes(draft: string): string {
  const section1 = extractSection(
    draft,
    /^#+\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im,
  );
  if (!section1) return draft;
  let cleaned = section1
    .replace(/^#+\s*([^\n]*?)\s+---\s+---[^\n]*$/gm, "## 1. Contexto y Alcance")
    .replace(/^[^\n#][^\n]*---\s+---\s+---[^\n]*$/gm, "")
    .replace(/^[^\n#][^\n]*---\s+---[^\n]*$/gm, "")
    .replace(/^###\s+([A-Za-zÁÉÍÓÚÑ][^\n]{0,100}?)\s*-\s+/gm, "- **$1:** ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  if (cleaned === section1) return draft;
  const idx = draft.indexOf(section1);
  if (idx === -1) return draft;
  return draft.slice(0, idx) + cleaned + draft.slice(idx + section1.length);
}

/** Envuelve JSON suelto de manifest §7 en fence ```json o repara bloque inválido. */
export function fixLooseInfraManifestJson(draft: string): string {
  const headingRe = /^#+\s*(?:7\.\s*)?(?:Infraestructura|Integración)\b/im;
  const headingMatch = draft.match(headingRe);
  if (!headingMatch || headingMatch.index === undefined) return draft;

  const sectionStart = headingMatch.index;
  const bodyStart = sectionStart + headingMatch[0].length;
  const rest = draft.slice(bodyStart);
  const nextH2 = rest.search(/\n##\s+/);
  const sectionEnd = nextH2 === -1 ? draft.length : bodyStart + nextH2;
  const section7 = draft.slice(bodyStart, sectionEnd);

  const fenced = section7.match(/```json\s*\n([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      JSON.parse(fenced[1]);
      return draft;
    } catch {
      const repaired = fenced[1]
        .replace(/^>\s?/gm, "")
        .replace(/```/g, "")
        .trim();
      try {
        const pretty = JSON.stringify(JSON.parse(repaired) as unknown, null, 2);
        const fixedSection = section7.replace(
          fenced[0],
          `\`\`\`json\n${pretty}\n\`\`\``,
        );
        return draft.slice(0, bodyStart) + fixedSection + draft.slice(sectionEnd);
      } catch {
        // fall through to loose-json extraction
      }
    }
  }

  const loose = section7.match(/\{\s*"stack"\s*:[\s\S]*\}/);
  if (loose) {
    try {
      const pretty = JSON.stringify(JSON.parse(loose[0]) as unknown, null, 2);
      const fixedSection = section7.replace(
        loose[0],
        `\`\`\`json\n${pretty}\n\`\`\``,
      );
      return draft.slice(0, bodyStart) + fixedSection + draft.slice(sectionEnd);
    } catch {
      return draft;
    }
  }

  if (/manifest\s+de\s+infraestructura/i.test(section7) && /Argon2id|DLQ|CloudFront/i.test(section7)) {
    const manifest = {
      stack: {
        security: { hashing_algorithm: /Argon2id/i.test(section7) ? "Argon2id" : undefined },
        messaging: /DLQ|dead[- ]?letter/i.test(section7) ? { dlq: true } : undefined,
        frontend: /CloudFront|S3/i.test(section7) ? { deploy: "cloudfront_s3" } : undefined,
      },
    };
    const block = `\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\``;
    if (!/"stack"\s*:/i.test(section7)) {
      const fixedSection = `${section7.trimEnd()}\n\n${block}\n`;
      return draft.slice(0, bodyStart) + fixedSection + draft.slice(sectionEnd);
    }
  }

  return draft;
}

/**
 * Pasada determinista de calidad MDD: repara lo posible sin LLM.
 * Idempotente; devuelve lista de acciones aplicadas (para logs).
 */
export function applyMddQualityAutoRepairs(draft: string): { markdown: string; repairs: string[] } {
  const repairs: string[] = [];
  let out = draft ?? "";

  const run = (label: string, fn: (s: string) => string) => {
    const next = fn(out);
    if (next !== out) {
      repairs.push(label);
      out = next;
    }
  };

  for (let pass = 0; pass < 3; pass++) {
    const beforeIssues = collectMddQualityIssues(out).length;
    run("§1 placeholders", stripContextPlaceholderDashes);
    run("§3 SQL/prosa duplicada", removeThinSqlStubsWhenProseRich);
    run("UI/UX genérico", stripGenericUiUxDesignIntent);
    run("§4/§7 JSON", fixLooseInfraManifestJson);
    run("§3 tablas huérfanas", enrichOrphanSqlTablesInDraft);
    run("Mermaid fences", fixBareMermaidFences);
    const afterIssues = collectMddQualityIssues(out).length;
    if (afterIssues >= beforeIssues) break;
  }

  return { markdown: out, repairs };
}

/** Envuelve bloques mermaid sueltos en fences. */
export function fixBareMermaidFences(draft: string): string {
  let out = draft ?? "";
  out = out.replace(
    /(?:^|\n)(mermaid)\s*\n((?:flowchart|sequenceDiagram|erDiagram|graph\s)[\s\S]*?)(?=\n```|\n##\s|\n---\s*\n|$)/gim,
    (_full, _kw, body) => `\n\`\`\`mermaid\n${String(body).trim()}\n\`\`\``,
  );
  out = out.replace(
    /(?:^|\n)((?:flowchart|sequenceDiagram)\s[\s\S]*?)(?=\n```|\n##\s|\n---\s*\n|$)/gim,
    (match, body, offset: number) => {
      const before = out.slice(0, offset).trimEnd();
      if (/```\s*mermaid\s*$/i.test(before.split("\n").pop() ?? "")) return match;
      return `\n\`\`\`mermaid\n${String(body).trim()}\n\`\`\``;
    },
  );
  return out;
}

/** Agrega issues de calidad MDD para validateMddStructure / delivery gate. */
export function collectMddQualityIssues(draft: string): string[] {
  const issues: string[] = [];
  const jsonIssue = detectUnbalancedJsonFences(draft);
  if (jsonIssue) issues.push(jsonIssue);
  issues.push(...detectBareMermaidBlocks(draft));
  issues.push(...detectOrphanSqlTables(draft));
  const manifestIssue = detectInvalidInfraManifest(draft);
  if (manifestIssue) issues.push(manifestIssue);
  const placeholderIssue = detectPlaceholderNoise(draft);
  if (placeholderIssue) issues.push(placeholderIssue);
  const truncatedIssue = detectTruncatedMddTail(draft);
  if (truncatedIssue) issues.push(truncatedIssue);
  return issues;
}

export type InfraManifestRequirement = {
  hashingAlgorithm?: string;
  rateLimitEndpoints?: string[];
  dlqRequired?: boolean;
  messagingBroker?: "rabbitmq" | "celery";
  celeryHealthPath?: string;
  staticDeploy?: "cloudfront_s3" | "nginx_container";
};

/** Extrae requisitos del manifest / prosa §7 para conformance Infra. */
export function extractMddInfraRequirements(mddContent: string): InfraManifestRequirement {
  const section7 = extractSection(
    mddContent,
    /^#+\s*(?:7\.\s*)?(?:infraestructura|infra|integraci[oó]n)/im,
  );
  const req: InfraManifestRequirement = {};
  if (!section7) return req;

  const jsonMatch = section7.match(/```json\s*\n([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      const obj = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      const stack = (obj.stack ?? {}) as Record<string, unknown>;
      const security = (stack.security ?? obj.security) as Record<string, unknown> | undefined;
      if (typeof security?.hashing_algorithm === "string") {
        req.hashingAlgorithm = security.hashing_algorithm;
      }
    } catch {
      // prose fallback below
    }
  }

  if (/Argon2id/i.test(section7)) req.hashingAlgorithm = "Argon2id";
  if (/dead[- ]?letter|DLQ/i.test(section7)) req.dlqRequired = true;
  if (/RabbitMQ|rabbitmq/i.test(section7)) req.messagingBroker = "rabbitmq";
  if (/Celery|celery/i.test(section7) && !req.messagingBroker) req.messagingBroker = "celery";
  if (/\/health.*Celery|Celery.*\/health/i.test(section7)) req.celeryHealthPath = "/health";
  if (/CloudFront|S3.*origen/i.test(section7)) req.staticDeploy = "cloudfront_s3";
  if (/nginx.*contenedor|nginx.*frontend/i.test(section7) && !req.staticDeploy) {
    req.staticDeploy = "nginx_container";
  }

  const rateLimits: string[] = [];
  if (/POST\s+\/api\/v1\/auth\/token.*\d+\s*req/i.test(section7)) rateLimits.push("POST /api/v1/auth/token");
  if (/POST\s+\/api\/v1\/auth\/refresh.*\d+\s*req/i.test(section7)) rateLimits.push("POST /api/v1/auth/refresh");
  if (rateLimits.length > 0) req.rateLimitEndpoints = rateLimits;

  return req;
}

/** Gaps Infra vs manifest §7 (determinista). */
export function checkInfraManifestConformance(
  mddContent: string,
  infraContent: string,
): string[] {
  const gaps: string[] = [];
  const req = extractMddInfraRequirements(mddContent);
  const infraLower = (infraContent ?? "").trim().toLowerCase();
  if (!infraLower || infraLower.length < 80) return gaps;

  if (req.hashingAlgorithm && !infraLower.includes(req.hashingAlgorithm.toLowerCase())) {
    gaps.push(
      `MDD §7 exige hashing ${req.hashingAlgorithm}; no aparece en el doc de Infra`,
    );
  }
  if (req.dlqRequired && !/\b(dlq|dead[- ]?letter)\b/i.test(infraLower)) {
    const broker = req.messagingBroker ?? "celery";
    gaps.push(
      broker === "rabbitmq"
        ? "MDD §7 exige Dead Letter Queue (DLQ) para RabbitMQ; no aparece en Infra"
        : "MDD §7 exige Dead Letter Queue (DLQ) para Celery; no aparece en Infra",
    );
  }
  if (req.messagingBroker === "rabbitmq" && !/\brabbitmq\b/i.test(infraLower)) {
    gaps.push("MDD §7 declara RabbitMQ; no documentado en Infra");
  }
  if (req.celeryHealthPath && !/\/health\b/i.test(infraContent)) {
    gaps.push("MDD §7 exige healthcheck HTTP /health en worker Celery; no documentado en Infra");
  }
  if (req.rateLimitEndpoints?.length) {
    for (const ep of req.rateLimitEndpoints) {
      const slug = ep.replace(/\s+/g, " ").toLowerCase();
      if (!infraLower.includes(slug.split(" ").pop() ?? "") && !/rate\s*limit/i.test(infraLower)) {
        gaps.push(`MDD §7 exige rate limiting en ${ep}; no reflejado en Infra`);
        break;
      }
    }
  }
  if (req.staticDeploy === "cloudfront_s3" && /\bnginx\b/i.test(infraLower) && !/cloudfront|s3/i.test(infraLower)) {
    gaps.push("MDD §7 especifica CloudFront+S3 para frontend; Infra documenta nginx en contenedor");
  }

  return gaps;
}

/** Alias semánticos de rutas API (warning, no missing). */
export const API_PATH_SEMANTIC_ALIASES: Array<{ mdd: RegExp; api: RegExp; label: string }> = [
  {
    mdd: /POST\s+\/api\/v1\/auth\/token/i,
    api: /POST\s+\/api\/v1\/auth\/login/i,
    label: "auth/token ↔ auth/login",
  },
  {
    mdd: /GET\s+\/api\/v1\/audit-logs/i,
    api: /GET\s+\/api\/v1\/audit-trail/i,
    label: "audit-logs ↔ audit-trail",
  },
  {
    mdd: /POST\s+\/api\/v1\/webhook\/whatsapp/i,
    api: /POST\s+\/api\/v1\/whatsapp\/webhook/i,
    label: "webhook/whatsapp ↔ whatsapp/webhook",
  },
];

export function findApiSemanticAliasWarnings(
  mddContent: string,
  apiContent: string,
): string[] {
  const warnings: string[] = [];
  for (const alias of API_PATH_SEMANTIC_ALIASES) {
    if (alias.mdd.test(mddContent) && alias.api.test(apiContent)) {
      warnings.push(`Alias de ruta detectado (${alias.label}); alinear API Contracts con MDD §4 canónico.`);
    }
  }
  return warnings;
}

export type ConformanceSummary = {
  ok: boolean;
  api: { ok: boolean; missingCount: number; extraCount: number; aliasWarnings: string[] };
  infra: { ok: boolean; gapCount: number; gaps: string[] };
  blueprint: { ok: boolean };
  logicFlows: { ok: boolean };
};
