import type { Queue } from "bullmq";
import type { AdminQueueRuntime, AdminWorkerJobQueue } from "@theforge/shared-types";

export async function describeBullmqAdminRuntime(params: {
  queueKey: AdminWorkerJobQueue;
  queueName: string;
  queue: Queue | null;
  localWorkerRunning: boolean;
  inMemoryActiveCount: () => number;
}): Promise<AdminQueueRuntime> {
  const { queueKey, queueName, queue, localWorkerRunning, inMemoryActiveCount } = params;

  if (!queue) {
    const active = inMemoryActiveCount();
    return {
      queue: queueKey,
      queueName,
      storage: "in-memory",
      localWorkerRunning: localWorkerRunning || active > 0,
      redisWorkers: [],
      jobCounts: {
        waiting: 0,
        active,
        delayed: 0,
        completed: 0,
        failed: 0,
      },
    };
  }

  const [workers, counts] = await Promise.all([
    queue.getWorkers().catch(() => [] as Array<{ name?: string; id?: string }>),
    queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"),
  ]);

  return {
    queue: queueKey,
    queueName,
    storage: "bullmq",
    localWorkerRunning,
    redisWorkers: workers.map((worker) => worker.name ?? worker.id ?? "worker"),
    jobCounts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    },
  };
}
