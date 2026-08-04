import { CASCADE_POST_PASS_STEP_LABEL } from "@theforge/shared-types";
import { deliverableStepLabelsForComplexity } from "@theforge/shared-types";
import { apiFetch, API_BASE } from "../../../utils/apiClient";
import type { AgentProgressItem } from "../../../utils/agentProgress";
import {
  applyDeliverableCascadeProgressUpdate,
  ensurePostPassCascadeRow,
  markAllAgentProgressTerminated,
  readDeliverableCascadeProgressStep,
} from "../../../utils/deliverableCascadeProgress";
import {
  isDeliverablesCascadeLoadingReason,
  loadingReasonForDeliverablesJobType,
} from "../../../utils/deliverablesCascadeUi";
import type { WorkshopState } from "../workshop-state.types";

type WorkshopGetSet = {
  get: () => WorkshopState;
  set: (
    partial:
      | Partial<WorkshopState>
      | ((state: WorkshopState) => Partial<WorkshopState>),
  ) => void;
};

export const deliverablesJobPoll = {
  projectId: null as string | null,
  jobId: null as string | null,
};

export function isDeliverablesJobPollRunning(projectId: string, jobId: string): boolean {
  return deliverablesJobPoll.projectId === projectId.trim() && deliverablesJobPoll.jobId === jobId.trim();
}

export function createInitialCascadeAgentProgress(stepLabels: readonly string[]): AgentProgressItem[] {
  return stepLabels.map((label) => ({
    agent: "Entregables",
    message: `⚪ ${label} — Generando…`,
    step: label,
    status: "generando" as const,
  }));
}

export function createRepairSddAgentProgress(): AgentProgressItem[] {
  return [
    {
      agent: "Brechas SDD",
      message: "Corrigiendo brechas auto/LLM…",
      step: "repair-sdd-gaps",
      status: "generando" as const,
    },
  ];
}

async function applyDeliverablesJobProgressTick(
  get: () => WorkshopState,
  set: WorkshopGetSet["set"],
  progress: unknown,
  allStepLabels: readonly string[],
  completedSteps: Set<string>,
  lastReportedStep: { current: string | null },
): Promise<void> {
  const progressUpdate = applyDeliverableCascadeProgressUpdate(
    get().agentProgress,
    completedSteps,
    progress,
  );
  if (progressUpdate.matched) {
    set({
      agentProgress: progressUpdate.agentProgress,
      cascadeCompleted: progressUpdate.cascadeCompleted,
    });
  } else {
    const apiStep = readDeliverableCascadeProgressStep(progress);
    if (apiStep && apiStep !== "done" && apiStep !== lastReportedStep.current) {
      lastReportedStep.current = apiStep;
      set({ agentProgress: progressUpdate.agentProgress });
    }
  }
  const waveStepsDone =
    get().cascadeCompleted >= allStepLabels.length &&
    get().agentProgress.every((item) => item.status === "terminado");
  if (waveStepsDone && !get().agentProgress.some((item) => item.step === CASCADE_POST_PASS_STEP_LABEL)) {
    set({ agentProgress: ensurePostPassCascadeRow(get().agentProgress) });
  }
}

