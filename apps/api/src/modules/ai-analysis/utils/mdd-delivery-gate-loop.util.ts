/**
 * @fileoverview Ciclo de reintento/corrección para delivery gates MDD.
 */

import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { isAutoRepairableDeliveryGateWarning } from "../../engine/mdd-quality-audit.util.js";
import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import { getSection6Or7Range } from "./mdd-sanitize.js";

/** Máximo de reintentos automáticos del gate de entrega (Fase 4). */
export const MAX_MDD_DELIVERY_GATE_ATTEMPTS = 3;

/** Nodo del grafo al que el auto-loop redirige tras un fallo del gate.
 *  - "software_architect": re-genera §2/§3/§4/§5 (slice completo, LOW/MEDIUM).
 *  - "stack_architect" | "data_model" | "api_contracts": pipeline HIGH acotado.
 *  - "integration": re-genera §6/§7 en paralelo.
 *  - "clarifier": re-pide alcance al usuario.
 *  - "section5": re-genera SOLO §5 (cuando el substance check falla
 *    únicamente en §5, evita re-correr todo el software_architect).
 *    CHANGELOG [Unreleased] → Added → "Dedicated §5 pass". */
export type DeliveryGateFixTarget =
  | "software_architect"
  | "stack_architect"
  | "data_model"
  | "api_contracts"
  | "integration"
  | "clarifier"
  | "section5";

export type ResolveDeliveryGateFixTargetOptions = {
  /** Pipeline HIGH §2→§3→§4: enruta al nodo acotado según blockers. */
  splitArchitectPipeline?: boolean;
  /** Fingerprint de blockers placeholder del intento anterior (circuit breaker). */
  previousPlaceholderFingerprint?: string;
  /** Intento actual del auto-loop (1-based tras incremento en prepare_output). */
  deliveryGateAttempt?: number;
};

const PLACEHOLDER_BLOCKER_RE =
  /placeholder del pipeline|Pendiente:\s*Arquitecto|está en \(Pendiente\)/i;

/** Fingerprint estable de blockers placeholder (misma sección/defecto repetido). */
export function fingerprintPlaceholderBlockers(blockers: string[]): string {
  return blockers
    .filter((b) => PLACEHOLDER_BLOCKER_RE.test(b))
    .map((b) => b.replace(/\s+/g, " ").trim().toLowerCase())
    .sort()
    .join("||");
}

/** True si los blockers placeholder son idénticos al intento anterior. */
export function hasRepeatedPlaceholderBlockers(
  previousFingerprint: string | undefined,
  blockers: string[],
): boolean {
  const fp = fingerprintPlaceholderBlockers(blockers);
  return fp.length > 0 && fp === (previousFingerprint ?? "");
}

const SECTION5_BLOCKER_RE = /5\.\s*Lógica\s+y\s*Edge\s+Cases/i;
const INTEGRATION_BLOCKER_RE =
  /§7|infraestructura|jwt|manifest|node:|microservicios|hashing_algorithm|jwks|api_prefix|tabla\s+outbox\b/i;
const SECTION2_BLOCKER_RE =
  /§2|2\.\s*arquitectura|stack\b|frontend|backend|orm\b/i;
const SECTION3_BLOCKER_RE =
  /§3|sql|prosa inválida|create table|erdiagram|technicalmetadata|outbox-like|§6 menciona tabla|fences desbalanceados|tabla huérfana|json inválido|domain-auth-only|domain-entities|domain-dbga|modelo de datos/i;
const SECTION4_BLOCKER_RE =
  /§4|contratos de api|endpoints reales|request\/response|domain-section4/i;
// §1 substance: el Clarifier debe re-pedir el alcance al usuario. §2 también
// si falta el stack (heading ausente); pero §2 con heading presente y
// body corto es un problema del Architect, no del Clarifier. Para distinguir,
// exigimos que el mensaje de §2 mencione "faltante" o "faltantes".
const CLARIFIER_BLOCKER_RE =
  /§1\s*contexto|1\.\s*contexto|estructura constituci[oó]n incompleta|2\.\s*arquitectura\s+y\s*stack\s*faltant|secciones obligatorias faltantes:.*(?:1\.\s*contexto|2\.\s*arquitectura)|placeholder.*guiones|objetivos comerciales/i;

