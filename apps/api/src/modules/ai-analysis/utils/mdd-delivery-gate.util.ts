/**
 * @fileoverview Evaluación de delivery gate — umbrales de calidad MDD.
 */

import type { DomainInventory } from "@theforge/shared-types";
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
import {
  isContratosSubstantial,
  countContratosEndpointRows,
  contratosLacksJsonWarning,
} from "./mdd-sanitize/contratos-format.js";
import { collectMddQualityIssues, isAutoRepairableDeliveryGateWarning } from "../../engine/mdd-quality-audit.util.js";
import { domainDeliveryGateFindings } from "../../engine/cascade-accuracy.util.js";
import { checkBrdDecisionLogClosure } from "../../engine/brd-decision-log.util.js";
import { evaluateBrdToMddTraceability } from "../estimation/brd-mdd-traceability.util.js";
import { prepareMddForDeliveryGateValidation } from "../../projects/mdd-deterministic-repair.util.js";
import {
  evaluateSection1BodyQuality,
  MIN_SECTION1_BODY_LEN_LOW,
  MIN_SECTION1_BODY_LEN_MEDIUM,
  MIN_SECTION1_BODY_LEN_HIGH,
} from "./mdd-section1-quality.util.js";
import { evaluateMddContentQuality } from "./mdd-content-quality.util.js";
import type { MddComplexityLevel } from "../state/mdd-state.schema.js";

export type { MddDeliveryGateResult };

/** Mínimo de chars que una sección canónica debe tener para no ser considerada
 *  placeholder. 200 chars = ~3-4 líneas de prosa o un bloque SQL/JSON de
 *  tabla pequeña. Ajustado para no rechazar SSOT correcciones que generan
 *  secciones muy sintéticas pero válidas (umbral relajado a 100 para §3 si
 *  tiene CREATE TABLE). */
const MIN_SECTION_BODY_LENGTH = 200;
const MIN_SECTION3_BODY_LENGTH = 100;

/** Umbrales del gate de entrega resueltos a partir de la complejidad del proyecto. */
export type DeliveryGateProfile = {
  /** Complejidad efectiva, o `null` cuando el llamador no la conoce (perfil indulgente). */
  complexity: MddComplexityLevel | null;
  /** True cuando no se conoce la complejidad: se usa el perfil MENOS estricto. */
  lenient: boolean;
  minSectionBodyLength: number;
  minSection3BodyLength: number;
  minSection1BodyLength: number;
};

/**
 * Única fuente de umbrales del gate. Todos los llamadores (pipeline, guard, HTTP, memo) deben
 * resolverlos por aquí para que el mismo MDD no pase o falle según quién invoque.
 *
 * Sin complejidad → perfil indulgente (nunca la ruta legacy más estricta): mínimos por sección
 * de HIGH (150/80, los más bajos) y §1 al mínimo de LOW (200).
 */
export function resolveDeliveryGateProfile(complexity?: MddComplexityLevel | null): DeliveryGateProfile {
  switch (complexity) {
    case "HIGH":
      return {
        complexity: "HIGH",
        lenient: false,
        minSectionBodyLength: 150,
        minSection3BodyLength: 80,
        minSection1BodyLength: MIN_SECTION1_BODY_LEN_HIGH,
      };
    case "MEDIUM":
      return {
        complexity: "MEDIUM",
        lenient: false,
        minSectionBodyLength: MIN_SECTION_BODY_LENGTH,
        minSection3BodyLength: MIN_SECTION3_BODY_LENGTH,
        minSection1BodyLength: MIN_SECTION1_BODY_LEN_MEDIUM,
      };
    case "LOW":
      return {
        complexity: "LOW",
        lenient: false,
        minSectionBodyLength: MIN_SECTION_BODY_LENGTH,
        minSection3BodyLength: MIN_SECTION3_BODY_LENGTH,
        minSection1BodyLength: MIN_SECTION1_BODY_LEN_LOW,
      };
    default:
      return {
        complexity: null,
        lenient: true,
        minSectionBodyLength: 150,
        minSection3BodyLength: 80,
        minSection1BodyLength: MIN_SECTION1_BODY_LEN_LOW,
      };
  }
}

