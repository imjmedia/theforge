/**
 * @fileoverview Rúbrica determinista del eval de MDDs. Puntúa un markdown contra las
 * expectativas de un `MddEvalCase` sin LLM. Pura: solo built-ins de node y las constantes
 * del contrato (`mdd-eval.types.ts`).
 */

import { MDD_EVAL_DIMENSION_WEIGHTS, MDD_EVAL_FORBIDDEN_PENALTY_MAX } from "./mdd-eval.types.js";
import type {
  MddEvalCase,
  MddEvalDimension,
  MddEvalDimensionKey,
  MddEvalScore,
} from "./mdd-eval.types.js";
import {
  scanMarkdownFences,
  type MarkdownFenceBlock,
  type MarkdownFenceScan,
} from "../utils/mdd-sanitize/fence-scan.util.js";

const CANONICAL_SECTIONS: ReadonlyArray<{ number: number; title: string }> = [
  { number: 1, title: "Contexto" },
  { number: 2, title: "Arquitectura y Stack" },
  { number: 3, title: "Modelo de Datos" },
  { number: 4, title: "Contratos de API" },
  { number: 5, title: "Lógica y Edge Cases" },
  { number: 6, title: "Seguridad" },
  { number: 7, title: "Infraestructura" },
];

const MIN_SECTION_CHARS = 150;
const SQL_LANGS = new Set(["sql", "postgres", "postgresql", "pgsql"]);
const ES_STOPWORDS = new Set([
  "el", "la", "los", "las", "de", "que", "para", "con", "por", "una", "un", "se", "del",
]);
const EN_STOPWORDS = new Set([
  "the", "and", "with", "for", "this", "that", "will", "should", "must",
]);

