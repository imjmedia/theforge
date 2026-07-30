import type { MddUpstreamSyncStatus, ProjectGenerationStatus } from "@theforge/shared-types";

export function mergeGenerationStatusWithMddUpstreamSync(
  status: ProjectGenerationStatus | null | undefined,
  sync: MddUpstreamSyncStatus | null | undefined,
): ProjectGenerationStatus | null {
  if (!sync) return status ?? null;
  if (!status) {
    return {
      busy: false,
      mddStreamActive: false,
      mddJobs: [],
      activeJob: null,
      queuedJobs: [],
      gates: {},
      mddUpstreamSync: sync,
    };
  }
  return { ...status, mddUpstreamSync: sync };
}

/** Quita un job cancelado del estado visible para liberar el banner de inmediato. */
export function clearCancelledJobFromGenerationStatus(
  status: ProjectGenerationStatus | null | undefined,
  jobId: string,
): ProjectGenerationStatus | null {
  if (!status) return null;
  const jid = jobId.trim();
  if (!jid) return status;
  const activeJob = status.activeJob?.jobId === jid ? null : status.activeJob;
  const queuedJobs = status.queuedJobs.filter((j) => j.jobId !== jid);
  const mddJobs = (status.mddJobs ?? []).filter((j) => j.jobId !== jid);
  const mddStillBusy = mddJobs.some((j) => j.status === "active" || j.status === "queued");
  const mddStreamActive = mddStillBusy ? status.mddStreamActive : false;
  const busy = Boolean(
    mddStreamActive || activeJob || queuedJobs.length > 0 || mddStillBusy,
  );
  return {
    ...status,
    busy,
    mddStreamActive,
    activeJob,
    queuedJobs,
    mddJobs,
  };
}

/** Si el job de entregables ya terminó pero generation-status sigue busy, libera el banner. */
export function reconcileFinishedDeliverablesJobInGenerationStatus(
  status: ProjectGenerationStatus,
  finishedJobId: string,
): ProjectGenerationStatus {
  return clearCancelledJobFromGenerationStatus(status, finishedJobId) ?? status;
}

export const generationStatusPoll = {
  timer: null as ReturnType<typeof setInterval> | null,
  projectId: null as string | null,
};

export function stopGenerationStatusPolling(): void {
  if (generationStatusPoll.timer) {
    clearInterval(generationStatusPoll.timer);
    generationStatusPoll.timer = null;
  }
  generationStatusPoll.projectId = null;
}
