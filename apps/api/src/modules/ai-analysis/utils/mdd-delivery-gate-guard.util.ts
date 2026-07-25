/**
 * @fileoverview Pre-guardia del delivery gate MDD.
 */

import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { prepareMddForOutput } from "./mdd-prepare-output.js";
import { validateMddForDelivery } from "./mdd-delivery-gate.util.js";

export const MDD_DELIVERY_GATE_ERR = "ERR_MDD_DELIVERY_GATE";

/**
 * Evalúa el gate tras el pipeline determinista de prepareMddForOutput (fixes seguros en mdd-sanitize).
 * @param domainContext BRD/DBGA opcionales para blockers de dominio (PLAN-CASCADE-90-ACCURACY).
 */
export async function evaluateMddDeliveryGatePrepared(
  mddRaw: string,
  domainContext?: { brdMarkdown?: string | null; dbgaMarkdown?: string | null },
): Promise<MddDeliveryGateResult> {
  const gateRef: { current?: MddDeliveryGateResult } = {};
  const prepared = await prepareMddForOutput(mddRaw, {
    deliveryGateRef: gateRef,
    brdMarkdown: domainContext?.brdMarkdown,
    dbgaMarkdown: domainContext?.dbgaMarkdown,
    formatForPersist: false,
  });
  return gateRef.current ?? validateMddForDelivery(prepared, domainContext);
}

export type MddDeliveryGateHttpErrorBody = {
  code: typeof MDD_DELIVERY_GATE_ERR;
  message: string;
  deliveryGate: MddDeliveryGateResult;
};

export type MddContentPersistMeta = {
  attempted: true;
  saved: false;
  field: "mddContent";
  stageId: string;
};

export type MddPatchPipelineErrorBody = {
  code: string;
  message: string;
  deliveryGate?: MddDeliveryGateResult;
  persist: MddContentPersistMeta;
};

/** Cuerpo de error HTTP 409 para bloqueo de entregables. */
export function buildMddDeliveryGateConflictBody(
  gate: MddDeliveryGateResult,
  fallbackMessage = "El MDD no aprueba el gate de entrega (≥90/100).",
): MddDeliveryGateHttpErrorBody {
  return {
    code: MDD_DELIVERY_GATE_ERR,
    message: gate.blockers.join("; ") || fallbackMessage,
    deliveryGate: gate,
  };
}

/** Cuerpo de error HTTP 400 para PATCH mddContent (pipeline / gate). */
export function buildMddPatchPipelineErrorBody(
  code: string,
  message: string,
  stageId: string,
  deliveryGate?: MddDeliveryGateResult,
): MddPatchPipelineErrorBody {
  return {
    code,
    message,
    ...(deliveryGate ? { deliveryGate } : {}),
    persist: { attempted: true, saved: false, field: "mddContent", stageId },
  };
}
