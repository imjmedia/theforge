import type { StateCreator } from "zustand";
import {
  buildUpstreamChangeSummaryForPipeline,
  mddMarkdownHasKnownFormatCorruption,
} from "@theforge/shared-types";
import {
  governancePatternSelectionDiffers,
  selectedPatternIdsFromMdd,
  serverWouldDropGovernancePatterns,
  shouldAllowGovernancePatternChangeOnPersist,
} from "@theforge/shared-types/mdd-governance-patterns";
import { apiFetch, API_BASE } from "../../utils/apiClient";
import { enqueueAndPollMddJob } from "../../utils/pollMddJob";
import {
  WORKSHOP_PERSIST_BASELINE_FIELDS,
  mergeProjectBaselinesAfterPersist,
} from "../../utils/persist-field-guard";
import {
  extractWorkshopDocumentTimestamps,
  workshopDocumentBodiesEqual,
  workshopMddEditorBaseline,
} from "../../utils/workshop-document-content.util";
import { parseErrorMessageFromResponse } from "../../utils/httpError";
import { mddJobProgressEventFields } from "../../utils/agentProgress";
import {
  isSsotPatternsNotice,
  SSOT_PATTERNS_RESTORED_NOTICE,
} from "../../utils/workshopSyncStatus";
import { patchAgentProgressFromMddEvent } from "./helpers/agent-progress-patch";
import {
  applyMddEditorBaselineToWorkshop,
  applyMddFromFetchedProject,
  enqueueMddPersist,
  mddContentForEditor,
  normalizedMddForPersistCompare,
  selectRawMddFromStage,
} from "./helpers/mdd-editor";
import { projectWithUxAfterStream } from "./helpers/stage-focus";
import { errorStateFromCaught, friendlyFetchError } from "./helpers/store-errors";
import { selectPersistedMddBaseline } from "./selectors";
import type { Project } from "./types";
import type { WorkshopState } from "./workshop-state.types";

type MddSliceActions = Pick<
  WorkshopState,
  | "setMddContent"
  | "updateMddContent"
  | "generateMddFromBenchmark"
  | "generateMddUpstreamSync"
  | "clearMddJustGeneratedFromBenchmark"
  | "persistMddContent"
  | "revertMddContent"
  | "clearMddContentCompletely"
  | "persistAndReviewMdd"
  | "reapplyMddFormat"
>;

