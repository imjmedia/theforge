/**
 * Reparaciones heurísticas para markdown pegado desde Word/Excel/chat (sin LLM).
 */

import { repairCollapsedSqlParagraphs, repairCollapsedSqlInsideFences, repairFragmentedSqlFences, openFenceLangBeforeCloseLine } from "./repair-collapsed-sql.js";
import { repairDirectoryTreeBlocks } from "./repair-directory-tree.js";
import { repairFlowSectionsToMermaid } from "./repair-flow-sections.js";
import { repairInfraMarkdown } from "./repair-infra-markdown.js";

const SQL_GLUE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/DEFAULT_NOW\(\)/gi, "DEFAULT NOW()"],
  [/DEFAULT_gen_random_uuid\(\)/gi, "DEFAULT gen_random_uuid()"],
  [/NOT_NULL_REFERENCES/gi, "NOT NULL REFERENCES"],
  [/UUID\s+NOT\s+NULL_REFERENCES/gi, "UUID NOT NULL REFERENCES"],
  [/UUID_REFERENCES/gi, "UUID REFERENCES"],
  [/REFERENCES_([a-z_]+)/gi, "REFERENCES $1"],
  [/regiON\s+estado\s*\(/gi, "region_estado("],
  [/REFERENCES\s+regi[oó]n_estado/gi, "REFERENCES region_estado"],
  [/([a-z])_(VARCHAR|TEXT|JSONB|BOOLEAN|INTEGER|BIGINT|DECIMAL|TIMESTAMPTZ|INET)\b/gi, "$1 $2"],
  [/(?<![a-z])_(UUID)\b/g, " UUID"],
  [/_(NOT\s+NULL)\b/gi, " $1"],
  [/_(ON\s+DELETE)\b/gi, " $1"],
  [/_(PRIMARY\s+KEY)\b/gi, " $1"],
  [/_(REFERENCES)([a-z_])/gi, " REFERENCES$2"],
  [/_(REFERENCES)\b/gi, " REFERENCES"],
  [/([a-z_])_(ON|DEFAULT)\b/gi, "$1 $2"],
  [/\bON_(DELETE|UPDATE|CASCADE|RESTRICT|SET|NO\s+ACTION)\b/gi, "ON $1"],
  [/^_(CREATE|INDEX)\b/gim, "$1"],
];

/** Cierra bloques ```sql abiertos antes del siguiente encabezado ##. */
export function repairUnclosedCodeFences(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const openMatch = trimmed.match(/^```(\w*)\s*$/);
    if (openMatch) {
      const nextLang = openMatch[1] ?? "";
      // Bare ``` closes the active fence; do not treat it as a new empty-lang opener.
      if (inFence && nextLang === "") {
        inFence = false;
        fenceLang = "";
        out.push(line);
        continue;
      }
      if (inFence) {
        // JSON partido en dos fences consecutivos — no insertar cierre artificial
        if (fenceLang === "json" && nextLang === "json") {
          continue;
        }
        out.push("```");
      }
      inFence = true;
      fenceLang = nextLang;
      out.push(line);
      continue;
    }
    if (inFence && trimmed === "```") {
      inFence = false;
      fenceLang = "";
      out.push(line);
      continue;
    }
    if (
      inFence &&
      (/^#{1,6}\s+\S/.test(trimmed) ||
        /^\*\*(?:Response\s+\d+|Beneficios de las|Headers?:|Request body|Request query params|Backend\s*\(|Frontends\s+que)/i.test(
          trimmed,
        ))
    ) {
      if (fenceLang === "json") {
        let jsonStart = out.length - 1;
        while (jsonStart >= 0 && !/^```json/i.test(out[jsonStart]!.trim())) jsonStart--;
        const jsonBody = out.slice(jsonStart + 1).join("\n");
        const balanced = balanceJsonFenceBody(jsonBody);
        if (balanced !== jsonBody.trimEnd()) {
          out.splice(jsonStart + 1);
          out.push(...balanced.split("\n"));
        }
      }
      out.push("```");
      inFence = false;
      fenceLang = "";
    }
    out.push(line);
  }
  if (inFence) out.push("```");
  return out.join("\n");
}

/** Bloques de líneas separadas por tab → tabla GFM. */
export function repairTabSeparatedTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const tabCount = (line.match(/\t/g) ?? []).length;

    if (
      tabCount >= 1 &&
      !trimmed.startsWith("|") &&
      !trimmed.startsWith("```") &&
      !/^#{1,6}\s/.test(trimmed)
    ) {
      const block: string[][] = [];
      let j = i;
      while (j < lines.length) {
        const raw = lines[j]!;
        const t = raw.trim();
        if (!t) break;
        if (t.startsWith("|") || t.startsWith("```") || /^#{1,6}\s/.test(t)) break;
        if (!raw.includes("\t")) break;
        const cells = raw.split("\t").map((c) => c.trim().replace(/\|/g, "\\|"));
        if (cells.length < 2) break;
        block.push(cells);
        j++;
      }
      if (block.length >= 2) {
        const colCount = Math.max(...block.map((r) => r.length));
        const pad = (row: string[]) => {
          const cells = [...row];
          while (cells.length < colCount) cells.push("");
          return cells;
        };
        const header = pad(block[0]!);
        out.push(`| ${header.join(" | ")} |`);
        out.push(`| ${header.map(() => "---").join(" | ")} |`);
        for (let r = 1; r < block.length; r++) {
          const row = pad(block[r]!);
          out.push(`| ${row.join(" | ")} |`);
        }
        out.push("");
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }
  return out.join("\n");
}

/** Indentación tipo lista (4 espacios tras párrafo con ':') → bullets markdown. */
export function repairIndentedLists(text: string): string {
  return text.replace(
    /(\n(?:\d+\.\s+[^\n]+:))\n((?: {4,}[^\n]+\n?)+)/g,
    (_, intro: string, body: string) => {
      const items = body
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean)
        .map((l: string) => `- ${l.replace(/^ {4,}/, "")}`);
      return `${intro}\n${items.join("\n")}\n`;
    },
  );
}

const INDENTED_CODE_HINT =
  /^(CREATE|ALTER|SELECT|INSERT|DELETE|DROP|DECLARE|BEGIN|END\b|```|\{|\}|--\s*Tabla|--\s*Índice)/i;

/** Bloques con 4+ espacios (Word/chat) → bullets; evita que GFM los muestre como ``` code ```. */
export function repairIndentedProseBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (/^```/.test(t)) {
      inFence = t !== "```";
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (/^(\s{4,}|\t+)\S/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^(\s{4,}|\t+)/.test(lines[i]!) && !/^```/.test(lines[i]!.trim())) {
        block.push(lines[i]!.trim());
        i++;
      }
      i--;
      if (block.some((l) => INDENTED_CODE_HINT.test(l))) {
        for (const l of block) out.push(`    ${l}`);
      } else if (block.some((l) => /^#{1,6}\s/.test(l) || /^\|/.test(l))) {
        for (const l of block) {
          out.push(l.replace(/^ {4,}/, ""));
        }
        out.push("");
      } else {
        for (const l of block) {
          const item = l.replace(/^ {4,}/, "");
          out.push(item.startsWith("- ") ? item : `- ${item}`);
        }
        out.push("");
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** `**Flujo de X** **Odoo genera**` → heading + bullet */
export function repairGluedBoldFlowTitles(text: string): string {
  return text
    .replace(
      /^\*\*Flujo de procesamiento\*\*\s*\*\*Odoo genera\*\*\s*(.+)$/gim,
      "### Flujo de procesamiento\n\n- Odoo genera $1",
    )
    .replace(/^\*\*Seguridad\*\*\s*\*\*API Key\*\*\s*(.+)$/gim, "### Seguridad\n\n- API Key $1")
    .replace(/^\*\*Beneficios de las\*\*\s*tablas espejo\s*$/gim, "### Beneficios de las tablas espejo");
}

/** Índice del `}` que cierra el primer objeto JSON `{...}` (respeta strings). */
function findBalancedJsonObjectEnd(s: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) return i;
    }
  }
  return -1;
}

/** True cuando la línea anterior a `}` parece cierre legítimo de un objeto JSON. */
function isLikelyJsonClosingBrace(prevLine: string): boolean {
  const t = prevLine.trim();
  if (!t) return false;
  if (t === "{" || t.endsWith("{")) return true;
  if (/^[\]}]|,\s*$/.test(t)) return true;
  if (/:\s*["\d\[\{nulltruefals-]/i.test(t)) return true;
  if (/^\s*"[^"]+"\s*:\s*/.test(t)) return true;
  return false;
}

/** Añade `}` faltantes antes de cerrar un fence ```json. */
function balanceJsonFenceBody(body: string): string {
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }
  let fixed = body.trimEnd();
  while (depth > 0) {
    fixed += "\n}";
    depth--;
  }
  return fixed;
}

