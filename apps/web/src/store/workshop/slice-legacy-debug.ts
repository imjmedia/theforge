import type { StateCreator } from "zustand";
import type { PlanValidationPersisted, ProjectGenerationStatus } from "@theforge/shared-types";
import {
  deliverableStepLabelsForComplexity,
  deliverableStepLabelsForKinds,
  planLegacyDeliverablesToGenerate,
  resolveLegacyCascadeSkipKindsFromStage,
} from "@theforge/shared-types";
import { apiFetch, API_BASE } from "../../utils/apiClient";
import { enqueueAndPollLegacyMdd } from "../../utils/pollMddJob";
import { parseErrorMessageFromResponse } from "../../utils/httpError";
import {
  applyDeliverableCascadeProgressUpdate,
  markAllAgentProgressTerminated,
  readDeliverableCascadeProgressStep,
} from "../../utils/deliverableCascadeProgress";
import { mddJobProgressEventFields, mergeAgentProgressFromMddEvent } from "../../utils/agentProgress";
import { primaryMddJob } from "../../utils/projectGenerationGate";
import { shouldApplyWorkshopUpdate } from "./helpers/workshop-scope";
import { friendlyFetchError } from "./helpers/store-errors";
import {
  clearCancelledJobFromGenerationStatus,
  generationStatusPoll,
  reconcileFinishedDeliverablesJobInGenerationStatus,
  stopGenerationStatusPolling,
} from "./helpers/generation-status";
import { applyMddFromFetchedProject } from "./helpers/mdd-editor";
import { legacyDebugFromStages } from "./helpers/stage-focus";
import { patchAgentProgressFromMddEvent } from "./helpers/agent-progress-patch";
import { attachToActiveDeliverablesJob } from "./helpers/deliverables-job-sync";
import { activeDeliverablesGenerationJob } from "../../utils/deliverablesCascadeUi";
import type { LegacyDeliverablesDebugReport, LegacyMcpDebugEntry } from "./types";
import type { WorkshopState } from "./workshop-state.types";

type LegacyDebugSliceActions = Pick<
  WorkshopState,
  | "fetchGenerationStatus"
  | "cancelMddJob"
  | "cancelDeliverablesJob"
  | "fetchPlanValidation"
  | "validateChangePlan"
  | "refreshWorkshopOnTabVisible"
  | "legacyGenerateCodebaseDoc"
  | "legacyUpdateCodebaseDoc"
  | "legacyStart"
  | "legacyAnswer"
  | "legacyGenerateMdd"
  | "legacyGenerateAsIsManual"
  | "legacySuggestBrdFromCodebaseDoc"
  | "legacyGenerateFromCodebaseDoc"
  | "suggestBrdFromDbga"
  | "legacyGenerateDeliverables"
>;

export const createLegacyDebugSlice: StateCreator<
  WorkshopState,
  [],
  [],
  LegacyDebugSliceActions
