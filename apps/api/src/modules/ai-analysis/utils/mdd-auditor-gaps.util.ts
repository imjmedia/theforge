/**
 * @fileoverview Nodo auditor — evalúa calidad de documentación y gaps en el pipeline.
 */

import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import {
  detectSection2Section7NodeVersionMismatchIssue,
  mddHasDuplicateSectionHeadings,
  type ValidateMddStructureResult,
} from "./mdd-sanitize.js";
import { computeContractGaps, computeTraceabilityGaps } from "../../engine/mdd-internal-audit.util.js";
import { collectMddQualityIssues, isAutoRepairableDeliveryGateWarning } from "../../engine/mdd-quality-audit.util.js";
import { applyPreDeliveryGateFixes } from "./mdd-sanitize.js";
import {
  evaluateBrdToMddTraceability,
} from "../estimation/brd-mdd-traceability.util.js";

export const MDD_AUDIT_PASS_THRESHOLD = 85;

export function buildAuditorFeedbackFromGaps(gaps: AuditorGapsState): string {
  const parts: string[] = [];
  for (const g of gaps.critical_gaps) {
    parts.push(`[${(g.sections ?? []).join(", ")}] ${g.issue} Corrección: ${g.fix}`);
  }
  for (const e of gaps.syntax_errors) parts.push(e);
  return parts.join(" ");
}

/** Score from structural validation + deterministic contract/traceability gaps. */
export function computeDeterministicAuditorScore(
  draft: string,
  validation: ValidateMddStructureResult,
): number {
  let score = 80;
  if (
    validation.missingSections.length === 0 &&
    validation.section3HasPayloads &&
    validation.hasTechnicalMetadata
  ) {
    score = 88;
  } else {
    if (!validation.section3HasPayloads) score -= 20;
    if (!validation.hasTechnicalMetadata) score -= 5;
    if (validation.missingSections.length > 0) {
      score = Math.min(score, 94);
      score -= validation.missingSections.length * 5;
    }
  }

  const contract = computeContractGaps(draft);
  const trace = computeTraceabilityGaps(draft);
  if (contract.mermaidParityGap) score -= 10;
  if (contract.apiSchemaGap) score -= 8;
  if (contract.infraStackGap) score -= 10;
  if (contract.securityEdgeCaseGap) score -= 5;
  if (trace.inconsistentSections.length > 0) score -= 15;
  if (mddHasDuplicateSectionHeadings(draft)) score -= 12;
  if (collectMddQualityIssues(draft).length > 0) score -= 8;

  return Math.max(0, Math.min(100, score));
}

/** Gaps estructurales mínimos (solo secciones canónicas faltantes) — fallback si el LLM no responde. */
export function synthesizeStructuralAuditorGaps(
  validation: ValidateMddStructureResult,
): AuditorGapsState {
  const critical_gaps: AuditorGapsState["critical_gaps"] = [];
  for (const sec of validation.missingSections) {
    critical_gaps.push({
      sections: [sec],
      issue: `Falta la sección obligatoria: ${sec}`,
      fix: `Generar la sección «${sec}» con contenido sustancial según la plantilla canónica del MDD.`,
    });
  }
  const score = validation.missingSections.length > 0 ? Math.min(84, 70 - validation.missingSections.length * 5) : 0;
  return {
    score: Math.max(0, score),
    status: "RECHAZADO",
    critical_gaps,
    syntax_errors: [],
    infrastructure_ready: false,
  };
}

export function appendBrdTraceabilityAuditorGaps(
  critical_gaps: AuditorGapsState["critical_gaps"],
  brdMarkdown: string | null | undefined,
  mddMarkdown: string,
): number {
  const { missingGaps } = evaluateBrdToMddTraceability(brdMarkdown, mddMarkdown);
  for (const g of missingGaps.slice(0, 12)) {
    critical_gaps.push({
      sections: ["Sección 1", "Sección 4", "Sección 5"],
      issue: g.hint ?? `[BRD→MDD] ${g.concept} sin traza en MDD`,
      fix: `Añadir «${g.concept.slice(0, 80)}» en §1 (contexto), §4 (API) o §5 (lógica) según el BRD (${g.brdSection ?? "negocio"}).`,
    });
  }
  return missingGaps.length;
}