/** Cierra ```json abiertos antes de **Response**, **Beneficios**, headings, etc. */
export function repairCloseJsonBeforeContractMarkers(text: string): string {
  return text.replace(
    /```json\n([\s\S]*?)(?=\n\s*\*\*(?:Response\s+\d+|Beneficios de las|Headers?:|Request body)|\n#{1,4}\s+)/gi,
    (full, inner: string) => {
      if (/\n```/.test(inner)) return full;
      const end = findBalancedJsonObjectEnd(inner);
      if (end < 0) {
        const fixed = balanceJsonFenceBody(inner);
        return `\`\`\`json\n${fixed}\n\`\`\`\n`;
      }
      const json = inner.slice(0, end + 1).trimEnd();
      const leak = inner.slice(end + 1).trim();
      return `\`\`\`json\n${json}\n\`\`\`${leak ? `\n\n${leak}` : ""}`;
    },
  );
}

/** Elimina ``` huérfanos entre endpoints §4 y tras separadores `---`. */
export function repairOrphanContratosApiFences(text: string): string {
  let out = text.replace(
    /\n---[ \t]*\n+```[ \t]*\n+(?=\s*###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s)/gi,
    "\n---\n\n",
  );
  const lines = out.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "```" && i + 1 < lines.length) {
      const next = lines[i + 1]!.trim();
      if (/^###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/i.test(next)) {
        let open = false;
        for (let j = 0; j < i; j++) {
          const ft = lines[j]!.trim();
          if (/^```/.test(ft)) open = !open;
        }
        if (!open) continue;
      }
    }
    result.push(lines[i]!);
  }
  return result.join("\n");
}

/** Contratos API (webhook, costos-reales, JWT, env): fences JSON/env rotos. */
export function repairApiContractJsonFences(text: string): string {
  let out = text.replace(/\r\n/g, "\n");
  out = repairCloseJsonBeforeContractMarkers(out);
  out = out.replace(
    /(\*\*Response\s+\d+:\*\*)\s*\n+```\s*\n+```json/gi,
    "$1\n\n```json",
  );
  out = out.replace(
    /(\*\*Response\s+\d+:\*\*)\s*\n+(?!\s*```json)(\{)/gi,
    "$1\n\n```json\n$2",
  );
  out = out.replace(
    /(\*\*Request body[^*]*\*\*)\s*\n+(?!\s*```json)(\{)/gi,
    "$1\n\n```json\n$2",
  );
  out = out.replace(
    /```json\n([\s\S]*?)(\n\s*\*\*Beneficios de las)/gi,
    (full, inner: string, marker: string) => {
      if (/\n```/.test(inner)) return full;
      const end = findBalancedJsonObjectEnd(inner);
      if (end < 0) return full;
      const json = inner.slice(0, end + 1).trimEnd();
      return `\`\`\`json\n${json}\n\`\`\`\n${marker}`;
    },
  );
  out = out.replace(/^(#{1,4}\s+Variables de entorno)\s*\n\}\s*\n/gm, "$1\n\n");
  out = out.replace(/^\*\*Beneficios de las tablas espejo\*\*\s*$/gim, "### Beneficios de las tablas espejo");
  out = out.replace(
    /(\*\*Backend\s*\(NestJS\):\*\*|\*\*Frontends que consuman[^\n]*\*\*)\s*\n+```\s*\n+```env/gi,
    "$1\n\n```env",
  );
  return out;
}

/** ` ``` ` sueltos antes de ```json / ```env y fences duplicados. */
export function repairStackedCodeFences(text: string): string {
  let out = text.replace(/\n```\s*\n```\s*\n```(json|env|sql)\b/gi, "\n\n```$1");
  out = out.replace(/\n```[ \t]*\r?\n```(json|env|sql)\b/gi, (match, lang: string, offset: number) => {
    const openLang = openFenceLangBeforeCloseLine(out, offset + 1);
    if (openLang != null && openLang !== "" && openLang !== "sql") return match;
    return `\n\n\`\`\`${lang}`;
  });
  out = out.replace(/(\n```json\n[\s\S]*?\n```)\s*\n```json\n/gi, "$1\n");
  out = out.replace(/(\n```env\n[\s\S]*?\n```)\s*\n```env\n/gi, "$1\n");
  out = out.replace(/\n```\s*\n\n```json/g, "\n\n```json");
  out = out.replace(/\n```\s*\n\n```env/g, "\n\n```env");
  out = out.replace(/^```\s*\n(\*\*Response)/gim, "$1");
  out = out.replace(/(\*\*Response \d+:\*\*)\s*\n+```\s*\n+(?=\{)/gi, "$1\n\n```json\n");
  out = out.replace(/(\*\*Response \d+:\*\*)\s*\n+```\s*\n+```json/gi, "$1\n\n```json");
  out = out.replace(/\n\}\s*\n```\s*\n/g, (match, offset) => {
    const before = out.slice(0, offset);
    const prevLines = before.split("\n").map((l) => l.trim()).filter(Boolean);
    const prev = prevLines[prevLines.length - 1] ?? "";
    if (isLikelyJsonClosingBrace(prev)) return match;
    return "\n```\n\n";
  });
  out = out.replace(/\n###[^\n]+\n\}\s*\n```/g, (m) => m.replace(/\n\}\s*\n```/, "\n\n"));
  out = out.replace(/(#{1,6}[^\n]*\n)\}\s*\n+(?=\*\*|```)/g, "$1");
  out = out.replace(/\n\}\s*\n+(?=\*\*Backend|\*\*Frontends|```env\b)/gi, "\n\n");
  return out;
}

/** Cierra JSON / elimina fences vacíos antes de Response o **Beneficios** */
export function repairJsonFenceIntegrity(text: string): string {
  let out = text;
  out = out.replace(
    /\*\*Response (\d+)[^*]*\*\*\s*:?\s*\n+```\s*\n+```json/gi,
    "**Response $1:**\n\n```json",
  );
  // Solo marcadores de contrato API (**Request body:** / **Response N:**), no cualquier **bold**.
  out = repairCloseJsonBeforeContractMarkers(out);
  out = out.replace(
    /```json\n([\s\S]*?)(?=\n###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s)/gi,
    (full, inner: string) => {
      if (/^\s*```/m.test(inner)) return full;
      const end = findBalancedJsonObjectEnd(inner);
      if (end >= 0) {
        const json = inner.slice(0, end + 1).trimEnd();
        return `\`\`\`json\n${json}\n\`\`\`\n`;
      }
      const fixed = balanceJsonFenceBody(inner);
      return `\`\`\`json\n${fixed}\n\`\`\`\n`;
    },
  );
  out = out.replace(/(\n```json\n[\s\S]*?\n)(\n\*\*Beneficios)/g, (m, block: string, rest: string) => {
    if (block.trimEnd().endsWith("```")) return m;
    const inner = block.replace(/^```json\n/, "").trimEnd();
    const closed = inner.endsWith("}") ? inner : `${inner}\n}`;
    return `\n\`\`\`json\n${closed}\n\`\`\`\n${rest}`;
  });
  out = repairSplitJsonFragments(out);
  return out;
}

/** `**Donde:** - item` en una línea → párrafo + bullets */
export function repairDondeGluedBullets(text: string): string {
  return text.replace(
    /^\*\*Donde:\*\*\s*-\s*(.+)$/gim,
    "**Donde:**\n\n- $1",
  ).replace(
    /(\*\*Donde:\*\*[^\n]*)\n-\s*De \*\*/g,
    "$1\n\n- De **",
  );
}

export function repairGluedSqlTokens(text: string): string {
  let out = text;
  for (const [re, rep] of SQL_GLUE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  out = out.replace(/idx_[a-z0-9_]+_ON_/gi, (m) => m.replace(/_ON_/, "_ON "));
  return out;
}

/** Tabla portada rota: `| | |` + filas de metadatos. */
export function repairMetadataCoverTable(text: string): string {
  return text.replace(
    /^(\s*#\s+[^\n]+\n)\s*\|\s*\|\s*\|\s*\n\s*\|[-:\s|]+\|\s*\n((?:\|[^\n]+\|\s*\n?)+)/m,
    (_m, title: string, rows: string) => {
      const rowLines = rows.trim().split("\n").filter((l) => /^\|/.test(l.trim()));
      return `${title}| Campo | Valor |\n| --- | --- |\n${rowLines.join("\n")}\n\n`;
    },
  );
}

const DO_NOT_PROMOTE_TITLE =
  /^(Headers?:|Request body|Response \d+|Recibe eventos|Content-Type|X-Odoo|Beneficios de las|Flujo de procesamiento|Seguridad|Donde:|Detalle ejecutable|OBP4MO \(normalizado\):|OBP \(desnormalizado\):|Este microservicio tiene|Odoo genera|Endpoint receptor de webhooks$)/i;

/** Encabezados sueltos (sin #) que deberían ser sección. */
export function repairPromoteBareSectionHeadings(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const isBareTitle = (t: string, prev: string, next: string): boolean => {
    if (t.length < 4 || t.length > 100) return false;
    if (DO_NOT_PROMOTE_TITLE.test(t)) return false;
    if (/^#{1,6}\s/.test(t)) return false;
    if (t.startsWith("|") || t.startsWith("```")) return false;
    if (/^[-*]\s/.test(t)) return false;
    if (/^🔴|^🟡|^🟢/.test(t)) return false;
    if (/^[-*_]{3,}$/.test(t)) return false;
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(t)) return false;
    if (/^Módulo \d+ —/.test(t)) return false;
    if (/^contexto:/i.test(t)) return false;
    if (/[.!?]\s*$/.test(t) && t.length > 40) return false;
    if (/:$/.test(t) && t.length < 60) return false;
    if (!/^[A-ZÁÉÍÓÚÑ0-9]/.test(t)) return false;
    if (/^[{\[]/.test(next)) return true;
    if (prev === "" && (next === "" || next.startsWith("-") || next.startsWith("|"))) return true;
    if (prev === "" && /^[A-Za-z].{0,80}$/.test(t) && !t.includes(". ")) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    const prev = i > 0 ? (lines[i - 1] ?? "").trim() : "";
    const next = i + 1 < lines.length ? (lines[i + 1] ?? "").trim() : "";
    if (/^Módulo \d+ —/.test(t)) {
      out.push(`### ${t}`);
      continue;
    }
    if (/^Feature candidates/i.test(t)) {
      out.push(`## ${t}`);
      continue;
    }
    if (/^Riesgos y mitigaciones/i.test(t)) {
      out.push(`## ${t}`);
      continue;
    }
    if (/^Esquema SQL/i.test(t)) {
      out.push(/^#{1,4}\s/.test(t) ? line : `### ${t}`);
      continue;
    }
    if (/^Flujo de sincronización/i.test(t)) {
      out.push(`### ${t}`);
      continue;
    }
    if (/^Endpoint de recepción/i.test(t)) {
      out.push(`### ${t}`);
      continue;
    }
    if (isBareTitle(t, prev, next)) {
      out.push(`### ${t}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Abre ```sql antes de bloques CREATE sueltos (sin fence). */
export function repairOrphanSqlBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inSqlFence = false;
  let inAnyFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (/^```/.test(t)) {
      if (inSqlFence) {
        out.push("```");
        inSqlFence = false;
      }
      inAnyFence = t !== "```";
      out.push(line);
      if (t === "```") inAnyFence = false;
      continue;
    }
    if (inAnyFence) {
      out.push(line);
      continue;
    }
    const sqlStart =
      /^Esquema SQL\b/i.test(t) ||
      /^CREATE TABLE\b/i.test(t) ||
      /^CREATE INDEX\b/i.test(t) ||
      /^-- Tabla espejo/i.test(t);
    if (!inSqlFence && sqlStart) {
      out.push("```sql");
      inSqlFence = true;
    }
    if (inSqlFence && /^#{1,6}\s+CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/i.test(t)) {
      out.push(line.replace(/^#{1,6}\s+/, ""));
      continue;
    }
    if (inSqlFence && /^#{1,6}\s/.test(t)) {
      out.push("```");
      inSqlFence = false;
    }
    if (
      inSqlFence &&
      t === "" &&
      i + 1 < lines.length &&
      /^#{1,6}\s/.test((lines[i + 1] ?? "").trim())
    ) {
      out.push("```");
      inSqlFence = false;
    }
    out.push(line);
  }
  if (inSqlFence) out.push("```");
  return out.join("\n");
}

/** Líneas ``` huérfanas o duplicadas tras fences bien formados. */
export function repairStrayCodeFences(text: string): string {
  let out = text.replace(/\n```[a-z]*\s*\n```\s*\n/gi, "\n\n");
  out = out.replace(/(\n```\s*\n){2,}/g, "\n\n");
  const lines = out.split("\n");
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "```") {
      const prev = cleaned[cleaned.length - 1]?.trim() ?? "";
      const next = lines[i + 1]?.trim() ?? "";
      if (prev === "```" || next === "```") continue;
    }
    cleaned.push(lines[i]!);
  }
  return cleaned.join("\n");
}

/** Línea en blanco entre headings / párrafos y tablas GFM. */
export function repairTableBoundaries(text: string): string {
  let out = text.replace(/^(#{1,6}\s+[^\n]+)\n(\|)/gm, "$1\n\n$2");
  out = out.replace(/(\n\|[^\n]+\|)\n(#{1,6}\s+)/g, "$1\n\n$2");
  out = out.replace(/^(contexto:[^\n]+)\n(\|)/gim, "$1\n\n$2");
  return out;
}

/** Diagramas ASCII multilínea (arquitectura, cajas con `|`, `│`, `┌`, `▼`, etc.). */
const ASCII_BOX_DRAWING_RE = /[┌┐└┘┬┴┼╔╗╚╝╠╣╦╩╬│┃─━┄┅┆┇┈┉┊┋╭╮╰╯╱╲]/;
const ASCII_ARROW_OR_TRIANGLE_RE = /[▼▲►◄↔↕]|(?:-{2,}>|={2,}>)/;

function countDiagramPipes(text: string): number {
  return (text.match(/[|│]/g) ?? []).length;
}

function looksLikeErDiagramLine(line: string): boolean {
  const t = line.trim();
  if (/^[A-Za-z_][\w]*\s*\{\s*$/.test(t)) return true;
  if (/^\}\s*$/.test(t)) return true;
  if (/^[A-Za-z_][\w-]*\s+\|\|--/.test(t)) return true;
  if (/^(uuid|string|int|boolean|datetime|fk)\s+\w+/i.test(t)) return true;
  if (/^\w+\s+(PK|FK)\b/i.test(t)) return true;
  return false;
}

/** SQL/DDL lines must not be wrapped as ASCII ```text``` diagrams (Copiloto §3). */
function looksLikeSqlStatementLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (
    /^(CREATE|ALTER|DROP|INSERT|SELECT|UPDATE|DELETE|REFERENCES|CONSTRAINT|PRIMARY|UNIQUE|INDEX|ON\s+DELETE|ON\s+UPDATE)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^--\s/.test(t)) return true;
  if (/\b(?:UUID|VARCHAR|TEXT|JSONB|BOOLEAN|INTEGER|BIGINT|TIMESTAMPTZ|INET)\b/i.test(t) && /[(),]/.test(t)) {
    return true;
  }
  if (/^\s*[a-z_][a-z0-9_]*\s+(?:UUID|VARCHAR|TEXT|JSONB|BOOLEAN|INTEGER)\b/i.test(t)) return true;
  if (/^erDiagram\b/i.test(t)) return true;
  return false;
}

function looksLikeMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  if (!/^\|.*\|$/.test(t)) return false;
  if (/^\|[\s:\-|]+\|$/.test(t) && /[-:]/.test(t)) return true;
  if (/[┌┐└┘┬┴┼▼▲│┃─━_]{2,}/.test(t)) return false;
  const cells = t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  if (cells.length < 2) return false;
  const substantiveCells = cells.filter((c) => /[A-Za-z0-9áéíóúÁÉÍÓÚñÑ]{2,}/.test(c));
  return substantiveCells.length >= 2;
}

export function looksLikeAsciiDiagramLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^```/.test(t)) return false;
  if (/^#{1,6}\s/.test(t)) return false;
  if (looksLikeSqlStatementLine(line)) return false;
  if (looksLikeErDiagramLine(line)) return false;
  if (looksLikeMarkdownTableLine(line)) return false;

  if (ASCII_BOX_DRAWING_RE.test(t)) return true;
  if (ASCII_ARROW_OR_TRIANGLE_RE.test(t)) return true;
  if (/_{4,}/.test(t)) return true;
  if (/[+\-|│][\-_=]{3,}[+\-|│]/.test(t)) return true;

  const pipes = countDiagramPipes(t);
  if (pipes >= 2) return true;
  if (pipes >= 1 && (/^[\s|│+\-_=\\/:.]+$/.test(t) || /_{2,}/.test(t))) return true;

  return false;
}

function looksLikeAsciiDiagramContinuation(line: string): boolean {
  if (looksLikeSqlStatementLine(line)) return false;
  if (looksLikeErDiagramLine(line)) return false;
  if (looksLikeAsciiDiagramLine(line)) return true;
  const t = line.trim();
  if (!t) return true;
  if (/^#{1,6}\s/.test(t)) return false;
  if (/^[-*]\s+\S/.test(t)) return false;
  if (/^\d+\.\s+\S/.test(t)) return false;
  if (t.length > 160) return false;
  if (/[.!?]\s+[A-ZÁÉÍÓÚÑ]/.test(t)) return false;
  if (/^[|│].*[|│]$/.test(t)) {
    if (looksLikeMarkdownTableLine(line)) return false;
    return true;
  }
  if (countDiagramPipes(t) >= 1 && /^[\s|│+\-_=\\/:.]+$/.test(t)) return true;
  if (/^[A-ZÁÉÍÓÚÑ0-9][\w\s()\/\-–—.:+|│&°,°*#]+$/u.test(t) && t.length <= 80 && !/[.!?]$/.test(t)) return true;
  return false;
}

function dedentAsciiLines(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;
  const indents = nonEmpty.map((l) => l.match(/^\s*/)?.[0]?.length ?? 0);
  const min = Math.min(...indents);
  return lines.map((l) => (l.length >= min ? l.slice(min) : l));
}

function shouldWrapAsciiBlock(lines: string[]): boolean {
  const significant = lines.map((l) => l.trim()).filter(Boolean);
  if (significant.length < 2) return false;
  const diagramLines = significant.filter(
    (l) => looksLikeAsciiDiagramLine(l) || looksLikeAsciiDiagramContinuation(l),
  ).length;
  return diagramLines >= 2;
}

function wrapAsciiLinesAsTextFence(lines: string[]): string {
  const normalized = dedentAsciiLines(lines.map((l) => l.trimEnd()));
  return ["```text", ...normalized, "```"].join("\n");
}

function repairMultilineAsciiDiagramBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const buffer: string[] = [];
  let inFence = false;
  let inAsciiRun = false;

  function flushBuffer() {
    if (buffer.length === 0) return;
    if (shouldWrapAsciiBlock(buffer)) {
      out.push(wrapAsciiLinesAsTextFence(buffer));
    } else {
      out.push(...buffer);
    }
    buffer.length = 0;
    inAsciiRun = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushBuffer();
      inFence = trimmed !== "```";
      out.push(line);
      continue;
    }

    if (inFence) {
      flushBuffer();
      out.push(line);
      continue;
    }

    const isDiagramLine = inAsciiRun
      ? looksLikeAsciiDiagramContinuation(line)
      : looksLikeAsciiDiagramLine(line);

    if (isDiagramLine) {
      buffer.push(line);
      inAsciiRun = true;
      continue;
    }

    flushBuffer();
    out.push(line);
  }

  flushBuffer();
  return out.join("\n");
}

/** Une párrafos sueltos (separados por línea en blanco) que forman un diagrama ASCII. */
function repairLooseAsciiParagraphBlocks(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  const buffer: string[] = [];

  function flushBuffer() {
    if (buffer.length === 0) return;
    if (buffer.length >= 2 && buffer.some((p) => looksLikeAsciiDiagramLine(p))) {
      out.push(wrapAsciiLinesAsTextFence(buffer));
    } else {
      out.push(...buffer);
    }
    buffer.length = 0;
  }

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (/^```/.test(trimmed)) {
      flushBuffer();
      out.push(paragraph);
      continue;
    }

    const lines = paragraph.split("\n");
    if (
      lines.length === 1 &&
      (looksLikeAsciiDiagramLine(trimmed) || looksLikeAsciiDiagramContinuation(trimmed))
    ) {
      buffer.push(trimmed);
      continue;
    }

    if (lines.length > 1 && shouldWrapAsciiBlock(lines)) {
      flushBuffer();
      out.push(wrapAsciiLinesAsTextFence(lines));
      continue;
    }

    flushBuffer();
    out.push(paragraph);
  }

  flushBuffer();
  return out.join("\n\n");
}

/** Diagramas ASCII (relaciones en una línea o bloques de arquitectura) → bloque ```text```. */
export function repairAsciiDiagramBlocks(text: string): string {
  let out = text.replace(
    /^\*\*(OBP4MO|OBP) \([^)]+\):\*\*\s*(.+)$/gim,
    (_m, label: string, diagram: string) =>
      `**${label}:**\n\n\`\`\`text\n${diagram.trim()}\n\`\`\``,
  );
  out = out.replace(/^((?:pais|ubicacion|País).{10,200}(?:──|└|┬|┘).*)$/gim, (line) => {
    const t = line.trim();
    if (t.startsWith("```")) return line;
    return `\`\`\`text\n${t}\n\`\`\``;
  });
  out = repairLooseAsciiParagraphBlocks(out);
  return repairMultilineAsciiDiagramBlocks(out);
}

/** Quita ### erróneos en subtítulos de contrato API / Odoo. */
export function repairDemoteFalseApiHeadings(text: string): string {
  let out = text.replace(
    /^### (Headers?:|Request body \(ejemplo|Response \d+|Recibe eventos|Content-Type:|API Key|Odoo genera|Donde:|OBP4MO \(normalizado\):|OBP \(desnormalizado\):)\s*/gim,
    "**$1** ",
  );
  out = out.replace(/^### (Este microservicio[^\n]+)/gim, "$1");
  return out;
}

/** Envuelve manifest §7 suelto en ```json (incl. ### Manifest de Infraestructura). */
export function repairMddInfraManifestJsonBlock(text: string): string {
  const sectionRe = /(?:^|\n)(##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b[^\n]*)/i;
  const sectionMatch = text.match(sectionRe);
  if (!sectionMatch || sectionMatch.index === undefined) return text;

  const sectionStart = sectionMatch.index + sectionMatch[1]!.length;
  const rest = text.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const sectionEnd = nextH2 === -1 ? text.length : sectionStart + nextH2;
  const body = text.slice(sectionStart, sectionEnd);

  const manifestRe = /\n#{3,4}\s+Manifest(?:\s+de\s+Infraestructura)?\s*\n+/i;
  const manifestMatch = body.match(manifestRe);
  if (!manifestMatch || manifestMatch.index === undefined) return text;

  const afterHeadingStart = manifestMatch.index + manifestMatch[0].length;
  let afterHeading = body.slice(afterHeadingStart).trimStart();

  const tryFenceJson = (raw: string): string | null => {
    const normalized = raw.replace(/^-\s+(")/gm, "$1");
    const braceStart = normalized.indexOf("{");
    if (braceStart === -1) return null;
    const end = findBalancedJsonObjectEnd(normalized.slice(braceStart));
    if (end === -1) return null;
    const slice = normalized.slice(braceStart, braceStart + end + 1);
    try {
      return JSON.stringify(JSON.parse(slice) as unknown, null, 2);
    } catch {
      return null;
    }
  };

  let pretty: string | null = null;
  let tail = "";

  if (/^```json\s*\n/i.test(afterHeading)) {
    const inner = afterHeading.replace(/^```json\s*\n/i, "");
    pretty = tryFenceJson(inner);
    if (pretty) {
      const normalized = inner.replace(/^-\s+(")/gm, "$1");
      const braceStart = normalized.indexOf("{");
      const end =
        braceStart >= 0 ? findBalancedJsonObjectEnd(normalized.slice(braceStart)) : -1;
      tail = end >= 0 ? inner.slice(braceStart + end + 1).replace(/^\s*```\s*/m, "").trim() : "";
    }
  } else {
    pretty = tryFenceJson(afterHeading);
    if (pretty) {
      const normalized = afterHeading.replace(/^-\s+(")/gm, "$1");
      const braceStart = normalized.indexOf("{");
      const end = findBalancedJsonObjectEnd(normalized.slice(braceStart));
      tail = end >= 0 ? normalized.slice(braceStart + end + 1).trim() : "";
    }
  }

  if (!pretty) return text;

  const headingPart = body.slice(0, afterHeadingStart);
  const newBody = `${headingPart}\`\`\`json\n${pretty}\n\`\`\`${tail ? `\n\n${tail}` : ""}`;
  return text.slice(0, sectionStart) + newBody + text.slice(sectionEnd);
}

/** Bloques JSON sueltos (webhook / Odoo) → fence json. */
export function repairLooseJsonBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = (lines[i] ?? "").trim();
    const prev = (lines[i - 1] ?? "").trim();
    if (t === "{" && !prev.match(/^```/)) {
      const block: string[] = [lines[i]!];
      let j = i + 1;
      let depth = (t.match(/{/g) ?? []).length - (t.match(/}/g) ?? []).length;
      while (j < lines.length && depth > 0) {
        block.push(lines[j]!);
        const lj = lines[j]!.trim();
        depth += (lj.match(/{/g) ?? []).length - (lj.match(/}/g) ?? []).length;
        j++;
      }
      if (depth <= 0 && block.length >= 3) {
        out.push("```json");
        out.push(...block);
        out.push("```");
        out.push("");
        i = j;
        continue;
      }
    }
    out.push(lines[i]!);
    i++;
  }
  return out.join("\n");
}

function jsonBraceBalance(chunk: string): { braces: number; brackets: number } {
  let braces = 0;
  let brackets = 0;
  for (const ch of chunk) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  return { braces, brackets };
}

/** Une fragmentos JSON partidos por fences intermedios (```json … ```json). */
export function repairSplitJsonFragments(text: string): string {
  return text.replace(
    /```json\n([\s\S]*?)\n```\s*\n+```json\n([\s\S]*?)\n```/gi,
    (_m, a: string, b: string) => {
      const bal = jsonBraceBalance(a);
      if (bal.braces <= 0 && bal.brackets <= 0) return _m;
      const aTrim = a.trimEnd();
      const bTrim = b.trim();
      const sep = aTrim.endsWith("[") || aTrim.endsWith(",") ? "\n" : ",\n";
      return `\`\`\`json\n${aTrim}${sep}${bTrim}\n\`\`\``;
    },
  );
}

/**
 * Separa líneas pegadas en §4 Contratos de API donde el LLM comprime
 * Request body / Response / Errores / Nota en una sola línea.
 * Patrones:
 *   - `**Label:**{` → `**Label:**\n{`
 *   - `"value"**Label:**{` → `"value"\n**Label:**\n{`
 *   - `"value"**Label:**` → `"value"\n**Label:**`
 *   - `}**Label:**` → `}\n**Label:**`
 *   - `### Heading.**Label:**` → `### Heading.\n**Label:**`
 */
export function repairGluedApiContractLines(text: string): string {
  // 1. "}**Label:**" → "}\n**Label:**" — closing brace glued to next label
  let out = text.replace(
    /(\})\s*(\*\*(?:Request body|Response\s+\d+|Errores|Nota|Beneficios|Headers?)\b[^*]*\*\*)/gi,
    "$1\n$2",
  );
  // 2. "**Label:**{" at start of line (no preceding content) → "**Label:**\n{"
  out = out.replace(
    /^(\*\*(?:Request body[^*]*|Response\s+\d+[^*]*|Errores[^*]*|Nota[^*]*)\*\*)\s*\{/gim,
    "$1\n{",
  );
  // 3. Content before "**Label:**{" — "value"**Label:**{  or  ### Heading.**Label:**{
  out = out.replace(
    /([^\n{])\s*(\*\*(?:Request body|Response\s+\d+|Errores|Nota|Beneficios|Headers?)\b[^*]*\*\*)\s*\{/g,
    "$1\n$2\n{",
  );
  // 4. Content before "**Label:**" without { — "value"**Label:**  or  ### Heading.**Label:**
  out = out.replace(
    /([^\n])\s*(\*\*(?:Request body|Response\s+\d+|Errores|Nota|Beneficios|Headers?)\b[^*]*\*\*)\s*$/gm,
    "$1\n$2",
  );
  return out;
}

/**
 * Elimina llaves `}` y `{` sueltas que quedan fuera de fences ```json en §4.
 * Patrones:
 *   - `}\n```json` → ` ```json` (llave de cierre suelta antes de fence)
 *   - `**Response 200:**\n},\n{` → `**Response 200:**\n{` (doble llave suelta)
 *   - Línea suelta `}` o `},`紧跟 antes de un heading o **Label**
 */
export function repairOrphanBracesInContratos(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    const next = (lines[i + 1] ?? "").trim();
    // "}**Label:**" ya manejado por repairGluedApiContractLines
    // "}\n```json" → remove lone "}"
    if (/^\}\s*$/.test(t) && /^```json/i.test(next)) {
      i++;
      continue;
    }
    // "},\n{" → just "{"
    if (/^\}\s*,\s*$/.test(t) && /^\{\s*$/.test(next)) {
      out.push("{");
      i += 2;
      continue;
    }
    // "},\n```json" → "```json"
    if (/^\}\s*,?\s*$/.test(t) && /^```json/i.test(next)) {
      i++;
      continue;
    }
    // Orphan "}" before heading or bold label
    if (/^\}\s*$/.test(t)) {
      let k = i + 1;
      while (k < lines.length && lines[k]!.trim() === "") k++;
      if (k < lines.length && lines[k]!.trim() === "```") {
        let m = k + 1;
        while (m < lines.length && lines[m]!.trim() === "") m++;
        const afterFence = (lines[m] ?? "").trim();
        if (/^\*\*(?:Request body|Response)/i.test(afterFence)) {
          i = m;
          continue;
        }
      }
      if (/^#{1,6}\s/.test(next) || /^\*\*/.test(next)) {
        i++;
        continue;
      }
    }
    // Orphan lone "{" immediately after **Response:** or **Request body:** (already on prev line)
    if (/^\{\s*$/.test(t) && i > 0) {
      const prev = (out[out.length - 1] ?? "").trim();
      if (/^\*\*(?:Response|Request body|Errores)/i.test(prev)) {
        // Keep it — it's the start of the JSON block
        out.push(lines[i]!);
        i++;
        continue;
      }
    }
    out.push(lines[i]!);
    i++;
  }
  return out.join("\n");
}

/**
 * Envuelve en ```json los bloques de Request/Response que están como texto plano
 * (sin fence) después de **Request body:** o **Response N:**.
 * Solo aplica dentro de §4 Contratos de API.
 */
export function repairUnfencedJsonInContratos(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    // Detect **Response 200:** or **Request body:** followed by { on next line
    const labelMatch = t.match(/^\*\*(Response\s+\d+[^*]*|Request body[^*]*)\*\*\s*$/i);
    if (labelMatch && i + 1 < lines.length) {
      const next = lines[i + 1]!.trim();
      if (next === "{" || /^\{\s*$/.test(next)) {
        // Check if this is already inside a ```json fence
        const prevLine = (out[out.length - 1] ?? "").trim();
        if (/^```json/i.test(prevLine)) {
          out.push(lines[i]!);
          i++;
          continue;
        }
        // Collect JSON content until we hit a label, heading, fence, or blank line
        const jsonLines: string[] = [];
        let j = i + 1;
        let depth = 0;
        let closed = false;
        while (j < lines.length) {
          const jt = lines[j]!.trim();
          jsonLines.push(lines[j]!);
          // Count braces
          for (const ch of jt) {
            if (ch === "{") depth++;
            if (ch === "}") depth--;
          }
          if (depth <= 0 && jsonLines.length > 0) {
            closed = true;
            j++;
            break;
          }
          // Stop if we hit a label or heading (unclosed)
          if (/^\*\*(?:Response|Request body|Errores|Nota|Beneficios|Headers?)\b/i.test(jt)) {
            jsonLines.pop(); // remove the label line
            break;
          }
          if (/^#{1,6}\s/.test(jt) && depth <= 0) {
            jsonLines.pop();
            break;
          }
          if (/^```/.test(jt)) {
            jsonLines.pop();
            break;
          }
          j++;
        }
        if (jsonLines.length >= 1) {
          out.push(lines[i]!);
          out.push("```json");
          out.push(...jsonLines);
          if (!closed) {
            let balance = 0;
            for (const jl of jsonLines) {
              for (const ch of jl) {
                if (ch === "{") balance++;
                if (ch === "}") balance--;
              }
            }
            while (balance > 0) {
              out.push("}");
              balance--;
            }
          }
          out.push("```");
          i = j;
          continue;
        }
      }
    }
    out.push(lines[i]!);
    i++;
  }
  return out.join("\n");
}

/** Fusiona heading partido del bloque UI/UX «Matriz pantalla→componente». */
export function repairSplitUiUxMatrizHeading(text: string): string {
  return text.replace(
    /(### Matriz pantalla→componente\s*\n+)\s*### Detalle ejecutable en\s*\n+\s*(\*\*`pantallas\.md`\*\*)/i,
    "$1Detalle ejecutable en $2",
  );
}

/** Elimina líneas basura `# ```` / `# ``` tras fences (MDD §3 mermaid). */
export function repairStrayHashFenceLines(text: string): string {
  let out = text.replace(/^\s*#\s*```+\s*$/gm, "");
  out = out.replace(/(\n```\s*\n)#\s*```+\s*\n/g, "$1");
  out = out.replace(/(\*\*Response\s+204:\*\*)\s*\n+#\s+_No Content_/gim, "$1\n\n_No Content_");
  return out;
}

/** Quita fences ``` huérfanos antes de **Request body:** / **Response N:** en §4. */
export function repairOrphanFenceBeforeContractLabels(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "```") {
      let open = false;
      for (let j = 0; j < i; j++) {
        const ft = lines[j]!.trim();
        if (/^```/.test(ft)) open = !open;
      }
      // Cierra un bloque abierto — conservar aunque siga **Request body:** / **Response N:**
      if (open) {
        out.push(lines[i]!);
        continue;
      }
      let k = i + 1;
      while (k < lines.length && lines[k]!.trim() === "") k++;
      const after = (lines[k] ?? "").trim();
      if (/^\*\*(?:Request body|Response\s+\d+)/i.test(after)) {
        continue;
      }
    }
    out.push(lines[i]!);
  }
  return out.join("\n");
}

/** Quita ` ---` pegado al final de prosa antes de un separador horizontal. */
export function repairGluedHrSuffixInProse(text: string): string {
  return text.replace(/([.!?])\s+---\s*$/gm, "$1");
}

/** Cierra ```json incompletos antes del siguiente endpoint ### POST/GET…. */
export function repairUnclosedJsonBeforeApiEndpoint(text: string): string {
  return text.replace(
    /```json\n([\s\S]*?)(?=\n###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s)/gi,
    (full, inner: string) => {
      if (/^\s*```/m.test(inner)) return full;
      let body = inner.replace(/^-\s+(")/gm, "$1").trimEnd();
      const end = findBalancedJsonObjectEnd(body);
      if (end >= 0) {
        const json = body.slice(0, end + 1).trimEnd();
        const leak = body.slice(end + 1).trim();
        return `\`\`\`json\n${json}\n\`\`\`${leak ? `\n\n${leak}\n` : "\n"}`;
      }
      const fixed = balanceJsonFenceBody(body);
      return `\`\`\`json\n${fixed}\n\`\`\`\n`;
    },
  );
}

/** Normaliza Response 204 con `# No Content` / `# _No Content_` erróneo. */
export function repairApiResponse204NoContent(text: string): string {
  return text.replace(
    /(\*\*Response\s+204:\*\*)\s*\n+#\s+(?:`No Content`|_No Content_)/gim,
    "$1\n\n_No Content_",
  );
}

import { repairMddFormatIssues } from "./repair-mdd-format.js";

export function repairPastedMarkdown(text: string): string {
  if (!text?.trim()) return text ?? "";
  let out = text.replace(/\r\n/g, "\n");
  out = repairMddFormatIssues(out);
  out = repairMetadataCoverTable(out);
  out = repairGluedBoldFlowTitles(out);
  out = repairGluedHrSuffixInProse(out);
  out = repairSplitUiUxMatrizHeading(out);
  out = repairStrayHashFenceLines(out);
  out = repairOrphanFenceBeforeContractLabels(out);
  out = repairGluedApiContractLines(out);
  out = repairOrphanBracesInContratos(out);
  out = repairUnclosedJsonBeforeApiEndpoint(out);
  out = repairUnfencedJsonInContratos(out);
  out = repairApiContractJsonFences(out);
  out = repairApiResponse204NoContent(out);
  out = repairOrphanContratosApiFences(out);
  out = repairStackedCodeFences(out);
  out = repairSplitJsonFragments(out);
  out = repairJsonFenceIntegrity(out);
  out = repairIndentedProseBlocks(out);
  out = repairStrayCodeFences(out);
  out = repairPromoteBareSectionHeadings(out);
  out = repairSplitUiUxMatrizHeading(out);
  out = repairDemoteFalseApiHeadings(out);
  out = repairCollapsedSqlParagraphs(out);
  out = repairFragmentedSqlFences(out);
  out = repairCollapsedSqlInsideFences(out);
  out = repairOrphanSqlBlocks(out);
  out = repairFragmentedSqlFences(out);
  out = repairLooseJsonBlocks(out);
  out = repairMddInfraManifestJsonBlock(out);
  out = repairJsonFenceIntegrity(out);
  out = repairGluedSqlTokens(out);
  out = repairApiContractJsonFences(out);
  out = repairOrphanContratosApiFences(out);
  out = repairStackedCodeFences(out);
  out = repairSplitJsonFragments(out);
  out = repairJsonFenceIntegrity(out);
  out = repairUnclosedCodeFences(out);
  out = repairStrayCodeFences(out);
  out = repairAsciiDiagramBlocks(out);
  out = repairDirectoryTreeBlocks(out);
  out = repairDondeGluedBullets(out);
  out = repairTableBoundaries(out);
  out = repairTabSeparatedTables(out);
  out = repairIndentedLists(out);
  out = repairIndentedProseBlocks(out);
  out = repairFlowSectionsToMermaid(out);
  out = repairInfraMarkdown(out);
  out = repairTableBoundaries(out);
  out = repairApiContractJsonFences(out);
  out = repairOrphanContratosApiFences(out);
  out = repairStackedCodeFences(out);
  out = repairSplitJsonFragments(out);
  out = repairJsonFenceIntegrity(out);
  out = repairOrphanContratosApiFences(out);
  out = repairFragmentedSqlFences(out);
  out = repairOrphanSqlBlocks(out);
  out = repairStrayCodeFences(out);
  out = repairUnclosedJsonBeforeApiEndpoint(out);
  out = repairApiResponse204NoContent(out);
  out = repairOrphanFenceBeforeContractLabels(out);
  out = repairSplitUiUxMatrizHeading(out);
  out = out.replace(/\n(🔴|🟡|🟢)/g, "\n\n$1");
  out = out.replace(/\n-{3,}\n/g, "\n\n---\n\n");
  return out;
}
