/** Colas BullMQ / in-memory monitorizables desde Ajustes → Workers (solo admin). */
export type AdminWorkerJobQueue = "mdd" | "deliverables" | "legacy-deliverables";

export const ADMIN_WORKER_JOB_QUEUE_LABELS: Record<AdminWorkerJobQueue, string> = {
  mdd: "MDD (LangGraph)",
  deliverables: "Entregables",
  "legacy-deliverables": "Legacy entregables",
};

export type AdminQueueJobCounts = {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

export type AdminQueueRuntime = {
  queue: AdminWorkerJobQueue;
  queueName: string;
  storage: "bullmq" | "in-memory";
  localWorkerRunning: boolean;
  redisWorkers: string[];
  jobCounts: AdminQueueJobCounts;
};

export type AdminWorkerJobRow = {
  jobId: string;
  queue: AdminWorkerJobQueue;
  projectId: string;
  projectName: string | null;
  actionLabel: string;
  status: "queued" | "active" | "retrying" | "cancelling";
  inProgress: boolean;
  storage: "bullmq" | "in-memory";
  redisCancelKey: string | null;
  redisCancelKeyPresent: boolean;
  bullmqLockHeld: boolean | null;
  progressSummary: string | null;
  createdAt: number | null;
};

export type AdminWorkerJobsSnapshot = {
  runtimeRole: "all" | "http" | "worker";
  redisConfigured: boolean;
  queues: AdminQueueRuntime[];
  mddStreamProjectIds: string[];
  jobs: AdminWorkerJobRow[];
};

export type AdminStopWorkerJobBody = {
  queue: AdminWorkerJobQueue;
  projectId: string;
};

export type AdminStopWorkerJobResult = {
  jobId: string;
  queue: AdminWorkerJobQueue;
  cancelled: boolean;
  status: string;
  cleaned: {
    redisCancelKey: boolean;
    bullmqRemoved: boolean;
    inMemoryCleared: boolean;
  };
};
