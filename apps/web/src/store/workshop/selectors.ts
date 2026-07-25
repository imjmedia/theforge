/**
 * @fileoverview Selectores memoizados del store Workshop: detección de agentes ocupados, comparación de documentos.
 */
import { isWorkshopAgentsBusy } from "../../utils/workshopAgentsBusy";
import { workshopDocumentBodiesEqual } from "../../utils/workshop-document-content.util";
import type { WorkshopState } from "./workshop-state.types";

export const selectWorkshopAgentsBusy = (s: WorkshopState) => isWorkshopAgentsBusy(s);

/** MDD persistido en BD para la etapa activa (baseline del aviso «sin guardar»). */
export const selectPersistedMddBaseline = (s: WorkshopState): string => s.mddPersistedBaseline;

/** Aviso «sin guardar»: compara editor vs último baseline persistido (no workshopStages). */
export function isMddEditorDirty(s: WorkshopState): boolean {
  return (
    !s.mddPersisting &&
    !workshopDocumentBodiesEqual(s.mddContent, s.mddPersistedBaseline)
  );
}
