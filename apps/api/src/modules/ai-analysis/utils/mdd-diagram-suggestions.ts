/**
 * @fileoverview Motor de sugerencias de diagramas según contenido MDD.
 */

/**
 * Detecta en qué secciones del MDD conviene añadir diagramas Mermaid (ER, estados, jerárquicos)
 * y genera bloques Mermaid basados en el contenido del documento.
 */

import {
  ensureErDiagramHeader,
  repairErDiagramPkFkCommas,
  stripErDiagramSqlDefaultArtifacts,
} from "@theforge/shared-types/mermaid";

export interface DiagramSuggestion {
  /** Sección donde insertar (ej. "2. Modelo de datos") */
  section: string;
  /** Tipo Mermaid: erDiagram, stateDiagram-v2, flowchart, etc. */
  type: string;
  /** Motivo de la sugerencia */
  reason: string;
  /** Bloque Mermaid listo para insertar (```mermaid ... ```) */
  mermaidBlock: string;
  /** Inserir después de este heading (ej. "## 2. Modelo de datos") */
  insertAfterMarker: string;
  /** "start" = justo después del heading; "end" = al final del cuerpo de la sección */
  insertAt: "start" | "end";
}

function getSectionBody(
  draft: string,
  headingPattern: RegExp,
): { body: string; startIndex: number; endIndex: number; matchedHeading: string } | null {
  const match = draft.match(headingPattern);
  if (!match) return null;
  const heading = match[0].trim();
  const idx = draft.indexOf(match[0]);
  const sectionStart = idx + match[0].length;
  const rest = draft.slice(sectionStart).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2).trim() : rest.trim();
  const endIndex = nextH2 !== -1 ? sectionStart + nextH2 : draft.length;
  return { body, startIndex: sectionStart, endIndex, matchedHeading: heading };
}

/** Mapea tipo SQL a tipo Mermaid erDiagram; usa datetime (como en ejemplos del skill) para máxima compatibilidad. */
function sqlTypeToMermaid(sqlType: string): string {
  const t = (sqlType || "").toUpperCase();
  if (/^UUID$/i.test(t)) return "uuid";
  if (/TIMESTAMPTZ|TIMESTAMP\s+WITH\s+TIME\s+ZONE|TIMESTAMP|DATE|TIME/i.test(t)) return "datetime";
  if (/CHAR|VARCHAR|TEXT|STRING/i.test(t)) return "string";
  if (/INT|BIGINT|SMALLINT|SERIAL/i.test(t)) return "int";
  if (/BOOL/i.test(t)) return "boolean";
  if (/DECIMAL|NUMERIC|FLOAT|REAL/i.test(t)) return "float";
  return "string";
}

interface TableColumns {
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean }>;
}

const COL_DEF_REGEX =
  /([a-zA-Z_][a-zA-Z0-9_]*)\s+(UUID|VARCHAR|CHAR|TEXT|BOOLEAN|INT|BIGINT|SMALLINT|SERIAL|TIMESTAMPTZ|TIMESTAMP|DATE|TIME|NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE)(\s*\([^)]+\))?/gi;

const SQL_RESERVED_COL_NAMES = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
  "REFERENCES",
  "FOR",
  "WHEN",
  "THEN",
  "ELSE",
  "BEGIN",
  "END",
]);

