import type { StateCreator } from "zustand";
import { apiFetch, API_BASE, fetchWithRetry } from "../../utils/apiClient";
import { queueAndPoll } from "../../utils/queueAndPoll";
import { isFireAndForgetQueueResponse } from "../../utils/queueAndPollHelpers";
import {
  applyTasksPipelineProgress,
  completeTasksGenerationProgressItems,
  createTasksGenerationProgressItems,
} from "../../utils/tasks-generation-progress.util";
import type { TasksPipelineProgress } from "@theforge/shared-types";
import {
  applyDeliverableCascadeProgressUpdate,
  ensurePostPassCascadeRow,
  markAllAgentProgressTerminated,
  readDeliverableCascadeProgressStep,
} from "../../utils/deliverableCascadeProgress";
import { CASCADE_POST_PASS_STEP_LABEL } from "@theforge/shared-types";
import {
  advanceAgentGovernanceProgressItems,
  completeAgentGovernanceProgressItems,
  createAgentGovernanceProgressItems,
} from "../../constants/agent-governance-loading-steps";
import { deliverableStepLabelsForComplexity } from "@theforge/shared-types";
import { normalizeWorkshopDocumentForEditor } from "../../utils/workshop-document-content.util";
import { mergeAgentProgressFromMddEvent } from "../../utils/agentProgress";
import { parseNdjsonLine } from "../../utils/ndjson";
import { hasDeliveryGateBlockers } from "./helpers/delivery-gate";
import { persistField } from "./helpers/persist-field";
import { errorStateFromCaught, friendlyFetchError, throwStreamHttpError } from "./helpers/store-errors";
import { workshopStateFromProjectStage } from "./helpers/stage-focus";
import type {
  ApiConformanceResult,
  ComplexityPending,
  ConformanceResult,
  CrossDocumentGap,
  DocumentCompleteness,
  LiveMetricsResult,
  PrecisionBreakdown,
  Project,
} from "./types";
import type { WorkshopState } from "./workshop-state.types";

type DeliverablesSliceActions = Pick<
  WorkshopState,
  | "setUxUiGuideContent"
  | "persistUxUiGuideContent"
  | "persistUxGuideDesignRef"
  | "setBlueprintContent"
  | "persistBlueprintContent"
  | "generateBlueprint"
  | "setApiContractsContent"
  | "persistApiContractsContent"
  | "generateApiContracts"
  | "setLogicFlowsContent"
  | "persistLogicFlowsContent"
  | "generateLogicFlows"
  | "setInfraContent"
  | "persistInfraContent"
  | "generateInfra"
  | "setArchitectureContent"
  | "persistArchitectureContent"
  | "generateArchitecture"
  | "setUseCasesContent"
  | "persistUseCasesContent"
  | "generateUseCases"
  | "setUserStoriesContent"
  | "persistUserStoriesContent"
  | "generateUserStories"
  | "setSpecContent"
  | "persistSpecContent"
  | "setAemContent"
  | "persistAemContent"
  | "generateAem"
  | "setUiScreensContent"
  | "syncUiScreens"
  | "generateSpec"
  | "setTasksContent"
  | "persistTasksContent"
  | "generateTasks"
  | "requestGenerateTasks"
  | "generateAgentGovernance"
  | "fetchAgentGovernanceExport"
  | "generateDeliverablesCascade"
  | "repairSddGaps"
  | "confirmComplexityProposal"
  | "dismissComplexityProposal"
  | "reassessComplexity"
  | "fetchConformance"
  | "verifyDeliverable"
  | "setDbgaContent"
  | "persistDbgaContent"
  | "clearDbgaContent"
  | "generateBenchmark"
  | "setPhase0SummaryContent"
  | "persistPhase0SummaryContent"
  | "phase0DeepResearch"
  | "startPhase0Assisted"
  | "stopPhase0Assisted"
  | "fetchEstimation"
  | "clearPhase0SummaryContent"
  | "clearMddDependentDeliverables"
  | "clearWorkshopDocumentContent"
  | "setAgentProgress"
>;

export const createDeliverablesSlice: StateCreator<
  WorkshopState,
  [],
  [],
  DeliverablesSliceActions
