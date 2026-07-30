/**
 * @fileoverview Checks deterministas de *contenido* (no solo forma) para el delivery gate.
 *
 * El gate previo mide forma: longitud mínima, heading presente, filas de tabla. Una
 * auditoría manual de un MDD "que pasó el gate" (KMS corporativo, score=100 interno)
 * encontró 4 gaps de contenido invisibles a esas métricas: endpoints con solo tabla-resumen
 * y sin request/response, §1 sin requisitos no funcionales cuantificados, tablas §3 sin
 * ancla en el dominio (copiadas de un ejemplo del prompt de otro proyecto), y §5 truncada
 * a mitad de subsección. Los cuatro son detectables sin LLM extra.
 */

import { extractSection3Body, extractSection5Body } from "./mdd-sanitize/section-merge.js";
import { extractContratosSectionBody } from "./mdd-sanitize/contratos-format.js";
import { extractCreateTableNamesFromSql } from "./mdd-data-model-patch.util.js";
import { extractEndpointHeadingsFromContratosBody } from "./mdd-api-contracts-chunk.util.js";

// ─── §4: ratio de endpoints con schema request/response ──────────────────────

export type ContratosSchemaRatioResult = {
  totalEndpoints: number;
  endpointsWithSchema: number;
  ratio: number;
};

/**
 * Fracción de endpoints (headings `### MÉTODO /ruta`) que traen al menos un bloque
 * ` ```json ` propio (request o response), no solo la fila en la tabla resumen.
 */
