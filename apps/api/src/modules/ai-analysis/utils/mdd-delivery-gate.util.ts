/**
 * @fileoverview Evaluación de delivery gate — umbrales de calidad MDD.
 */

import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { preRenderMddSanity } from "./mdd-pre-render.js";
import {
  applyPreDeliveryGateFixes,
  detectCrossConsistencyIssues,
  detectDuplicateUatSections,
  detectUnclosedSqlFences,
  mddHasDuplicateSectionHeadings,
  validateMddStructure,
} from "./mdd-sanitize.js";
import { isMddSectionPipelinePlaceholderBody } from "./mdd-sanitize/section-merge.js";
import { isContratosSubstantial, countContratosEndpointRows } from "./mdd-sanitize/contratos-format.js";
import { collectMddQualityIssues, isAutoRepairableDeliveryGateWarning } from "../../engine/mdd-quality-audit.util.js";
import { domainDeliveryGateFindings } from "../../engine/cascade-accuracy.util.js";
import { checkBrdDecisionLogClosure } from "../../engine/brd-decision-log.util.js";

export type { MddDeliveryGateResult };

const DELIVERY_SCORE_THRESHOLD = 90;

/** Mínimo de chars que una sección canónica debe tener para no ser considerada
 *  placeholder. 200 chars = ~3-4 líneas de prosa o un bloque SQL/JSON de
 *  tabla pequeña. Ajustado para no rechazar SSOT correcciones que generan
 *  secciones muy sintéticas pero válidas (umbral relajado a 100 para §3 si
 *  tiene CREATE TABLE). */
const MIN_SECTION_BODY_LENGTH = 200;
const MIN_SECTION3_BODY_LENGTH = 100;

export type ValidateMddForDeliveryOptions = {
  /** BRD stage content — enables domain auth-skew / entity coverage blockers. */
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
  /** Relaja blockers de dominio/sustancia en proyectos HIGH (menos loops del gate). */
  mddComplexity?: "LOW" | "MEDIUM" | "HIGH";
};

/** Títulos canónicos de las 7 secciones del MDD (ordenados). Usados para construir
 *  los nombres en los blockers y para que el log de errores sea legible. */
