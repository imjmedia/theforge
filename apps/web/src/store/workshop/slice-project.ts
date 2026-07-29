import type { StateCreator } from "zustand";
import { apiFetch, API_BASE } from "../../utils/apiClient";
import { isWorkshopAgentsBusy } from "../../utils/workshopAgentsBusy";
import { shouldPreserveWorkshopBusyState } from "../../utils/workshopBusyRefresh";
import { normalizeWorkshopDocumentForEditor } from "../../utils/workshop-document-content.util";
import { resolveMddFetchMerge } from "../../utils/workshop-mdd-sync.util";
import { pickDefaultStageId } from "./helpers/pick-default-stage";
import {
  resolveWorkshopChatScopeForProject,
  saveWorkshopChatScopePreference,
} from "./helpers/chat-scope";
import { patchWorkshopMddStagesWithEditorContent } from "./helpers/mdd-editor";
import {
  legacyDebugFromStages,
  workshopFlatFromStage,
  workshopStateFromProjectStage,
} from "./helpers/stage-focus";
import { shouldApplyWorkshopUpdate, workshopScopeProjectId } from "./helpers/workshop-scope";
import { resetWorkshopSemaphoreSnapshot } from "./helpers/semaphore-snapshot";
import { selectPersistedMddBaseline } from "./selectors";
import type { WorkshopChatScope } from "@theforge/shared-types";
import type { Project, Session, WorkshopStage } from "./types";
import type { WorkshopState } from "./workshop-state.types";

type ProjectSliceActions = Pick<
  WorkshopState,
  | "setWorkshopActiveDocPanel"
  | "setProject"
  | "patchPluginData"
  | "setActiveStageId"
  | "setChatScope"
  | "createWorkshopStage"
  | "patchWorkshopStage"
  | "setProjectRequireBrdTobeGate"
  | "fetchProject"
>;

