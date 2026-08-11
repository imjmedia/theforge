import type { StateCreator } from "zustand";
import {
  buildUpstreamChangeSummaryForPipeline,
  mddMarkdownHasKnownFormatCorruption,
  type MddUpstreamSyncStatus,
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
import {
  buildMddSection5PipelineRegenNotice,
  mddHasSection5Heading,
} from "../../utils/mddSectionRegen";
import { patchAgentProgressFromMddEvent } from "./helpers/agent-progress-patch";
import { mergeGenerationStatusWithMddUpstreamSync } from "./helpers/generation-status";
import {
  applyMddEditorBaselineToWorkshop,
  applyMddFromFetchedProject,
  enqueueMddPersist,
  mddContentForEditor,
  normalizedMddForPersistCompare,
  selectRawMddFromStage,
} from "./helpers/mdd-editor";
import { projectWithUxAfterStream, effectiveMddContentForSectionRegen } from "./helpers/stage-focus";
import { errorStateFromCaught, friendlyFetchError, streamErrorPatch } from "./helpers/store-errors";
import { shouldApplyWorkshopUpdate } from "./helpers/workshop-scope";
import {
  generationStatusWithoutSddGraph,
  resetWorkshopSemaphoreSnapshot,
} from "./helpers/semaphore-snapshot";
import { selectPersistedMddBaseline } from "./selectors";
import type { Project } from "./types";
import type { WorkshopState } from "./workshop-state.types";

type MddSliceActions = Pick<
  WorkshopState,
  | "setMddContent"
  | "updateMddContent"
  | "generateMddFromBenchmark"
  | "generateMddUpstreamSync"
  | "acceptMddUpstreamBaseline"
  | "clearMddJustGeneratedFromBenchmark"
  | "persistMddContent"
  | "revertMddContent"
  | "clearMddContentCompletely"
  | "persistAndReviewMdd"
  | "reapplyMddFormat"
  | "regenerateMddSection5Pipeline"
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
        // fetchProject siempre pone error:null — reponer el fallo del job.
        set({ ...errorStateFromCaught(e), loading: false, loadingReason: null });
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
        // fetchProject siempre pone error:null — reponer el fallo del job.
        set({ ...errorStateFromCaught(e), loading: false, loadingReason: null });
      }
      void get().fetchGenerationStatus(pid);
      return null;
    }
  },

  acceptMddUpstreamBaseline: async (projectId, opts) => {
    if (!projectId?.trim()) return false;
    const pid = projectId.trim();
    const stageId = opts?.stageId ?? get().activeStageId ?? undefined;
    const qs = new URLSearchParams({ projectId: pid });
    if (stageId?.trim()) qs.set("stageId", stageId.trim());
    try {
      const res = await apiFetch(`${API_BASE}/ai-analysis/mdd/upstream-sync/accept-baseline?${qs}`, {
        method: "POST",
      });
      if (!res.ok) {
        const msg = await parseErrorMessageFromResponse(
          res,
          "No se pudo marcar el MDD como sincronizado.",
        );
        set({ error: msg });
        return false;
      }
      const body = (await res.json()) as {
        syncStatus?: MddUpstreamSyncStatus;
        pendingSync?: boolean;
      };
      if (body.syncStatus) {
        set((s) => ({
          error: null,
          generationStatus: mergeGenerationStatusWithMddUpstreamSync(s.generationStatus, body.syncStatus!),
        }));
      }
      await get().fetchGenerationStatus(pid, stageId);
      return body.pendingSync !== true;
    } catch (e) {
      set({ ...errorStateFromCaught(e) });
      return false;
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
      const status =
        get().generationStatus ??
        (await get().fetchGenerationStatus(pid, stageId, { light: true }));
      const cancellableMddJobs = (status?.mddJobs ?? []).filter(
        (j) => j.status === "active" || j.status === "queued" || j.status === "retrying",
      );
      if (cancellableMddJobs.length > 0) {
        await Promise.all(
          cancellableMddJobs.map((job) =>
            apiFetch(`${API_BASE}/projects/${pid}/mdd-jobs/${encodeURIComponent(job.jobId)}`, {
              method: "DELETE",
            }).catch(() => undefined),
          ),
        );
      }

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

      const checkpointQs = new URLSearchParams({ projectId: pid });
      if (stageId?.trim()) checkpointQs.set("stageId", stageId.trim());
      await Promise.all([
        apiFetch(`${API_BASE}/ai-analysis/estimation/clear-draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: pid,
            ...(stageId ? { stageId } : {}),
          }),
        }).catch(() => undefined),
        apiFetch(`${API_BASE}/ai-analysis/dbga/checkpoint?${checkpointQs}`, {
          method: "DELETE",
        }).catch(() => undefined),
      ]);

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
        notice: null,
        loading: false,
        loadingReason: null,
        agentProgress: [],
        mddJustGeneratedFromBenchmark: false,
        ...resetWorkshopSemaphoreSnapshot(),
        generationStatus: generationStatusWithoutSddGraph(get().generationStatus),
      });
      void get().fetchEstimation(pid);
      void get().fetchConformance(pid).catch(() => {});
      void get().fetchGenerationStatus(pid, stageId, { light: true }).catch(() => {});
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

  regenerateMddSection5Pipeline: async (projectId, options) => {
    const pid = projectId?.trim();
    if (!pid) return;
    const mddContent = effectiveMddContentForSectionRegen(get);
    if (!mddContent.trim()) {
      set({ error: "Necesitas MDD guardado para regenerar §5." });
      return;
    }
    const regStage = get().activeStageId;
    const gapReasons = options?.gapReasons?.filter((g) => g?.trim()) ?? [];
    set({
      loading: true,
      loadingReason: "mdd-section",
      notice: buildMddSection5PipelineRegenNotice(),
      error: null,
      synced: false,
      agentProgress: [],
    });
    void get().fetchGenerationStatus(pid);
    try {
      const pollResult = await enqueueAndPollMddJob(
        {
          mode: "section-pipeline",
          projectId: pid,
          section: 5,
          mddContent: mddContent || undefined,
          ...(gapReasons.length ? { gapReasons } : {}),
          ...(regStage ? { stageId: regStage } : {}),
        },
        pid,
        {
          onProgress: (p) => {
            patchAgentProgressFromMddEvent(set, p);
          },
          onEnqueued: () => {
            void get().fetchGenerationStatus(pid);
          },
        },
      );
      if (!shouldApplyWorkshopUpdate(get, pid)) return;
      const { fetchProject, fetchEstimation, fetchConformance } = get();
      await fetchProject(pid);
      const merged = selectPersistedMddBaseline(get()) || get().mddContent || "";
      if (merged.trim().length <= 80) {
        set({
          error:
            merged.trim().length > 0
              ? "La regeneración devolvió un documento demasiado corto; §5 no se aplicó al MDD."
              : "La regeneración terminó sin markdown actualizado.",
          loading: false,
          loadingReason: null,
          notice: null,
          agentProgress: [],
          evaluatorCritique: null,
        });
        return;
      }
      if (!mddHasSection5Heading(merged)) {
        set({
          error:
            "El servidor respondió OK pero el MDD no incluye ## 5. Lógica y Edge Cases. Reintenta o usa «Regenerar MDD» completo.",
          loading: false,
          loadingReason: null,
          notice: null,
          agentProgress: [],
          evaluatorCritique: null,
        });
        return;
      }
      await fetchEstimation(pid, merged).catch(() => {});
      fetchConformance(pid).catch(() => {});
      await get().fetchGenerationStatus(pid, regStage ?? undefined);
      const syncFromJob = (pollResult.result as { mddUpstreamSync?: MddUpstreamSyncStatus } | undefined)
        ?.mddUpstreamSync;
      if (syncFromJob) {
        set((s) => ({
          generationStatus: mergeGenerationStatusWithMddUpstreamSync(s.generationStatus, syncFromJob),
        }));
      }
      const editorMerged = mddContentForEditor(merged);
      const stateAfterFetch = get();
      const mddPatch =
        stateAfterFetch.project != null
          ? applyMddEditorBaselineToWorkshop(
              stateAfterFetch.project,
              stateAfterFetch.workshopStages,
              stateAfterFetch.activeStageId,
              editorMerged,
            )
          : {
              mddContent: editorMerged,
              mddPersistedBaseline: editorMerged,
              workshopStages: stateAfterFetch.workshopStages,
              project: stateAfterFetch.project,
            };
      set({
        ...(stateAfterFetch.project != null
          ? { project: mddPatch.project, workshopStages: mddPatch.workshopStages }
          : {}),
        mddContent: mddPatch.mddContent,
        mddPersistedBaseline: mddPatch.mddPersistedBaseline,
        loading: false,
        loadingReason: null,
        notice: null,
        agentProgress: [],
        evaluatorCritique: null,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? friendlyFetchError(e) : "Error al regenerar §5 (pipeline)";
      const code =
        e instanceof Error && "code" in e && typeof (e as { code?: string }).code === "string"
          ? (e as { code?: string }).code
          : undefined;
      set({
        ...streamErrorPatch({ message: msg, code }),
        loading: false,
        loadingReason: null,
        notice: null,
        agentProgress: [],
        evaluatorCritique: null,
      });
    }
  },
});