/**
 * Builds structured auditorGaps when the LLM auditor is skipped or as a merge baseline.
 */
export function synthesizeDeterministicAuditorGaps(
  draft: string,
  validation: ValidateMddStructureResult,
  score: number,
  brdMarkdown?: string | null,
): AuditorGapsState {
  const repairedDraft = applyPreDeliveryGateFixes((draft ?? "").trim());
  const critical_gaps: AuditorGapsState["critical_gaps"] = [];
  const syntax_errors: string[] = [];
  const contract = computeContractGaps(repairedDraft);
  const trace = computeTraceabilityGaps(repairedDraft);

  for (const sec of validation.missingSections) {
    critical_gaps.push({
      sections: [sec],
      issue: `Falta la sección obligatoria: ${sec}`,
      fix: `Generar la sección «${sec}» con contenido sustancial según la plantilla canónica del MDD.`,
    });
  }

  if (!validation.section3HasPayloads) {
    critical_gaps.push({
      sections: ["Sección 4"],
      issue: "Contratos de API sin payloads JSON ni endpoints documentados",
      fix: "Añadir endpoints REST con request/response en bloques ```json y tabla de rutas.",
    });
  }

  if (!validation.hasTechnicalMetadata) {
    critical_gaps.push({
      sections: ["Sección 3"],
      issue: "Falta bloque TechnicalMetadata con etiquetas de coste",
      fix: "Incluir TechnicalMetadata con etiquetas como [high_security], [external_api], [cicd_pipeline].",
    });
  }

  if (contract.mermaidParityGap) {
    critical_gaps.push({
      sections: ["Sección 3"],
      issue: "El diagrama erDiagram no coincide con las tablas SQL (nombres o atributos)",
      fix: "Alinear entidades y columnas del erDiagram 1:1 con CREATE TABLE; un solo marcador PK o FK por atributo.",
    });
  }

  if (contract.apiSchemaGap) {
    critical_gaps.push({
      sections: ["Sección 3", "Sección 4"],
      issue: "Campos JSON de la API no mapean a columnas del modelo de datos",
      fix: "Revisar payloads request/response para que coincidan con tipos y columnas SQL.",
    });
  }

  const nodeVersionIssue = detectSection2Section7NodeVersionMismatchIssue(repairedDraft);
  if (nodeVersionIssue) {
    critical_gaps.push({
      sections: ["Sección 2", "Sección 7"],
      issue: nodeVersionIssue,
      fix: "Alinear `base_image`, Dockerfile y manifest §7 con la versión Node documentada en §2 (p. ej. node:20-alpine).",
    });
  } else if (contract.infraStackGap) {
    critical_gaps.push({
      sections: ["Sección 2", "Sección 7"],
      issue: "Stack NestJS/Node en Arquitectura no reflejado en Infraestructura",
      fix: "Documentar Dockerfile/imagen Node, variables de entorno y despliegue acorde al stack §2.",
    });
  }

  if (contract.securityEdgeCaseGap) {
    critical_gaps.push({
      sections: ["Sección 5", "Sección 6"],
      issue: "Edge case de bloqueo de cuenta sin política de intentos en Seguridad",
      fix: "Definir número máximo de intentos fallidos y duración del bloqueo en §6.",
    });
  }

  if (trace.inconsistentSections.length > 0) {
    critical_gaps.push({
      sections: ["Sección 1", "Sección 3", "Sección 4", "Sección 6"],
      issue: "Concepto de seguridad avanzada (ej. MFA) en Contexto sin soporte en modelo, API o Seguridad",
      fix: "Añadir tablas de secretos, endpoint de verificación y algoritmo TOTP en las secciones correspondientes.",
    });
  }

  for (const issue of validation.issues) {
    if (
      /mermaid|erDiagram|syntax|sintaxis|tabla markdown|huérfana|JSON inválido|duplic/i.test(issue) &&
      !isAutoRepairableDeliveryGateWarning(issue)
    ) {
      syntax_errors.push(issue);
    }
  }

  if (mddHasDuplicateSectionHeadings(repairedDraft)) {
    critical_gaps.push({
      sections: ["Secciones 1–7"],
      issue: "Headings canónicos §1–§7 duplicados en el borrador",
      fix: "Ejecutar deduplicateAndReorderMddSections o regenerar las secciones afectadas desde cero.",
    });
  }

  for (const q of collectMddQualityIssues(repairedDraft)) {
    if (/Mermaid|JSON|Manifest|huérfana|placeholder/i.test(q) && !isAutoRepairableDeliveryGateWarning(q)) {
      syntax_errors.push(q);
    }
  }

  appendBrdTraceabilityAuditorGaps(critical_gaps, brdMarkdown, repairedDraft);

  const infrastructure_ready = contract.infraStackGap === 0 && validation.hasTechnicalMetadata;
  const status =
    score >= MDD_AUDIT_PASS_THRESHOLD && critical_gaps.length === 0 && syntax_errors.length === 0
      ? "APROBADO"
      : "RECHAZADO";

  return {
    score,
    status,
    critical_gaps,
    syntax_errors,
    infrastructure_ready,
  };
}

