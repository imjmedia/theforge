import type { Job, Queue } from "bullmq";

/** Mensaje estándar cuando un job quedó huérfano tras reinicio o caída del worker. */
export const BULLMQ_WORKER_RESTARTED_REASON =
  "Proceso API reiniciado; vuelve a generar el MDD";

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