const DUPLICATE_SECTION_BLOCKER_RE =
  /repite headings canónicos §1–§7|secciones duplicadas por acumulación del pipeline/i;
const SECTION4_TRUNCATED_BLOCKER_RE =
  /§4 Contratos.*truncado|catálogo API insuficiente/i;
const MISSING_SECTION7_BLOCKER_RE =
  /secciones obligatorias faltantes:\s*7\.\s*infraestructura\b/i;

const MISSING_SECTIONS_BLOCKER_RE = /secciones obligatorias faltantes:/i;

const SECTION1_BROKEN_BLOCKER_RE =
  /1\.\s*contexto.*(?:insuficiente|placeholder|\(pendiente\)|estructura constituci[oó]n incompleta)/i;

const SECTION2_BROKEN_BLOCKER_RE =
  /2\.\s*arquitectura.*(?:insuficiente|placeholder|\(pendiente\)|pendiente:\s*arquitecto)/i;

/** §1–§2 rotas y varias secciones §3–§7 ausentes → pasada completa del arquitecto, no Clarifier. */
export function needsFullArchitectPipelineRegeneration(blockers: string[]): boolean {
  if (blockers.length === 0) return false;

  const s1Broken = blockers.some((b) => SECTION1_BROKEN_BLOCKER_RE.test(b));
  const s2Broken = blockers.some((b) => SECTION2_BROKEN_BLOCKER_RE.test(b));
  if (!s1Broken && !s2Broken) return false;

  const missingBlocker = blockers.find((b) => MISSING_SECTIONS_BLOCKER_RE.test(b));
  if (!missingBlocker) return false;

  const missingSectionNums = new Set(
    [...missingBlocker.matchAll(/\b([3-7])\.\s/gi)].map((m) => m[1]),
  );
  return missingSectionNums.size >= 3;
}

/** Decide si el siguiente paso del auto-loop debe ser arquitecto (§3/§4), integración (§7),
 *  clarifier (§1) o section5 (§5 sólo). Prioriza el match más específico:
 *  si el substance check sólo menciona §5, enruta a "section5" (más eficiente
 *  que re-correr software_architect). */
function resolveSplitArchitectFixTarget(items: string[]): DeliveryGateFixTarget {
  let stackScore = 0;
  let dataScore = 0;
  let apiScore = 0;
  for (const b of items) {
    if (SECTION4_BLOCKER_RE.test(b)) apiScore++;
    else if (SECTION3_BLOCKER_RE.test(b)) dataScore++;
    else if (SECTION2_BLOCKER_RE.test(b)) stackScore++;
  }
  if (apiScore > 0 && apiScore >= dataScore && apiScore >= stackScore) return "api_contracts";
  if (dataScore > 0 && dataScore >= stackScore) return "data_model";
  if (stackScore > 0) return "stack_architect";
  return "data_model";
}

function gapTextTargetsSection5(text: string): boolean {
  return /§?\s*5\b|secci[oó]n\s*5|5\.\s*l[oó]gica\s+y\s+edge/i.test(text);
}

/** True si algún blocker de sustancia apunta a §5 (insuficiente, placeholder, pendiente). */
export function gateHasSection5SubstanceBlocker(blockers: string[]): boolean {
  return blockers.some(
    (b) => SECTION5_BLOCKER_RE.test(b) && !MISSING_SECTIONS_BLOCKER_RE.test(b),
  );
}

/**
 * Evita enrutar a scoped §2–§4 mientras §5 sigue bloqueado por sustancia.
 * Gate blockers > texto de gaps del Auditor (p. ej. contratos en warnings).
 */