> = (set, get) => ({
  setUxUiGuideContent: (content) => set({ uxUiGuideContent: content }),
  persistUxUiGuideContent: async (content) => {
    await persistField("uxUiGuideContent", content, get, set);
  },

  persistUxGuideDesignRef: async (ref) => {
    const { projectId, project } = get();
    if (!projectId || !project) return false;
    const normalized = ref?.trim() || null;
    if (normalized === (project.uxGuideDesignRef ?? null)) return true;
    set({ synced: false, error: null });
    try {
      const r = await fetchWithRetry(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uxGuideDesignRef: normalized }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Project;
      set({ project: data, synced: true, error: null });
      return true;
    } catch (e) {
      set({ error: friendlyFetchError(e), synced: false });
      return false;
    }
  },

  setBlueprintContent: (content) => set({ blueprintContent: content }),

  persistBlueprintContent: async (content) => {
    await persistField("blueprintContent", content, get, set);
  },

  generateBlueprint: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    // Preview mode eliminado — regeneración directa
    // Normal: encolar con queueAndPoll
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = {};
      if (options?.gapsFeedback?.trim()) body.gapsFeedback = options.gapsFeedback.trim();
      const stageId = get().activeStageId;
      if (stageId) body.stageId = stageId;
      const data = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-blueprint`, body);
      const raw = data.blueprintContent ?? "";
      const cleaned = raw.replace(/^\s*```(?:markdown)?\s*/i, "").replace(/^\s*```\s*/, "").replace(/\s*```\s*$/, "");
      const stages = data.stages ?? get().project?.stages ?? [];
      const merged: Project = {
        ...data,
        stages: stageId
          ? stages.map((s) => (s.id === stageId ? { ...s, blueprintContent: cleaned || null } : s))
          : stages,
      };
      const focused = workshopStateFromProjectStage(merged, get().activeStageId);
      set({ project: focused.project, blueprintContent: focused.blueprintContent, error: null });
      get().fetchConformance(projectId).catch(() => { });
      return focused.project;
    } catch (e) {
      set({ error: friendlyFetchError(e) });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  setApiContractsContent: (content) => set({ apiContractsContent: content }),
  persistApiContractsContent: async (content) => {
    await persistField("apiContractsContent", content, get, set);
  },
  generateApiContracts: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    const conformancePreCheck = () => {
      const dm = get().conformance?.blueprintDataModel;
      if (dm && !dm.ok) {
        const hint = dm.gaps.length ? ` (${dm.gaps.slice(0, 2).join("; ")}${dm.gaps.length > 2 ? "…" : ""})` : "";
        set({ error: `El Blueprint debe cubrir el modelo de datos del MDD (§3) antes de generar Contratos API.${hint}` });
        return false;
      }
      return true;
    };
    // Preview mode eliminado — regeneración directa
    await get().fetchConformance(projectId.trim());
    if (!conformancePreCheck()) return null;
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = {};
      if (options?.gapsFeedback?.trim()) body.gapsFeedback = options.gapsFeedback.trim();
      const proj = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-api-contracts`, body);
      set({ project: proj, apiContractsContent: proj.apiContractsContent ?? null, error: null });
      get().fetchConformance(projectId).catch(() => { });
      return proj;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setLogicFlowsContent: (content) => set({ logicFlowsContent: content }),
  persistLogicFlowsContent: async (content) => {
    await persistField("logicFlowsContent", content, get, set);
  },
  generateLogicFlows: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = {};
      if (options?.gapsFeedback?.trim()) body.gapsFeedback = options.gapsFeedback.trim();
      const data = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-logic-flows`, body);
      set({ project: data, logicFlowsContent: data.logicFlowsContent ?? null, error: null });
      get().fetchConformance(projectId).catch(() => { });
      get().fetchProject(projectId).catch(() => { });
      return data;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setInfraContent: (content) => set({ infraContent: content }),
  persistInfraContent: async (content) => {
    await persistField("infraContent", content, get, set);
  },
  generateInfra: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    // Preview mode eliminado — regeneración directa
    set({ loading: true, error: null });
    try {
      const body: Record<string, unknown> = {};
      if (options?.gapsFeedback?.trim()) body.gapsFeedback = options.gapsFeedback.trim();
      const proj = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-infra`, body);
      set({ project: proj, infraContent: proj.infraContent ?? null, error: null });
      get().fetchConformance(projectId).catch(() => { });
      return proj;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setArchitectureContent: (content) => set({ architectureContent: content }),
  persistArchitectureContent: async (content) => {
    await persistField("architectureContent", content, get, set);
  },
  generateArchitecture: async (projectId) => {
    if (!projectId?.trim()) return null;
    // Preview mode eliminado — regeneración directa
    set({ loading: true, error: null });
    try {
      const proj = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-architecture`, {});
      set({ project: proj, architectureContent: proj.architectureContent ?? null, error: null });
      return proj;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setUseCasesContent: (content) => set({ useCasesContent: content }),
  persistUseCasesContent: async (content) => {
    await persistField("useCasesContent", content, get, set);
  },
  generateUseCases: async (projectId) => {
    if (!projectId?.trim()) return null;
    // Preview mode eliminado — regeneración directa
    set({ loading: true, error: null });
    try {
      const proj = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-use-cases`, {});
      set({ project: proj, useCasesContent: proj.useCasesContent ?? null, error: null });
      return proj;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setUserStoriesContent: (content) => set({ userStoriesContent: content }),
  persistUserStoriesContent: async (content) => {
    await persistField("userStoriesContent", content, get, set);
  },
  generateUserStories: async (projectId) => {
    if (!projectId?.trim()) return null;
    // Preview mode eliminado — regeneración directa
    set({ loading: true, error: null });
    try {
      const proj = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-user-stories`, {});
      set({ project: proj, userStoriesContent: proj.userStoriesContent ?? null, error: null });
      return proj;
    } catch (e) { set({ error: friendlyFetchError(e) }); return null; }
    finally { set({ loading: false }); }
  },

  setSpecContent: (content) => set({ specContent: content }),
  persistSpecContent: async (content) => {
    await persistField("specContent", content, get, set);
  },
  setAemContent: (content) => set({ aemContent: content }),
  persistAemContent: async (content) => {
    await persistField("aemContent", content, get, set);
  },
  /** POST …/projects/:id/generate-aem — Benchmark + Fase 0 + BRD → AEM + dictamen inversión digital. */
  generateAem: async (projectId, opts) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "aem", error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/generate-aem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketScope: opts.marketScope }),
      });
      const raw = await r.text();
      if (!r.ok) {
        let errMessage = "Error al generar AEM";
        try {
          const err = JSON.parse(raw) as { message?: string };
          if (err?.message) errMessage = err.message;
        } catch {
          if (raw.trim().length > 0 && raw.length < 500) errMessage = raw;
        }
        throw new Error(errMessage);
      }
      let data: Project;
      try {
        data = JSON.parse(raw) as Project;
      } catch {
        throw new Error("El servidor devolvió una respuesta inválida al generar AEM.");
      }
      set({ project: data, aemContent: data.aemContent ?? null, error: null });
      return data;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al generar AEM" });
      return null;
    } finally {
      set({ loading: false, loadingReason: null });
    }
  },

  setUiScreensContent: (content) => set({ uiScreensContent: content }),
  syncUiScreens: async (projectId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/ui-screens/sync`, {
        method: "POST",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? "Error al sincronizar Pantallas");
      }
      const data = (await r.json()) as { content?: string | null };
      const content = data.content ?? null;
      const current = get().project;
      set({
        uiScreensContent: content,
        project: current ? { ...current, uiScreensContent: content } : current,
      });
      return content;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al sincronizar Pantallas" });
      return null;
    } finally {
      set({ loading: false });
    }
  },
  generateSpec: async (projectId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const data = await queueAndPoll<Project>(`${API_BASE}/projects/${projectId}/generate-spec`, {});
      const raw = data.specContent ?? "";
      const cleaned = raw.replace(/^\s*```(?:markdown)?\s*/i, "").replace(/^\s*```\s*/, "").replace(/\s*```\s*$/, "");
      const newData = { ...data, specContent: cleaned || null };
      set({ project: newData, specContent: cleaned || null, error: null });
      void get().fetchGenerationStatus(projectId);
      return newData;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al generar Spec" });
      return null;
    } finally {
      set({ loading: false });
    }
  },
  setTasksContent: (content) => set({ tasksContent: content }),
  persistTasksContent: async (content) => {
    await persistField("tasksContent", content, get, set);
  },
  generateTasks: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    set({
      loading: true,
      loadingReason: "tasks",
      error: null,
      agentProgress: createTasksGenerationProgressItems(),
    });
    try {
      const params = new URLSearchParams({ queue: "true" });
      if (options?.acknowledgeGaps === true) params.set("acknowledgeGaps", "true");
      const baselineLen = get().tasksContent?.length ?? 0;
      const r = await apiFetch(`${API_BASE}/projects/${pid}/generate-tasks?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar Tasks");
      }
      const queued = (await r.json()) as { queued?: boolean; jobId?: string };
      if (queued.queued !== true) {
        const data = queued as unknown as Project;
        set({
          project: data,
          tasksContent: data.tasksContent ?? null,
          workshopStages: data.stages ?? get().workshopStages,
          agentProgress: completeTasksGenerationProgressItems(),
          error: null,
        });
        void get().fetchPlanValidation(pid);
        return data;
      }

      const jobId = queued.jobId as string;
      set({ activeDeliverablesJobId: jobId });
      const deadline = Date.now() + 6 * 60 * 60 * 1000;
      let lastTasksLen = baselineLen;

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const projectRes = await apiFetch(`${API_BASE}/projects/${pid}`);
        if (projectRes.ok) {
          const project = (await projectRes.json()) as Project;
          const nextLen = project.tasksContent?.length ?? 0;
          if (nextLen > lastTasksLen) {
            lastTasksLen = nextLen;
            set({
              project,
              tasksContent: project.tasksContent ?? null,
              workshopStages: project.stages ?? get().workshopStages,
            });
          }
        }

        if (isFireAndForgetQueueResponse(queued)) {
          const status = await get().fetchGenerationStatus(pid);
          const tasksStillRunning =
            status?.activeJob?.type === "tasks" ||
            (status?.queuedJobs.some((j) => j.type === "tasks") ?? false);
          if (!tasksStillRunning && lastTasksLen > baselineLen) {
            const done = await get().fetchProject(pid);
            set({ agentProgress: completeTasksGenerationProgressItems() });
            void get().fetchPlanValidation(pid);
            return done;
          }
          continue;
        }

        const jobRes = await apiFetch(`${API_BASE}/projects/jobs/${jobId}`);
        if (!jobRes.ok) continue;
        const job = (await jobRes.json()) as {
          status: string;
          progress?: TasksPipelineProgress & { percent?: number };
          result?: Project;
          error?: string;
        };
        if (job.progress) {
          set((s) => ({
            agentProgress: applyTasksPipelineProgress(s.agentProgress, job.progress!),
          }));
        }
        if (job.status === "failed") {
          throw new Error(job.error ?? "Error al generar Tasks");
        }
        if (job.status === "completed") {
          let data = job.result as Project | undefined;
          if (!data) {
            const fresh = await apiFetch(`${API_BASE}/projects/${pid}`);
            if (fresh.ok) data = (await fresh.json()) as Project;
          }
          if (data) {
            set({
              project: data,
              tasksContent: data.tasksContent ?? null,
              workshopStages: data.stages ?? get().workshopStages,
              agentProgress: completeTasksGenerationProgressItems(),
              error: null,
            });
            void get().fetchPlanValidation(pid);
            return data;
          }
          break;
        }
      }

      const fallback = await get().fetchProject(pid);
      void get().fetchPlanValidation(pid);
      return fallback;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al generar Tasks", agentProgress: [] });
      return null;
    } finally {
      set({ loading: false, loadingReason: null, activeDeliverablesJobId: null, agentProgress: [] });
      void get().fetchGenerationStatus(pid);
    }
  },
  requestGenerateTasks: async (projectId) => {
    if (!projectId?.trim()) return null;
    const gate = get().deliveryGate;
    let acknowledgeGaps = false;
    if (hasDeliveryGateBlockers(gate)) {
      const ok = window.confirm(
        "El gate MDD tiene gaps conocidos. ¿Generar Tasks igual? Se relajará el pre-flight upstream (DocAccuracy medio / gate MDD).",
      );
      if (!ok) return null;
      acknowledgeGaps = true;
    }
    return get().generateTasks(projectId, { acknowledgeGaps });
  },
  generateAgentGovernance: async (projectId) => {
    if (!projectId?.trim()) return null;
    const beforeLen = get().agentGovernanceContent?.length ?? 0;
    console.warn(
      `[agent-gov] workshop generateAgentGovernance start projectId=${projectId} force=true beforeLen=${beforeLen}`,
    );
    set({
      loading: true,
      loadingReason: "agent-governance",
      error: null,
      agentProgress: createAgentGovernanceProgressItems(),
    });

    const stepTimer = setInterval(() => {
      set((s) => {
        if (s.loadingReason !== "agent-governance") return s;
        return { agentProgress: advanceAgentGovernanceProgressItems(s.agentProgress) };
      });
    }, 12_000);

    try {
      const data = await queueAndPoll<Project>(
        `${API_BASE}/projects/${projectId}/generate-agent-governance`,
        { force: true },
      );
      const afterLen = data.agentGovernanceContent?.length ?? 0;
      console.warn(
        `[agent-gov] workshop generateAgentGovernance complete projectId=${projectId} beforeLen=${beforeLen} afterLen=${afterLen} preview=${(data.agentGovernanceContent ?? "").slice(0, 80)}`,
      );
      set({
        project: data,
        agentGovernanceContent: data.agentGovernanceContent ?? null,
        error: null,
        agentProgress: completeAgentGovernanceProgressItems(),
      });
      return data;
    } catch (e) {
      console.warn(
        `[agent-gov] workshop generateAgentGovernance failed projectId=${projectId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      set({
        error: e instanceof Error ? e.message : "Error al generar gobernanza de agentes",
        agentProgress: [],
      });
      return null;
    } finally {
      clearInterval(stepTimer);
      set({ loading: false, loadingReason: null, agentProgress: [] });
    }
  },
  fetchAgentGovernanceExport: async (projectId) => {
    if (!projectId?.trim()) return null;
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/agent-governance-export`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al preparar ZIP de gobernanza");
      }
      const scaffold = (await r.json()) as import("@theforge/shared-types").AgentGovernanceScaffold;
      return scaffold;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al preparar ZIP de gobernanza",
      });
      return null;
    }
  },
  generateDeliverablesCascade: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    const acknowledgeGaps = options?.acknowledgeGaps === true;
    const complexity = get().project?.complexity ?? "HIGH";
    const allStepLabels = deliverableStepLabelsForComplexity(complexity);
    set({
      loading: true,
      loadingReason: "deliverables-cascade",
      error: null,
      agentProgress: allStepLabels.map((label) => ({
        agent: "Entregables",
        message: `⚪ ${label} — Generando…`,
        step: label,
        status: "generando" as const,
      })),
      cascadeTotal: allStepLabels.length,
      cascadeCompleted: 0,
    });
    try {
      const qs = acknowledgeGaps ? "?acknowledgeGaps=true" : "";
      const r = await apiFetch(`${API_BASE}/projects/${pid}/generate-deliverables${qs}`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al generar entregables");
      }
      const data = (await r.json()) as { queued?: boolean; jobId?: string; streamPath?: string };
      if (data.queued === true && typeof data.jobId === "string") {
        set({ activeDeliverablesJobId: data.jobId });
        const deadline = Date.now() + 45 * 60 * 1000;

        const completedSteps = new Set<string>();
        let lastReportedStep: string | null = null;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const st = await apiFetch(`${API_BASE}/projects/${pid}/deliverables-jobs/${data.jobId}`);
          if (!st.ok) {
            const err = await st.json().catch(() => ({}));
            throw new Error((err as { message?: string }).message ?? "Error al consultar cola de entregables");
          }
          const j = (await st.json()) as {
            status: string;
            progress?: { step?: string; index?: number; total?: number };
            error?: string;
          };
          if (j.status === "failed") {
            if (j.error?.includes("Cancelado por el usuario")) {
              return null;
            }
            throw new Error(j.error ?? "Cascada de entregables fallida");
          }
          if (j.status === "completed") break;
          if (j.progress != null) {
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
            } else {
              const apiStep = readDeliverableCascadeProgressStep(j.progress);
              if (apiStep && apiStep !== "done" && apiStep !== lastReportedStep) {
                lastReportedStep = apiStep;
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
        }
        set((s) => ({
          agentProgress: markAllAgentProgressTerminated(s.agentProgress),
          cascadeCompleted: Math.max(s.cascadeCompleted, allStepLabels.length),
        }));
        const projQueued = await get().fetchProject(pid);
        await get().fetchEstimation(pid).catch(() => {});
        await get().fetchGenerationStatus(pid);
        get().bumpDocumentationGapsRefresh();
        set({ agentProgress: [] });
        return projQueued;
      }
      set((s) => ({
        agentProgress: markAllAgentProgressTerminated(s.agentProgress),
        cascadeCompleted: Math.max(s.cascadeCompleted, allStepLabels.length),
      }));
      const projSync = await get().fetchProject(pid);
      await get().fetchEstimation(pid).catch(() => {});
      await get().fetchGenerationStatus(pid);
      get().bumpDocumentationGapsRefresh();
      set({ agentProgress: [] });
      return projSync;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al generar entregables", agentProgress: [] });
      return null;
    } finally {
      set({ loading: false, loadingReason: null, activeDeliverablesJobId: null });
    }
  },

  repairSddGaps: async (projectId, options) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    const acknowledgeGaps = options?.acknowledgeGaps === true;
    set({
      loading: true,
      loadingReason: "repair-sdd-gaps",
      error: null,
      agentProgress: [
        {
          agent: "Brechas SDD",
          message: "Corrigiendo brechas auto/LLM…",
          step: "repair-sdd-gaps",
          status: "generando" as const,
        },
      ],
    });
    try {
      const qs = acknowledgeGaps ? "?acknowledgeGaps=true" : "";
      const r = await apiFetch(`${API_BASE}/projects/${pid}/repair-sdd-gaps${qs}`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Error al corregir brechas SDD");
      }
      const data = (await r.json()) as { queued?: boolean; jobId?: string };
      if (data.queued === true && typeof data.jobId === "string") {
        set({ activeDeliverablesJobId: data.jobId });
        const deadline = Date.now() + 45 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const st = await apiFetch(`${API_BASE}/projects/${pid}/deliverables-jobs/${data.jobId}`);
          if (!st.ok) {
            const err = await st.json().catch(() => ({}));
            throw new Error((err as { message?: string }).message ?? "Error al consultar reparación SDD");
          }
          const j = (await st.json()) as { status: string; error?: string };
          if (j.status === "failed") {
            if (j.error?.includes("Cancelado por el usuario")) return null;
            throw new Error(j.error ?? "Reparación de brechas SDD fallida");
          }
          if (j.status === "completed") break;
        }
      }
      const proj = await get().fetchProject(pid);
      await get().fetchConformance(pid).catch(() => {});
      await get().fetchEstimation(pid).catch(() => {});
      set({ agentProgress: [] });
      return proj;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al corregir brechas SDD",
        agentProgress: [],
      });
      return null;
    } finally {
      set({ loading: false, loadingReason: null, activeDeliverablesJobId: null });
    }
  },

  confirmComplexityProposal: async (projectId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/confirm-complexity`, {
        method: "POST",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "No se pudo confirmar la complejidad");
      }
      return await get().fetchProject(projectId.trim());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al confirmar complejidad" });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  dismissComplexityProposal: async (projectId) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearComplexityPending: true }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "No se pudo descartar la propuesta");
      }
      return await get().fetchProject(projectId.trim());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al descartar propuesta" });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  reassessComplexity: async (projectId, note) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/reassess-complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "No se pudo re-valorar la complejidad");
      }
      return await get().fetchProject(projectId.trim());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al re-valorar" });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  fetchConformance: async (projectId, options) => {
    if (!projectId?.trim()) return;
    const useLlm = options?.useLlm === true;
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/conformance${useLlm ? "?useLlm=true" : ""}`);
      if (r.ok) {
        const data = (await r.json()) as {
          blueprint: ConformanceResult;
          blueprintDataModel?: ConformanceResult;
          api: ApiConformanceResult;
          logicFlows: ConformanceResult;
          infra: ConformanceResult;
          readiness?: {
            gapSummary: {
              total: number;
              auto: number;
              llm: number;
              human: number;
              truncated: boolean;
              items?: Array<{
                message: string;
                kind: "auto" | "llm" | "human";
                prefix: string;
                targetDeliverable?: string;
              }>;
            };
            compositeReadiness?: { reasons: string[] };
            consistencyScore?: number;
            conformanceOk: boolean;
          };
        };
        set({
          conformance: {
            ...data,
            blueprintDataModel: data.blueprintDataModel ?? { ok: true, gaps: [] },
          },
          readinessAudit: data.readiness
            ? {
                gapSummary: {
                  total: data.readiness.gapSummary.total,
                  auto: data.readiness.gapSummary.auto,
                  llm: data.readiness.gapSummary.llm,
                  human: data.readiness.gapSummary.human,
                  truncated: data.readiness.gapSummary.truncated,
                  items: data.readiness.gapSummary.items ?? [],
                },
                compositeReadiness: data.readiness.compositeReadiness,
                consistencyScore: data.readiness.consistencyScore,
                conformanceOk: data.readiness.conformanceOk,
              }
            : null,
        });
      }
    } catch {
      set({ conformance: null, readinessAudit: null });
    }
  },
  verifyDeliverable: async (projectId, deliverable) => {
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/verify-deliverable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverable }),
      });
      if (!r.ok) throw new Error("Error al verificar");
      const text = await r.text();
      return text.replace(/^["']|["']$/g, "").trim();
    } catch {
      return "";
    }
  },
  setDbgaContent: (content) => set({ dbgaContent: content }),

  persistDbgaContent: async (content) => {
    await persistField("dbgaContent", content, get, set);
  },

  setAgentProgress: (progress) => set({ agentProgress: progress }),

  generateBenchmark: async (projectId, userIdea) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "benchmark", error: null, agentProgress: [] });
    try {
      const r = await apiFetch(`${API_BASE}/ai-analysis/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: userIdea?.trim() ?? "",
          projectId: projectId.trim(),
        }),
      });
      if (!r.ok) {
        await throwStreamHttpError(r, "Error al generar Benchmark & Gap Analysis");
      }
      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMarkdown: string | null = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            for (const event of parseNdjsonLine(line)) {
              try {
                const ev = event as {
                  type: string;
                  agent?: string;
                  message?: string;
                  markdown?: string;
                  complexityProposal?: ComplexityPending;
                  code?: string;
                };
                if (ev.type === "progress" && ev.agent != null && ev.message != null) {
                  set((s) => ({
                    agentProgress: mergeAgentProgressFromMddEvent(s.agentProgress, {
                      agent: ev.agent!,
                      message: ev.message!,
                    }),
                  }));
                } else if (ev.type === "done" && ev.markdown != null) {
                  finalMarkdown = ev.markdown;
                  if (ev.complexityProposal != null) {
                    set((s) => ({
                      project:
                        s.project != null
                          ? { ...s.project, complexityPending: ev.complexityProposal! }
                          : s.project,
                    }));
                  }
                } else if (ev.type === "error" && ev.message) {
                  const err = new Error(ev.message) as Error & { code?: string };
                  if (ev.code) err.code = ev.code;
                  throw err;
                }
              } catch (parseErr) {
                if (parseErr instanceof SyntaxError) continue;
                throw parseErr;
              }
            }
          }
        }
      }

      if (finalMarkdown != null) {
        set({ dbgaContent: finalMarkdown, error: null });
        const { persistDbgaContent, fetchProject } = get();
        await persistDbgaContent(finalMarkdown);
        const data = await fetchProject(projectId);
        return data ?? get().project;
      }
      return get().project;
    } catch (e) {
      set({
        ...errorStateFromCaught(e),
        loading: false,
        loadingReason: null,
        agentProgress: [],
      });
      return null;
    } finally {
      set({ loading: false, loadingReason: null, agentProgress: [] });
    }
  },


  setPhase0SummaryContent: (content) => set({ phase0SummaryContent: content }),

  persistPhase0SummaryContent: async (content) => {
    await persistField("phase0SummaryContent", content, get, set);
  },

  startPhase0Assisted: async (idea) => {
    const projectId = get().projectId?.trim() ?? "";
    if (!projectId) {
      set({ error: "No hay proyecto activo" });
      return;
    }
    set({ loading: true, error: null });
    try {
      const {
        postPhase0AssistedStart,
        appendWorkshopChatPair,
        applyAssistedMarkdownToState,
        ensureWorkshopChatSession,
        countWorkshopTabMessages,
      } = await import("./helpers/phase0-assisted");
      const event = await postPhase0AssistedStart(projectId, idea);
      if (event.type === "error") {
        set({
          loading: false,
          error: event.message ?? "No se pudo activar el modo asistido",
        });
        return;
      }
      applyAssistedMarkdownToState(set as (p: Record<string, unknown>) => void, get, event);
      const assistantContent =
        typeof event.message === "string" && event.message.trim()
          ? event.message.trim()
          : "Modo asistido activado.";
      const chatSession = await ensureWorkshopChatSession({
        projectId,
        tab: "benchmark",
        fetchWelcome: (pid, tab, opts) => get().fetchWelcome(pid, tab, opts),
        getSession: () => get().session,
      });
      const nextSession = await appendWorkshopChatPair({
        session: chatSession ?? get().session,
        stageId: get().activeStageId,
        tab: "benchmark",
        userContent: idea?.trim() || "Activar modo asistido",
        assistantContent,
      });
      const persistedBenchmark = countWorkshopTabMessages(nextSession, "benchmark") > 0;
      const done =
        event.type === "assisted_started" &&
        !event.awaitingSeed &&
        !event.question?.trim();
      set({
        session: nextSession ?? chatSession ?? get().session,
        phase0AssistedActive: !done,
        phase0AssistedThreadId: event.threadId?.trim() || null,
        phase0AssistedAwaitingSeed: !!event.awaitingSeed,
        phase0AssistedTemplateLabel: event.templateLabel?.trim() || null,
        phase0AssistedBootstrapMessage: persistedBenchmark ? null : assistantContent,
        loading: false,
        error: null,
        workshopActiveDocPanel: "benchmark",
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "No se pudo activar el modo asistido",
      });
    }
  },

  stopPhase0Assisted: async () => {
    const projectId = get().projectId?.trim() ?? "";
    if (!projectId) {
      set({
        phase0AssistedActive: false,
        phase0AssistedThreadId: null,
        phase0AssistedAwaitingSeed: false,
        phase0AssistedTemplateLabel: null,
        phase0AssistedBootstrapMessage: null,
      });
      return;
    }
    set({ loading: true, error: null });
    try {
      const { postPhase0AssistedStop, appendWorkshopChatPair, applyAssistedMarkdownToState } =
        await import("./helpers/phase0-assisted");
      const event = await postPhase0AssistedStop(projectId);
      applyAssistedMarkdownToState(set as (p: Record<string, unknown>) => void, get, event);
      const nextSession = await appendWorkshopChatPair({
        session: get().session,
        stageId: get().activeStageId,
        tab: "benchmark",
        assistantContent:
          typeof event.message === "string" && event.message.trim()
            ? event.message.trim()
            : "Modo asistido desactivado.",
      });
      set({
        session: nextSession ?? get().session,
        phase0AssistedActive: false,
        phase0AssistedThreadId: null,
        phase0AssistedAwaitingSeed: false,
        phase0AssistedTemplateLabel: null,
        phase0AssistedBootstrapMessage: null,
        loading: false,
        error: null,
      });
    } catch (e) {
      set({
        phase0AssistedActive: false,
        phase0AssistedThreadId: null,
        phase0AssistedAwaitingSeed: false,
        phase0AssistedTemplateLabel: null,
        phase0AssistedBootstrapMessage: null,
        loading: false,
        error: e instanceof Error ? e.message : "No se pudo desactivar el modo asistido",
      });
    }
  },

  phase0DeepResearch: async (projectId, opts) => {
    if (!projectId?.trim()) return null;
    set({ loading: true, loadingReason: "phase0-deep-research", error: null });
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}/phase0-deep-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIdea: opts.userIdea?.trim() || undefined,
          urls: opts.urls?.length ? opts.urls : undefined,
          includeBenchmark: opts.includeBenchmark ?? false,
        }),
      });
      const raw = await r.text();
      if (!r.ok) {
        let errMessage = "Error al generar Deep Research";
        try {
          const err = JSON.parse(raw) as { message?: string };
          if (err?.message) errMessage = err.message;
        } catch {
          if (raw.trim().length > 0 && raw.length < 500) errMessage = raw;
        }
        throw new Error(errMessage);
      }
      let data: Project;
      try {
        data = JSON.parse(raw) as Project;
      } catch {
        console.error("[phase0DeepResearch] Respuesta no es JSON. Preview:", raw.slice(0, 200));
        throw new Error(
          "El servidor devolvió texto en lugar de JSON (posible fallo del proveedor de IA). Intenta de nuevo.",
        );
      }
      set({ project: data, phase0SummaryContent: data.phase0SummaryContent ?? null, error: null });
      return data;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al generar Deep Research" });
      return null;
    } finally {
      set({ loading: false, loadingReason: null });
    }
  },

  clearDbgaContent: async (projectId) => {
    if (!projectId?.trim()) return;
    try {
      void apiFetch(
        `${API_BASE}/ai-analysis/dbga/checkpoint?projectId=${encodeURIComponent(projectId.trim())}`,
        { method: "DELETE" },
      ).catch(() => { });
      const r = await apiFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dbgaContent: null }),
      });
      if (r.ok) {
        const data: Project = await r.json();
        set({
          project: data,
          dbgaContent: normalizeWorkshopDocumentForEditor(data.dbgaContent ?? null),
        });
      }
    } catch {
      // ignore
    }
  },

  fetchEstimation: async (projectId, mddContentOverride) => {
    if (!projectId?.trim()) return null;
    try {
      const currentMdd = (mddContentOverride ?? get().mddContent ?? get().project?.mddContent ?? "").trim();
      const sid = get().activeStageId;
      const r = await apiFetch(`${API_BASE}/ai-analysis/estimation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          ...(currentMdd ? { mddContent: currentMdd } : {}),
          ...(sid ? { stageId: sid } : {}),
        }),
      });
      if (!r.ok) return null;
      const data = (await r.json()) as LiveMetricsResult & {
        precisionBreakdown?: PrecisionBreakdown;
        completeness?: DocumentCompleteness;
        crossDocumentGaps?: CrossDocumentGap[];
        consistencyScore?: number;
        auditTrail?: string[];
        lastAuditAt?: string;
      };
      const {
        precisionBreakdown,
        completeness,
        crossDocumentGaps,
        consistencyScore,
        auditTrail,
        deliveryGate,
        ...metrics
      } = data;
      set({
        liveMetrics: metrics,
        deliveryGate: deliveryGate ?? null,
        ...(precisionBreakdown != null ? { precisionBreakdown } : {}),
        ...(completeness != null ? { documentCompleteness: completeness } : {}),
        ...(crossDocumentGaps != null ? { crossDocumentGaps } : {}),
        ...(consistencyScore != null ? { consistencyScore } : {}),
        ...(auditTrail?.length ? { auditTrail } : {}),
        // Alinea project.status/precisionScore con el semáforo integral (listado ↔ panel).
        ...(get().project
          ? {
              project: {
                ...get().project!,
                status:
                  metrics.status === "green"
                    ? "VERDE"
                    : metrics.status === "yellow"
                      ? "AMARILLO"
                      : "ROJO",
                precisionScore: Math.min(100, Math.max(0, Math.round(metrics.precision))),
              },
            }
          : {}),
      });
      return metrics;
    } catch {
      return null;
    }
  },

  clearPhase0SummaryContent: async (projectId) => {
    if (!projectId?.trim()) return;
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase0SummaryContent: null }),
      });
      if (r.ok) {
        const data: Project = await r.json();
        set({ project: data, phase0SummaryContent: data.phase0SummaryContent ?? null });
      }
    } catch {
      // ignore
    }
  },

  clearMddDependentDeliverables: async (projectId) => {
    const pid = projectId?.trim();
    if (!pid) return false;
    const stageId = get().activeStageId?.trim();
    try {
      const r = await apiFetch(`${API_BASE}/projects/${pid}/clear-mdd-deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stageId ? { stageId } : {}),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        set({
          error: (err as { message?: string }).message ?? "No se pudieron limpiar los entregables",
        });
        return false;
      }
      await get().fetchProject(pid);
      set({
        conformance: null,
        readinessAudit: null,
        crossDocumentGaps: [],
        error: null,
      });
      await get().fetchConformance(pid).catch(() => {});
      return true;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al limpiar entregables del MDD",
      });
      return false;
    }
  },

  clearWorkshopDocumentContent: async (projectId, panel, options) => {
    if (!projectId?.trim()) return false;
    const pid = projectId.trim();

    try {
      if (panel === "benchmark") {
        if (options?.benchmarkPhaseTab === "benchmark") {
          await get().clearPhase0SummaryContent(pid);
        } else {
          await get().clearDbgaContent(pid);
        }
        return true;
      }

      if (panel === "brd") {
        const stageId = options?.stageId?.trim() ?? get().activeStageId?.trim();
        if (!stageId) return false;
        const ok = await get().patchWorkshopStage(stageId, { brdContent: "" });
        if (ok) set({ error: null });
        return ok;
      }

      if (panel === "mdd-inicial") {
        const ok = await get().legacyUpdateCodebaseDoc(pid, "");
        if (ok) await get().fetchProject(pid);
        return ok;
      }

      const fieldByPanel: Record<string, string> = {
        spec: "specContent",
        mdd: "mddContent",
        "ux-ui-guide": "uxUiGuideContent",
        blueprint: "blueprintContent",
        "api-contracts": "apiContractsContent",
        "logic-flows": "logicFlowsContent",
        tasks: "tasksContent",
        infra: "infraContent",
        architecture: "architectureContent",
        "use-cases": "useCasesContent",
        "user-stories": "userStoriesContent",
        aem: "aemContent",

        "agent-governance": "agentGovernanceContent",
      };

      const fieldName = fieldByPanel[panel];
      if (!fieldName) return false;

      if (panel === "mdd") {
        return get().clearMddContentCompletely(pid);
      }

      const r = await apiFetch(`${API_BASE}/projects/${pid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldName]: null }),
      });
      if (!r.ok) return false;
      const data: Project = await r.json();
      set({
        project: data,
        [fieldName]: (data as unknown as Record<string, unknown>)[fieldName] ?? null,
        synced: true,
        error: null,
      } as Partial<WorkshopState>);
      return true;
    } catch {
      set({ error: "No se pudo limpiar el documento" });
      return false;
    }
  },
});