const FENCE_LINE_RE = /^\s*(```|~~~)(.*)$/;
const SECTION_HEADING_RE = /^##\s+(\d+)\.\s/;
const JSON_OMITTED_NOTE = "[ejemplo JSON omitido por tamaño]";
const PROSE_TRUNCATED_MARKER = "[... sección truncada ...]";
const PROSE_SECTIONS = new Set([1, 2, 5, 6, 7]);

type DraftChunk = { num: number; lines: string[] };

/** Divide el borrador en preámbulo (num 0) + secciones `## N.`; ignora headings dentro de fences. */
function splitDraftIntoChunks(draft: string): DraftChunk[] {
  const chunks: DraftChunk[] = [{ num: 0, lines: [] }];
  let fence: string | null = null;
  for (const line of draft.split("\n")) {
    const f = line.match(FENCE_LINE_RE);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1] === fence && f[2]!.trim() === "") fence = null;
    } else if (fence === null) {
      const h = line.match(SECTION_HEADING_RE);
      if (h) {
        chunks.push({ num: Number(h[1]), lines: [line] });
        continue;
      }
    }
    chunks[chunks.length - 1]!.lines.push(line);
  }
  return chunks;
}

function chunkLength(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length + 1, 0);
}

/** Sustituye por `{…}` el cuerpo de cada fence ```json con cuerpo > `minBodyChars` (siempre cierra el fence). */
function dropJsonFenceBodies(lines: string[], minBodyChars: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const f = line.match(FENCE_LINE_RE);
    if (f && /^json\b/i.test(f[2]!.trim())) {
      let j = i + 1;
      const body: string[] = [];
      while (j < lines.length) {
        const c = lines[j]!.match(FENCE_LINE_RE);
        if (c && c[1] === f[1] && c[2]!.trim() === "") break;
        body.push(lines[j]!);
        j += 1;
      }
      const closed = j < lines.length;
      if (closed && body.join("\n").length > minBodyChars) {
        out.push(line, "{…}", f[1]!, JSON_OMITTED_NOTE);
      } else {
        out.push(line, ...body);
        if (closed) out.push(lines[j]!);
      }
      i = closed ? j + 1 : lines.length;
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out;
}

/** Corta por líneas completas hasta `limit` chars; si queda dentro de un fence lo cierra antes del marcador. */
function truncateLinesFenceAware(lines: string[], limit: number): string[] {
  if (chunkLength(lines) <= limit) return lines;
  const out: string[] = [];
  let used = 0;
  let fence: string | null = null;
  for (const line of lines) {
    if (used + line.length + 1 > limit && out.length > 0) break;
    out.push(line);
    used += line.length + 1;
    const f = line.match(FENCE_LINE_RE);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1] === fence && f[2]!.trim() === "") fence = null;
    }
  }
  if (fence !== null) out.push(fence);
  out.push("", PROSE_TRUNCATED_MARKER);
  return out;
}