export function guardFixTargetAgainstSection5Blockers(
  blockers: string[],
  target: DeliveryGateFixTarget,
): DeliveryGateFixTarget {
  if (!gateHasSection5SubstanceBlocker(blockers)) return target;
  if (
    target === "api_contracts" ||
    target === "data_model" ||
    target === "stack_architect" ||
    target === "software_architect"
  ) {
    return "section5";
  }
  return target;
}

/** Resuelve fixTarget: blockers de sustancia primero; warnings solo si no hay blockers. */
export function resolveDeliveryGateFixTargetFromGate(
  blockers: string[],
  warnings: string[],
  options?: ResolveDeliveryGateFixTargetOptions,
): DeliveryGateFixTarget {
  if (blockers.length > 0) {
    return guardFixTargetAgainstSection5Blockers(
      blockers,
      resolveDeliveryGateFixTarget(blockers, options),
    );
  }
  const autoWarnings = warnings.filter((w) => isAutoRepairableDeliveryGateWarning(w));
  if (autoWarnings.length > 0) {
    return resolveDeliveryGateFixTarget(autoWarnings, options);
  }
  return "software_architect";
}

/** Convierte gaps del Auditor en fixTarget acotado (§5, data_model, integration, …). */
export function mapAuditorGapsToFixTarget(
  gaps: AuditorGapsState,
  options?: ResolveDeliveryGateFixTargetOptions,
): DeliveryGateFixTarget {
  const items: string[] = [];
  for (const g of gaps.critical_gaps) {
    const sections = (g.sections ?? []).join(" ");
    items.push(`${sections} ${g.issue} ${g.fix}`.trim());
  }
  for (const e of gaps.syntax_errors) {
    items.push(e);
  }
  if (items.length === 0) return "software_architect";
  if (
    gaps.syntax_errors.length === 0 &&
    gaps.critical_gaps.length > 0 &&
    gaps.critical_gaps.every((g) =>
      gapTextTargetsSection5(`${(g.sections ?? []).join(" ")} ${g.issue} ${g.fix}`),
    )
  ) {
    return "section5";
  }
  return resolveDeliveryGateFixTarget(items, options);
}

export function resolveDeliveryGateFixTarget(
  blockers: string[],
  options?: ResolveDeliveryGateFixTargetOptions,
): DeliveryGateFixTarget {
  const items = blockers.length > 0 ? blockers : [];
  const text = items.join(" ");

  // Circuit breaker: mismos placeholders §2–§4 dos veces → pasada scoped barata (no clarifier/stack completo).
  if (
    options?.splitArchitectPipeline &&
    (options.deliveryGateAttempt ?? 0) >= 2 &&
    hasRepeatedPlaceholderBlockers(options.previousPlaceholderFingerprint, items) &&
    items.some((b) => SECTION2_BLOCKER_RE.test(b) || SECTION3_BLOCKER_RE.test(b) || SECTION4_BLOCKER_RE.test(b))
  ) {
    return resolveSplitArchitectFixTarget(items);
  }

  // Prioridad alta: si TODOS los blockers son sólo sobre §5 → section5
  // (más eficiente que regenerar §2-§5 vía software_architect).
  if (items.length > 0 && items.every((b) => SECTION5_BLOCKER_RE.test(b))) {
    return "section5";
  }

  // Borrador cascarón: §1/§2 rotas y faltan §3–§7 → software_architect completo (no Clarifier acotado).
  if (needsFullArchitectPipelineRegeneration(items)) {
    return "software_architect";
  }

  // Clarifier: §1/§2 destruidos pero el resto del doc aún tiene masa (reparación de alcance).
  if (items.some((b) => CLARIFIER_BLOCKER_RE.test(b))) {
    return "clarifier";
  }

  if (items.some((b) => MISSING_SECTION7_BLOCKER_RE.test(b))) {
    return "integration";
  }

  if (items.some((b) => DUPLICATE_SECTION_BLOCKER_RE.test(b))) {
    return options?.splitArchitectPipeline ? "data_model" : "software_architect";
  }
  if (items.some((b) => SECTION4_TRUNCATED_BLOCKER_RE.test(b))) {
    return options?.splitArchitectPipeline ? "api_contracts" : "software_architect";
  }

  let integrationScore = 0;
  let architectScore = 0;
  for (const b of items) {
    if (INTEGRATION_BLOCKER_RE.test(b)) integrationScore++;
    if (SECTION3_BLOCKER_RE.test(b) || SECTION4_BLOCKER_RE.test(b) || SECTION2_BLOCKER_RE.test(b)) {
      architectScore++;
    }
  }
  if (integrationScore > architectScore) return "integration";
  if (architectScore > integrationScore) {
    return options?.splitArchitectPipeline
      ? resolveSplitArchitectFixTarget(items)
      : "software_architect";
  }
  if (options?.splitArchitectPipeline && architectScore > 0) {
    return resolveSplitArchitectFixTarget(items);
  }
  if (options?.splitArchitectPipeline && items.some((b) => PLACEHOLDER_BLOCKER_RE.test(b))) {
    return resolveSplitArchitectFixTarget(items);
  }
  return INTEGRATION_BLOCKER_RE.test(text) ? "integration" : "software_architect";
}

