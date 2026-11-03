/**
 * @fileoverview Contexto AsyncLocalStorage del lease MDD activo (fence del turno).
 *
 * Por qué existe: los tools del Manager (`patch_mdd_section`, `propose_mdd_amendment`) escriben el MDD
 * con `projects.update` → `persistMddFromPatch` sin recibir el fence del turno. Si esa escritura no lleva
 * fence, un turno zombi (lease ya perdido) puede pisar el documento (ADR 0004). Con este contexto, la
 * escritura toma el fence del lease en el que corre el turno y queda condicionada a la etapa, sin tocar
 * las firmas de los tools.
 *
 * Quién fija el contexto:
 * - `ThreadRunLockService.runExclusive` (job BullMQ y chat en cola): envuelve el `fn` del turno.
 * - `AiAnalysisService.runGuardedMddStream` (stream HTTP): envuelve cada paso del generador interno.
 * `ThreadRunLockService.acquire` directo NO fija contexto: quien lo use debe fijarlo si necesita fence.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Lease activo: fence del turno y clave del hilo (`mddThreadLockKey`). */
export type MddLeaseContext = {
  readonly fence: number;
  readonly key: string;
};

const mddLeaseStorage = new AsyncLocalStorage<MddLeaseContext>();

/** Ejecuta `fn` con `ctx` como lease MDD activo (síncrono o asíncrono; el contexto se propaga a sus continuaciones). */
export function runWithMddLeaseContext<T>(ctx: MddLeaseContext, fn: () => T): T {
  return mddLeaseStorage.run(ctx, fn);
}

/** Fence del lease activo en este contexto async, o `undefined` fuera de un turno con lease. */
export function getActiveMddLeaseFence(): number | undefined {
  return mddLeaseStorage.getStore()?.fence;
}
