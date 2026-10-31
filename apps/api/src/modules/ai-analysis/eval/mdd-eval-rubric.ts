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
const TOP_LEVEL_HEADING_RE = /^#{1,2}\s/;
const FENCE_OPEN_RE = /^\s*```(.*)$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;
const CREATE_TABLE_RE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(;]+)/gi;
const ER_DIAGRAM_RE = /^\s*erDiagram\b/m;
const ER_ENTITY_BLOCK_RE = /^\s*"?([A-Za-z_][\w-]*)"?\s*\{/;
const ER_RELATION_RE = /^\s*"?([A-Za-z_][\w-]*)"?\s+[|o}{.-]+\s+"?([A-Za-z_][\w-]*)"?\s*:/;
const HTTP_METHOD_RE = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;
const INLINE_ROUTE_RE = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+`?(\/[^\s`'"<>),;|*]*)/g;
const ROUTE_TOKEN_RE = /\/[\w\-.:{}~%\/]*/g;

type Fence = { lang: string; content: string; closed: boolean };
type FenceScan = { blocks: Fence[]; inFence: boolean[]; unclosed: boolean };

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

/** Recorre las líneas marcando las que están dentro de un bloque ``` y extrae los bloques. */
function scanFences(lines: string[]): FenceScan {
  const blocks: Fence[] = [];
  const inFence: boolean[] = lines.map(() => false);
  let open: { lang: string; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (open === null) {
      const opener = FENCE_OPEN_RE.exec(line);
      if (opener) {
        inFence[i] = true;
        const info = (opener[1] ?? "").trim().split(/\s+/)[0] ?? "";
        open = { lang: info.toLowerCase(), body: [] };
      }
      continue;
    }
    inFence[i] = true;
    if (FENCE_CLOSE_RE.test(line)) {
      blocks.push({ lang: open.lang, content: open.body.join("\n"), closed: true });
      open = null;
    } else {
      open.body.push(line);
    }
  }
  if (open !== null) {
    blocks.push({ lang: open.lang, content: open.body.join("\n"), closed: false });
  }
  return { blocks, inFence, unclosed: open !== null };
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
 * Cuerpo de la sección `## N. Título` (o variantes `## N Título`, `## N) Título`).
 * Ignora encabezados dentro de bloques de código. Devuelve null si la sección no existe.
 */
export function extractMddSectionBody(markdown: string, sectionNumber: number): string | null {
  const lines = splitLines(markdown);
  const { inFence } = scanFences(lines);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const line = lines[i] ?? "";
    if (start === -1) {
      if (sectionNumberOf(line) === sectionNumber) start = i + 1;
    } else if (TOP_LEVEL_HEADING_RE.test(line)) {
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

function scoreStructure(markdown: string, failures: string[]): MddEvalDimension {
  const lines = splitLines(markdown);
  const scan = scanFences(lines);
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

function scoreEntities(
  expect: MddEvalCase["expect"],
  section3: string | null,
  failures: string[],
): MddEvalDimension {
  const sqlVariants = new Set<string>();
  const erVariants = new Set<string>();
  if (section3 !== null) {
    for (const block of scanFences(splitLines(section3)).blocks) {
      if (SQL_LANGS.has(block.lang)) {
        for (const match of block.content.matchAll(CREATE_TABLE_RE)) {
          addEntityVariants(sqlVariants, match[1] ?? "");
        }
      } else if (block.lang === "mermaid" && ER_DIAGRAM_RE.test(block.content)) {
        for (const line of block.content.split("\n")) {
          const entity = ER_ENTITY_BLOCK_RE.exec(line);
          if (entity) addEntityVariants(erVariants, entity[1] ?? "");
          const relation = ER_RELATION_RE.exec(line);
          if (relation) {
            addEntityVariants(erVariants, relation[1] ?? "");
            addEntityVariants(erVariants, relation[2] ?? "");
          }
        }
      }
    }
  }

  let found = 0;
  const details: string[] = [];
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
  section4: string | null,
  failures: string[],
): MddEvalDimension {
  const routeText = (section4 === null ? [] : extractRouteTokensFromSection4(section4)).join("\n");
  let covered = 0;
  const details: string[] = [];
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
  const { inFence } = scanFences(lines);
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
  const mermaid = scanFences(splitLines(markdown)).blocks.filter((block) => block.lang === "mermaid");
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
    scoreEntities(expect, section3, failures),
    scoreCapabilities(expect, section4, failures),
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