/** Issues del gate que siguen tras auto-reparación — disparan loop de agentes, no bloquean al usuario. */
export function hasUnresolvedAutoRepairableGateWarnings(warnings: string[]): boolean {
  return warnings.some((w) => isAutoRepairableDeliveryGateWarning(w));
}

/** @deprecated Use hasUnresolvedAutoRepairableGateWarnings */
export function hasUnresolvedAutoRepairableQuality(warnings: string[]): boolean {
  return hasUnresolvedAutoRepairableGateWarnings(warnings);
}

/** Feedback en español para agentes en el auto-loop del gate (no se muestra crudo al usuario). */
export function formatDeliveryGateBlockersFeedback(blockers: string[]): string {
  const items = blockers.filter((b) => b.trim().length > 0);
  if (items.length === 0) return "";
  const header =
    "Gate de entrega MDD — corrige automáticamente estos defectos estructurales antes de finalizar:";
  return `${header}\n${items.map((b) => `- ${b}`).join("\n")}`;
}

/** Feedback para agentes a partir de warnings auto-reparables del gate. */
export function formatDeliveryGateQualityWarningsFeedback(warnings: string[]): string {
  const items = warnings.filter((w) => isAutoRepairableDeliveryGateWarning(w));
  if (items.length === 0) return "";
  const header =
    "Gate MDD — reparar automáticamente (coherencia §1–§7, SQL, Mermaid, metadata):";
  return `${header}\n${items.map((w) => `- ${w}`).join("\n")}`;
}

export function draftHasSubstantialSection7(draft: string): boolean {
  const range = getSection6Or7Range((draft ?? "").trim(), 7);
  if (!range) return false;
  const body = draft
    .slice(range.start + range.heading.length, range.end)
    .replace(/^\s*\n+/, "")
    .trim();
  return body.length > 200 && !/^\s*\(Pendiente[^)]*\)\s*$/im.test(body);
}

/** True si §6 y §7 tienen contenido sustancial (saltar re-ejecución en reintentos del gate). */
export function draftHasSubstantialSections6And7(draft: string): boolean {
  const range6 = getSection6Or7Range((draft ?? "").trim(), 6);
  if (!range6) return false;
  const body6 = draft
    .slice(range6.start + range6.heading.length, range6.end)
    .replace(/^\s*\n+/, "")
    .trim();
  const has6 = body6.length > 200 && !/^\s*\(Pendiente[^)]*\)\s*$/im.test(body6);
  return has6 && draftHasSubstantialSection7(draft);
}

export function shouldContinueDeliveryGateLoop(
  gate: MddDeliveryGateResult | undefined,
  attempt: number,
): boolean {
  if (!gate || gate.ok) return false;
  return attempt < MAX_MDD_DELIVERY_GATE_ATTEMPTS;
}
