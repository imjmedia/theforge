import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import type { ValidateMddStructureResult } from "../utils/mdd-sanitize.js";
import {
  MDD_AUDIT_PASS_THRESHOLD,
  MDD_MAX_AUDIT_QUESTIONS,
  MDD_MIN_AUDIT_CHARS,
  type MddAuditQuestionItem,
} from "./mdd-manual-audit.types.js";

export function hasMddAuditDocument(mddContent: string | null | undefined): boolean {
  return (mddContent?.trim().length ?? 0) >= MDD_MIN_AUDIT_CHARS;
}

export function isMddAuditPass(
  score: number | undefined,
  validation: ValidateMddStructureResult,
  gaps: AuditorGapsState | null | undefined,
): boolean {
  if (validation.missingSections.length > 0) return false;
  // Sin nota (Auditor no disponible) no aprueba: tampoco se trata como 0.
  if (score === undefined || score < MDD_AUDIT_PASS_THRESHOLD) return false;
  if ((gaps?.critical_gaps?.length ?? 0) > 0) return false;
  if ((gaps?.syntax_errors?.length ?? 0) > 0) return false;
  return true;
}

export function buildMddQuestionPlan(
  validation: ValidateMddStructureResult,
  gaps: AuditorGapsState | null | undefined,
  max = MDD_MAX_AUDIT_QUESTIONS,
): MddAuditQuestionItem[] {
  const items: MddAuditQuestionItem[] = [];
  const seen = new Set<string>();

  const push = (item: MddAuditQuestionItem) => {
    const key = `${item.issue.slice(0, 80)}::${item.sugerenciaPregunta.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const sec of validation.missingSections) {
    push({
      sections: [sec],
      issue: `Falta la sección obligatoria: ${sec}`,
      sugerenciaPregunta: `El MDD no incluye «${sec}». ¿Qué debe contener esa sección en tu proyecto?`,
    });
  }

  if (!validation.section3HasPayloads) {
    push({
      sections: ["3"],
      issue: "La sección 3 no incluye contratos con payloads JSON",
      sugerenciaPregunta:
        "¿Qué endpoints o contratos de API deben documentarse en §3 con request/response en bloques ```json?",
    });
  }

  for (const g of gaps?.critical_gaps ?? []) {
    push({
      sections: g.sections ?? [],
      issue: g.issue,
      sugerenciaPregunta:
        g.fix?.trim() ||
        `Respecto a «${g.issue}»: ¿qué decisión o detalle falta para cerrar este gap?`,
    });
  }

  for (const err of gaps?.syntax_errors ?? []) {
    push({
      sections: [],
      issue: err,
      sugerenciaPregunta: `Hay un error de estructura/sintaxis: ${err}. ¿Cómo debe resolverse?`,
    });
  }

  return items.slice(0, max);
}