export async function pollDeliverablesJobInBackground(
  projectId: string,
  jobId: string,
  get: () => WorkshopState,
  set: WorkshopGetSet["set"],
): Promise<void> {
  const pid = projectId.trim();
  const jid = jobId.trim();
  if (!pid || !jid) return;
  if (isDeliverablesJobPollRunning(pid, jid)) return;

  deliverablesJobPoll.projectId = pid;
  deliverablesJobPoll.jobId = jid;

  const loadingReason = get().loadingReason;
  const isRepair = loadingReason === "repair-sdd-gaps";
  const allStepLabels = deliverableStepLabelsForComplexity(get().project?.complexity ?? "HIGH");

  try {
    const deadline = Date.now() + 45 * 60 * 1000;
    const completedSteps = new Set<string>();
    const lastReportedStep = { current: null as string | null };

    while (Date.now() < deadline) {
      if (deliverablesJobPoll.projectId !== pid || deliverablesJobPoll.jobId !== jid) return;

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const st = await apiFetch(`${API_BASE}/projects/${pid}/deliverables-jobs/${jid}`);
      if (!st.ok) {
        const err = await st.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al consultar cola de entregables");
      }
      const j = (await st.json()) as {
        status: string;
        progress?: { step?: string; index?: number; total?: number; completedSteps?: string[] };
        error?: string;
      };

      if (j.status === "failed") {
        if (j.error?.includes("Cancelado por el usuario")) return;
        throw new Error(j.error ?? "Cascada de entregables fallida");
      }
      if (j.status === "completed") break;

      if (!isRepair && j.progress != null) {
        await applyDeliverablesJobProgressTick(
          get,
          set,
          j.progress,
          allStepLabels,
          completedSteps,
          lastReportedStep,
        );
      }
    }

    if (!isRepair) {
      set((s) => ({
        agentProgress: markAllAgentProgressTerminated(s.agentProgress),
        cascadeCompleted: Math.max(s.cascadeCompleted, allStepLabels.length),
      }));
    }
    await get().fetchProject(pid);
    await get().fetchEstimation(pid).catch(() => {});
    await get().fetchGenerationStatus(pid);
    get().bumpDocumentationGapsRefresh();
    set({ agentProgress: [] });
  } catch (e) {
    set({
      error: e instanceof Error ? e.message : "Error al consultar cola de entregables",
      agentProgress: [],
    });
  } finally {
    if (deliverablesJobPoll.projectId === pid && deliverablesJobPoll.jobId === jid) {
      deliverablesJobPoll.projectId = null;
      deliverablesJobPoll.jobId = null;
    }
    set({ loading: false, loadingReason: null, activeDeliverablesJobId: null });
  }
}

/** Reabre checklist + poll cuando generation-status detecta cascada/reparación ya en curso. */
export function attachToActiveDeliverablesJob(
  projectId: string,
  jobId: string,
  jobType: string,
  get: () => WorkshopState,
  set: WorkshopGetSet["set"],
): void {
  const pid = projectId.trim();
  const jid = jobId.trim();
  if (!pid || !jid) return;

  const state = get();
  if (
    state.activeDeliverablesJobId === jid &&
    state.loading &&
    isDeliverablesCascadeLoadingReason(state.loadingReason)
  ) {
    return;
  }
  if (isDeliverablesJobPollRunning(pid, jid)) return;

  const loadingReason = loadingReasonForDeliverablesJobType(
    jobType as "cascade" | "cascade-delta" | "repair-sdd-gaps",
  );
  const stepLabels = deliverableStepLabelsForComplexity(state.project?.complexity ?? "HIGH");
  const agentProgress =
    loadingReason === "repair-sdd-gaps"
      ? createRepairSddAgentProgress()
      : createInitialCascadeAgentProgress(stepLabels);

  set({
    loading: true,
    loadingReason,
    error: null,
    activeDeliverablesJobId: jid,
    agentProgress,
    cascadeTotal: stepLabels.length,
    cascadeCompleted: 0,
  });

  void (async () => {
    try {
      const st = await apiFetch(`${API_BASE}/projects/${pid}/deliverables-jobs/${jid}`);
      if (!st.ok) return;
      const j = (await st.json()) as {
        status: string;
        progress?: { step?: string; completedSteps?: string[] };
      };
      if (j.status === "completed" || j.status === "failed") {
        await get().fetchGenerationStatus(pid);
        return;
      }
      if (loadingReason !== "repair-sdd-gaps" && j.progress != null) {
        const completedSteps = new Set<string>();
        const progressUpdate = applyDeliverableCascadeProgressUpdate(
          get().agentProgress,
          completedSteps,
          j.progress,
        );
        set({
          agentProgress: progressUpdate.agentProgress,
          cascadeCompleted: progressUpdate.cascadeCompleted,
        });
      }
    } catch {
      // ignore hydration errors; poll loop will retry
    }
    void pollDeliverablesJobInBackground(pid, jid, get, set);
  })();
}