const CANONICAL_SECTION_TITLES: ReadonlyArray<{ num: number; title: string; pattern: RegExp }> = [
  { num: 1, title: "1. Contexto", pattern: /^##\s+1\.\s*Contexto\b/i },
  { num: 2, title: "2. Arquitectura y Stack", pattern: /^##\s+2\.\s*(?:Arquitectura(?:\s+y\s*Stack)?|Stack(?:\s+t[eé]cnico)?)\b/i },
  { num: 3, title: "3. Modelo de Datos", pattern: /^##\s+3\.\s*Modelo\s+(?:de\s+)?datos/i },
  { num: 4, title: "4. Contratos de API", pattern: /^##\s+4\.\s*Contratos\s+de\s+API/i },
  { num: 5, title: "5. Lógica y Edge Cases", pattern: /^##\s+5\.\s*Lógica\s+y\s+Edge\s+Cases/i },
  { num: 6, title: "6. Seguridad", pattern: /^##\s+6\.\s*Seguridad\b|^##\s*Seguridad\b/i },
  { num: 7, title: "7. Infraestructura", pattern: /^##\s+7\.\s*Infraestructura\b|^##\s*Infraestructura\b|^##\s*Integración\b/i },
];

/** Extrae el cuerpo (markdown) de la sección canónica `num` (1-7) sin el heading.
 *  Devuelve `null` si la sección no existe. Robusto contra:
 *  - Code fences que contengan `## N. …` literal (no cortar dentro).
 *  - Heading pegado al body en la misma línea (`## 1. Contexto ForgeOps es…`),
 *    artefacto de `applyDeterministicCrossConsistencyFixes` upstream.
 *  - Variantes de heading: numerado (`## N. …`) o bare (`## Seguridad`,
 *    `## Infraestructura`/`## Integración` para §6/§7).
 */
function extractSectionBody(draft: string, num: number): string | null {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return null;
  const entry = CANONICAL_SECTION_TITLES.find((s) => s.num === num);
  if (!entry) return null;

  const lines = trimmed.split("\n");
  let headingLineIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (entry.pattern.test(lines[i]!)) {
      headingLineIdx = i;
      break;
    }
  }
  if (headingLineIdx === -1) return null;

  // Si el heading está pegado al body en la misma línea (e.g.
  // "## 1. Contexto ForgeOps es…"), parte la línea: el cuerpo empieza
  // después del match del heading en la misma línea.
  const headingLine = lines[headingLineIdx]!;
  const headingMatch = headingLine.match(entry.pattern);
  const bodyStartsOnSameLine =
    headingMatch != null && headingLine.slice(headingMatch[0].length).trim().length > 0;
  const inlineBodyPrefix = bodyStartsOnSameLine
    ? headingLine.slice(headingMatch![0]!.length).replace(/^\s+/, "")
    : null;

  // Cuerpo: líneas después del heading, hasta el próximo ## N+1 (o ## <Title-bare>).
  let inFence = false;
  const bodyLines: string[] = [];
  if (inlineBodyPrefix) bodyLines.push(inlineBodyPrefix);
  for (let i = headingLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      bodyLines.push(line);
      continue;
    }
    if (!inFence) {
      const nextNumMatch = line.match(/^##\s+(\d+)\./);
      if (nextNumMatch && parseInt(nextNumMatch[1]!, 10) > num) break;
      if (num >= 6) {
        if (/^##\s+Seguridad\b/.test(line) && num !== 6) break;
        if (/^##\s+Infraestructura\b|^##\s+Integraci[oó]n\b/.test(line) && num !== 7) break;
      }
    }
    bodyLines.push(line);
  }
  return bodyLines.join("\n").replace(/^\s*\n+/, "").trim();
}

/** Heurística alineada con reconcileUiUxDesignIntent: columnas id,name,status repetidas. */
function detectGenericUiUxIntent(draft: string): boolean {
  if (!/##\s*UI\/UX\s+Design\s+Intent/i.test(draft)) return false;
  return (draft.match(/\bid,\s*name,\s*status\b/g) ?? []).length >= 4;
}

/**
 * Gate bloqueante de entrega MDD (Fase 0 ≥9/10).
 * ok=true solo si score >= 90 y blockers.length === 0.
 * Con BRD/DBGA: añade blockers de dominio (auth-only skew, entidades faltantes).
 */
export function validateMddForDelivery(
  draft: string,
  options?: ValidateMddForDeliveryOptions,
): MddDeliveryGateResult {
  const trimmed = applyPreDeliveryGateFixes((draft ?? "").trim());
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 100;
  const isHigh = options?.mddComplexity === "HIGH";
  const minSectionBodyLength = isHigh ? 150 : MIN_SECTION_BODY_LENGTH;
  const minSection3BodyLength = isHigh ? 80 : MIN_SECTION3_BODY_LENGTH;

  const structure = validateMddStructure(trimmed);
  if (structure.missingSections.length > 0) {
    blockers.push(`Secciones obligatorias faltantes: ${structure.missingSections.join(", ")}`);
  }

  // ─── Sustancia por sección canónica ────────────────────────────────────
  // Caso de uso: el LLMFormatter (u otro nodo) puede comprimir el MDD a
  // ~18k chars dejando §2-§7 como "(Pendiente)" o placeholders triviales.
  // El check de `validateMddStructure` solo verifica que los headings
  // `## N. …` existan, no que tengan contenido real. El log del job 92
  // del proyecto ForgeOps (2026-07-22 05:35–05:59) demuestra el bug: 3
  // de 7 secciones persistidas en (Pendiente) con `gate ok=true
  // score=100`. CHANGELOG [Unreleased] → Fixed → "Quality Gate endurece
  // substance check para detectar placeholders".
  //
  // Excepciones: una sección puede tener cuerpo corto pero válido si
  // contiene una referencia cruzada (ej. §5 con "Ver §1" tras dedup de
  // UAT) o un manifest JSON muy sintético. Estos patrones no bloquean.
  // El check ignora sub-headings (`### …`) al inicio — una sección puede
  // empezar con `### Criterios UAT` y luego contener la referencia `Ver §N`.
  const hasCrossReference = (body: string) => /Ver\s+§\d/i.test(body);
  for (const entry of CANONICAL_SECTION_TITLES) {
    const body = extractSectionBody(trimmed, entry.num);
    const minLength = entry.num === 3 ? minSection3BodyLength : minSectionBodyLength;
    if (body == null) {
      // Ya cubierto por `missingSections` arriba (heading ausente).
      continue;
    }
    if (hasCrossReference(body)) continue;
    const bodyLen = body.length;
    if (bodyLen < minLength) {
      const isPlaceholder = isMddSectionPipelinePlaceholderBody(body);
      const reason = isPlaceholder
        ? `Sección ${entry.title} está en (Pendiente) o tiene contenido insuficiente (${bodyLen} chars; mínimo ${minLength}).`
        : `Sección ${entry.title} tiene contenido insuficiente (${bodyLen} chars; mínimo ${minLength}).`;
      blockers.push(reason);
      continue;
    }
    if (isMddSectionPipelinePlaceholderBody(body)) {
      blockers.push(
        `Sección ${entry.title} es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.`,
      );
    }
    // §4: longitud sola no basta — rechaza “(Falta: definir endpoints…)” y stubs sin JSON/rutas.
    if (entry.num === 4 && !isContratosSubstantial(body)) {
      blockers.push(
        "§4 Contratos de API no tiene endpoints reales con request/response JSON (placeholder o solo stubs). Regenera contratos antes de persistir.",
      );
    }
    if (entry.num === 4 && isHigh && isContratosSubstantial(body)) {
      const endpointRows = countContratosEndpointRows(body);
      if (bodyLen < 800 && endpointRows < 8) {
        blockers.push(
          "§4 Contratos de API truncado o incompleto para proyecto HIGH (catálogo API insuficiente). Regenera contratos antes de persistir.",
        );
      }
    }
  }
  if (!structure.hasTechnicalMetadata) {
    const metaIssue =
      "Falta bloque TechnicalMetadata con etiquetas (ej. [high_security]) en §3 Modelo de Datos.";
    if (isAutoRepairableDeliveryGateWarning(metaIssue)) {
      warnings.push(metaIssue);
    } else {
      blockers.push(metaIssue);
    }
  }

  const unclosedSql = detectUnclosedSqlFences(trimmed);
  if (unclosedSql) {
    if (isAutoRepairableDeliveryGateWarning(unclosedSql)) {
      warnings.push(unclosedSql);
    } else {
      blockers.push(unclosedSql);
    }
  }

  for (const issue of detectCrossConsistencyIssues(trimmed)) {
    if (isAutoRepairableDeliveryGateWarning(issue)) {
      warnings.push(issue);
    } else {
      blockers.push(issue);
    }
  }

  if (mddHasDuplicateSectionHeadings(trimmed)) {
    blockers.push(
      "MDD repite headings canónicos §1–§7 (secciones duplicadas por acumulación del pipeline).",
    );
  }

  for (const q of collectMddQualityIssues(trimmed)) {
    if (isAutoRepairableDeliveryGateWarning(q)) {
      warnings.push(q);
    } else if (/huérfana|JSON inválido|fences desbalanceados|Manifest|Mermaid sin fence|placeholder/i.test(q)) {
      blockers.push(q);
    } else {
      warnings.push(q);
    }
  }

  const sanity = preRenderMddSanity(trimmed);
  if (!sanity.ok) {
    const sanityMsg = sanity.message ?? sanity.code ?? "Error de validación pre-render del MDD.";
    if (isAutoRepairableDeliveryGateWarning(sanityMsg)) {
      warnings.push(sanityMsg);
    } else {
      blockers.push(sanityMsg);
    }
  }

  if (detectDuplicateUatSections(trimmed)) {
    warnings.push("§1 y §5 duplican criterios UAT; consolidar referencia en §1.");
    score -= 5;
  }

  if (detectGenericUiUxIntent(trimmed)) {
    warnings.push(
      "UI/UX Design Intent usa columnas genéricas repetidas (id, name, status); regenerar desde §3.",
    );
    score -= 10;
  }

  if (options?.brdMarkdown?.trim() || options?.dbgaMarkdown?.trim()) {
    const domain = domainDeliveryGateFindings({
      brdMarkdown: options.brdMarkdown,
      dbgaMarkdown: options.dbgaMarkdown,
      mddMarkdown: trimmed,
      specMarkdown: options.specMarkdown,
      complexity: options.mddComplexity,
    });
    blockers.push(...domain.blockers);
    warnings.push(...domain.warnings);
  }

  if (options?.brdMarkdown?.trim()) {
    const brdLog = checkBrdDecisionLogClosure(options.brdMarkdown);
    blockers.push(...brdLog.blockers.map((b) => `brd-decision-log: ${b}`));
    warnings.push(...brdLog.warnings);
  }

  score -= blockers.length * 8;
  score = Math.max(0, Math.min(100, score));

  const ok = score >= DELIVERY_SCORE_THRESHOLD && blockers.length === 0;
  return { ok, score, blockers, warnings };
}

/** Ajusta semáforo en vivo cuando el gate de entrega no aprueba el MDD. */
export function applyDeliveryGateToSemaphoreStatus(
  status: "red" | "yellow" | "green",
  gate: MddDeliveryGateResult,
): "red" | "yellow" | "green" {
  if (gate.ok) return status;
  return gate.blockers.length > 0 ? "red" : "yellow";
}

/** Campos SSE compartidos (done/draft/interrupt) a partir del gate y métricas. */
export function mddStreamDeliveryGateFields(
  gate: MddDeliveryGateResult | undefined,
  metricsStatus: "red" | "yellow" | "green",
): { deliveryGate?: MddDeliveryGateResult; status: "red" | "yellow" | "green" } {
  if (!gate) return { status: metricsStatus };
  return {
    deliveryGate: {
      ok: gate.ok,
      score: gate.score,
      blockers: gate.blockers,
      warnings: gate.warnings,
    },
    status: applyDeliveryGateToSemaphoreStatus(metricsStatus, gate),
  };
}

export type PersistedMddDeliveryGate = MddDeliveryGateResult & { updatedAt: string };

/** Lee snapshot persistido en `Stage.shortTermContext.deliveryGate`. */
export function readDeliveryGateSnapshot(shortTermContext: unknown): PersistedMddDeliveryGate | null {
  if (!shortTermContext || typeof shortTermContext !== "object" || Array.isArray(shortTermContext)) {
    return null;
  }
  const gate = (shortTermContext as Record<string, unknown>).deliveryGate;
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) return null;
  const g = gate as Record<string, unknown>;
  if (typeof g.ok !== "boolean" || typeof g.score !== "number") return null;
  return {
    ok: g.ok,
    score: g.score,
    blockers: Array.isArray(g.blockers)
      ? g.blockers.filter((b): b is string => typeof b === "string")
      : [],
    warnings: Array.isArray(g.warnings)
      ? g.warnings.filter((w): w is string => typeof w === "string")
      : [],
    updatedAt: typeof g.updatedAt === "string" ? g.updatedAt : "",
  };
}

/** Fusiona gate en shortTermContext sin borrar otras claves (p. ej. mddAuditSnapshot). */
export function mergeDeliveryGateIntoShortTermContext(
  prev: Record<string, unknown>,
  gate: MddDeliveryGateResult,
): Record<string, unknown> {
  return {
    ...prev,
    deliveryGate: {
      ok: gate.ok,
      score: gate.score,
      blockers: gate.blockers,
      warnings: gate.warnings,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Lightweight: true si validateMddForDelivery reportaría blockers duros (sin recalcular score). */
export function mddDeliveryGateHasBlockers(draft: string): boolean {
  if (!(draft ?? "").trim()) return true;
  return validateMddForDelivery(draft).blockers.length > 0;
}
