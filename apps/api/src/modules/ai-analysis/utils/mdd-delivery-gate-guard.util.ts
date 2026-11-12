/**
 * @fileoverview Pre-guardia del delivery gate MDD.
 */

import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { prepareMddForOutput } from "./mdd-prepare-output.js";
import { validateMddForDelivery } from "./mdd-delivery-gate.util.js";
import type { MddComplexityLevel } from "../state/mdd-state.schema.js";

export const MDD_DELIVERY_GATE_ERR = "ERR_MDD_DELIVERY_GATE";
export const DELIVERABLES_GATE_ERR = "ERR_DELIVERABLES_GATE";

export type DeliverablesGateConflictDetail = {
  allowed: boolean;
  rule: import("@theforge/shared-types").DeliverablesGateRule;
  reasons: string[];
  semaphoreStatus: import("@theforge/shared-types").SemaphoreStatus;
  hasSpec: boolean;
};

/**
 * Evalúa el gate tras el pipeline determinista de prepareMddForOutput (fixes seguros en mdd-sanitize).
 * @param domainContext BRD/DBGA opcionales para blockers de dominio (PLAN-CASCADE-90-ACCURACY).
 *   `mddComplexity` opcional: se reenvía al pipeline y al gate para usar el mismo perfil de umbrales
 *   que el pipeline (ver `resolveDeliveryGateProfile`); ausente → perfil indulgente.
 */
export async function evaluateMddDeliveryGatePrepared(
  mddRaw: string,
  domainContext?: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    mddComplexity?: MddComplexityLevel;
  },
): Promise<MddDeliveryGateResult> {
  const gateRef: { current?: MddDeliveryGateResult } = {};
  const prepared = await prepareMddForOutput(mddRaw, {
    deliveryGateRef: gateRef,
    brdMarkdown: domainContext?.brdMarkdown,
    dbgaMarkdown: domainContext?.dbgaMarkdown,
    mddComplexity: domainContext?.mddComplexity,
    formatForPersist: false,
  });
  return gateRef.current ?? validateMddForDelivery(prepared, domainContext);
}

export type MddDeliveryGateHttpErrorBody = {
  code: typeof MDD_DELIVERY_GATE_ERR | typeof DELIVERABLES_GATE_ERR;
  message: string;
  deliveryGate: MddDeliveryGateResult;
  gate?: DeliverablesGateConflictDetail;
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
  options?: {
    deliverablesGate?: DeliverablesGateConflictDetail;
    code?: typeof MDD_DELIVERY_GATE_ERR | typeof DELIVERABLES_GATE_ERR;
  },
): MddDeliveryGateHttpErrorBody {
  const blockers = gate.blockers.join("; ");
  const dg = options?.deliverablesGate;
  const code =
    options?.code ??
    (dg && !blockers && dg.reasons.length > 0 ? DELIVERABLES_GATE_ERR : MDD_DELIVERY_GATE_ERR);
  const message =
    code === DELIVERABLES_GATE_ERR && dg
      ? dg.reasons.join("; ") || fallbackMessage
      : blockers || fallbackMessage;
  return {
    code,
    message,
    deliveryGate: gate,
    ...(dg ? { gate: dg } : {}),
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