function isValidErColumnName(name: string): boolean {
  if (SQL_RESERVED_COL_NAMES.has(name.toUpperCase())) return false;
  if (/\b(para|cuando|mediante|debe|null|system)\b/i.test(name)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/** Devuelve el índice del paréntesis de cierre que equilibra el abierto en start. */
function findMatchingParen(str: string, start: number): number {
  if (str[start] !== "(") return -1;
  let depth = 1;
  for (let i = start + 1; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Slice from column start to next top-level comma (end of one column definition). */
function sliceSqlColumnDefinition(inner: string, start: number): string {
  let depth = 0;
  for (let i = start; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) return inner.slice(start, i);
  }
  return inner.slice(start);
}

/** Extrae columnas del bloque CREATE TABLE parseando el contenido entre ( y ) con regex global (independiente de saltos de línea). */
function parseColumnsFromBlock(block: string, tableName: string): { columns: Array<{ name: string; type: string; pk: boolean }>; relations: Array<{ from: string; to: string; fkColumn: string }> } {
  const columns: Array<{ name: string; type: string; pk: boolean }> = [];
  const relations: Array<{ from: string; to: string; fkColumn: string }> = [];
  const openParen = block.indexOf("(");
  const closeParen = findMatchingParen(block, openParen);
  const inner = openParen !== -1 && closeParen !== -1 ? block.slice(openParen + 1, closeParen) : block;
  let m: RegExpExecArray | null;
  COL_DEF_REGEX.lastIndex = 0;
  while ((m = COL_DEF_REGEX.exec(inner)) !== null) {
    const colName = m[1].toLowerCase();
    if (!isValidErColumnName(colName)) continue;
    const sqlType = (m[2] + (m[3] ?? "")).trim();
    const start = m.index;
    const rest = sliceSqlColumnDefinition(inner, start);
    const pk = /\bPRIMARY\s+KEY\b/i.test(rest);
    const refMatch = rest.match(/REFERENCES\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)/i);
    if (refMatch) relations.push({ from: tableName, to: refMatch[1].toLowerCase(), fkColumn: colName });
    columns.push({ name: colName, type: sqlTypeToMermaid(sqlType), pk });
  }
  const pkOnlyLine = inner.match(/\bPRIMARY\s+KEY\s*\(\s*([^)]+)\s*\)/gi);
  if (pkOnlyLine && columns.length > 0) {
    for (const pkLine of pkOnlyLine) {
      const namesMatch = pkLine.match(/\(\s*([^)]+)\s*\)/);
      if (!namesMatch) continue;
      const names = namesMatch[1].split(/\s*,\s*/).map((n) => n.trim().toLowerCase());
      for (const name of names) {
        const col = columns.find((c) => c.name === name);
        if (col) col.pk = true;
      }
    }
  }
  return { columns, relations };
}

/** Extrae tablas con columnas reales y relaciones REFERENCES. */
function extractTablesAndRelations(
  body: string,
): { tables: TableColumns[]; relations: Array<{ from: string; to: string; fkColumn?: string }> } {
  const tableMap = new Map<string, TableColumns>();
  const allRelations: Array<{ from: string; to: string; fkColumn?: string }> = [];
  const tableBlocks = body.split(/CREATE\s+TABLE/gi);
  for (let i = 1; i < tableBlocks.length; i++) {
    const block = tableBlocks[i];
    const tableNameMatch = block.match(/^\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/);
    const tableName = tableNameMatch ? tableNameMatch[1].toLowerCase() : "";
    if (!tableName) continue;
    const { columns, relations } = parseColumnsFromBlock(block, tableName);
    allRelations.push(...relations);
    if (!tableMap.has(tableName)) {
      tableMap.set(tableName, { name: tableName, columns });
    }
  }
  return { tables: Array.from(tableMap.values()), relations: allRelations };
}

/** Nombres reservados en Mermaid erDiagram (cardinalidad); no usarlos como entidades. */
const ER_RESERVED = new Set(["one", "many", "to", "u"]);

/** Etiquetas semánticas para relaciones (fromTable-toTable) en lugar del nombre de columna FK. */
const RELATION_LABELS: Record<string, string> = {
  "sessions-users": "has",
  "roles-applications": "defines",
  "user_application_roles-users": "assigned",
  "user_application_roles-roles": "includes",
};

