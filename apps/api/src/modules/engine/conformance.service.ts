import { Injectable } from "@nestjs/common";
import { contentHasMarkdownTableSeparator } from "./markdown-table-repair.util.js";
import { checkInfraManifestConformance } from "./mdd-quality-audit.util.js";

/**
 * Verificación de conformidad de entregables (Blueprint, API, Infra) contra el MDD (Constitución).
 * SDD Plan 10/10: Fase 2 — Conformance check.
 */

export interface ConformanceResult {
  ok: boolean;
  gaps: string[];
}

export interface ApiConformanceResult {
  ok: boolean;
  missingInApi: string[];
  extraInApi: string[];
}

/** Feedback estructurado para regenerar Contratos API alineados con MDD §4. */
export function buildApiConformanceGapFeedback(check: ApiConformanceResult): string {
  const parts: string[] = [];
  if (check.missingInApi.length > 0) {
    parts.push(
      "ENDPOINTS DEL MDD §4 QUE FALTAN EN EL DOCUMENTO (incorpora cada uno en tabla | Método | Ruta | … con el método exacto):\n" +
        check.missingInApi.map((ep) => `- ${ep}`).join("\n"),
    );
  }
  if (check.extraInApi.length > 0) {
    parts.push(
      "ENDPOINTS EN EL DOC QUE NO ESTÁN EN MDD §4 (elimínalos; no documentes prefijos base como GET /api/v1):\n" +
        check.extraInApi.map((ep) => `- ${ep}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** Extrae el cuerpo de la primera sección cuyo título coincide con el patrón (hasta el siguiente ##). */
function extractSection(md: string, pattern: RegExp): string {
  const content = (md || "").trim();
  const m = content.match(pattern);
  if (!m) return "";
  const start = m.index ?? 0;
  const afterTitle = start + (m[0]?.length ?? 0);
  const rest = content.slice(afterTitle);
  const nextH2 = rest.match(/\n##\s/m);
  const end = nextH2 ? nextH2.index! + 1 : rest.length;
  return rest.slice(0, end).trim();
}

/** Forma canónica por tecnología para que "postgres"/"postgresql" y "tailwind"/"tailwindcss" cuenten como match. */
const STACK_CANONICAL: Record<string, string> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  redis: "redis",
  tailwind: "tailwindcss",
  tailwindcss: "tailwindcss",
  vite: "vite",
  webpack: "webpack",
  nestjs: "nestjs",
  react: "react",
  vue: "vue",
  angular: "angular",
  svelte: "svelte",
  prisma: "prisma",
  typeorm: "typeorm",
  docker: "docker",
  dockerfile: "docker",
  "docker-compose": "docker",
  typescript: "typescript",
  javascript: "javascript",
  turborepo: "turborepo",
  nx: "nx",
};

/** Extrae palabras clave de stack/tecnologías (NestJS, React, PostgreSQL, etc.) de un bloque de texto. Devuelve formas canónicas para comparación. */
function extractStackKeywords(text: string): Set<string> {
  const lower = text.toLowerCase();
  const keywords = new Set<string>();
  const patterns = [
    /\b(nestjs|nestjs\s*v?\d*)\b/gi,
    /\b(react|vue|angular|svelte)\b/gi,
    /\b(postgresql|postgres|mysql|sqlite|redis)\b/gi,
    /\b(prisma|typeorm)\b/gi,
    /\b(docker|dockerfile|docker-compose)\b/gi,
    /\b(typescript|javascript)\b/gi,
    /\b(tailwind|tailwindcss)\b/gi,
    /\b(vite|webpack)\b/gi,
    /\b(turborepo|nx)\b/gi,
  ];
  for (const p of patterns) {
    let match: RegExpExecArray | null;
    while ((match = p.exec(lower)) !== null) {
      const raw = (match[1]?.toLowerCase() ?? "").replace(/\s*v?\d*$/, "");
      const canonical = STACK_CANONICAL[raw] ?? raw;
      if (canonical) keywords.add(canonical);
    }
  }
  return keywords;
}

/** Extrae el cuerpo de la primera sección cuyo título coincide con el patrón (hasta el siguiente ##). (EXPORTADO) */
export { extractSection };

/** Extrae nombres de entidades/tablas (CREATE TABLE, **Entity**, tabla markdown, listas) de un bloque. */
export function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  const createTable = text.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)/gi);
  for (const m of createTable) {
    if (m[1]) entities.add(m[1].toLowerCase());
  }
  const bold = text.matchAll(/\*\*([A-Za-z][A-Za-z0-9_]*)\*\*/g);
  for (const m of bold) {
    if (m[1] && m[1].length > 2) entities.add(m[1].toLowerCase());
  }
  // Extraer de filas de tabla markdown: | entidad | ... |  o  | `entidad` | ... |
  const tableRows = text.matchAll(/^\|\s*`?([a-z_][a-z0-9_]*)`?\s*\|/gim);
  for (const m of tableRows) {
    if (m[1]) entities.add(m[1].toLowerCase());
  }
  // Extraer de segunda columna: | # | `accounting` | ... |  o  | # | accounts | ... |
  const secondCol = text.matchAll(/^\|\s*[^|]+\|\s*`?([a-z_][a-z0-9_]*)`?\s*\|/gim);
  for (const m of secondCol) {
    if (m[1] && !/^(tabla|nombre|name|entidad|entity|table)$/i.test(m[1])) {
      entities.add(m[1].toLowerCase());
    }
  }
  // Extraer de listas markdown: - users  o  * users
  const listItems = text.matchAll(/^[\s]*[-*]\s+(?:`?)([a-z_][a-z0-9_]*)(?:`?)\s*$/gim);
  for (const m of listItems) {
    if (m[1]) entities.add(m[1].toLowerCase());
  }
  // Extraer de cabeceras markdown: ### developers  o  ### `developers`
  // Filtra cabeceras genéricas (secciones, descripción, etc.)
  const genericHeaders = /^(modelo|entidad|tabla|nombre|descripcion|datos|campo|tipo|relacion|relación|indice|índice)$/i;
  const headers = text.matchAll(/^#{2,5}\s+`?([a-z_][a-z0-9_]*)`?\s*$/gim);
  for (const m of headers) {
    if (m[1] && !genericHeaders.test(m[1]) && m[1].length > 2) {
      entities.add(m[1].toLowerCase());
    }
  }
// Extraer de listas inline en párrafos: "Las tablas developers, users, properties..."
  // Busca frases como "tablas X, Y, Z" o "entidades X, Y, Z" o "tables X, Y, Z"
  // y extrae los nombres separados por coma. Soporta opcional ":" después del trigger word.
  const inlineEntityLists = text.matchAll(
    /\b(?:tablas?|entidades?|tables?|entities?|modelos?)\s*:?\s*([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)+)/gi,
  );
  for (const m of inlineEntityLists) {
    const names = m[1].split(/\s*,\s*/);
    for (const name of names) {
      const clean = name.trim().toLowerCase();
      if (clean.length > 2 && !genericHeaders.test(clean)) {
        entities.add(clean);
      }
    }
  }
  // También captura: "developers, users, properties" al inicio de una línea tras viñeta o
  // como parte de "incluye: developers, users..."
  const colonLists = text.matchAll(
    /(?:incluye|contiene|son|tiene|lista|list):\s*([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)+)/gi,
  );
  for (const m of colonLists) {
    const names = m[1].split(/\s*,\s*/);
    for (const name of names) {
      const clean = name.trim().toLowerCase();
      if (clean.length > 2 && !genericHeaders.test(clean) && !entities.has(clean)) {
        entities.add(clean);
      }
    }
  }
  // Extraer nombres de entidades en texto plano por línea independiente:
  // developers
  // users
  // properties
  // Formato común cuando la IA los lista sin markdown.
  // Filtra palabras genéricas (modelo, stack, etc.) y requiere >= 3 chars.
  const bareWords = text.matchAll(/^\s*([a-z_][a-z0-9_]{2,})\s*$/gm);
  for (const m of bareWords) {
    const word = m[1].toLowerCase();
    if (word.length > 2 && !genericHeaders.test(word) && !entities.has(word)) {
      entities.add(word);
    }
  }
  return entities;
}

/** Rutas que son mutaciones (login, register, logout, etc.): método por defecto POST, no GET. */
function defaultMethodForPath(path: string): string {
  const lower = path.toLowerCase();
  if (/\/login\/?$|\/register\/?$|\/logout\/?$|\/mfa\/setup\/?$|\/mfa\/verify\/?$|\/auth\/login|\/auth\/register|\/auth\/logout/.test(lower)) {
    return "POST";
  }
  if (/\/assign\/?$|\/create\/?$|\/delete\/?$|\/application\/register\/?$|\/role\/assign\/?$/.test(lower)) return "POST";
  return "GET";
}

/** Normaliza ruta HTTP para comparación (params `{id}` / `:id` → `/*`, sin query ni trailing slash). */
export function normalizeApiPathForCompare(path: string): string {
  let p = path.replace(/`/g, "").trim().split("?")[0] ?? "";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  p = p.toLowerCase();
  p = p.replace(/\/\{[^}]+\}/g, "/*");
  p = p.replace(/\/:[a-z_][a-z0-9_]*/gi, "/*");
  p = p.replace(/\{[^}]+\}/g, "*");
  p = p.replace(/:[a-z_][a-z0-9_]*/gi, "*");
  return p;
}

const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE";
const API_PATH_CAPTURE = String.raw`(\`[^\`]+\`|\/(?:[\w\-{}:]+(?:\/[\w\-{}:]*)*))`;

/** Extrae métodos + rutas (GET /api/..., POST /auth/...) de un bloque. Acepta líneas sueltas y filas de tabla Markdown. */
/** Prefijo base (/api/v1) mencionado en prosa — no es un endpoint documentable. */
function isBareApiPrefix(path: string): boolean {
  return /^\/api\/v\d+$/i.test(path.replace(/\/$/, ""));
}

function parseEndpointLine(
  line: string,
  add: (method: string, path: string) => void,
  options?: { tablesOnly?: boolean },
): void {
  const tableMethodFirst = line.match(
    new RegExp(`\\|\\s*(${HTTP_METHODS})\\s*\\|\\s*${API_PATH_CAPTURE}`, "i"),
  );
  if (tableMethodFirst) {
    add(tableMethodFirst[1]!, tableMethodFirst[2]!);
    return;
  }
  const tablePathFirst = line.match(
    new RegExp(`\\|\\s*${API_PATH_CAPTURE}\\s*\\|\\s*(${HTTP_METHODS})`, "i"),
  );
  if (tablePathFirst) {
    add(tablePathFirst[2]!, tablePathFirst[1]!);
    return;
  }
  if (options?.tablesOnly) return;

  const methodPath = line.match(
    new RegExp(`\\b(${HTTP_METHODS})\\s+${API_PATH_CAPTURE}`, "i"),
  );
  if (methodPath) {
    add(methodPath[1]!, methodPath[2]!);
    return;
  }
  if (/\/api\/|\/auth\/|\/health/.test(line)) {
    const path = line.match(new RegExp(API_PATH_CAPTURE))?.[1];
    if (path) add(defaultMethodForPath(path.replace(/`/g, "")), path);
  }
}

/** Solo filas de tabla markdown (SSOT §4); ignora H3/prosa que duplican rutas con prefijo distinto. */
export function extractTableEndpoints(text: string): Array<{ method: string; path: string }> {
  const endpoints: Array<{ method: string; path: string }> = [];
  const seen = new Set<string>();
  const add = (method: string, path: string) => {
    const pathClean = path.replace(/`/g, "").trim();
    if (!pathClean.startsWith("/")) return;
    if (isBareApiPrefix(pathClean)) return;
    const normalized = normEp({ method, path: pathClean });
    if (seen.has(normalized)) return;
    seen.add(normalized);
    endpoints.push({ method: method.toUpperCase(), path: pathClean });
  };
  for (const line of text.split(/\r?\n/)) {
    parseEndpointLine(line, add, { tablesOnly: true });
  }
  return endpoints;
}

/** Extrae métodos + rutas (GET /api/..., POST /auth/...) de un bloque. Acepta líneas sueltas y filas de tabla Markdown. */
export function extractEndpoints(text: string): Array<{ method: string; path: string }> {
  const endpoints: Array<{ method: string; path: string }> = [];
  const seen = new Set<string>();
  const add = (method: string, path: string) => {
    const pathClean = path.replace(/`/g, "").trim();
    if (!pathClean.startsWith("/")) return;
    if (isBareApiPrefix(pathClean)) return;
    const normalized = normEp({ method, path: pathClean });
    if (seen.has(normalized)) return;
    seen.add(normalized);
    endpoints.push({ method: method.toUpperCase(), path: pathClean });
  };
  for (const line of text.split(/\r?\n/)) {
    parseEndpointLine(line, add);
  }
  return endpoints;
}

/** Endpoints declarados en MDD §4 (Contratos de API). */
export function extractMddSection4Endpoints(mddContent: string): Array<{ method: string; path: string }> {
  const section4 = extractSection(
    mddContent,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  return extractEndpoints(section4);
}

/** Normaliza endpoint para comparación (sin trailing slash, lowercase path, params unificados). */
export function normEp(ep: { method: string; path: string }): string {
  let method = ep.method.toUpperCase();
  const path = normalizeApiPathForCompare(ep.path);
  if (method === "GET" && defaultMethodForPath(ep.path.replace(/`/g, "")) === "POST") {
    method = "POST";
  }
  return `${method} ${path}`;
}

/** Prefijo API declarado en §7 o dominante en §4 (p. ej. KMS con api_prefix /api/v1). */
export function resolveMddApiPrefixForCompare(mddContent: string): "/api/v1" | "/api" | null {
  if (/api_prefix["']?\s*:\s*["']\/api\/v1["']/i.test(mddContent)) return "/api/v1";
  if (/api_prefix["']?\s*:\s*["']\/api["']/i.test(mddContent)) return "/api";
  const section4 = extractSection(
    mddContent,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  const paths = extractTableEndpoints(section4).map((e) => e.path);
  if (paths.some((p) => /^\/api\/v1\b/i.test(p))) return "/api/v1";
  if (paths.some((p) => /^\/api\b/i.test(p) && !/^\/api\/v1\b/i.test(p))) return "/api";
  if (/\/api\/v1\//i.test(mddContent)) return "/api/v1";
  return null;
}

function endpointCompareVariants(norm: string, prefix: "/api/v1" | "/api" | null): string[] {
  const m = norm.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (!m) return [norm];
  const method = m[1]!.toUpperCase();
  const path = m[2]!;
  const variants = new Set<string>([norm, `${method} ${path}`]);
  if (prefix === "/api/v1") {
    if (!path.startsWith("/api/v1")) {
      variants.add(`${method} /api/v1${path.startsWith("/") ? path : `/${path}`}`);
    } else {
      variants.add(`${method} ${path.slice("/api/v1".length) || "/"}`);
    }
    if (/^\/api\/(?!v1)/i.test(path)) {
      variants.add(`${method} ${path.replace(/^\/api/, "/api/v1")}`);
    }
  } else if (prefix === "/api" && !path.startsWith("/api")) {
    variants.add(`${method} /api${path.startsWith("/") ? path : `/${path}`}`);
  }
  return [...variants];
}

export function apiEndpointsMatch(mddNorm: string, apiNorm: string, prefix: "/api/v1" | "/api" | null = null): boolean {
  if (mddNorm === apiNorm) return true;
  if (mddNorm.toLowerCase() === apiNorm.toLowerCase()) return true;
  const mddVars = endpointCompareVariants(mddNorm, prefix);
  const apiVars = endpointCompareVariants(apiNorm, prefix);
  return mddVars.some((v) => apiVars.includes(v));
}

/** Endpoints §4 para conformidad: tabla primero; H3/prosa solo si no hay tabla. */
function extractMddSection4ForConformance(section4: string): Array<{ method: string; path: string }> {
  const table = extractTableEndpoints(section4);
  return table.length > 0 ? table : extractEndpoints(section4);
}

/** Longitud mínima para considerar un documento como "con contenido" (evitar falsos Cumple cuando está vacío). */
const MIN_DOC_LENGTH = 80;

/** Cabeceras de sección requeridas en el Blueprint (sin importar nivel ##). */
const BLUEPRINT_REQUIRED_SECTIONS = [
  { label: "Stack / Estructura", patterns: [/stack/i, /estructura/i, /tecnol/] },
  { label: "Persistencia y datos", patterns: [/persistencia/i, /datos/i, /modelo\s+de\s+datos/i] },
  { label: "Mapa de contratos API", patterns: [/contratos\s*api/i, /mapa\s+de\s+(?:rutas|contratos|api)/i, /api.*m[oó]dulos/i, /contratos.*m[oó]dulos/i] },
  { label: "Componentes transversales", patterns: [/transversal/i, /pipeline/i, /componentes?/i] },
  { label: "Seguridad en despliegue", patterns: [/seguridad.*despliegue/i, /seguridad.*deploy/i, /seguridad.*auth/i] },
  { label: "Riesgos y mitigaciones", patterns: [/riesgos/i, /mitigacion/i] },
  { label: "Plan de implementación", patterns: [/plan.*implementaci[oó]n/i, /fases/i, /implementaci[oó]n/i] },
];

/**
 * Verifica que el Blueprint contenga todas las secciones requeridas.
 * Busca cabeceras markdown (###) que contengan los patrones.
 */
export function checkBlueprintSectionHeaders(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!blueprintContent?.trim() || blueprintContent.trim().length < MIN_DOC_LENGTH) {
    return { ok: false, gaps: ["Falta Blueprint con contenido suficiente para validar secciones"] };
  }
  // Buscar todas las cabeceras markdown de nivel 2 o 3 en el Blueprint
  const headers = blueprintContent.match(/^#{2,3}\s+.+$/gm) ?? [];
  for (const section of BLUEPRINT_REQUIRED_SECTIONS) {
    const found = headers.some((h) =>
      section.patterns.some((p) => p.test(h)),
    );
    if (!found) {
      gaps.push(`Blueprint no incluye sección "${section.label}". Las cabeceras encontradas son: ${headers.slice(0, 15).map((h) => h.trim()).join(", ")}`);
    }
  }
  return { ok: gaps.length === 0, gaps };
}

/** Palabras y frases incorrectas en español con su corrección. */
const SPANISH_ERRORS: { wrong: RegExp; correction: string }[] = [
  { wrong: /\bval[uú]a(?:ndo|r|s|)\b/i, correction: "valida/validando (de validar)" },
  { wrong: /\bsetear\b/i, correction: "establecer/asignar" },
  { wrong: /\bdel\s+switch\b/i, correction: "del caso/selección" },
  { wrong: /\bencolada\b/i, correction: "encolada (si es 'encolar', sin doble n)" },
];

/**
 * Verifica calidad de español: busca palabras inexistentes o errores comunes.
 */
export function checkBlueprintSpanishQuality(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!blueprintContent?.trim()) return { ok: true, gaps: [] };
  for (const { wrong, correction } of SPANISH_ERRORS) {
    if (wrong.test(blueprintContent)) {
      gaps.push(`Error de español: se encontró patrón "${wrong.source}" — usa "${correction}" en su lugar`);
    }
  }
  return { ok: gaps.length === 0, gaps };
}

/** Patrones de referencia al MDD que DEBEN estar ausentes en el Blueprint (autocontenido). */
const MDD_REFERENCE_PATTERNS: { pattern: RegExp; example: string }[] = [
  // "Ver diagrama en §2.3", "ver §2 del MDD", "véase §3"
  { pattern: /\bver\s+(?:diagrama|figura|tabla|secci[oó]n|el)\s*(?:en\s+)?[§][\d.]/gi, example: "ver diagrama en §2.3" },
  { pattern: /\b(?:v[ée]ase|v[ée]r)\s+[§]\d/gi, example: "véase §3" },
  { pattern: /\b(?:remitimos?\s+al?\s+MDD|remite\s+al\s+MDD)\b/gi, example: "remite al MDD" },
  { pattern: /\b(?:el\s+MDD\s+(?:define|describe|detalla|contiene|especifica|tiene|l[Ii]sta))\b/gi, example: "el MDD define..." },
  { pattern: /\b(?:consultar\s+(?:el\s+)?MDD|v[ée]r\s+(?:el\s+)?MDD)\b/gi, example: "consultar el MDD" },
];

/** Checklist / cumplimiento al final del Blueprint: metadatos, no delegación de contenido. */
const BLUEPRINT_COMPLIANCE_TAIL = /\n#{2,3}\s+(?:Checklist|Verificaci[oó]n(?:\s+de\s+calidad)?|Cumplimiento con el MDD)\b/i;

function stripBlueprintComplianceTail(blueprintContent: string): string {
  const cut = blueprintContent.search(BLUEPRINT_COMPLIANCE_TAIL);
  return cut >= 0 ? blueprintContent.slice(0, cut) : blueprintContent;
}

function isAllowedBlueprintMddReference(context: string): boolean {
  const allowedSql = /ver\s+[§]3\s+del\s+MDD\s+para\s+(?:columnas|tipos|índices|esquema)/i;
  const allowedSso = /ver\s+[§]6\s+(?:del\s+MDD\s+)?para\s+(?:el\s+)?flujo\s+SSO/i;
  if (allowedSql.test(context) || allowedSso.test(context)) return true;

  // Atribución en títulos/metadatos (no sustituye contenido): alineado con blueprint-prompt.md
  if (/\(\s*explícito\s+del\s+MDD\s+[§][\d.]+\s*\)/i.test(context)) return true;
  if (/\(\s*trazabilidad\s+[§][\d.]+\s*\)/i.test(context)) return true;
  if (/\bstack\s+t[eé]cnico\s*\(\s*explícito\s+del\s+MDD/i.test(context)) return true;
  if (/\bcomo\s+en\s+el\s+MDD\s+[§][\d.]+/i.test(context)) return true;

  return false;
}

/**
 * Verifica que el Blueprint no delegue contenido al MDD (autocontenido).
 * Permite excepciones: "(ver §3 del MDD para columnas)" y "(ver §6 para flujo SSO completo)".
 */
export function checkBlueprintSelfContained(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!blueprintContent?.trim()) return { ok: true, gaps: [] };

  const scannable = stripBlueprintComplianceTail(blueprintContent);

  for (const { pattern, example } of MDD_REFERENCE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    const matches = scannable.matchAll(re);
    for (const match of matches) {
      const fullMatch = match[0];
      const context = scannable.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 80);

      if (isAllowedBlueprintMddReference(context)) continue;

      gaps.push(
        `El Blueprint delega contenido al MDD ("${fullMatch}" en contexto: "...${context.trim()}..."). ` +
        `El Blueprint debe ser autocontenido. En su lugar, describe el contenido directamente. ` +
        `Ejemplo de lo que no debe ocurrir: "${example}".`,
      );
    }
  }
  return { ok: gaps.length === 0, gaps };
}

/**
 * Verifica que todas las tablas markdown del Blueprint tengan formato válido:
 * - Separador (|---|---|) en línea distinta a la cabecera
 * - Mismo número de columnas en cabecera, separador y filas
 * - Celdas vacías con al menos un espacio (| | no ||)
 */
export function checkBlueprintTableFormat(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!blueprintContent?.trim()) return { ok: true, gaps: [] };

  const lines = blueprintContent.split("\n");
  let inTable = false;
  let headerCols = 0;
  let lineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    lineNum = i + 1;

    // Detectar inicio de tabla markdown: línea que empieza con |
    if (!line.trim().startsWith("|")) {
      inTable = false;
      continue;
    }

    const cols = line.split("|").length - 1; // columnas = número de pipes - 1 (por pipes al inicio y final)
    if (cols < 2) continue;

    if (!inTable) {
      // Primera fila de la tabla (cabecera)
      inTable = true;
      headerCols = cols;

      // Verificar que la SIGUIENTE línea no contenga separador pegado
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // Si la siguiente línea tiene tanto texto como separador en la misma línea
        if (nextLine.startsWith("|") && /^\|[|\-:]+\|/.test(nextLine) && /[a-zA-Z]/.test(nextLine)) {
          gaps.push(
            `Línea ${lineNum + 1}: La fila de separación (|---|---|) está pegada al contenido de la cabecera. ` +
            "Deben estar en líneas separadas. Ejemplo correcto:\n" +
            "| Col1 | Col2 |\n" +
            "|------|------|\n" +
            "| val1 | val2 |",
          );
        }
      }
      continue;
    }

    // Verificar fila separadora (|---|---|)
    const isSeparator = /^\|[-:]+\|/.test(line.trim());
    if (isSeparator) {
      const sepCols = line.trim().split("|").length - 1;
      if (sepCols !== headerCols) {
        gaps.push(
          `Línea ${lineNum}: La fila separadora tiene ${sepCols} columnas pero la cabecera tiene ${headerCols}. ` +
          `Deben coincidir. Cabecera: "${lines[i - 1]?.trim()}", Separador: "${line.trim()}"`,
        );
      }
      continue;
    }

    // Verificar fila de datos
    if (cols !== headerCols) {
      gaps.push(
        `Línea ${lineNum}: La fila de datos tiene ${cols} columnas pero la cabecera tiene ${headerCols}. ` +
        `Fila: "${line.trim()}"`,
      );
    }

    // Verificar celdas vacías sin espacio: ||
    if (/\|\|/.test(line)) {
      gaps.push(
        `Línea ${lineNum}: Celda vacía sin espacio (||). Usa "| |" en lugar de "||". ` +
        `Fila: "${line.trim()}"`,
      );
    }
  }

  return { ok: gaps.length === 0, gaps };
}

/** Patrón de tabla markdown válida con método HTTP + ruta. */
const API_TABLE_PATTERN = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?.+`?\s*\|/im;

/**
 * Verifica que el Blueprint contenga al menos una tabla markdown con formato
 * correcto para las rutas API (Método | Ruta | ...).
 */
export function checkBlueprintApiTableFormat(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!blueprintContent?.trim()) {
    return { ok: false, gaps: ["Falta Blueprint para verificar tabla API"] };
  }
  const hasApiTable = API_TABLE_PATTERN.test(blueprintContent);
  if (!hasApiTable) {
    // Buscar si hay rutas mencionadas sin tabla
    const hasRoutes = /\/api\/|\/auth\/|\/health/.test(blueprintContent);
    if (hasRoutes) {
      gaps.push("El Blueprint menciona rutas API pero no las presenta en una tabla markdown con formato | Método | Ruta | Módulo | Notas |");
    }
  }
  // Verificar separador GFM en cualquier tabla (no solo al inicio del doc).
  const hasSeparator = contentHasMarkdownTableSeparator(blueprintContent);
  if (hasApiTable && !hasSeparator) {
    gaps.push("La tabla de rutas API no tiene una fila de separación después de las cabeceras (formato markdown: |---|---:|---|)");
  }
  return { ok: gaps.length === 0, gaps };
}

/** Verificación completa del Blueprint: secciones + formato + español */
export function checkBlueprintFullQuality(blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  const checks = [
    checkBlueprintSectionHeaders(blueprintContent),
    checkBlueprintApiTableFormat(blueprintContent),
    checkBlueprintSpanishQuality(blueprintContent),
  ];
  for (const c of checks) {
    gaps.push(...c.gaps);
  }
  return { ok: gaps.length === 0, gaps };
}

/**
 * Solo §3 Modelo de datos vs Blueprint (entidades/tablas). Usado para gate de generación de API.
 */
export function checkBlueprintDataModelVsMdd(
  mddContent: string | null,
  blueprintContent: string | null,
): ConformanceResult {
  const gaps: string[] = [];
  if (!mddContent?.trim()) {
    return { ok: true, gaps: [] };
  }
  if (!blueprintContent?.trim() || blueprintContent.trim().length < MIN_DOC_LENGTH) {
    return {
      ok: false,
      gaps: ["Falta Blueprint con contenido suficiente para validar el modelo de datos (§3 MDD)"],
    };
  }
  const section3 = extractSection(
    mddContent,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  );
  if (section3.length <= 50) {
    return { ok: true, gaps: [] };
  }
  const mddEntities = extractEntities(section3);
  const blueprintEntities = extractEntities(blueprintContent);
  for (const e of mddEntities) {
    if (!e || e.length < 2) continue;
    const exactMatch = blueprintEntities.has(e);
    const partialMatch = Array.from(blueprintEntities).some(
      (b) => b.includes(e) || e.includes(b),
    );
    if (exactMatch || partialMatch) continue;

    // Fallback: buscar el nombre de la entidad como palabra suelta en el Blueprint
    // (captura menciones en párrafos, oraciones, cualquier formato no estructurado)
    const nameRegex = new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (nameRegex.test(blueprintContent)) continue;

    gaps.push(`Entidad/tabla "${e}" del MDD §3 no está reflejada en el Blueprint`);
  }
  return { ok: gaps.length === 0, gaps };
}

/** Tecnologías de §2 presentes en el MDD pero ausentes por nombre en el Blueprint. */
export function getMissingBlueprintStackKeywords(
  mddContent: string | null,
  blueprintContent: string | null,
): string[] {
  if (!mddContent?.trim() || !blueprintContent?.trim()) return [];
  const section2 = extractSection(
    mddContent,
    /^#+\s*(?:2\.\s*)?(?:arquitectura\s+y\s+stack|arquitectura\s+stack)/im,
  );
  if (section2.length <= 20) return [];
  const mddStack = extractStackKeywords(section2);
  const blueprintStack = extractStackKeywords(blueprintContent);
  const missing: string[] = [];
  for (const kw of mddStack) {
    if (kw && !blueprintStack.has(kw)) missing.push(kw);
  }
  return missing;
}

/**
 * Comprueba conformidad del Blueprint con el MDD (§2 Arquitectura y Stack, §3 Modelo de Datos).
 */
export function checkBlueprintVsMdd(mddContent: string | null, blueprintContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!mddContent?.trim()) {
    return { ok: true, gaps: [] };
  }
  if (!blueprintContent?.trim() || blueprintContent.trim().length < MIN_DOC_LENGTH) {
    return { ok: false, gaps: ["Falta contenido del Blueprint"] };
  }
  const section2 = extractSection(
    mddContent,
    /^#+\s*(?:2\.\s*)?(?:arquitectura\s+y\s+stack|arquitectura\s+stack)/im,
  );
  if (section2.length > 50) {
    const mddStack = extractStackKeywords(section2);
    const blueprintStack = extractStackKeywords(blueprintContent);
    for (const kw of mddStack) {
      if (kw && !blueprintStack.has(kw)) {
        gaps.push(`Stack MDD menciona "${kw}" pero no aparece en Blueprint`);
      }
    }
  }
  const dataModel = checkBlueprintDataModelVsMdd(mddContent, blueprintContent);
  gaps.push(...dataModel.gaps);
  return { ok: gaps.length === 0, gaps };
}

/**
 * Comprueba conformidad del documento de API con el MDD (§4 Contratos de API).
 */
export function checkApiVsMdd(mddContent: string | null, apiContent: string | null): ApiConformanceResult {
  const missingInApi: string[] = [];
  const extraInApi: string[] = [];
  if (!mddContent?.trim()) {
    return { ok: true, missingInApi: [], extraInApi: [] };
  }
  const section4 = extractSection(
    mddContent,
    /^#+\s*(?:4\.\s*)?(?:contratos\s+de\s+api|api\s+contracts|endpoints)/im,
  );
  const apiPrefix = resolveMddApiPrefixForCompare(mddContent);
  const mddEndpoints = new Set(extractMddSection4ForConformance(section4).map(normEp));
  if (!apiContent?.trim() || apiContent.trim().length < MIN_DOC_LENGTH) {
    const missing = mddEndpoints.size > 0 ? Array.from(mddEndpoints) : ["Falta contenido del documento API"];
    return {
      ok: false,
      missingInApi: missing,
      extraInApi: [],
    };
  }
  const apiEndpoints = new Set(extractEndpoints(apiContent).map(normEp));
  for (const ep of mddEndpoints) {
    const match =
      apiEndpoints.has(ep) ||
      Array.from(apiEndpoints).some((a) => apiEndpointsMatch(ep, a, apiPrefix));
    if (!match) missingInApi.push(ep);
  }
  for (const ep of apiEndpoints) {
    const match =
      mddEndpoints.has(ep) ||
      Array.from(mddEndpoints).some((m) => apiEndpointsMatch(m, ep, apiPrefix));
    if (!match) extraInApi.push(ep);
  }
  const ok = missingInApi.length === 0 && extraInApi.length === 0;
  return { ok, missingInApi, extraInApi };
}

/** Feedback estructurado para regenerar Infra alineada con MDD §7. */
export function buildInfraConformanceGapFeedback(gaps: string[]): string {
  if (gaps.length === 0) return "";
  return (
    "GAPS DE CONFORMIDAD MDD §7 — incorpora explícitamente en el documento de Infra:\n" +
    gaps.map((g) => `- ${g}`).join("\n") +
    "\n\nSi §7 exige CI/CD o despliegue, incluye una sección dedicada (GitHub Actions, pipeline, estrategia de despliegue, etc.)."
  );
}

/**
 * Comprueba conformidad del documento de Infra con el MDD (§7 Infraestructura).
 */
export function checkInfraVsMdd(mddContent: string | null, infraContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!mddContent?.trim()) {
    return { ok: true, gaps: [] };
  }
  if (!infraContent?.trim() || infraContent.trim().length < MIN_DOC_LENGTH) {
    return { ok: false, gaps: ["Falta contenido del documento de Infra"] };
  }
  const section7 = extractSection(
    mddContent,
    /^#+\s*(?:7\.\s*)?(?:infraestructura|infra|integraci[oó]n)/im,
  );
  const infraLower = infraContent.trim().toLowerCase();
  if (section7.length > 80) {
    if (/\b(env|variable|variable de entorno|\.env)\b/i.test(section7) && !/\b(env|\.env|variable|entorno)\b/i.test(infraLower)) {
      gaps.push("MDD §7 exige variables de entorno; no se mencionan en el doc de Infra");
    }
    if (/\b(docker|dockerfile|docker-compose)\b/i.test(section7) && !/\b(docker|dockerfile|docker-compose)\b/i.test(infraLower)) {
      gaps.push("MDD §7 exige Docker; no aparece en el doc de Infra");
    }
    if (
      /\b(ci\/cd|pipeline|despliegue)\b/i.test(section7) &&
      !/\b(ci|cd|pipeline|deploy|despliegue|desplegar|github actions|gitlab)\b/i.test(infraLower)
    ) {
      gaps.push("MDD §7 exige CI/CD o despliegue; no aparece en el doc de Infra");
    }
  }

  gaps.push(...checkInfraManifestConformance(mddContent ?? "", infraContent ?? ""));

  return { ok: gaps.length === 0, gaps };
}

/** Extrae términos de lógica/edge cases (validación, flujo, mermaid, regla, caso de uso, etc.) de un bloque. */
function extractLogicKeywords(text: string): Set<string> {
  const lower = text.toLowerCase();
  const keywords = new Set<string>();
  const patterns = [
    /\b(edge\s+case|caso\s+límite|casos\s+límite)\b/gi,
    /\b(validaci[oó]n|validar|regla\s+de\s+negocio)\b/gi,
    /\b(flujo|flow|sequence|secuencia)\b/gi,
    /\b(mermaid|sequenceDiagram|flowchart)\b/gi,
    /\b(caso\s+de\s+uso|use\s+case)\b/gi,
    /\b(regla|rule|business\s+logic)\b/gi,
    /\b(mfa|2fa|two-factor|autenticaci[oó]n)\b/gi,
  ];
  for (const p of patterns) {
    let match: RegExpExecArray | null;
    while ((match = p.exec(lower)) !== null) {
      keywords.add((match[1] ?? match[0])?.toLowerCase().trim() ?? "");
    }
  }
  return keywords;
}

/** ¿El documento Flujos cubre un término de lógica extraído del MDD §5? */
function flowsCoversLogicKeyword(
  kw: string,
  flowsLogic: Set<string>,
  logicFlowsContent: string,
): boolean {
  if (!kw || kw.length <= 2) return true;
  if (flowsLogic.has(kw)) return true;
  if (Array.from(flowsLogic).some((f) => f.includes(kw) || kw.includes(f))) return true;

  const hasMermaidFence = /```mermaid/i.test(logicFlowsContent);
  const hasSequence = /\bsequenceDiagram\b/i.test(logicFlowsContent);
  const hasFlowchart = /\bflowchart\b/i.test(logicFlowsContent);
  const hasDiagramWord = /\b(diagrama|flujo)\b/i.test(logicFlowsContent);

  const diagramKeywords = new Set([
    "flowchart",
    "sequencediagram",
    "sequence",
    "mermaid",
    "diagrama",
    "flujo",
  ]);
  if (diagramKeywords.has(kw)) {
    return hasMermaidFence || hasSequence || hasFlowchart || hasDiagramWord;
  }
  return false;
}

/**
 * Comprueba conformidad del documento de Flujos de lógica con el MDD (§5 Lógica y Edge Cases).
 */
export function checkLogicFlowsVsMdd(mddContent: string | null, logicFlowsContent: string | null): ConformanceResult {
  const gaps: string[] = [];
  if (!mddContent?.trim()) {
    return { ok: true, gaps: [] };
  }
  // Misma regla que Blueprint/API/Infra: MDD con contenido + entregable vacío/corto → no cumple
  if (!logicFlowsContent?.trim() || logicFlowsContent.trim().length < MIN_DOC_LENGTH) {
    return { ok: false, gaps: ["Falta contenido del documento de Flujos"] };
  }
  const section5 = extractSection(
    mddContent,
    /^#+\s*(?:5\.\s*)?(?:l[oó]gica\s+y\s+edge\s+cases|l[oó]gica\s+edge|edge\s+cases|casos\s+de\s+uso)/im,
  );
  const mddLogic = extractLogicKeywords(section5);
  const flowsLogic = extractLogicKeywords(logicFlowsContent);
  for (const kw of mddLogic) {
    if (!flowsCoversLogicKeyword(kw, flowsLogic, logicFlowsContent)) {
      gaps.push(`MDD §5 menciona "${kw}" pero no aparece en Flujos`);
    }
  }
  const mddMentionsDiagrams = /\b(mermaid|diagrama|flowchart|sequence|flujo)\b/i.test(section5);
  if (mddMentionsDiagrams && !/\b(mermaid|sequenceDiagram|flowchart|flujo|diagrama)\b/i.test(logicFlowsContent)) {
    gaps.push("Flujos no incluye diagramas (Mermaid) o descripción de flujos explícita");
  }
  return { ok: gaps.length === 0, gaps };
}

@Injectable()
export class ConformanceService {
  checkBlueprintDataModel(mddContent: string | null, blueprintContent: string | null): ConformanceResult {
    return checkBlueprintDataModelVsMdd(mddContent, blueprintContent);
  }

  checkBlueprint(mddContent: string | null, blueprintContent: string | null): ConformanceResult {
    return checkBlueprintVsMdd(mddContent, blueprintContent);
  }

  checkApi(mddContent: string | null, apiContent: string | null): ApiConformanceResult {
    return checkApiVsMdd(mddContent, apiContent);
  }

  checkLogicFlows(mddContent: string | null, logicFlowsContent: string | null): ConformanceResult {
    return checkLogicFlowsVsMdd(mddContent, logicFlowsContent);
  }

  checkInfra(mddContent: string | null, infraContent: string | null): ConformanceResult {
    return checkInfraVsMdd(mddContent, infraContent);
  }
}
