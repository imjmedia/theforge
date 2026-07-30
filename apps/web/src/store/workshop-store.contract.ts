/**
 * Acciones mínimas del contrato público de `useWorkshopStore` (Fase 0).
 * Si se renombra o elimina una acción durante el refactor, este test debe actualizarse a propósito.
 */
export const WORKSHOP_STORE_CONTRACT_ACTIONS = [
  "setProjectId",
  "setProject",
  "setSession",
  "setMddContent",
  "sendMessage",
  "fetchProject",
  "fetchWelcome",
  "clearChat",
  "persistMddContent",
  "generateDeliverablesCascade",
  "generateTasks",
  "fetchEstimation",
  "setActiveStageId",
  "patchWorkshopStage",
  "transitionWorkshopStage",
  "createWorkshopStage",
  "startPhase0Assisted",
  "stopPhase0Assisted",
] as const;

export type WorkshopStoreContractAction = (typeof WORKSHOP_STORE_CONTRACT_ACTIONS)[number];