export const createProjectSlice: StateCreator<WorkshopState, [], [], ProjectSliceActions> = (
  set,
  get,
) => ({
  setWorkshopActiveDocPanel: (panel) => {
    const state = get();
    if (isWorkshopAgentsBusy(state)) return;
    set({ workshopActiveDocPanel: panel });
  },

  setProject: (p) => {
    if (!p) {
      set({
        project: null,
        activeStageId: null,
        workshopStages: [],
        mddPersistedBaseline: "",
        lastLegacyDeliverablesDebug: null,
        pluginData: {},
      });
      return;
    }
    const stages = p.stages ?? [];
    const prev = get().activeStageId;
    const activeStageId = prev && stages.some((s) => s.id === prev) ? prev : pickDefaultStageId(stages);
    const focused = workshopStateFromProjectStage({ ...p, stages }, activeStageId);
    set({
      project: focused.project,
      workshopStages: stages,
      activeStageId,
      mddContent: focused.mddContent,
      mddPersistedBaseline: focused.mddContent ?? "",
      documentTimestamps: focused.documentTimestamps,
      uxUiGuideContent: focused.uxUiGuideContent,
      dbgaContent: p.dbgaContent ?? null,
      phase0SummaryContent: focused.phase0SummaryContent,
      blueprintContent: focused.blueprintContent,
      apiContractsContent: focused.apiContractsContent,
      logicFlowsContent: focused.logicFlowsContent,
      architectureContent: focused.architectureContent,
      useCasesContent: focused.useCasesContent,
      userStoriesContent: focused.userStoriesContent,
      infraContent: focused.infraContent,
      aemContent: focused.aemContent,
      specContent: focused.specContent,
      tasksContent: focused.tasksContent,
      uiScreensContent: focused.uiScreensContent,
      agentGovernanceContent: focused.agentGovernanceContent,
      lastLegacyDeliverablesDebug: legacyDebugFromStages(stages, activeStageId),
      pluginData: (p.pluginData as Record<string, unknown> | null | undefined) ?? {},
    });
  },

  patchPluginData: (pluginId, data) =>
    set((s) => ({
      pluginData: { ...s.pluginData, [pluginId]: data },
      project: s.project
        ? {
            ...s.project,
            pluginData: { ...(s.project.pluginData as Record<string, unknown> | undefined), [pluginId]: data },
          }
        : s.project,
    })),

  setActiveStageId: (stageId) => {
    const { project, projectId, workshopStages } = get();
    if (!project || !stageId) return;
    const stages = workshopStages.length > 0 ? workshopStages : (project.stages ?? []);
    if (!stages.some((s) => s.id === stageId)) return;
    const focused = workshopStateFromProjectStage({ ...project, stages }, stageId);
    set({
      activeStageId: stageId,
      project: focused.project,
      mddContent: focused.mddContent,
      mddPersistedBaseline: focused.mddContent ?? "",
      documentTimestamps: focused.documentTimestamps,
      specContent: focused.specContent,
      architectureContent: focused.architectureContent,
      useCasesContent: focused.useCasesContent,
      userStoriesContent: focused.userStoriesContent,
      blueprintContent: focused.blueprintContent,
      tasksContent: focused.tasksContent,
      apiContractsContent: focused.apiContractsContent,
      logicFlowsContent: focused.logicFlowsContent,
      infraContent: focused.infraContent,
      agentGovernanceContent: focused.agentGovernanceContent,
      uxUiGuideContent: focused.uxUiGuideContent,
      uiScreensContent: focused.uiScreensContent,
      phase0SummaryContent: focused.phase0SummaryContent,
      aemContent: focused.aemContent,
      lastLegacyDeliverablesDebug: legacyDebugFromStages(stages, stageId),
    });
    const pid = projectId ?? project.id;
    if (pid?.trim()) {
      const qs = new URLSearchParams({ projectId: pid.trim(), stageId });
      void apiFetch(`${API_BASE}/ai-analysis/mdd/thread?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { threadId?: string | null } | null) => {
          if (data?.threadId) set({ managerThreadId: data.threadId });
          else set({ managerThreadId: null });
        })
        .catch(() => {});
      void get()
        .fetchEstimation(pid.trim())
        .catch(() => {});
    }
  },

  setChatScope: (scope: WorkshopChatScope) => {
    const pid = get().projectId ?? get().project?.id ?? "";
    if (pid.trim()) saveWorkshopChatScopePreference(pid, scope);
    set({ chatScope: scope });
  },

  createWorkshopStage: async (opts) => {
    const { projectId, project, workshopStages } = get();
    if (!projectId?.trim()) return null;
    const body: Record<string, unknown> = { activate: true };
    if (opts.name?.trim()) body.name = opts.name.trim();
    if (opts.key?.trim()) body.key = opts.key.trim();
    if (opts.copyMddFromStageId?.trim()) body.copyMddFromStageId = opts.copyMddFromStageId.trim();
    if (opts.copyLegacyChangeFromStageId?.trim()) {
      body.copyLegacyChangeFromStageId = opts.copyLegacyChangeFromStageId.trim();
    }
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "No se pudo crear la etapa");
      }
      const data = (await r.json()) as { stage?: WorkshopStage } | Project;
      const newStage = "stage" in data && data.stage ? data.stage : null;
      if (newStage && project) {
        const prev = workshopStages.length > 0 ? workshopStages : (project.stages ?? []);
        const stages = [...prev.filter((s) => s.id !== newStage.id), newStage].sort(
          (a, b) => a.ordinal - b.ordinal,
        );
        const nextProject: Project = { ...project, stages };
        const activeStageId = newStage.id;
        const flat = workshopFlatFromStage(nextProject, activeStageId);
        set({
          workshopStages: stages,
          project: { ...nextProject, ...flat },
          activeStageId,
          mddContent: normalizeWorkshopDocumentForEditor(flat.mddContent) ?? "",
          mddPersistedBaseline: normalizeWorkshopDocumentForEditor(flat.mddContent) ?? "",
          error: null,
        });
        const pid = projectId.trim();
        const threadQs = new URLSearchParams({ projectId: pid, stageId: activeStageId });
        void apiFetch(`${API_BASE}/ai-analysis/mdd/thread?${threadQs.toString()}`)
          .then((tr) => (tr.ok ? tr.json() : null))
          .then((d: { threadId?: string | null } | null) => {
            if (d?.threadId) set({ managerThreadId: d.threadId });
            else set({ managerThreadId: null });
          })
          .catch(() => {});
        void get().fetchEstimation(pid).catch(() => {});
        return get().project;
      }
      return await get().fetchProject(projectId.trim());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al crear etapa" });
      return null;
    }
  },

  patchWorkshopStage: async (stageId, body) => {
    const { projectId } = get();
    if (!projectId?.trim() || !stageId?.trim()) {
      set({ error: "Falta proyecto o etapa" });
      return false;
    }
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}/stages/${stageId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
        throw new Error(msg ?? "PATCH etapa falló");
      }
      await get().fetchProject(projectId.trim());
      if ("brdContent" in body) {
        void get().fetchGenerationStatus(projectId.trim());
      }
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al actualizar etapa" });
      return false;
    }
  },

  setProjectRequireBrdTobeGate: async (projectId, requireBrdTobeGate) => {
    if (!projectId?.trim()) {
      set({ error: "Falta proyecto" });
      return false;
    }
    const prev = get().project;
    if (prev) {
      set({ project: { ...prev, requireBrdTobeGate } });
    }
    try {
      const r = await apiFetch(`${API_BASE}/projects/${projectId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireBrdTobeGate }),
      });
      if (!r.ok) {
        if (prev) {
          set({ project: prev });
        }
        const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
        throw new Error(msg ?? "PATCH proyecto falló");
      }
      await get().fetchProject(projectId.trim());
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al actualizar proyecto" });
      return false;
    }
  },

  fetchProject: async (projectId, options) => {
    const requestedId = projectId.trim();
    if (!requestedId) return null;
    void get().fetchGenerationStatus(requestedId, undefined, { light: true }).catch(() => {});
    try {
      const switchingProject =
        !!get().projectId?.trim() && get().projectId!.trim() !== requestedId;
      const preserveBusy = !switchingProject && shouldPreserveWorkshopBusyState(get(), requestedId);
      set({
        ...(preserveBusy
          ? {}
          : {
              session: null,
              managerThreadId: null,
              streamingUserMessage: null,
              streamingUserImages: null,
              streamingContent: null,
              streamingTab: null,
              agentProgress: [],
            }),
        ...(switchingProject
          ? {
              loading: false,
              loadingReason: null,
              pendingPlanApproval: null,
              evaluatorCritique: null,
            }
          : {}),
      });
      const r = await apiFetch(`${API_BASE}/projects/${requestedId}`);
      if (!r.ok) throw new Error("Proyecto no encontrado");
      const data: Project = await r.json();
      const stages = data.stages ?? [];
      const prev = get().activeStageId;
      const activeStageId = prev && stages.some((s) => s.id === prev) ? prev : pickDefaultStageId(stages);
      const focused = workshopStateFromProjectStage({ ...data, stages }, activeStageId);
      if (!shouldApplyWorkshopUpdate(get, requestedId)) return null;
      const localMdd = get().mddContent ?? "";
      const persistedMdd = selectPersistedMddBaseline(get());
      const serverMdd = focused.mddContent ?? "";
      const sameProjectLoaded =
        get().project?.id === requestedId && workshopScopeProjectId(get) === requestedId;
      const preferServerMdd =
        options?.preferServerMdd === true ||
        get().loadingReason === "mdd" ||
        get().loadingReason === "mdd-section" ||
        get().loadingReason === "legacy-mdd";
      const { nextMddContent, updatePersistedBaseline } = resolveMddFetchMerge({
        switchingProject,
        sameProjectLoaded,
        mddPersisting: get().mddPersisting,
        preferServerMdd,
        localMdd,
        persistedMdd,
        serverMdd,
      });
      let nextStages = stages;
      let nextProject: typeof focused.project = focused.project;
      if (activeStageId) {
        const patched = patchWorkshopMddStagesWithEditorContent(
          focused.project,
          stages,
          activeStageId,
          nextMddContent,
        );
        nextStages = patched.stages;
        nextProject = patched.project;
      }
      const chatScope = resolveWorkshopChatScopeForProject(
        data.projectType,
        stages.length,
        requestedId,
      );
      set({
        project: nextProject,
        workshopStages: nextStages,
        activeStageId,
        chatScope,
        mddContent: nextMddContent,
        ...(updatePersistedBaseline ? { mddPersistedBaseline: nextMddContent } : {}),
        documentTimestamps: focused.documentTimestamps,
        uxUiGuideContent: focused.uxUiGuideContent,
        dbgaContent: normalizeWorkshopDocumentForEditor(data.dbgaContent ?? null),
        specContent: focused.specContent,
        phase0SummaryContent: focused.phase0SummaryContent,
        blueprintContent: focused.blueprintContent,
        tasksContent: focused.tasksContent,
        apiContractsContent: focused.apiContractsContent,
        logicFlowsContent: focused.logicFlowsContent,
        architectureContent: focused.architectureContent,
        useCasesContent: focused.useCasesContent,
        userStoriesContent: focused.userStoriesContent,
        infraContent: focused.infraContent,
        aemContent: focused.aemContent,
        uiScreensContent: focused.uiScreensContent,
        agentGovernanceContent: focused.agentGovernanceContent,
        error: null,
        legacyMcpDebugTrace: null,
        synced: true,
        ...resetWorkshopSemaphoreSnapshot(),
        pluginData: (data.pluginData as Record<string, unknown> | null | undefined) ?? {},
      });
      void (async () => {
        const sessionsRes = await apiFetch(`${API_BASE}/sessions/project/${requestedId}`);
        if (sessionsRes.ok) {
          const sessions: Session[] = await sessionsRes.json();
          if (!shouldApplyWorkshopUpdate(get, requestedId)) return;
          const scoped = sessions.filter((s) => s.projectId === requestedId);
          set({ session: scoped.length > 0 ? scoped[0] : null });
        }
        if (!shouldApplyWorkshopUpdate(get, requestedId)) return;
        const sid = get().activeStageId;
        const threadQs = new URLSearchParams({ projectId: requestedId });
        if (sid) threadQs.set("stageId", sid);
        const threadRes = await apiFetch(`${API_BASE}/ai-analysis/mdd/thread?${threadQs.toString()}`).catch(
          () => null,
        );
        if (threadRes?.ok) {
          const threadData = (await threadRes.json()) as { threadId?: string | null };
          if (shouldApplyWorkshopUpdate(get, requestedId) && threadData.threadId) {
            set({ managerThreadId: threadData.threadId });
          }
        }
      })();
      setTimeout(() => {
        if (!shouldApplyWorkshopUpdate(get, requestedId)) return;
        const sid = get().activeStageId;
        get().fetchEstimation(requestedId).catch(() => {});
        get().fetchAdrs(requestedId).catch(() => {});
        get().fetchGenerationStatus(requestedId, sid ?? undefined).catch(() => {});
        get().fetchPlanValidation(requestedId).catch(() => {});
      }, 0);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al cargar proyecto";
      set({ error: msg });
      return null;
    }
  },
});