/** Escapa comillas dobles en etiqueta de relación para no romper el parser de Mermaid. */
function escapeErLabel(s: string): string {
  return (s ?? "").replace(/"/g, "'").trim() || "ref";
}

/** Etiqueta de relación: mapa semántico, stem de FK (`tenant_id` → `tenant`), o referencia a tabla padre. */
function getRelationLabel(fromTable: string, toTable: string, fkColumn: string): string {
  const key = `${fromTable}-${toTable}`;
  const semantic = RELATION_LABELS[key];
  if (semantic) return escapeErLabel(semantic);
  const fk = (fkColumn ?? "").trim();
  if (fk && fk !== "ref" && fk.toLowerCase() !== "id") {
    const stem = fk.replace(/_id$/i, "");
    if (stem && stem !== fk) return escapeErLabel(stem.replace(/_/g, " "));
  }
  const parent = toTable.replace(/_entity$/i, "");
  return escapeErLabel(`references ${parent}`);
}

/** Genera erDiagram Mermaid: tipos uuid/timestamptz, indentación 2/4 espacios ASCII (nunca &nbsp; ni tab). */
function buildErDiagram(
  tables: TableColumns[],
  relations: Array<{ from: string; to: string; fkColumn?: string }>,
): string {
  const lines: string[] = ["erDiagram", ""];
  const indentEntity = "  "; // 2 espacios ASCII (0x20)
  const indentAttr = "    "; // 4 espacios ASCII (0x20)
  for (const t of tables) {
    const entityName = ER_RESERVED.has(t.name.toLowerCase()) ? `${t.name}_entity` : t.name;
    if (t.columns.length === 0) {
      lines.push(`${indentEntity}${entityName} {`);
      lines.push(`${indentAttr}uuid id PK`);
      lines.push(`${indentEntity}}`);
      continue;
    }
    lines.push(`${indentEntity}${entityName} {`);
    for (const c of t.columns) {
      const isFk = relations.some((r) => r.from === t.name && r.fkColumn === c.name);
      const keySuffix = c.pk ? " PK" : isFk ? " FK" : "";
      lines.push(`${indentAttr}${c.type} ${c.name}${keySuffix}`);
    }
    lines.push(`${indentEntity}}`);
  }
  lines.push("");
  const seen = new Set<string>();
  for (const r of relations) {
    const key = `${r.from}-${r.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fromName = ER_RESERVED.has(r.from.toLowerCase()) ? `${r.from}_entity` : r.from;
    const toName = ER_RESERVED.has(r.to.toLowerCase()) ? `${r.to}_entity` : r.to;
    const label = getRelationLabel(r.from, r.to, r.fkColumn ?? "ref");
    lines.push(`${indentEntity}${toName} ||--o{ ${fromName} : "${label}"`);
  }
  return lines.join("\n");
}

/** Detecta si la sección 3 habla de auth/login y genera stateDiagram-v2 para flujo de autenticación. */
function suggestAuthStateDiagram(section3Body: string): DiagramSuggestion | null {
  const lower = section3Body.toLowerCase();
  const hasAuth = /login|logout|auth|token|session|jwt|sso/.test(lower) && (/post\s+\/api\/auth|get\s+\/api\/auth|\/login|\/logout/.test(lower) || /###\s+(POST|GET).*auth/.test(section3Body));
  if (!hasAuth) return null;
  const mermaid = `stateDiagram-v2
  [*] --> NoAutenticado
  NoAutenticado --> Autenticado : login OK
  NoAutenticado --> Error : credenciales inválidas
  Autenticado --> NoAutenticado : logout / token expirado
  Autenticado --> [*]`;
  return {
    section: "3. Contratos de API",
    type: "stateDiagram-v2",
    reason: "El documento describe flujo de autenticación (login/logout/token); un diagrama de estados mejora la comprensión.",
    mermaidBlock: "\n\n### Flujo de autenticación\n\n```mermaid\n" + mermaid + "\n```\n\n",
    insertAfterMarker: "## 3. Contratos de API",
    insertAt: "start",
  };
}

/**
 * Normaliza diagrama erDiagram: timestamptz→datetime, PK/FK dobles→PK, 2 espacios ASCII.
 */
export function normalizeErDiagramForMermaid(content: string): string {
  if (!content?.trim()) return content;
  const base = stripErDiagramSqlDefaultArtifacts(
    repairErDiagramPkFkCommas(
      content
        .replace(/\btimestamptz\b/gi, "datetime")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\t/g, " ")
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    ),
  );
  const withHeader = ensureErDiagramHeader(base);
  return withHeader
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)/);
      const len = m?.[1].length ?? 0;
      const levels = Math.floor(len / 2);
      return "  ".repeat(levels) + line.slice(len);
    })
    .join("\n")
    .trim();
}

/** Parsea erDiagram Mermaid y devuelve entidades (nombre + columnas) y relaciones (from, to, fkColumn). */
function parseErDiagramContent(diagramContent: string): {
  entities: Array<{ name: string; columns: Array<{ name: string; type: string; pk: boolean; fk: boolean }> }>;
  relations: Array<{ from: string; to: string; fkColumn: string }>;
} {
  const entities: Array<{ name: string; columns: Array<{ name: string; type: string; pk: boolean; fk: boolean }> }> = [];
  const relations: Array<{ from: string; to: string; fkColumn: string }> = [];
  const lines = diagramContent.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const entityMatch = lines[i].match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\{\s*$/);
    if (entityMatch) {
      const name = entityMatch[1].toLowerCase();
      const columns: Array<{ name: string; type: string; pk: boolean; fk: boolean }> = [];
      i++;
      while (i < lines.length && !/^\s*\}\s*$/.test(lines[i])) {
        const attrMatch = lines[i].match(/^\s*(\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+PK)?(?:\s*,\s*FK|\s+FK)?/);
        if (attrMatch) {
          const pk = /\bPK\b/.test(lines[i]);
          const fk = /\bFK\b/.test(lines[i]);
          columns.push({
            name: attrMatch[2].toLowerCase(),
            type: (attrMatch[1] || "string").toLowerCase(),
            pk,
            fk,
          });
        }
        i++;
      }
      if (i < lines.length) i++;
      entities.push({ name, columns });
      continue;
    }
    const relMatch = lines[i].match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+\|\|--o\{\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+:\s*"([^"]*)"/);
    if (relMatch) {
      const toEntity = relMatch[1].toLowerCase();
      const fromEntity = relMatch[2].toLowerCase();
      const fkColumn = relMatch[3].trim().toLowerCase() || "id";
      relations.push({ from: toEntity, to: fromEntity, fkColumn });
    }
    i++;
  }
  return { entities, relations };
}

/** Mapea tipo Mermaid erDiagram a tipo SQL PostgreSQL. */
function mermaidTypeToSql(mermaidType: string): string {
  const t = (mermaidType || "string").toLowerCase();
  if (t === "uuid") return "UUID";
  if (t === "timestamptz") return "TIMESTAMPTZ";
  if (t === "int" || t === "integer") return "INTEGER";
  if (t === "boolean" || t === "bool") return "BOOLEAN";
  if (t === "date" || t === "datetime") return "TIMESTAMPTZ";
  if (t === "float" || t === "decimal") return "REAL";
  return "VARCHAR(255)";
}

/** Genera CREATE TABLE en PostgreSQL a partir del contenido erDiagram (sin fences). El diagrama es la fuente de verdad. */
export function erDiagramToSql(diagramContent: string): string | null {
  const normalized = normalizeErDiagramForMermaid(diagramContent);
  if (!normalized) return null;
  const body = normalized.replace(/^\s*erDiagram\s*\n?/i, "").trim();
  if (!/^\s*\w+\s*\{/m.test(body)) return null;
  const { entities, relations } = parseErDiagramContent("erDiagram\n\n" + body);
  if (entities.length === 0) return null;

  const sqlLines: string[] = [];
  for (const ent of entities) {
    const tableName = ent.name;
    const parts: string[] = [];
    const pkCols: string[] = [];
    for (const c of ent.columns) {
      const isFk = relations.some((r) => r.to === tableName && r.fkColumn === c.name);
      const sqlType = isFk ? "UUID" : mermaidTypeToSql(c.type);
      let def = `${c.name} ${sqlType}`;
      if (c.pk) {
        pkCols.push(c.name);
        if (pkCols.length === 1 && !isFk) def += " PRIMARY KEY DEFAULT gen_random_uuid()";
      }
      if (isFk) {
        const rel = relations.find((r) => r.to === tableName && r.fkColumn === c.name);
        if (rel) def += ` REFERENCES ${rel.from}(id) ON DELETE CASCADE`;
      }
      if (c.name === "mfa_enabled" && sqlType === "BOOLEAN") def += " NOT NULL DEFAULT false";
      else if (c.name === "created_at" && sqlType === "TIMESTAMPTZ") def += " NOT NULL DEFAULT now()";
      else if (!c.pk && !isFk) def += " NOT NULL";
      parts.push(def);
    }
    if (pkCols.length > 1) parts.push(`PRIMARY KEY (${pkCols.join(", ")})`);
    sqlLines.push(`CREATE TABLE ${tableName} (`, parts.join(",\n"), ");", "");
  }
  return sqlLines.join("\n").trim();
}

/** Genera contenido erDiagram (sin fences) desde SQL. Exportado para Diagram Injector cuando opera sobre mddStructured.modeloDatos. */
export function sqlToErDiagramContent(sql: string): string | null {
  if (!sql?.trim() || !/CREATE\s+TABLE/i.test(sql)) return null;
  const { tables, relations } = extractTablesAndRelations(sql);
  if (tables.length === 0) return null;
  return normalizeErDiagramForMermaid(buildErDiagram(tables, relations));
}

/** Bloque ```mermaid con un solo encabezado erDiagram (sin ###). */
export function wrapErDiagramAsMermaidFence(diagramContent: string): string {
  const body = normalizeErDiagramForMermaid(
    (diagramContent ?? "")
      .replace(/^```mermaid\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim(),
  );
  if (!body) return "";
  return `\`\`\`mermaid\n${body}\n\`\`\``;
}

/** Bloque completo §3: heading + fence mermaid derivado del SQL. */
export function buildErDiagramSectionBlockFromSql(sql: string): string | null {
  const diagram = sqlToErDiagramContent(sql);
  if (!diagram) return null;
  return `\n\n### Diagrama entidad-relación\n\n${wrapErDiagramAsMermaidFence(diagram)}\n\n`;
}

/** Sugiere erDiagram derivado del SQL (siempre que haya CREATE TABLE). insertAfterMarker debe coincidir con el heading real del draft (## 2 o ## 3. Modelo de datos). */
function suggestErDiagram(
  sectionBody: string,
  insertAfterMarker: string = "## 3. Modelo de Datos",
): DiagramSuggestion | null {
  const block = buildErDiagramSectionBlockFromSql(sectionBody);
  if (!block) return null;
  return {
    section: "3. Modelo de Datos",
    type: "erDiagram",
    reason: "Hay tablas definidas con CREATE TABLE; el erDiagram se deriva del SQL (no del LLM).",
    mermaidBlock: block,
    insertAfterMarker,
    insertAt: "end",
  };
}

/** Sugiere flowchart si la sección 4 describe componentes o flujos. */
function suggestFrontendFlowchart(section4Body: string, draft: string): DiagramSuggestion | null {
  if (section4Body.length < 100) return null;
  if (/```mermaid\s*[\s\S]*?flowchart/i.test(draft)) return null;
  const hasComponents = /componente|estructura|flujo|login|dashboard|ruta|router/i.test(section4Body.toLowerCase());
  if (!hasComponents) return null;
  const mermaid = `flowchart LR
  subgraph Frontend
    A[Login] --> B[Dashboard]
    B --> C[Perfil]
    B --> D[Recursos]
  end`;
  return {
    section: "4. Arquitectura Frontend",
    type: "flowchart",
    reason: "La sección Frontend describe componentes y flujos; un diagrama de flujo resume la navegación.",
    mermaidBlock: "\n\n### Flujo de vistas\n\n```mermaid\n" + mermaid + "\n```\n\n",
    insertAfterMarker: "## 4. Arquitectura Frontend",
    insertAt: "start",
  };
}

/**
 * Analiza el MDD y devuelve sugerencias de diagramas Mermaid a insertar (ER, estados, flujo).
 * Determinístico: basado en reglas sobre el contenido de cada sección.
 */
export function suggestMddDiagrams(draft: string): DiagramSuggestion[] {
  const trimmed = (draft || "").trim();
  if (trimmed.length < 200) return [];

  const suggestions: DiagramSuggestion[] = [];

  const sectionModelo = getSectionBody(trimmed, /##\s*(2|3)\.\s*Modelo\s+(?:de\s+)?datos/i);
  if (sectionModelo) {
    const er = suggestErDiagram(sectionModelo.body, sectionModelo.matchedHeading);
    if (er) suggestions.push(er);
  }

  const section3 = getSectionBody(trimmed, /##\s*3\.\s*Contratos\s+de\s+API/i);
  if (section3) {
    const state = suggestAuthStateDiagram(section3.body);
    if (state) suggestions.push(state);
  }

  const section4 = getSectionBody(trimmed, /##\s*4\.\s*Arquitectura\s+Frontend/i);
  if (section4) {
    const flow = suggestFrontendFlowchart(section4.body, trimmed);
    if (flow) suggestions.push(flow);
  }

  return suggestions;
}

/** Reemplaza el primer bloque ```mermaid ... erDiagram ... ``` en sectionBody por newBlock. Quita ### anterior si existe. */
function replaceErDiagramBlock(sectionBody: string, newBlock: string): string {
  const open = sectionBody.search(/```mermaid\s*/i);
  if (open === -1) return sectionBody;
  const afterOpen = sectionBody.slice(open);
  const closeMatch = afterOpen.match(/\n```\s*\n?/);
  const close = closeMatch ? open + closeMatch.index! + closeMatch[0].length : afterOpen.length + open;
  let before = sectionBody.slice(0, open).replace(/\n+$/, "");
  before = before.replace(/\n*###\s*[^\n]*[Dd]iagrama[^\n]*\n*$/, "").replace(/\n+$/, "");
  const after = sectionBody.slice(close).replace(/^\n+/, "");
  const sep = before && after ? "\n\n" : before || after ? "\n" : "";
  return before + sep + newBlock.trim() + (after ? "\n\n" + after : "");
}

/**
 * Inyecta o reemplaza el bloque ```mermaid erDiagram``` en la sección ## 3. Modelo de datos del draft.
 * No reconstruye el documento; solo modifica §3. Usado por DiagramInjector para no pisar §3 desde mddStructured.
 */
export function injectErDiagramBlockIntoDraft(draft: string, mermaidBlock: string): string {
  const trimmed = (draft || "").trim();
  const sectionModelo = getSectionBody(trimmed, /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i);
  if (!sectionModelo) return draft;
  let newBody: string;
  if (/```mermaid\s*[\s\S]*?erDiagram/i.test(sectionModelo.body)) {
    newBody = replaceErDiagramBlock(sectionModelo.body, mermaidBlock.trim());
  } else {
    newBody = sectionModelo.body.trimEnd() + "\n\n" + mermaidBlock.trim();
  }
  return trimmed.slice(0, sectionModelo.startIndex) + newBody + trimmed.slice(sectionModelo.endIndex);
}

/**
 * Regenera el diagrama ER de la sección Modelo de datos (## 2 o ## 3) a partir del SQL (CREATE TABLE).
 * Reemplaza el bloque existente si hay uno, o lo inserta al final. Devuelve el draft actualizado o null si no hay SQL.
 */
export function regenerateErDiagramFromSql(draft: string): string | null {
  const trimmed = (draft || "").trim();
  const sectionModelo = getSectionBody(trimmed, /##\s*(2|3)\.\s*Modelo\s+(?:de\s+)?datos/i);
  if (!sectionModelo) return null;
  const suggestion = suggestErDiagram(sectionModelo.body, sectionModelo.matchedHeading);
  if (!suggestion) return null;
  let newBody: string;
  if (/```mermaid\s*[\s\S]*?erDiagram/i.test(sectionModelo.body)) {
    newBody = replaceErDiagramBlock(sectionModelo.body, suggestion.mermaidBlock);
  } else {
    newBody = sectionModelo.body.trimEnd() + "\n\n" + suggestion.mermaidBlock.trim();
  }
  return trimmed.slice(0, sectionModelo.startIndex) + newBody + trimmed.slice(sectionModelo.endIndex);
}

/**
 * Inserta los bloques Mermaid: "start" = justo después del heading; "end" = al final del cuerpo.
 * erDiagram: siempre se regenera desde SQL cuando hay sugerencia (pisa salida del LLM).
 */
export function injectMddDiagrams(draft: string, suggestions: DiagramSuggestion[]): string {
  let out = draft;
  for (const s of suggestions) {
    const marker = s.insertAfterMarker;
    const idx = out.indexOf(marker);
    if (idx === -1) continue;
    const endOfHeadingLine = out.indexOf("\n", idx);
    const sectionStart = endOfHeadingLine === -1 ? idx + marker.length : endOfHeadingLine + 1;
    const afterMarker = out.slice(sectionStart);
    const nextH2 = afterMarker.search(/\n##\s+/);
    const sectionBody = nextH2 !== -1 ? afterMarker.slice(0, nextH2) : afterMarker;

    if (s.type === "erDiagram" && /```mermaid\s*[\s\S]*?erDiagram/i.test(sectionBody)) {
      const newSectionBody = replaceErDiagramBlock(sectionBody, s.mermaidBlock);
      const sectionEnd = nextH2 !== -1 ? sectionStart + nextH2 : out.length;
      out = out.slice(0, sectionStart) + newSectionBody + out.slice(sectionEnd);
      continue;
    }

    if (sectionBody.includes("```mermaid") && sectionBody.includes(s.type)) continue;
    const insertPoint =
      s.insertAt === "start" ? sectionStart : nextH2 !== -1 ? sectionStart + nextH2 : out.length;
    out = out.slice(0, insertPoint) + s.mermaidBlock + out.slice(insertPoint);
  }
  return out;
}