export function computeContratosSchemaRatio(contratosBody: string): ContratosSchemaRatioResult {
  const body = contratosBody ?? "";
  const headings = extractEndpointHeadingsFromContratosBody(body);
  if (headings.length === 0) return { totalEndpoints: 0, endpointsWithSchema: 0, ratio: 1 };

  const blocks = body.split(/\n(?=###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+)/i).filter((b) => /^###\s+/.test(b.trim()));
  const withSchema = blocks.filter((b) => /```json/i.test(b)).length;
  // Si el split no aisló bloques 1:1 con headings (formato atípico), usar recuento de fences
  // como aproximación conservadora en vez de dividir por cero información.
  const endpointsWithSchema = blocks.length >= headings.length ? withSchema : Math.min(withSchema, headings.length);
  return {
    totalEndpoints: headings.length,
    endpointsWithSchema,
    ratio: headings.length > 0 ? endpointsWithSchema / headings.length : 1,
  };
}

/** Umbral mínimo de endpoints con schema propio antes de considerar §4 "contrato incompleto". */
export const CONTRATOS_SCHEMA_RATIO_MIN = 0.6;
/** Por debajo de este nº de endpoints el ratio es ruido estadístico; no se evalúa. */
export const CONTRATOS_SCHEMA_RATIO_MIN_ENDPOINTS = 5;

/** `null` si no aplica (pocos endpoints); mensaje de blocker si el ratio es bajo. */
export function evaluateContratosSchemaRatio(contratosBody: string): string | null {
  const result = computeContratosSchemaRatio(contratosBody);
  if (result.totalEndpoints < CONTRATOS_SCHEMA_RATIO_MIN_ENDPOINTS) return null;
  if (result.ratio >= CONTRATOS_SCHEMA_RATIO_MIN) return null;
  const pct = Math.round(result.ratio * 100);
  return (
    `§4 Contratos de API: solo ${result.endpointsWithSchema}/${result.totalEndpoints} endpoints (${pct}%) ` +
    `traen request/response en JSON; el resto es solo fila de tabla-resumen. Mínimo ${Math.round(CONTRATOS_SCHEMA_RATIO_MIN * 100)}%.`
  );
}

// ─── §1: requisitos no funcionales cuantificados ──────────────────────────────

// Acepta también la forma "**Requisitos No Funcionales:**" — el pipeline de sanitize
// (repairGluedMarkdownHeadings) demota un H3 corto seguido de una lista a etiqueta en
// negrita inline (ver mdd-content-quality.util.spec.ts, job KMS), así que un MDD real que
// pasó por persist puede no conservar el heading `###` aunque el modelo sí lo generase.
const NFR_HEADING_RE =
  /^#{2,4}\s*(?:Requisitos\s+no\s+funcionales|NFRs?|Non-functional\s+requirements)\b|\*\*(?:Requisitos\s+no\s+funcionales|NFRs?)\s*:?\*\*/im;
/** Números con unidad (ms, s, %, req/s, tps, réplicas…) — evita aceptar prosa sin cifras. */
// Sin `\b` final: tras una unidad como `%` (no-word) seguida de puntuación (`.`, no-word),
// `\b` no marca límite ahí y el match fallaba en "99.95%." — se usa lookahead en su lugar.
const QUANTIFIED_METRIC_RE =
  /\b\d+(?:[.,]\d+)?\s*(?:ms|s|seg|segundos|min|minutos|h|horas?|%|req\/s|rps|tps|ops\/s|réplicas?|replicas?|nodos?|GB|TB|MB)(?![a-záéíóúñ])/i;

export type Section1NfrCheckResult = {
  hasNfrSection: boolean;
  quantifiedLines: number;
};

/** Detecta si §1 declara un bloque de NFRs con al menos 2 líneas con cifra+unidad. */
export function evaluateSection1NfrBlock(section1Body: string): Section1NfrCheckResult {
  const body = section1Body ?? "";
  const match = body.match(NFR_HEADING_RE);
  if (!match) return { hasNfrSection: false, quantifiedLines: 0 };
  const startIdx = match.index! + match[0].length;
  const rest = body.slice(startIdx);
  const nextHeadingIdx = rest.search(/\n#{2,4}\s+/);
  const sectionBody = nextHeadingIdx !== -1 ? rest.slice(0, nextHeadingIdx) : rest;
  const quantifiedLines = sectionBody
    .split("\n")
    .filter((line) => QUANTIFIED_METRIC_RE.test(line)).length;
  return { hasNfrSection: true, quantifiedLines };
}

/** Mínimo de líneas cuantificadas para que el bloque NFR cuente como sustancial. */
export const MIN_QUANTIFIED_NFR_LINES = 2;

/** Warning (o `null`) sobre ausencia/insuficiencia de NFRs cuantificados en §1. */
export function evaluateSection1Nfr(section1Body: string): string | null {
  const result = evaluateSection1NfrBlock(section1Body);
  if (!result.hasNfrSection) {
    return "§1 Contexto no declara un bloque de Requisitos No Funcionales (RPO/RTO, latencia, throughput). Añade cifras concretas, no solo cualitativas.";
  }
  if (result.quantifiedLines < MIN_QUANTIFIED_NFR_LINES) {
    return `§1 tiene bloque de NFRs pero solo ${result.quantifiedLines} línea(s) con cifra+unidad (mínimo ${MIN_QUANTIFIED_NFR_LINES}); son cualitativos, no medibles.`;
  }
  return null;
}

// ─── §5: subsecciones completas (detecta truncación de cola) ─────────────────

const SUBSECTION_HEADING_RE = /^###\s+5\.(\d+)\b[^\n]*$/gm;
/** Cuerpo mínimo para que una subsección §5.N cuente como desarrollada, no un título huérfano. */
const MIN_SUBSECTION_BODY_LEN = 80;

export type Section5CompletenessResult = {
  subsections: number;
  /** Índice (1-based) de la última subsección declarada por el heading, si hay numeración. */
  lastDeclaredIndex: number | null;
  /** True si la última subsección tiene heading pero cuerpo insuficiente (cola cortada). */
  truncatedTail: boolean;
};

/** Detecta si §5 termina con un heading `### 5.N` sin desarrollo (indicio de truncación). */
export function evaluateSection5Completeness(section5Body: string): Section5CompletenessResult {
  const body = section5Body ?? "";
  const matches = [...body.matchAll(SUBSECTION_HEADING_RE)];
  if (matches.length === 0) return { subsections: 0, lastDeclaredIndex: null, truncatedTail: false };

  const last = matches[matches.length - 1]!;
  const lastIndex = parseInt(last[1]!, 10);
  const afterHeading = body.slice(last.index! + last[0].length);
  const tailBody = afterHeading.trim();

  return {
    subsections: matches.length,
    lastDeclaredIndex: Number.isFinite(lastIndex) ? lastIndex : null,
    truncatedTail: tailBody.length < MIN_SUBSECTION_BODY_LEN,
  };
}

/** Warning (o `null`) si la última subsección de §5 parece cortada a mitad. */
export function evaluateSection5TailTruncation(section5Body: string): string | null {
  const result = evaluateSection5Completeness(section5Body);
  if (!result.truncatedTail || result.lastDeclaredIndex == null) return null;
  return (
    `§5 Lógica y Edge Cases: la subsección 5.${result.lastDeclaredIndex} tiene título pero cuerpo ` +
    `insuficiente (<${MIN_SUBSECTION_BODY_LEN} chars) — indicio de generación cortada. Completa o retoma la generación.`
  );
}

// ─── §3 ↔ §6/§7: overlap de contenido entre Seguridad e Infraestructura ──────

/** Frases de control técnico que suelen duplicarse entre §6 y §7 (mismo control, dos secciones). */
const OVERLAP_PHRASE_RE =
  /\b(tls\s*1\.[23]|rbac\b|mtls\b|rate\s*limit(?:ing)?|cors\b|audit(?:oría|\s*log)|network\s*polic(?:y|ies)|envelope\s+encryption)\b/gi;

export type SectionOverlapResult = {
  sharedPhrases: string[];
  overlapCount: number;
};

/** Frases de control repetidas literalmente en §6 y §7 (mismo control documentado dos veces). */
export function computeSection6And7Overlap(section6Body: string, section7Body: string): SectionOverlapResult {
  const norm = (s: string) => (s ?? "").toLowerCase();
  const s6 = norm(section6Body);
  const s7 = norm(section7Body);
  const s6Phrases = new Set([...s6.matchAll(OVERLAP_PHRASE_RE)].map((m) => m[0].toLowerCase()));
  const shared = [...s6Phrases].filter((p) => s7.includes(p));
  return { sharedPhrases: shared, overlapCount: shared.length };
}

/** Mínimo de frases de control repetidas para considerarlo redundancia, no coincidencia. */
export const SECTION_OVERLAP_MIN_SHARED_PHRASES = 4;

/** Warning (o `null`) si §6 y §7 documentan los mismos controles por duplicado. */
export function evaluateSection6And7Overlap(section6Body: string, section7Body: string): string | null {
  const result = computeSection6And7Overlap(section6Body, section7Body);
  if (result.overlapCount < SECTION_OVERLAP_MIN_SHARED_PHRASES) return null;
  return (
    `§6 Seguridad y §7 Infraestructura repiten ${result.overlapCount} controles literalmente ` +
    `(${result.sharedPhrases.slice(0, 5).join(", ")}…). §7 debería referenciar "ver §6.x", no reexplicar el control.`
  );
}

// ─── §3: tablas sin ancla en el dominio del proyecto ──────────────────────────

/**
 * Nombres de tabla vistos filtrar entre dominios en prompts de ejemplo (mensajería/orquestación
 * multi-agente) hacia proyectos de otro dominio (ej. KMS) porque el modelo copia el ejemplo
 * literal del prompt en vez de derivar nombres del proyecto real.
 */
export const KNOWN_PROMPT_EXAMPLE_TABLE_NAMES: ReadonlySet<string> = new Set([
  "llm_configs",
  "llm_config",
  "scheduled_tasks",
  "scheduled_task",
  "failed_request_logs",
  "failed_request_log",
  "mcp_plugins",
  "mcp_plugin",
  "conversation_memory",
  "channels",
  "channel",
]);

export type UnanchoredTablesResult = {
  tables: string[];
};

/**
 * Tablas §3 que coinciden con el ejemplo filtrado del prompt del Arquitecto y no aparecen
 * ancladas en BRD/DBGA/inventario — señal fuerte de copia literal de ejemplo, no diseño real.
 */
export function findUnanchoredExampleTables(
  section3Body: string,
  domainCorpus: string,
): UnanchoredTablesResult {
  const sqlMatch = (section3Body ?? "").match(/```sql\s*([\s\S]*?)```/i);
  const sql = sqlMatch?.[1] ?? section3Body ?? "";
  const tables = extractCreateTableNamesFromSql(sql);
  const corpus = (domainCorpus ?? "").toLowerCase();
  const flagged = tables.filter((t) => {
    if (!KNOWN_PROMPT_EXAMPLE_TABLE_NAMES.has(t)) return false;
    // Si el propio BRD/DBGA menciona el nombre, no es leak — es dominio real.
    return !corpus.includes(t);
  });
  return { tables: flagged };
}

/** Warning (o `null`) si §3 tiene tablas del ejemplo del prompt sin ancla en BRD/DBGA. */
export function evaluateUnanchoredExampleTables(
  section3Body: string,
  domainCorpus: string,
): string | null {
  const result = findUnanchoredExampleTables(section3Body, domainCorpus);
  if (result.tables.length === 0) return null;
  return (
    `§3 Modelo de Datos incluye tabla(s) del ejemplo del prompt sin ancla en BRD/DBGA: ` +
    `${result.tables.join(", ")}. Probable copia literal de ejemplo de otro dominio — revisa si pertenecen a este proyecto.`
  );
}

// ─── Entrada única para el delivery gate ──────────────────────────────────────

export type MddContentQualityFindings = {
  warnings: string[];
};

export type EvaluateMddContentQualityInput = {
  draft: string;
  domainCorpus?: string;
};

/** Ejecuta los 4 checks de contenido y agrega los warnings resultantes. */
export function evaluateMddContentQuality(input: EvaluateMddContentQualityInput): MddContentQualityFindings {
  const warnings: string[] = [];
  const draft = input.draft ?? "";

  // `\n*` (no `\n+`): el pipeline de sanitize a veces pega el heading al primer párrafo en
  // la misma línea ("## 1. Contexto KMS corporativo..."); con `\n+` esa forma no matchea nunca.
  const section1Match = draft.match(/##\s*1\.\s*Contexto\b[ \t]*\n*([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  const section1Body = section1Match?.[1] ?? "";
  const nfrIssue = evaluateSection1Nfr(section1Body);
  if (nfrIssue) warnings.push(nfrIssue);

  const contratosBody = extractContratosSectionBody(draft) ?? "";
  const schemaIssue = evaluateContratosSchemaRatio(contratosBody);
  if (schemaIssue) warnings.push(schemaIssue);

  const section5Body = extractSection5Body(draft) ?? "";
  const tailIssue = evaluateSection5TailTruncation(section5Body);
  if (tailIssue) warnings.push(tailIssue);

  const section6Match = draft.match(/##\s*6\.\s*Seguridad\b[ \t]*\n*([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  const section7Match = draft.match(/##\s*7\.\s*Infraestructura\b[ \t]*\n*([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  const overlapIssue = evaluateSection6And7Overlap(section6Match?.[1] ?? "", section7Match?.[1] ?? "");
  if (overlapIssue) warnings.push(overlapIssue);

  if (input.domainCorpus != null) {
    const section3Body = extractSection3Body(draft) ?? "";
    const unanchoredIssue = evaluateUnanchoredExampleTables(section3Body, input.domainCorpus);
    if (unanchoredIssue) warnings.push(unanchoredIssue);
  }

  return { warnings };
}