const SECTION_HEADING_RE = /^##\s+(\d+)(?:[.)])?(?:\s|$)/;
const LEVEL1_HEADING_RE = /^#\s/;
const LEVEL2_HEADING_RE = /^##\s/;
const LEADING_NUMBER_RE = /^##\s+(\d+)/;
const CREATE_TABLE_RE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(;]+)/gi;
const CREATE_TABLE_TEST_RE = /\bcreate\s+table\b/i;
const ER_DIAGRAM_RE = /^\s*erDiagram\b/m;
const ER_ENTITY_BLOCK_RE = /^\s*"?([A-Za-z_][\w-]*)"?\s*\{/;
const ER_RELATION_RE = /^\s*"?([A-Za-z_][\w-]*)"?\s+[|o}{.-]+\s+"?([A-Za-z_][\w-]*)"?\s*:/;
const HTTP_METHOD_RE = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;
const INLINE_ROUTE_RE = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+`?(\/[^\s`'"<>),;|*]*)/g;
const ROUTE_TOKEN_RE = /\/[\w\-.:{}~%\/]*/g;

function clamp(value: number, low = 0, high = 100): number {
  return Math.min(high, Math.max(low, value));
}

function ratio(hits: number, total: number): number {
  return total === 0 ? 100 : (hits / total) * 100;
}

function dimension(key: MddEvalDimensionKey, rawScore: number, details: string[]): MddEvalDimension {
  return {
    key,
    score: Math.round(clamp(rawScore)),
    weight: MDD_EVAL_DIMENSION_WEIGHTS[key],
    details,
  };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function sectionNumberOf(line: string): number | null {
  const match = SECTION_HEADING_RE.exec(line);
  return match ? Number(match[1]) : null;
}

/** Normaliza para comparar: sin acentos, minúsculas y espacios colapsados. */
function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Un encabezado cierra la sección N si es de nivel 1 (`# ...`), de nivel 2 sin número
 * (`## Seguridad`) o de nivel 2 con un número distinto de N (`## 4.`, `## 4 `, `## 4)`).
 * Los `## N.M ...` son subsecciones de N y no la cierran.
 */
function closesSection(line: string, sectionNumber: number): boolean {
  if (LEVEL1_HEADING_RE.test(line)) return true;
  if (!LEVEL2_HEADING_RE.test(line)) return false;
  const leading = LEADING_NUMBER_RE.exec(line);
  return leading === null || Number(leading[1]) !== sectionNumber;
}

/**
 * Cuerpo de la sección `## N. Título` (o variantes `## N Título`, `## N) Título`), incluidas
 * sus subsecciones `## N.M ...`. Ignora encabezados dentro de bloques de código.
 * Devuelve null si la sección no existe.
 */
export function extractMddSectionBody(markdown: string, sectionNumber: number): string | null {
  const lines = splitLines(markdown);
  const { inFence } = scanMarkdownFences(lines);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const line = lines[i] ?? "";
    if (start === -1) {
      if (sectionNumberOf(line) === sectionNumber) start = i + 1;
    } else if (closesSection(line, sectionNumber)) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

/**
 * Rutas (en minúsculas, únicas) que aparecen en §4: celda de ruta tras una celda de método
 * en tablas GFM, `METHOD /path` inline y encabezados `### METHOD /path`.
 */
export function extractRouteTokensFromSection4(section4: string): string[] {
  const routes = new Set<string>();
  const addRoutes = (text: string): void => {
    for (const match of text.matchAll(ROUTE_TOKEN_RE)) {
      const route = match[0].toLowerCase();
      if (route.length >= 2) routes.add(route);
    }
  };
  for (const rawLine of section4.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|");
      cells.forEach((cell, index) => {
        const next = cells[index + 1];
        if (next !== undefined && HTTP_METHOD_RE.test(cell.replace(/[*`]/g, "").trim())) {
          addRoutes(next);
        }
      });
    }
    for (const match of line.matchAll(INLINE_ROUTE_RE)) {
      addRoutes(match[1] ?? "");
    }
  }
  return [...routes];
}

/** Forma canónica para comparar nombres de tabla: minúsculas, sin comillas ni esquema. */
function normalizeEntityName(raw: string): string {
  let name = raw.trim().toLowerCase().replace(/[`"'[\]]/g, "");
  const dot = name.lastIndexOf(".");
  if (dot >= 0) name = name.slice(dot + 1);
  return name.replace(/[\s-]+/g, "_");
}

/** Variantes singular/plural de un nombre: dos nombres casan si comparten alguna variante. */
function entityVariants(raw: string): Set<string> {
  const name = normalizeEntityName(raw);
  const variants = new Set<string>([name, `${name}s`, `${name}es`]);
  if (name.endsWith("ies")) variants.add(`${name.slice(0, -3)}y`);
  if (name.endsWith("y")) variants.add(`${name.slice(0, -1)}ies`);
  if (name.endsWith("es")) variants.add(name.slice(0, -2));
  if (name.endsWith("s")) variants.add(name.slice(0, -1));
  return variants;
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function addEntityVariants(target: Set<string>, raw: string): void {
  if (raw.trim() === "") return;
  for (const variant of entityVariants(raw)) target.add(variant);
}

/**
 * Si el encabezado `## N.` existe pero dentro de un bloque de código, devuelve el detalle que
 * explica por qué la sección se reporta ausente (p. ej. un ```sql sin cerrar que se traga §5).
 */
function fenceDetailForHeading(
  lines: string[],
  scan: MarkdownFenceScan,
  sectionNumber: number,
): string | null {
  const hit = lines.findIndex(
    (line, i) => scan.inFence[i] === true && sectionNumberOf(line) === sectionNumber,
  );
  if (hit === -1) return null;
  const lineNumber = hit + 1;
  const block = scan.blocks.find(
    (b) => b.startLine <= lineNumber && (b.endLine === null || lineNumber < b.endLine),
  );
  const lang = block?.lang || "sin etiqueta";
  const openedAt = block?.startLine ?? lineNumber;
  const state = block && !block.closed ? "bloque de código abierto" : "bloque de código";
  return `§${sectionNumber}: encabezado dentro de un ${state} (lang ${lang}, abierto en línea ${openedAt})`;
}

function scoreStructure(markdown: string, failures: string[]): MddEvalDimension {
  const lines = splitLines(markdown);
  const scan = scanMarkdownFences(lines);
  const headingCounts = new Map<number, number>();
  lines.forEach((line, i) => {
    if (scan.inFence[i]) return;
    const number = sectionNumberOf(line);
    if (number !== null && CANONICAL_SECTIONS.some((s) => s.number === number)) {
      headingCounts.set(number, (headingCounts.get(number) ?? 0) + 1);
    }
  });

  let score = 100;
  const details: string[] = [];
  for (const section of CANONICAL_SECTIONS) {
    const label = `§${section.number} ${section.title}`;
    const body = extractMddSectionBody(markdown, section.number);
    if (body === null) {
      score -= 14;
      details.push(`${label}: ausente`);
      const insideFence = fenceDetailForHeading(lines, scan, section.number);
      if (insideFence) details.push(insideFence);
      failures.push(`estructura: falta la sección §${section.number} (${section.title})`);
    } else if (body.length < MIN_SECTION_CHARS) {
      score -= 7;
      details.push(`${label}: ${body.length} caracteres (mínimo ${MIN_SECTION_CHARS})`);
      failures.push(
        `estructura: la sección §${section.number} tiene ${body.length} caracteres (mínimo ${MIN_SECTION_CHARS})`,
      );
    } else {
      details.push(`${label}: presente`);
    }
  }

  const duplicated = [...headingCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((a, b) => a - b);
  if (duplicated.length > 0) {
    score -= 20;
    for (const number of duplicated) {
      details.push(`§${number}: encabezado canónico duplicado`);
      failures.push(`estructura: encabezado canónico duplicado §${number}`);
    }
  }
  if (scan.unclosed) {
    score -= 20;
    details.push("bloque de código sin cerrar");
    failures.push("estructura: bloque de código sin cerrar (```)");
  }
  return dimension("structure", score, details);
}

/** Fence SQL: etiqueta tipo sql/PostgreSQL/pgsql, o sin etiqueta si su contenido tiene CREATE TABLE. */
function isSqlFence(block: MarkdownFenceBlock): boolean {
  if (block.lang === "") return CREATE_TABLE_TEST_RE.test(block.content);
  return SQL_LANGS.has(block.lang) || block.lang.includes("sql");
}

/** Nombres de tabla de los `CREATE TABLE` en fences SQL del texto. */
function sqlTableNames(text: string): string[] {
  const names: string[] = [];
  for (const block of scanMarkdownFences(splitLines(text)).blocks) {
    if (!isSqlFence(block)) continue;
    for (const match of block.content.matchAll(CREATE_TABLE_RE)) names.push(match[1] ?? "");
  }
  return names;
}

/** Nombres de entidad (bloques y extremos de relación) de los bloques mermaid erDiagram del texto. */
function erEntityNames(text: string): string[] {
  const names: string[] = [];
  for (const block of scanMarkdownFences(splitLines(text)).blocks) {
    if (block.lang !== "mermaid" || !ER_DIAGRAM_RE.test(block.content)) continue;
    for (const line of block.content.split("\n")) {
      const entity = ER_ENTITY_BLOCK_RE.exec(line);
      if (entity) names.push(entity[1] ?? "");
      const relation = ER_RELATION_RE.exec(line);
      if (relation) names.push(relation[1] ?? "", relation[2] ?? "");
    }
  }
  return names;
}

function namesToVariants(names: string[]): Set<string> {
  const variants = new Set<string>();
  for (const name of names) addEntityVariants(variants, name);
  return variants;
}

function distinctEntityCount(names: string[]): number {
  return new Set(names.map(normalizeEntityName).filter((name) => name !== "")).size;
}

function scoreEntities(
  expect: MddEvalCase["expect"],
  section3: string | null,
  markdown: string,
  failures: string[],
): MddEvalDimension {
  const section3Text = section3 ?? "";
  const section3Sql = sqlTableNames(section3Text);
  const section3Er = erEntityNames(section3Text);
  const documentSql = sqlTableNames(markdown);
  const documentEr = erEntityNames(markdown);
  const details: string[] = [];

  let sqlVariants = namesToVariants(section3Sql);
  let erVariants = namesToVariants(section3Er);
  if (section3Sql.length === 0 && section3Er.length === 0 && documentSql.length + documentEr.length > 0) {
    // §3 no tiene tablas ni entidades (típico de subsecciones mal numeradas): se puntúa el documento entero.
    sqlVariants = namesToVariants(documentSql);
    erVariants = namesToVariants(documentEr);
    details.push("entidades: SQL/erDiagram encontrados fuera de §3 (revisar numeración de secciones)");
  }

  const fenceLangs = section3 === null
    ? []
    : scanMarkdownFences(splitLines(section3)).blocks.map((block) => block.lang || "(sin etiqueta)");
  details.push(
    `diagnóstico: fences en §3 = [${fenceLangs.join(", ")}], CREATE TABLE en §3 = ${section3Sql.length}, en documento = ${documentSql.length}, entidades erDiagram en documento = ${distinctEntityCount(documentEr)}`,
  );

  let found = 0;
  for (const entity of expect.entities) {
    const candidates = [entity, ...(expect.entitySynonyms[entity] ?? [])].map(entityVariants);
    const inSql = candidates.some((variants) => setsIntersect(variants, sqlVariants));
    const inEr = !inSql && candidates.some((variants) => setsIntersect(variants, erVariants));
    if (inSql || inEr) {
      found++;
      details.push(`entidad ${entity}: ${inSql ? "CREATE TABLE" : "erDiagram"} encontrada`);
    } else {
      details.push(`entidad ${entity}: no encontrada`);
      failures.push(`entidades: falta "${entity}" en §3 (ni CREATE TABLE ni entidad erDiagram)`);
    }
  }
  return dimension("entities", ratio(found, expect.entities.length), details);
}

function scoreCapabilities(
  expect: MddEvalCase["expect"],
  markdown: string,
  section4: string | null,
  failures: string[],
): MddEvalDimension {
  const section4Routes = section4 === null ? [] : extractRouteTokensFromSection4(section4);
  const documentRoutes = extractRouteTokensFromSection4(markdown);
  const details: string[] = [];
  const routes = section4Routes.length > 0 ? section4Routes : documentRoutes;
  if (section4Routes.length === 0 && documentRoutes.length > 0) {
    // §4 no tiene rutas (típico de subsecciones mal numeradas): se usan las del documento entero.
    details.push("capacidades: no hay rutas en §4; usadas las del documento completo (revisar numeración de secciones)");
  }
  details.push(
    `diagnóstico: rutas en §4 = ${section4Routes.length}, rutas en documento = ${documentRoutes.length}`,
  );
  const routeText = routes.join("\n");
  let covered = 0;
  for (const capability of expect.capabilities) {
    const matched = capability.endpointHints.filter((hint) => routeText.includes(hint.toLowerCase()));
    if (matched.length > 0) {
      covered++;
      details.push(`capacidad ${capability.name}: cubierta (${matched.join(", ")})`);
    } else {
      details.push(`capacidad ${capability.name}: sin ruta en §4`);
      failures.push(
        `capacidades: falta "${capability.name}" en §4 (rutas esperadas: ${capability.endpointHints.join(", ")})`,
      );
    }
  }
  return dimension("capabilities", ratio(covered, expect.capabilities.length), details);
}

/** Un token "a|b" se cumple si aparece cualquiera de sus alternativas. */
function isTokenPresent(token: string, normalizedText: string): boolean {
  return token
    .split("|")
    .map((alternative) => normalizeText(alternative).trim())
    .some((alternative) => alternative.length > 0 && normalizedText.includes(alternative));
}

function scoreTokenSet(
  key: "security" | "infra",
  prefix: string,
  sectionNumber: number,
  tokens: string[],
  section: string | null,
  failures: string[],
): MddEvalDimension {
  const text = normalizeText(section ?? "");
  let present = 0;
  const details: string[] = [];
  for (const token of tokens) {
    if (isTokenPresent(token, text)) {
      present++;
      details.push(`${prefix}: "${token}" presente`);
    } else {
      details.push(`${prefix}: "${token}" ausente`);
      failures.push(`${prefix}: falta "${token}" en §${sectionNumber}`);
    }
  }
  return dimension(key, ratio(present, tokens.length), details);
}

function scoreContext(
  mustMention: string[],
  section1: string | null,
  failures: string[],
): MddEvalDimension {
  if (mustMention.length === 0) {
    return dimension("context", 100, ["sin menciones obligatorias"]);
  }
  const text = normalizeText(section1 ?? "");
  let present = 0;
  const details: string[] = [];
  for (const term of mustMention) {
    if (text.includes(normalizeText(term))) {
      present++;
      details.push(`contexto: menciona "${term}"`);
    } else {
      details.push(`contexto: no menciona "${term}"`);
      failures.push(`contexto: §1 no menciona "${term}"`);
    }
  }
  return dimension("context", ratio(present, mustMention.length), details);
}

/** Prosa de una sección: sin bloques de código ni filas de tabla. */
function proseOf(section: string | null): string {
  if (section === null) return "";
  const lines = splitLines(section);
  const { inFence } = scanMarkdownFences(lines);
  return lines.filter((line, i) => !inFence[i] && !line.trim().startsWith("|")).join("\n");
}

function scoreLanguage(section1: string | null, section5: string | null, failures: string[]): MddEvalDimension {
  const words = `${proseOf(section1)}\n${proseOf(section5)}`.toLowerCase().match(/\p{L}+/gu) ?? [];
  let es = 0;
  let en = 0;
  for (const word of words) {
    if (ES_STOPWORDS.has(word)) es++;
    else if (EN_STOPWORDS.has(word)) en++;
  }
  let score: number;
  if (es === 0 && en === 0) score = 0;
  else if (en === 0) score = 100;
  else if (es / en >= 3) score = 100;
  else if (es / en >= 1) score = 50;
  else score = 0;
  if (score < 100) {
    failures.push(`idioma: prosa de §1 y §5 con poco español (ES=${es}, EN=${en})`);
  }
  return dimension("language", score, [`stopwords ES=${es} EN=${en}`]);
}

function scoreDiagrams(markdown: string, failures: string[]): MddEvalDimension {
  const mermaid = scanMarkdownFences(splitLines(markdown)).blocks.filter((block) => block.lang === "mermaid");
  if (mermaid.some((block) => ER_DIAGRAM_RE.test(block.content))) {
    return dimension("diagrams", 100, ["bloque mermaid erDiagram presente"]);
  }
  if (mermaid.length > 0) {
    failures.push("diagramas: hay bloque mermaid pero ninguno es erDiagram");
    return dimension("diagrams", 50, ["solo bloques mermaid sin erDiagram"]);
  }
  failures.push("diagramas: falta un bloque mermaid erDiagram");
  return dimension("diagrams", 0, ["sin bloques mermaid"]);
}

/**
 * Puntúa un MDD (markdown) contra las expectativas de un caso. Determinista, sin LLM.
 * Ver pesos en `MDD_EVAL_DIMENSION_WEIGHTS` y penalización en `MDD_EVAL_FORBIDDEN_PENALTY_MAX`.
 */
export function scoreMddAgainstCase(markdown: string, evalCase: MddEvalCase): MddEvalScore {
  const { expect } = evalCase;
  const failures: string[] = [];
  const section1 = extractMddSectionBody(markdown, 1);
  const section3 = extractMddSectionBody(markdown, 3);
  const section4 = extractMddSectionBody(markdown, 4);
  const section5 = extractMddSectionBody(markdown, 5);
  const section6 = extractMddSectionBody(markdown, 6);
  const section7 = extractMddSectionBody(markdown, 7);

  const dimensions: MddEvalDimension[] = [
    scoreStructure(markdown, failures),
    scoreEntities(expect, section3, markdown, failures),
    scoreCapabilities(expect, markdown, section4, failures),
    scoreTokenSet("security", "seguridad", 6, expect.security, section6, failures),
    scoreTokenSet("infra", "infra", 7, expect.infra, section7, failures),
    scoreContext(expect.mustMentionInContext, section1, failures),
    scoreLanguage(section1, section5, failures),
    scoreDiagrams(markdown, failures),
  ];

  const normalizedDoc = normalizeText(markdown);
  const forbiddenHits = expect.forbidden.filter(
    (token) => normalizeText(token).length > 0 && normalizedDoc.includes(normalizeText(token)),
  );
  for (const hit of forbiddenHits) {
    failures.push(`prohibido presente: "${hit}" (-5)`);
  }
  const forbiddenPenalty = Math.min(MDD_EVAL_FORBIDDEN_PENALTY_MAX, 5 * forbiddenHits.length);

  const weighted = dimensions.reduce((sum, d) => sum + (d.score * d.weight) / 100, 0);
  const total = Math.round(clamp(weighted - forbiddenPenalty));

  return {
    total,
    passed: total >= evalCase.thresholds.minRubric,
    dimensions,
    forbiddenHits,
    forbiddenPenalty,
    failures,
  };
}
