import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import {
  detectSection2Section7NodeVersionMismatchIssue,
  mddHasDuplicateSectionHeadings,
  type ValidateMddStructureResult,
} from "./mdd-sanitize.js";
import { computeContractGaps, computeTraceabilityGaps } from "../../engine/mdd-internal-audit.util.js";
import { collectMddQualityIssues, isAutoRepairableDeliveryGateWarning } from "../../engine/mdd-quality-audit.util.js";
import { applyPreDeliveryGateFixes } from "./mdd-sanitize.js";

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

/**
 * Builds structured auditorGaps when the LLM auditor is skipped or as a merge baseline.
 */
export function synthesizeDeterministicAuditorGaps(
  draft: string,
  validation: ValidateMddStructureResult,
  score: number,
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

/** Truncate large MDD drafts for LLM auditor calls (avoid proxy timeout). */
export function truncateDraftForAuditorLlm(draft: string, maxChars = 28_000): string {
  const trimmed = draft.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const chunks = trimmed.split(/\n(?=##\s+\d+\.)/);
  if (chunks.length <= 1) {
    return `${trimmed.slice(0, maxChars)}\n\n[... MDD truncado para auditoría ...]`;
  }

  const perSection = Math.max(1200, Math.floor(maxChars / chunks.length));
  const parts = chunks.map((chunk) => {
    if (chunk.length <= perSection) return chunk;
    return `${chunk.slice(0, perSection)}\n\n[... sección truncada ...]`;
  });
  return parts.join("\n");
}