export const createMddSlice: StateCreator<WorkshopState, [], [], MddSliceActions> = (set, get) => ({
  setMddContent: (content) => set({ mddContent: mddContentForEditor(content) }),
  updateMddContent: (content) => set({ mddContent: mddContentForEditor(content) }),
  generateMddFromBenchmark: async (projectId) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    const dbgaContent = (get().dbgaContent ?? get().project?.dbgaContent ?? get().project?.phase0SummaryContent ?? "").trim();
    const benchStage = get().activeStageId;
    set({ loading: true, loadingReason: "mdd", error: null, agentProgress: [] });
    void get().fetchGenerationStatus(pid);

    try {
      await enqueueAndPollMddJob(
        {
          mode: "pipeline",
          projectId: pid,
          dbgaContent: dbgaContent || undefined,
          forceFullPipeline: true,
          mddContent: (get().mddContent ?? "").trim() || undefined,
          ...(benchStage ? { stageId: benchStage } : {}),
        },
        pid,
        {
          onProgress: (p) => {
            patchAgentProgressFromMddEvent(set, p);
            const ev = mddJobProgressEventFields(p);
            if (ev.phase === "persisted" || ev.phase === "draft") {
              void get().fetchProject(pid, { preferServerMdd: true });
            }
          },
          onEnqueued: () => {
            void get().fetchGenerationStatus(pid);
          },
        },
      );
      set({ mddJustGeneratedFromBenchmark: true, error: null });
      const data = await get().fetchProject(pid, { preferServerMdd: true });
      applyMddFromFetchedProject(get, set, data ?? get().project);
      await get().fetchEstimation(pid);
      await get().fetchGenerationStatus(pid);
      await get().fetchConformance(pid).catch(() => {});
      set({ loading: false, loadingReason: null, agentProgress: [] });
      return data ?? get().project;
    } catch (e) {
      const status = await get().fetchGenerationStatus(pid);
      const stillRunning = Boolean(status?.busy || status?.mddStreamActive);
      const friendly = friendlyFetchError(e);
      if (stillRunning) {
        set({
          notice:
            `${friendly} La regeneración puede seguir en el servidor; recarga el proyecto en unos minutos para ver el MDD.`,
          error: null,
          loading: true,
          loadingReason: "mdd",
        });
      } else {
        set({
          ...errorStateFromCaught(e),
          loading: false,
          loadingReason: null,
          agentProgress: [],
        });
        const recovered = await get().fetchProject(pid, { preferServerMdd: true });
        applyMddFromFetchedProject(get, set, recovered ?? get().project);
      }
      void get().fetchGenerationStatus(pid);
      return null;
    }
  },

  generateMddUpstreamSync: async (projectId, opts) => {
    if (!projectId?.trim()) return null;
    const pid = projectId.trim();
    const stageId = opts?.stageId ?? get().activeStageId ?? undefined;
    const dbgaContent = (get().dbgaContent ?? get().project?.dbgaContent ?? "").trim();
    const syncMeta = get().generationStatus?.mddUpstreamSync;
    const changeSummary =
      syncMeta?.changes?.length && syncMeta.recommendedSections
        ? buildUpstreamChangeSummaryForPipeline({
            hasBaseline: syncMeta.hasBaseline ?? false,
            hasMdd: true,
            baselineCapturedAt: null,
            changedSources: syncMeta.changedSources ?? [],
            changes: syncMeta.changes,
            recommendedSections: syncMeta.recommendedSections,
            expandedSections: syncMeta.expandedSections ?? opts?.sections ?? [],
            canSync: syncMeta.canSync ?? true,
            needsFullRegen: false,
            pendingSync: syncMeta.pendingSync ?? true,
          })
        : undefined;

    set({ loading: true, loadingReason: "mdd", error: null, agentProgress: [] });
    void get().fetchGenerationStatus(pid, stageId);

    try {
      await enqueueAndPollMddJob(
        {
          mode: "upstream-sync",
          projectId: pid,
          dbgaContent: dbgaContent || undefined,
          mddContent: (get().mddContent ?? "").trim() || undefined,
          ...(stageId ? { stageId } : {}),
          ...(opts?.sections?.length ? { upstreamSections: opts.sections } : {}),
          ...(changeSummary ? { upstreamChangeSummary: changeSummary } : {}),
        },
        pid,
        {
          onProgress: (p) => {
            patchAgentProgressFromMddEvent(set, p);
            const ev = mddJobProgressEventFields(p);
            if (ev.phase === "persisted" || ev.phase === "draft") {
              void get().fetchProject(pid, { preferServerMdd: true });
            }
          },
          onEnqueued: () => {
            void get().fetchGenerationStatus(pid, stageId);
          },
        },
      );
      set({ error: null });
      const data = await get().fetchProject(pid, { preferServerMdd: true });
      applyMddFromFetchedProject(get, set, data ?? get().project);
      await get().fetchEstimation(pid);
      await get().fetchGenerationStatus(pid, stageId);
      set({ loading: false, loadingReason: null, agentProgress: [] });
      return data ?? get().project;
    } catch (e) {
      const status = await get().fetchGenerationStatus(pid, stageId);
      const stillRunning = Boolean(status?.busy || status?.mddStreamActive);
      const friendly = friendlyFetchError(e);
      if (stillRunning) {
        set({
          notice:
            `${friendly} La sincronización puede seguir en el servidor; recarga el proyecto en unos minutos.`,
          error: null,
          loading: true,
          loadingReason: "mdd",
        });
      } else {
        set({
          ...errorStateFromCaught(e),
          loading: false,
          loadingReason: null,
          agentProgress: [],
        });
        const recovered = await get().fetchProject(pid, { preferServerMdd: true });
        applyMddFromFetchedProject(get, set, recovered ?? get().project);
      }
      void get().fetchGenerationStatus(pid);
      return null;
    }
  },

  clearMddJustGeneratedFromBenchmark: () => set({ mddJustGeneratedFromBenchmark: false }),
  persistMddContent: async (content, options) => {
    const state = get();
    if (!state.projectId || !state.project) return;

    const baseline = selectPersistedMddBaseline(state);
    if (!options?.force && workshopDocumentBodiesEqual(content, baseline)) {
      const normalized = normalizedMddForPersistCompare(content);
      set({ synced: true, mddContent: normalized, mddPersistedBaseline: normalized });
      return;
    }

    const rawPrevious = selectRawMddFromStage(state);
    const allowGovernancePatternChange =
      options?.allowGovernancePatternChange === true ||
      shouldAllowGovernancePatternChangeOnPersist(content, rawPrevious) ||
      selectedPatternIdsFromMdd(content).size > 0;

    set({
      mddPersisting: true,
      synced: false,
      error: null,
      notice: null,
      ...(allowGovernancePatternChange
        ? { mddContent: mddContentForEditor(content) }
        : {}),
    });

    return enqueueMddPersist(async () => {
      const { projectId, project, fetchEstimation } = get();
      if (!projectId || !project) return;

      try {
        const stageId = get().activeStageId;
        const r = await apiFetch(`${API_BASE}/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mddContent: content,
            ...(stageId ? { stageId } : {}),
            ...(allowGovernancePatternChange ? { allowGovernancePatternChange: true } : {}),
            ...(options?.mddGovernanceSeedOnly ? { mddGovernanceSeedOnly: true } : {}),
            ...(options?.mddFormatOnly ? { mddFormatOnly: true } : {}),
            ...(options?.clearMddCompletely ? { clearMddCompletely: true } : {}),
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as Project & { mddGovernancePatternsReverted?: boolean };
          const packed = projectWithUxAfterStream(data, data.uxUiGuideContent, get().activeStageId);
          let savedContent = packed?.mddContent ?? data.mddContent ?? content;
          const patternsReverted = data.mddGovernancePatternsReverted === true;
          const sentPatternCount = selectedPatternIdsFromMdd(content).size;
          if (
            sentPatternCount > 0 &&
            (patternsReverted || serverWouldDropGovernancePatterns(content, savedContent)) &&
            selectedPatternIdsFromMdd(savedContent).size === 0
          ) {
            savedContent = content;
          }
          const nextProjectRaw = packed?.project ?? data;
          const stateNow = get();
          const localFields = Object.fromEntries(
            WORKSHOP_PERSIST_BASELINE_FIELDS.map((f) => [
              f,
              (stateNow as unknown as Record<string, unknown>)[f] as string | null | undefined,
            ]),
          );
          const nextProject = mergeProjectBaselinesAfterPersist(
            nextProjectRaw as unknown as Record<string, unknown>,
            {
              savedField: "mddContent",
              prevProject: project as unknown as Record<string, unknown>,
              activeStageId: stageId,
              localFields,
            },
          ) as unknown as Project;
          const editorBaseline = workshopMddEditorBaseline(savedContent);
          const nextTimestamps = extractWorkshopDocumentTimestamps(savedContent);
          const aligned = applyMddEditorBaselineToWorkshop(
            nextProject as Project,
            get().workshopStages,
            stageId,
            editorBaseline,
          );
          set({
            project: aligned.project,
            workshopStages: aligned.workshopStages,
            activeStageId: packed?.activeStageId ?? get().activeStageId,
            mddContent: aligned.mddContent,
            mddPersistedBaseline: aligned.mddPersistedBaseline,
            ...(nextTimestamps
              ? {
                  documentTimestamps: {
                    ...get().documentTimestamps,
                    mddContent: nextTimestamps,
                  },
                }
              : {}),
            synced: true,
            error: null,
            notice: patternsReverted ? SSOT_PATTERNS_RESTORED_NOTICE : null,
          });
          await apiFetch(`${API_BASE}/ai-analysis/estimation/clear-draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: projectId.trim(),
              ...(stageId ? { stageId } : {}),
            }),
          }).catch(() => { });
          fetchEstimation(projectId).catch(() => { });
        } else {
          const errText = await parseErrorMessageFromResponse(r, "Error al guardar el MDD");
          set({ synced: false, error: errText });
        }
      } catch {
        set({ synced: false, error: "Error de red al guardar" });
      } finally {
        set({ mddPersisting: false });
      }
    });
  },

  revertMddContent: () => {
    set({ mddContent: get().mddPersistedBaseline });
  },

  clearMddContentCompletely: async (projectId) => {
    const pid = projectId?.trim();
    if (!pid) return false;
    const stageId = get().activeStageId;
    try {
      const r = await apiFetch(`${API_BASE}/projects/${pid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mddContent: "",
          ...(stageId ? { stageId } : {}),
          clearMddCompletely: true,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        set({
          error: (err as { message?: string }).message ?? "No se pudo limpiar el MDD",
        });
        return false;
      }
      const data = (await r.json()) as Project;
      const packed = projectWithUxAfterStream(data, data.uxUiGuideContent, get().activeStageId);
      const nextProject = packed?.project ?? data;
      set({
        project: nextProject,
        workshopStages: nextProject.stages ?? get().workshopStages,
        mddContent: "",
        mddPersistedBaseline: "",
        managerThreadId: null,
        synced: true,
        error: null,
        mddJustGeneratedFromBenchmark: false,
      });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Error al limpiar el MDD" });
      return false;
    }
  },

  /** Persiste el MDD y refresca estimación/semáforo. No reemplaza el contenido por la respuesta del review
   *  para que las ediciones manuales del usuario se respeten. */
  persistAndReviewMdd: async () => {
    const { projectId, project, mddContent, persistMddContent, fetchEstimation } = get();
    if (!projectId?.trim() || !project) return;
    const content = (mddContent ?? "").trim();
    const baseline = selectPersistedMddBaseline(get());
    if (workshopDocumentBodiesEqual(content, baseline)) return;
    set({ mddReviewing: true });
    try {
      const rawPrevious = selectRawMddFromStage(get()) || baseline;
      const allowPatternPersist =
        selectedPatternIdsFromMdd(content).size > 0 ||
        shouldAllowGovernancePatternChangeOnPersist(content, rawPrevious) ||
        governancePatternSelectionDiffers(content, baseline);
      await persistMddContent(content, {
        force: true,
        ...(allowPatternPersist ? { allowGovernancePatternChange: true } : {}),
      });
      const stateAfterPersist = get();
      if (stateAfterPersist.error && !isSsotPatternsNotice(stateAfterPersist.error)) return;
      const saved = selectPersistedMddBaseline(get()) || content;
      await apiFetch(`${API_BASE}/ai-analysis/mdd/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId.trim(), mddContent: saved }),
      });
      fetchEstimation(projectId).catch(() => { });
    } finally {
      set({ mddReviewing: false });
    }
  },

  reapplyMddFormat: async () => {
    const { projectId, project, mddContent, persistMddContent } = get();
    if (!projectId?.trim() || !project) return;
    const content = (mddContent ?? project.mddContent ?? "").trim();
    if (!content) return;
    const before = selectPersistedMddBaseline(get()) || content;
    const hadCorruption = mddMarkdownHasKnownFormatCorruption(content);
    set({ mddReapplyingFormat: true, error: null, notice: null });
    try {
      await persistMddContent(content, { force: true, mddFormatOnly: true });
      const after = selectPersistedMddBaseline(get());
      const stillCorrupt = mddMarkdownHasKnownFormatCorruption(after);
      set({
        notice:
          stillCorrupt
            ? "MDD: se aplicó formato pero aún hay bloques §4 o secciones por revisar manualmente."
            : after.trim() !== before.trim() || hadCorruption
              ? "MDD reformateado: se aplicaron correcciones deterministas (headings, JSON §4, SQL, coherencia)."
              : "MDD revisado: la pasada de formato no detectó cambios adicionales.",
      });
    } finally {
      set({ mddReapplyingFormat: false });
    }
  },
});
