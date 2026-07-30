import { PlanningDocumentFields, DocumentCompleteness, DOC_COMPLETE_MIN_LENGTH, DOC_PARTIAL_MIN_LENGTH } from "./estimation.types.js";
const DOC_WEIGHTS: Record<keyof PlanningDocumentFields, number> = {
  mddContent: 0,
  brdContent: 0.22,
  specContent: 0.14,
  architectureContent: 0.14,
  blueprintContent: 0.12,
  useCasesContent: 0.10,
  userStoriesContent: 0.05,
  apiContractsContent: 0.08,
  logicFlowsContent: 0.05,
  infraContent: 0.05,
  tasksContent: 0.05,
};

const THIN_USE_CASES_RE =
  /#\s*Casos de uso\s*\(\s*thin\s*[—–-]\s*ProcessInventory\s*\)|thin\s*[—–-]\s*ProcessInventory/i;
const THIN_UC_EMPTY_RE = /_Sin procesos en inventario/i;
const THIN_UC_PROCESS_HEADING_RE = /^##\s+CU-[^\n]+/m;
const THIN_UC_SUBSTANCE_RE = /-\s*\*\*(?:Pasos|Trigger):\*\*|^\s+\d+\.\s+/m;

/** UC thin ProcessInventory (HIGH cascade) — entregable válido sin prosa literaria. */
export function isThinProcessInventoryUseCases(content: string): boolean {
  return THIN_USE_CASES_RE.test(content);
}

/** Al menos un CU de inventario con trigger o pasos (no stub vacío). */
export function hasSubstantiveThinUseCaseProcesses(content: string): boolean {
  if (THIN_UC_EMPTY_RE.test(content)) return false;
  if (!THIN_UC_PROCESS_HEADING_RE.test(content)) return false;
  return THIN_UC_SUBSTANCE_RE.test(content);
}

/**
 * Calcula la completitud de cada documento del proyecto.
 * 100 = completo (≥300 chars), 50 = parcial (≥80 chars), 10 = mínimo (algún contenido), 0 = vacío.
 * Use Cases thin stub se capan a 50; thin con ProcessInventory sustantivo cuenta como 100.
 * El `overall` es el promedio ponderado por `DOC_WEIGHTS`.
 */
export function computeDocumentCompleteness(docs: PlanningDocumentFields): DocumentCompleteness {
  let weightedSum = 0;
  const result: Record<string, number> = { overall: 0 };

  for (const [key, weight] of Object.entries(DOC_WEIGHTS)) {
    const content = (docs as Record<string, unknown>)[key] ?? "";
    const trimmed = String(content).trim();
    let score: number;
    if (trimmed.length >= DOC_COMPLETE_MIN_LENGTH) {
      score = 100;
    } else if (trimmed.length >= DOC_PARTIAL_MIN_LENGTH) {
      score = 50;
    } else if (trimmed.length > 0) {
      score = 10;
    } else {
      score = 0;
    }
    if (key === "useCasesContent" && trimmed.length > 0 && isThinProcessInventoryUseCases(trimmed)) {
      if (hasSubstantiveThinUseCaseProcesses(trimmed)) {
        score = 100;
      } else {
        score = Math.min(score, 50);
      }
    }
    result[key] = score;
    weightedSum += (score / 100) * weight;
  }

  result.overall = Math.round(weightedSum * 100);
  return result as DocumentCompleteness;
}
