import type { WorkerOptions } from "bullmq";

/**
 * BullMQ defaults (lockDuration=30s) are too short for multi-minute LLM pipelines.
 * Without longer locks, workers log "could not renew lock" when CPU-heavy MDD stages
 * block the event loop or when nest --watch restarts overlap active jobs.
 */
export const LONG_JOB_LOCK_DURATION_MS = 900_000; // 15 min
export const LONG_JOB_LOCK_RENEW_TIME_MS = 120_000; // 2 min
export const LONG_JOB_STALLED_INTERVAL_MS = 180_000; // 3 min
export const LONG_JOB_MAX_STALLED_COUNT = 2;

export type LongRunningBullmqWorkerOptions = Pick<
  WorkerOptions,
  "lockDuration" | "lockRenewTime" | "stalledInterval" | "maxStalledCount" | "concurrency"
>;

export function longRunningBullmqWorkerOptions(
  overrides?: Pick<WorkerOptions, "concurrency" | "maxStalledCount">,
): LongRunningBullmqWorkerOptions {
  return {
    lockDuration: LONG_JOB_LOCK_DURATION_MS,
    lockRenewTime: LONG_JOB_LOCK_RENEW_TIME_MS,
    stalledInterval: LONG_JOB_STALLED_INTERVAL_MS,
    maxStalledCount: LONG_JOB_MAX_STALLED_COUNT,
    ...overrides,
  };
}