/** Reduce cada `CREATE TABLE` de los fences ```sql a las primeras `maxLines` líneas + cierre `);`. */
function compactCreateTables(lines: string[], maxLines: number): string[] {
  const out: string[] = [];
  let inSql = false;
  let tableLines = 0;
  let skipped = 0;
  let inTable = false;
  const flushSkipped = (): void => {
    if (skipped > 0) {
      out.push(`  -- … (+${skipped} línea(s) de columnas omitidas por tamaño)`);
      skipped = 0;
    }
  };
  for (const line of lines) {
    const f = line.match(FENCE_LINE_RE);
    if (f) {
      if (!inSql && /^sql\b/i.test(f[2]!.trim())) inSql = true;
      else if (inSql && f[2]!.trim() === "") {
        flushSkipped();
        inSql = false;
        inTable = false;
      }
      out.push(line);
      continue;
    }
    if (!inSql) {
      out.push(line);
      continue;
    }
    if (/^\s*CREATE\s+TABLE\b/i.test(line)) {
      inTable = true;
      tableLines = 0;
      out.push(line);
      continue;
    }
    if (inTable) {
      if (/^\s*\)\s*;?\s*$/.test(line)) {
        flushSkipped();
        inTable = false;
        out.push(line);
        continue;
      }
      tableLines += 1;
      if (tableLines <= maxLines) out.push(line);
      else skipped += 1;
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Reduce borradores MDD grandes para la llamada del Auditor LLM (evita timeouts del proxy)
 * SIN romper fences ni ocultar contratos: antes cortaba cada sección a ~3 500 chars, incluso
 * dentro de ```sql/```json, y el LLM reportaba fences rotos / endpoints faltantes que no existían.
 *
 * Orden de reducción (se detiene en cuanto cabe en `maxChars`):
 *  1. Cuerpos de ```json largos (sobre todo §4) → `{…}` + nota.
 *  2. Prosa de §1/§2/§5/§6/§7 truncada por líneas completas; si el corte cae dentro de un fence
 *     se cierra antes del marcador. §3 (CREATE TABLE) y §4 (filas de endpoints) no se tocan.
 *  3. Todos los cuerpos ```json restantes (p. ej. manifest de §7) → `{…}`.
 *  4. Último recurso: cuerpos de CREATE TABLE compactados (cabecera + primeras columnas).
 */
export function truncateDraftForAuditorLlm(draft: string, maxChars = 28_000): string {
  const trimmed = draft.trim();
  if (trimmed.length <= maxChars) return trimmed;

  let chunks = splitDraftIntoChunks(trimmed);
  const render = (): string => chunks.map((c) => c.lines.join("\n")).join("\n").trim();
  const total = (): number => chunks.reduce((n, c) => n + chunkLength(c.lines), 0);

  if (chunks.length <= 1) {
    // Sin secciones canónicas: reducir solo cuerpos JSON y cortar por líneas/fences.
    chunks[0]!.lines = dropJsonFenceBodies(chunks[0]!.lines, 400);
    chunks[0]!.lines = truncateLinesFenceAware(chunks[0]!.lines, maxChars);
    return render();
  }

  // 1. JSON largos de §4.
  chunks = chunks.map((c) => (c.num === 4 ? { ...c, lines: dropJsonFenceBodies(c.lines, 400) } : c));
  if (total() <= maxChars) return render();

  // 2. Prosa de secciones no contractuales.
  const proseChunks = chunks.filter((c) => PROSE_SECTIONS.has(c.num));
  if (proseChunks.length > 0) {
    const fixed = chunks.filter((c) => !PROSE_SECTIONS.has(c.num)).reduce((n, c) => n + chunkLength(c.lines), 0);
    const perSection = Math.max(1_200, Math.floor((maxChars - fixed) / proseChunks.length));
    chunks = chunks.map((c) =>
      PROSE_SECTIONS.has(c.num) ? { ...c, lines: truncateLinesFenceAware(c.lines, perSection) } : c,
    );
  }
  if (total() <= maxChars) return render();

  // 3. Resto de cuerpos JSON.
  chunks = chunks.map((c) => ({ ...c, lines: dropJsonFenceBodies(c.lines, 0) }));
  if (total() <= maxChars) return render();

  // 4. Último recurso: compactar CREATE TABLE de §3.
  chunks = chunks.map((c) => (c.num === 3 ? { ...c, lines: compactCreateTables(c.lines, 8) } : c));
  return render();
}
