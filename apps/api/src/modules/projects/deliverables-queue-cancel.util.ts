/** Resultado de cancelar un job BullMQ en estado `active`. */
export type DeliverablesActiveCancelOutcome = "cancelled" | "cancelling";

/**
 * Orquesta cancel cooperativa vs. force-fail para jobs activos.
 * - Huérfano (sin worker local ni lock Redis): fallo inmediato.
 * - Segunda solicitud mientras sigue activo: force-fail aunque el lock exista.
 */
export async function resolveDeliverablesActiveCancel(params: {
  alreadyCancelling: boolean;
  locallyRunning: boolean;
  lockHeld: boolean;
  forceFail: () => Promise<boolean>;
}): Promise<DeliverablesActiveCancelOutcome> {
  if (!params.locallyRunning && !params.lockHeld) {
    if (await params.forceFail()) return "cancelled";
  }
  if (params.alreadyCancelling) {
    if (await params.forceFail()) return "cancelled";
  }
  return "cancelling";
}
