import type { StageTransitionAction } from "@theforge/shared-types";

/** Etiqueta corta para botones del modal de transición de etapa. */
export function stageTransitionActionLabel(action: StageTransitionAction): string {
  switch (action) {
    case "activate":
      return "Activar etapa";
    case "complete":
      return "Marcar como completada";
    case "archive":
      return "Archivar etapa";
    case "reopen":
      return "Reabrir como borrador";
  }
}

/** Texto de ayuda bajo cada acción en el modal. */
export function stageTransitionActionDescription(action: StageTransitionAction): string {
  switch (action) {
    case "activate":
      return "Esta etapa pasa a ACTIVE; las demás activas quedan reemplazadas. Solo el owner del proyecto.";
    case "complete":
      return "Marca la etapa como terminada y congela entregables (snapshot) si aún no existía.";
    case "archive":
      return "Congela entregables en snapshot. La etapa sigue visible en el selector como Archivada.";
    case "reopen":
      return "Vuelve la etapa a borrador (DRAFT) para editar de nuevo el ciclo de vida.";
  }
}

/** Acciones que muestran campo de motivo opcional antes de confirmar. */
export function stageTransitionActionAcceptsReason(action: StageTransitionAction): boolean {
  return action === "archive" || action === "complete";
}
