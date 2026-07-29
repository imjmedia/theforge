import type { Job, Queue } from "bullmq";

/** Mensaje estándar cuando un job quedó huérfano tras reinicio o caída del worker. */
export const BULLMQ_WORKER_RESTARTED_REASON =
  "Proceso API reiniciado; vuelve a generar el MDD";

/** Worker recibió SIGTERM (redeploy); el job activo debe reencolarse manualmente. */
export const BULLMQ_WORKER_SHUTDOWN_REASON =
  "Worker detenido (redeploy o reinicio); vuelve a generar el MDD";

/** Job activo sustituido por uno nuevo del mismo proyecto (cancel + relanzar). */
export const BULLMQ_JOB_PREEMPTED_REASON = "Reemplazado por un job MDD más reciente";

/** Mensaje estándar para jobs huérfanos de la cola de entregables (cascada, spec, etc.). */
export const BULLMQ_DELIVERABLES_ORPHAN_REASON =
  "Cola de entregables interrumpida (reinicio o caída del worker). Recarga el proyecto; si los documentos ya están, no regeneres la cascada.";

/** BullMQ LockManager cuando el worker perdió el lock (redeploy, cancel, otro worker). */
export function isBullMqLockRenewalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /could not renew lock/i.test(msg);
}

type RecoverLogger = {
  log: (message: string) => void;
  warn: (message: string) => void;
};

/**
 * Fuerza fallo de un job BullMQ en estado `active` cuyo worker murió (lock Redis huérfano).
 * Elimina el lock antes de `moveToFailed` para no esperar `lockDuration` (p. ej. 15 min MDD).
 */
export async function forceFailBullMqActiveJob(
  queue: Queue,
  job: Job,
  reason: string,
): Promise<boolean> {
  const state = await job.getState();
  if (state !== "active") return false;

  const client = await queue.client;
  const lockKey = `${queue.toKey(String(job.id))}:lock`;
  await client.del(lockKey);

  try {
    await job.discard();
    await job.moveToFailed(new Error(reason), "0", false);
    return true;
  } catch {
    try {
      await client.del(lockKey);
      await job.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Tras reinicio del API/worker: jobs `active` en Redis no tienen worker vivo.
 * Los marcamos failed (no reintentar pipeline MDD a medias) y quitamos waiting/delayed obsoletos.
 */
export async function recoverBullMqJobsAfterWorkerRestart(
  queue: Queue,
  options: {
    reason?: string;
    removeQueued?: boolean;
    logger?: RecoverLogger;
  } = {},
): Promise<{ failedActive: number; removedQueued: number }> {
  const reason = options.reason ?? BULLMQ_WORKER_RESTARTED_REASON;
  const removeQueued = options.removeQueued ?? true;
  const logger = options.logger;
  let failedActive = 0;
  let removedQueued = 0;

  const activeJobs = await queue.getJobs(["active"], 0, 500);
  for (const job of activeJobs) {
    const ok = await forceFailBullMqActiveJob(queue, job, reason);
    if (ok) {
      failedActive += 1;
      logger?.log(`BullMQ job ${job.id} fallido (huérfano activo): ${reason}`);
    } else {
      logger?.warn(`BullMQ job ${job.id} no pudo limpiarse tras reinicio`);
    }
  }

  if (removeQueued) {
    for (const state of ["waiting", "delayed", "waiting-children"] as const) {
      const jobs = await queue.getJobs([state], 0, 500);
      for (const job of jobs) {
        try {
          await job.remove();
          removedQueued += 1;
          logger?.log(`BullMQ job ${job.id} eliminado (${state}, cola obsoleta tras reinicio)`);
        } catch {
          logger?.warn(`BullMQ job ${job.id} no pudo eliminarse (${state})`);
        }
      }
    }
  }

  return { failedActive, removedQueued };
}

/** True si Redis aún tiene el lock de un worker BullMQ sobre el job. */
export async function isBullMqJobLockHeld(queue: Queue, jobId: string): Promise<boolean> {
  const client = await queue.client;
  const lockKey = `${queue.toKey(String(jobId))}:lock`;
  const lockValue = await client.get(lockKey);
  return lockValue != null;
}

export type ReconcileOrphanBullMqActiveJobResult = "running" | "reconciled" | "skipped";

/**
 * Job `active` sin lock ni worker local → huérfano (p. ej. worker murió tras completar la cascada).
 * Lo marca failed para liberar `generation-status.busy` sin reintentar la pipeline entera.
 */
export async function reconcileOrphanBullMqActiveJob(
  queue: Queue,
  job: Job,
  options: {
    reason: string;
    isLocallyRunning?: (jobId: string) => boolean;
  },
): Promise<ReconcileOrphanBullMqActiveJobResult> {
  const state = await job.getState();
  if (state !== "active") return "skipped";

  const jobId = String(job.id);
  if (options.isLocallyRunning?.(jobId)) return "running";
  if (await isBullMqJobLockHeld(queue, jobId)) return "running";

  const ok = await forceFailBullMqActiveJob(queue, job, options.reason);
  return ok ? "reconciled" : "skipped";
}