/** Heurísticas no auto-reparables que informan pero no deben bloquear la entrega. */
const DEMOTED_TO_WARNING_RE =
  /UNIQUE\([^)]*\)\s+sin\s+WHERE|LDAP\/AD es auth principal pero|suelto sin ```mermaid|Manifest JSON sin objeto `stack`/i;

/** Warning (no blocker) si es auto-reparable o está en la lista de heurísticas degradadas. */
function isWarningOnlyIssue(issue: string): boolean {
  return isAutoRepairableDeliveryGateWarning(issue) || DEMOTED_TO_WARNING_RE.test(issue);
}

const PIPELINE_PLACEHOLDER_AT_START_RE =
  /^\s*\(?\s*(?:Pendiente|TBD)\s*:\s*(?:Arquitecto|Clarificador|Ingeniero|Integraci|paso\s+dedicado)/i;

/**
 * Placeholder del pipeline con guarda anti-sobreaciertos: una sección con >= `minLength` chars
 * de contenido real NO es placeholder solo porque mencione "Pendiente: …" en algún punto; solo
 * cuenta si el cuerpo ARRANCA con un placeholder de agente del pipeline.
 */
function isGatePlaceholderBody(body: string, minLength: number): boolean {
  if (!isMddSectionPipelinePlaceholderBody(body)) return false;
  if (body.length < minLength) return true;
  return PIPELINE_PLACEHOLDER_AT_START_RE.test(body);
}

export type ValidateMddForDeliveryOptions = {
  /** BRD stage content — enables domain auth-skew / entity coverage blockers. */
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
  inventory?: DomainInventory | null;
  /** Fija el perfil de umbrales (ver `resolveDeliveryGateProfile`); ausente → perfil indulgente. */
  mddComplexity?: "LOW" | "MEDIUM" | "HIGH";
  /** Omite reparaciones deterministas (tests del gate sobre markdown crudo). */
  skipDeterministicRepair?: boolean;
};

/** Blockers que requieren intervención humana (BRD / decision log), no reparación automática. */
export function isHumanRequiredDeliveryGateBlocker(issue: string): boolean {
  return /^brd-decision-log:/i.test(issue.trim());
}

/** Títulos canónicos de las 7 secciones del MDD (ordenados). Usados para construir
 *  los nombres en los blockers y para que el log de errores sea legible. */
const CANONICAL_SECTION_TITLES: ReadonlyArray<{ num: number; title: string; pattern: RegExp }> = [
  { num: 1, title: "1. Contexto", pattern: /^##\s+1\.\s*Contexto\b/i },
  { num: 2, title: "2. Arquitectura y Stack", pattern: /^##\s+2\.\s*(?:Arquitectura(?:\s+y\s*Stack)?|Stack(?:\s+t[eé]cnico)?)\b/i },
  { num: 3, title: "3. Modelo de Datos", pattern: /^##\s+3\.\s*Modelo\s+(?:de\s+)?datos/i },
  { num: 4, title: "4. Contratos de API", pattern: /^##\s+4\.\s*Contratos\s+de\s+API/i },
  { num: 5, title: "5. Lógica y Edge Cases", pattern: /^##\s+5\.\s*L[oó]gica\s+y\s+Edge\s+Cases/i },
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
 * ok=true si y solo si blockers.length === 0 (el score es informativo: las deducciones por
 * warnings no bloquean). Umbrales vía `resolveDeliveryGateProfile`.
 * Con BRD/DBGA: añade blockers de dominio (auth-only skew, entidades faltantes).
 */
export function validateMddForDelivery(
  draft: string,
  options?: ValidateMddForDeliveryOptions,
): MddDeliveryGateResult {
  const raw = (draft ?? "").trim();
  const hasDomainContext =
    Boolean(options?.brdMarkdown?.trim()) ||
    Boolean(options?.dbgaMarkdown?.trim()) ||
    Boolean(options?.inventory);

  const prepared = hasDomainContext && !options?.skipDeterministicRepair
    ? prepareMddForDeliveryGateValidation(raw, {
        brdMarkdown: options?.brdMarkdown,
        dbgaMarkdown: options?.dbgaMarkdown,
        specMarkdown: options?.specMarkdown,
        inventory: options?.inventory,
      })
    : { markdown: applyPreDeliveryGateFixes(raw), changed: false, notes: [] as string[] };

  const trimmed = prepared.markdown;
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 100;
  const profile = resolveDeliveryGateProfile(options?.mddComplexity);
  const isHigh = profile.complexity === "HIGH";
  const minSectionBodyLength = profile.minSectionBodyLength;
  const minSection3BodyLength = profile.minSection3BodyLength;

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
    if (entry.num === 1) {
      if (hasCrossReference(body)) continue;
      // Longitud/placeholder = blocker; subsecciones constitución = warning (§1 corta pero
      // estructurada incompleta no debe frenar la entrega).
      const quality = evaluateSection1BodyQuality(body, profile.complexity ?? "LOW", {
        minLen: profile.minSection1BodyLength,
      });
      blockers.push(...quality.lengthBlockers);
      warnings.push(...quality.structureWarnings);
      continue;
    }
    if (hasCrossReference(body)) continue;
    const bodyLen = body.length;
    if (bodyLen < minLength) {
      const isPlaceholder = isGatePlaceholderBody(body, minLength);
      const reason = isPlaceholder
        ? `Sección ${entry.title} está en (Pendiente) o tiene contenido insuficiente (${bodyLen} chars; mínimo ${minLength}).`
        : `Sección ${entry.title} tiene contenido insuficiente (${bodyLen} chars; mínimo ${minLength}).`;
      blockers.push(reason);
      continue;
    }
    if (isGatePlaceholderBody(body, minLength)) {
      blockers.push(
        `Sección ${entry.title} es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.`,
      );
    }
    // §4: longitud sola no basta — rechaza “(Falta: definir endpoints…)” y stubs sin rutas.
    // Criterio único (`isContratosSubstantial`): endpoints método+ruta (prosa, tabla GFM o JSON).
    if (entry.num === 4 && !isContratosSubstantial(body)) {
      blockers.push(
        "§4 Contratos de API no tiene endpoints reales (método + ruta; placeholder o solo stubs). Regenera contratos antes de persistir.",
      );
    }
    if (entry.num === 4 && isContratosSubstantial(body)) {
      const jsonWarning = contratosLacksJsonWarning(body);
      if (jsonWarning) warnings.push(jsonWarning);
      const endpointRows = countContratosEndpointRows(body);
      if (isHigh && bodyLen < 800 && endpointRows < 8) {
        warnings.push(
          "§4 Contratos de API truncado o incompleto para proyecto HIGH (catálogo API insuficiente); ampliar el catálogo.",
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
    if (isWarningOnlyIssue(issue)) {
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
    if (isWarningOnlyIssue(q)) {
      warnings.push(q);
    } else {
      blockers.push(q);
    }
  }

  const sanity = preRenderMddSanity(trimmed);
  if (!sanity.ok) {
    const sanityMsg = sanity.message ?? sanity.code ?? "Error de validación pre-render del MDD.";
    if (isWarningOnlyIssue(sanityMsg)) {
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

  // Checks de *contenido* (no solo forma): un MDD puede pasar longitud mínima y aun así
  // tener §4 solo-catálogo sin specs, §1 sin NFRs medibles, §5 cortada a mitad, §6/§7
  // redundantes, o tablas §3 copiadas del ejemplo del prompt de otro dominio. Todos
  // detectables sin LLM extra; se reportan como warning salvo §4 en HIGH (ver abajo).
  const domainCorpusForAnchor =
    options?.brdMarkdown?.trim() || options?.dbgaMarkdown?.trim()
      ? `${options?.brdMarkdown ?? ""}\n${options?.dbgaMarkdown ?? ""}\n${options?.specMarkdown ?? ""}`.toLowerCase()
      : undefined;
  const contentQuality = evaluateMddContentQuality({
    draft: trimmed,
    domainCorpus: domainCorpusForAnchor,
  });
  // Todo lo de calidad de contenido (incl. ratio de schema de §4) es warning, también en HIGH.
  warnings.push(...contentQuality.warnings);

  if (options?.brdMarkdown?.trim() || options?.dbgaMarkdown?.trim()) {
    const domain = domainDeliveryGateFindings({
      brdMarkdown: options.brdMarkdown,
      dbgaMarkdown: options.dbgaMarkdown,
      mddMarkdown: trimmed,
      specMarkdown: options.specMarkdown,
      complexity: options.mddComplexity,
    });
    for (const b of domain.blockers) {
      warnings.push(b);
    }
    warnings.push(...domain.warnings);
  }

  if (options?.brdMarkdown?.trim()) {
    const brdLog = checkBrdDecisionLogClosure(options.brdMarkdown);
    warnings.push(...brdLog.blockers.map((b) => `brd-decision-log: ${b}`));
    warnings.push(...brdLog.warnings);

    const trace = evaluateBrdToMddTraceability(options.brdMarkdown, trimmed);
    for (const tb of trace.blockers) {
      warnings.push(tb);
    }
    if (trace.missingGaps.length > 0) {
      warnings.push(
        `${trace.missingGaps.length} ítem(s) BRD sin traza completa en §1/§4/§5 (semáforo alineado).`,
      );
    }
  }

  score -= blockers.length * 8;
  score = Math.max(0, Math.min(100, score));

  // ok depende SOLO de los blockers: las deducciones de score por warnings (UAT dup, UI genérica)
  // no deben tumbar un MDD sin blockers (el score se conserva para mostrar).
  const ok = blockers.length === 0;
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