> = (set, get) => ({
  fetchGenerationStatus: async (projectId, stageId, options) => {
    const requestedId = projectId.trim();
    if (!requestedId) return null;
    const sid = stageId?.trim() || get().activeStageId?.trim();
    const params = new URLSearchParams();
    if (sid) params.set("stageId", sid);
    if (options?.light) params.set("light", "1");
    const qs = params.toString() ? `?${params.toString()}` : "";
    try {
      const r = await apiFetch(`${API_BASE}/projects/${requestedId}/generation-status${qs}`);
      if (!r.ok) return null;
      const raw = (await r.json()) as ProjectGenerationStatus;
      let status: ProjectGenerationStatus = { ...raw, mddJobs: raw.mddJobs ?? [] };
      const activeJobId = status.activeJob?.jobId?.trim();
      if (status.busy && activeJobId) {
        const jobRes = await apiFetch(`${API_BASE}/projects/${requestedId}/deliverables-jobs/${activeJobId}`);
        if (jobRes.ok) {
          const job = (await jobRes.json()) as { status?: string };
          if (job.status === "completed" || job.status === "failed" || job.status === "unknown") {
            status = reconcileFinishedDeliverablesJobInGenerationStatus(status, activeJobId);
          }
        }
      }
      if (!shouldApplyWorkshopUpdate(get, requestedId)) return status;
      const wasBusy = get().generationStatus?.busy === true;
      const releaseDeliverablesBusyUi =
        !status.busy &&
        (get().loadingReason === "deliverables-cascade" ||
          get().loadingReason === "legacy-deliverables" ||
          Boolean(get().activeDeliverablesJobId));
      set((s) => ({
        generationStatus: {
          ...status,
          gates:
            Object.keys(status.gates ?? {}).length > 0
              ? status.gates
              : (s.generationStatus?.gates ?? {}),
          mddUpstreamSync: status.mddUpstreamSync ?? s.generationStatus?.mddUpstreamSync ?? null,
          sddGraph: status.busy
            ? (status.sddGraph ?? s.generationStatus?.sddGraph ?? null)
            : (status.sddGraph ?? null),
        },
        ...(releaseDeliverablesBusyUi
          ? { loading: false, loadingReason: null, activeDeliverablesJobId: null, agentProgress: [] }
          : {}),
      }));
      const mddJob = primaryMddJob(status);
      if (
        mddJob &&
        (status.mddStreamActive ||
          get().loadingReason === "mdd" ||
          get().loadingReason === "mdd-section") &&
        ((mddJob.progressSteps?.length ?? 0) > 0 || mddJob.progressActive)
      ) {
        set((s) => ({
          agentProgress: mergeAgentProgressFromMddEvent(s.agentProgress, {
            steps: mddJob.progressSteps ?? [],
            active: mddJob.progressActive ?? null,
            phaseGroup: mddJob.progressPhaseGroup ?? null,
          }),
        }));
      }
      const deliverablesJob = activeDeliverablesGenerationJob(status);
      if (deliverablesJob?.jobId) {
        attachToActiveDeliverablesJob(
          requestedId,
          deliverablesJob.jobId,
          deliverablesJob.type,
          get,
          set,
        );
      }
      if (status.busy) {
        if (generationStatusPoll.projectId !== requestedId) {
          stopGenerationStatusPolling();
          generationStatusPoll.projectId = requestedId;
          generationStatusPoll.timer = setInterval(() => {
            void get().fetchGenerationStatus(requestedId, undefined, { light: true });
          }, 5000);
        }
      } else {
        stopGenerationStatusPolling();
        if (wasBusy) {
          void get()
            .fetchProject(requestedId, { preferServerMdd: true })
            .then((project) => {
              applyMddFromFetchedProject(get, set, project ?? get().project);
            });
        }
      }
      return status;
    } catch {
      return null;
    }
  },

  cancelMddJob: async (projectId, jobId) => {
    const pid = projectId.trim();
    const jid = jobId.trim();
    if (!pid || !jid) return false;

    try {
      const r = await apiFetch(`${API_BASE}/projects/${pid}/mdd-jobs/${jid}`, { method: "DELETE" });
      if (!r.ok) {
        set({
          error: await parseErrorMessageFromResponse(r, "No se pudo cancelar el job MDD"),
        });
        return false;
      }
      set({
        loading: false,
        loadingReason: null,
        agentProgress: [],
        generationStatus: clearCancelledJobFromGenerationStatus(get().generationStatus, jid),
        notice:
          "Generación MDD cancelada. Si un paso LLM aún cerraba, el proyecto queda libre en cuanto el worker aborta (normalmente unos segundos).",
      });
      void get().fetchGenerationStatus(pid);
      const pollUntilFree = async (attempt = 0) => {
        if (attempt >= 12) return;
        await new Promise((r) => setTimeout(r, 500));
        const status = await get().fetchGenerationStatus(pid, undefined, { light: true });
        if (!status?.busy && !status?.mddStreamActive) return;
        await pollUntilFree(attempt + 1);
      };
      void pollUntilFree();
      return true;
    } catch (e) {
      set({ error: friendlyFetchError(e) });
      return false;
    }
  },

  cancelDeliverablesJob: async (projectId, jobId) => {
    const pid = projectId.trim();
    const jid = jobId.trim();
    if (!pid || !jid) return false;

    try {
      const r = await apiFetch(`${API_BASE}/projects/${pid}/deliverables-jobs/${jid}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        set({
          error: await parseErrorMessageFromResponse(r, "No se pudo cancelar el job"),
        });
        return false;
      }
      set({
        loading: false,
        loadingReason: null,
        activeDeliverablesJobId: null,
        agentProgress: [],
        generationStatus: clearCancelledJobFromGenerationStatus(get().generationStatus, jid),
        notice:
          "Generación cancelada. Si el worker aún cerraba un paso LLM, puede tardar unos segundos en liberar el proyecto para una nueva generación.",
      });
      await get().fetchGenerationStatus(pid);
      return true;
    } catch (e) {
      set({ error: friendlyFetchError(e) });
      return false;
    }
  },

  fetchPlanValidation: async (projectId, stageId) => {
    const requestedId = projectId.trim();
    if (!requestedId) return null;
    try {
      const q = stageId?.trim() ? `?stageId=${encodeURIComponent(stageId.trim())}` : "";
      const r = await apiFetch(`${API_BASE}/projects/${requestedId}/plan-validation${q}`);
      if (!r.ok) return null;
      const data = (await r.json()) as { validation?: PlanValidationPersisted | null };
      const validation = data.validation ?? null;
      if (shouldApplyWorkshopUpdate(get, requestedId)) {
        set({ planValidation: validation });
      }
      return validation;
    } catch {
      return null;
    }
  },

  validateChangePlan: async (projectId, stageId) => {
    const requestedId = projectId.trim();
    if (!requestedId) return null;
    set({ loading: true, error: null });
    try {
      const q = stageId?.trim() ? `?stageId=${encodeURIComponent(stageId.trim())}` : "";
      const r = await apiFetch(`${API_BASE}/projects/${requestedId}/validate-change-plan${q}`, {
        method: "POST",
      });
      if (!r.ok) {
        throw new Error(await parseErrorMessageFromResponse(r, "Error al validar plan"));
      }
      const data = (await r.json()) as {
        skipped?: boolean;
        persisted?: PlanValidationPersisted;
      };
      const validation = data.persisted ?? null;
      if (validation && shouldApplyWorkshopUpdate(get, requestedId)) {
        set({ planValidation: validation });
      }
      return validation;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al validar plan" });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  refreshWorkshopOnTabVisible: async (projectId) => {
    const requestedId = projectId.trim();
    if (!requestedId) return;
    await get().fetchGenerationStatus(requestedId);
    const state = get();
    if (state.agentProgress.length > 0 || !state.loading) return;
    const reason = state.loadingReason;
    if (reason !== "deliverables-cascade" && reason !== "legacy-deliverables") return;

    const complexity = state.project?.complexity ?? "HIGH";
    const stepLabels =
      reason === "legacy-deliverables"
        ? deliverableStepLabelsForKinds(
            planLegacyDeliverablesToGenerate({
              complexity,
              hasMddContent: !!state.project?.mddContent?.trim(),
            }),
          )
        : deliverableStepLabelsForComplexity(complexity);
    if (stepLabels.length === 0) return;

    const completed = Math.min(state.cascadeCompleted, stepLabels.length);
    set({
      agentProgress: stepLabels.map((label, index) => ({
        agent: "Entregables",
        message:
          index < completed ? `✅ ${label} — Terminado` : `⚪ ${label} — Generando…`,
        step: label,
        status: index < completed ? ("terminado" as const) : ("generando" as const),
      })),
      cascadeTotal: stepLabels.length,
    });
  },

  legacyGenerateCodebaseDoc: async (projectId, opts) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "legacy-codebase-doc", error: null });
    try {
      const body: Record<string, unknown> = {};
      if (opts?.responseMode !== undefined) body.responseMode = opts.responseMode;
      if (opts?.stageId?.trim()) body.stageId = opts.stageId.trim();
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/legacy/generate-codebase-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar documentación");
      }
      const data = (await r.json()) as {
        codebaseDoc: string;
        mddContent?: string;
        mcpDebugTrace?: LegacyMcpDebugEntry[];
      } | null;
      await get().fetchProject(projectId);
      if (data == null) {
        set({
          loading: false,
          loadingReason: null,
          error:
            "No se pudo generar el MDD inicial: TheForge MCP no está configurado en el backend o la respuesta fue vacía. Revisa THEFORGE_MCP_URL.",
          legacyMcpDebugTrace: null,
        });
        return null;
      }
      set({
        loading: false,
        loadingReason: null,
        error: null,
        legacyMcpDebugTrace: data.mcpDebugTrace ?? null,
      });
      return data;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al generar documentación",
        loading: false,
        loadingReason: null,
        legacyMcpDebugTrace: null,
      });
      return null;
    }
  },

  legacyUpdateCodebaseDoc: async (projectId, codebaseDoc) => {
    if (!projectId?.trim()) return false;
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/legacy/codebase-doc`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codebaseDoc }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al guardar documentación");
      }
      await get().fetchProject(projectId);
      return true;
    } catch {
      return false;
    }
  },

  legacyStart: async (projectId, description, stageId) => {
    if (!projectId?.trim() || !description?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = { description: description.trim() };
      if (stageId?.trim()) body.stageId = stageId.trim();
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/legacy/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al analizar con Relic");
      }
      const data = (await r.json()) as {
        filesToModify: (string | { path: string; repoId?: string })[];
        questions: string[];
        suggestedAnswers?: Record<string, string>;
      };
      await get().fetchProject(projectId);
      set({ loading: false, error: null });
      return data;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error legacy start", loading: false });
      return null;
    }
  },

  legacyAnswer: async (projectId, answers, stageId) => {
    if (!projectId?.trim()) return false;
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = { answers: answers ?? {} };
      if (stageId?.trim()) body.stageId = stageId.trim();
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/legacy/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al guardar respuestas");
      }
      await get().fetchProject(projectId);
      set({ loading: false, error: null });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error legacy answer", loading: false });
      return false;
    }
  },

  legacyGenerateMdd: async (projectId, stageId) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    set({ loading: true, loadingReason: "legacy-mdd", error: null });
    void get().fetchGenerationStatus(pid);
    try {
      const jobStatus = await enqueueAndPollLegacyMdd(pid, stageId, {
        onProgress: (p) => {
          const ev = mddJobProgressEventFields(p);
          if (ev.message) {
            patchAgentProgressFromMddEvent(set, {
              agent: "MDD Legacy",
              message: ev.message,
            });
          }
        },
        onEnqueued: () => {
          void get().fetchGenerationStatus(pid);
        },
      });
      if (jobStatus.result?.outcome === "interrupt" && jobStatus.result.threadId) {
        set({ managerThreadId: jobStatus.result.threadId });
      }
      const project = await get().fetchProject(pid);
      const mddContent = project?.mddContent ?? "";
      set({
        mddContent,
        loading: false,
        loadingReason: null,
        error: null,
      });
      await get().fetchGenerationStatus(pid);
      return mddContent.trim() ? { mddContent } : null;
    } catch (e) {
      try {
        const project = await get().fetchProject(pid);
        if (project?.mddContent?.trim()) {
          set({
            mddContent: project.mddContent,
            loading: false,
            loadingReason: null,
            error: null,
          });
          return { mddContent: project.mddContent };
        }
      } catch {
        /* persist recovery failed */
      }
      set({
        error: friendlyFetchError(e),
        loading: false,
        loadingReason: null,
      });
      void get().fetchGenerationStatus(pid);
      return null;
    }
  },

  legacyGenerateAsIsManual: async (projectId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "legacy-as-is", error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/legacy/generate-as-is-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar As-Is");
      }
      const data = (await r.json()) as { asIsManualContent: string; stageId: string };
      await get().fetchProject(projectId.trim());
      set({ loading: false, loadingReason: null, error: null });
      return data;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al generar manual As-Is",
        loading: false,
        loadingReason: null,
      });
      return null;
    }
  },

  legacySuggestBrdFromCodebaseDoc: async (projectId, stageId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "legacy-brd-suggest", error: null });
    const body: Record<string, string> = {};
    if (stageId?.trim()) body.stageId = stageId.trim();
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/legacy/suggest-brd-from-codebase-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar BRD");
      }
      const data = (await r.json()) as { brdContent: string; stageId: string };
      await get().fetchProject(projectId.trim());
      set({ loading: false, loadingReason: null, error: null });
      return data;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al sugerir BRD",
        loading: false,
        loadingReason: null,
      });
      return null;
    }
  },

  legacyGenerateFromCodebaseDoc: async (projectId, documentType, stageId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "legacy-brd-suggest", error: null });
    const body: { documentType: string; stageId?: string } = { documentType };
    if (stageId?.trim()) body.stageId = stageId.trim();
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/legacy/generate-from-codebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar documento");
      }
      const data = (await r.json()) as { content: string; field: string };
      await get().fetchProject(projectId.trim());
      set({ loading: false, loadingReason: null, error: null });
      return data;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al generar documento desde codebase",
        loading: false,
        loadingReason: null,
      });
      return null;
    }
  },

  suggestBrdFromDbga: async (projectId, opts) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "brd-from-dbga", error: null });
    try {
      const body: { stageId?: string } = {};
      const sid = opts?.stageId?.trim();
      if (sid) body.stageId = sid;
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/suggest-brd-from-dbga`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar BRD desde DBGA");
      }
      const data = (await r.json()) as { brdContent: string; stageId: string };
      await get().fetchProject(projectId.trim());
      set({ loading: false, loadingReason: null, error: null });
      return data;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al sugerir BRD desde DBGA",
        loading: false,
        loadingReason: null,
      });
      return null;
    }
  },

  legacyGenerateDeliverables: async (projectId) => {
    if (!projectId?.trim()) return false;
    const pid = projectId.trim();
    const stageId = get().activeStageId?.trim() || undefined;
    const project = get().project;
    const complexity = project?.complexity ?? "HIGH";
    const activeStage = project?.stages?.find((s) => s.id === stageId);
    const skipKinds = activeStage
      ? resolveLegacyCascadeSkipKindsFromStage(activeStage)
      : undefined;
    const plannedKinds = planLegacyDeliverablesToGenerate({
      complexity,
      hasMddContent: !!project?.mddContent?.trim(),
      skipKinds: skipKinds?.length ? skipKinds : undefined,
    });
    const stepLabels = deliverableStepLabelsForKinds(plannedKinds);

    if (stepLabels.length === 0) {
      await get().fetchProject(pid);
      return true;
    }

    set({
      loading: true,
      loadingReason: "legacy-deliverables",
      error: null,
      agentProgress: stepLabels.map((label) => ({
        agent: "Entregables",
        message: `⚪ ${label} — Generando…`,
        step: label,
        status: "generando" as const,
      })),
      cascadeTotal: stepLabels.length,
      cascadeCompleted: 0,
    });

    const pollLegacyDeliverablesJob = async (jobId: string): Promise<boolean> => {
      const deadline = Date.now() + 90 * 60 * 1000;
      const completedSteps = new Set<string>();
      let lastReportedStep: string | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const st = await apiFetch(`${API_BASE}/projects/${pid}/legacy/deliverables-jobs/${jobId}`);
        if (!st.ok) {
          const err = await st.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message ?? "Error al consultar cola legacy");
        }
        const j = (await st.json()) as {
          status: string;
          progress?: { step?: string; index?: number; total?: number };
          result?: { ok?: boolean; lastDeliverablesDebug?: LegacyDeliverablesDebugReport };
          error?: string;
        };
        if (j.status === "failed") {
          throw new Error(j.error ?? "Cascada legacy fallida");
        }
        if (j.status === "completed") {
          if (j.result?.lastDeliverablesDebug) {
            set({ lastLegacyDeliverablesDebug: j.result.lastDeliverablesDebug });
          }
          return true;
        }
        const apiStep = readDeliverableCascadeProgressStep(j.progress);
        if (j.progress != null && (apiStep !== "done" || (j.progress as { completedSteps?: string[] }).completedSteps?.length)) {
          const progressUpdate = applyDeliverableCascadeProgressUpdate(
            get().agentProgress,
            completedSteps,
            j.progress,
          );
          if (progressUpdate.matched) {
            set({
              agentProgress: progressUpdate.agentProgress,
              cascadeCompleted: progressUpdate.cascadeCompleted,
            });
          } else if (apiStep && apiStep !== "done" && apiStep !== lastReportedStep) {
            lastReportedStep = apiStep;
            set({ agentProgress: progressUpdate.agentProgress });
          }
        }
      }
      throw new Error("Tiempo de espera agotado en cascada legacy (90 min). Revisa el proyecto por si hubo avance parcial.");
    };

    try {
      const r = await apiFetch(`${API_BASE}/projects/${pid}/legacy/generate-deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stageId ? { stageId } : {}),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as {
          message?: string;
          lastDeliverablesDebug?: LegacyDeliverablesDebugReport;
          retryAfterSeconds?: number;
        };
        if (r.status === 429 && err.lastDeliverablesDebug) {
          set({ lastLegacyDeliverablesDebug: err.lastDeliverablesDebug });
        }
        const suffix =
          r.status === 429 && typeof err.retryAfterSeconds === "number"
            ? ` Reintenta en ~${err.retryAfterSeconds}s (límite TPM/RPM del proveedor).`
            : "";
        throw new Error((err.message ?? "Error al generar entregables") + suffix);
      }
      const data = (await r.json()) as {
        queued?: boolean;
        jobId?: string;
        ok?: boolean;
        lastDeliverablesDebug?: LegacyDeliverablesDebugReport;
      };

      if (data.queued === true && typeof data.jobId === "string") {
        await pollLegacyDeliverablesJob(data.jobId);
      } else {
        if (import.meta.env.DEV && data.lastDeliverablesDebug) {
          console.debug("[LegacyDeliverables]", data.lastDeliverablesDebug);
        }
        set({ lastLegacyDeliverablesDebug: data.lastDeliverablesDebug ?? null });
      }

      set((s) => ({
        agentProgress: markAllAgentProgressTerminated(s.agentProgress),
        cascadeCompleted: stepLabels.length,
      }));
      const proj = await get().fetchProject(pid);
      await get().fetchEstimation(pid).catch(() => {});
      await get().fetchGenerationStatus(pid);
      get().bumpDocumentationGapsRefresh();
      set({
        loading: false,
        loadingReason: null,
        error: null,
        agentProgress: [],
      });
      return proj != null;
    } catch (e) {
      try {
        const project = await get().fetchProject(pid);
        const { activeStageId, workshopStages } = get();
        const stages = workshopStages.length > 0 ? workshopStages : (project?.stages ?? []);
        const debug = legacyDebugFromStages(stages, activeStageId);
        const partial =
          debug?.steps?.some((s) => typeof s.outChars === "number" && s.outChars > 48) ?? false;
        if (partial || (project?.specContent?.trim()?.length ?? 0) > 48) {
          set({
            lastLegacyDeliverablesDebug: debug ?? null,
            loading: false,
            loadingReason: null,
            error: null,
            agentProgress: [],
          });
          return true;
        }
      } catch {
        /* fetchProject recovery failed */
      }
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      console.error("[workshopStore] legacyGenerateDeliverables error:", msg, e);
      set({ error: msg, loading: false, loadingReason: null, agentProgress: [] });
      return false;
    }
  },
});
