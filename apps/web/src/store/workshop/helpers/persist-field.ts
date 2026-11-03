import { documentPersistFieldLabel, validateDocumentForPersist } from "@theforge/shared-types";
import {
  mergeProjectBaselinesAfterPersist,
  shouldApplyPersistedFieldContent,
  WORKSHOP_PERSIST_BASELINE_FIELDS,
} from "../../../utils/persist-field-guard";
import {
  cleanDocForWorkshop as cleanDoc,
  extractWorkshopDocumentTimestamps,
  normalizeWorkshopDocumentForEditor,
  workshopDocumentBodiesEqual,
} from "../../../utils/workshop-document-content.util";
import { API_BASE, addToOfflineQueue, fetchWithRetry, flushOfflineQueue, hashOfflineContent } from "../../../utils/apiClient";
import { parseErrorMessageFromResponse } from "../../../utils/httpError";
import {
  isStageScopedDeliverableField,
  resolveWorkshopStageDeliverables,
} from "../../../utils/workshopStageDeliverables";
import { SSOT_PATTERNS_RESTORED_NOTICE } from "../../../utils/workshopSyncStatus";
import { workshopStateFromProjectStage } from "./stage-focus";
import type { Project } from "../types";
import type { WorkshopState } from "../workshop-state.types";

export type PersistFieldResult = { ok: true } | { ok: false; error: string };

export async function persistField(
  fieldName: string,
  content: string | null,
  getState: () => WorkshopState,
  setState: (partial: Partial<WorkshopState>) => void,
): Promise<PersistFieldResult> {
  const { projectId, project, activeStageId } = getState();
  if (!projectId || !project) return { ok: false, error: "No hay proyecto activo." };
  const stageDeliverables = resolveWorkshopStageDeliverables(
    { ...project, stages: project.stages ?? [] },
    activeStageId,
  );
  const persistedBaseline = isStageScopedDeliverableField(fieldName)
    ? (stageDeliverables[fieldName] ?? "")
    : (((project as unknown as Record<string, unknown>)[fieldName] as string | null | undefined) ?? "");
  if (content === persistedBaseline || workshopDocumentBodiesEqual(content, persistedBaseline)) {
    return { ok: true };
  }

  const cleaned = cleanDoc(content) || content || "";
  const currentRaw = String(persistedBaseline);
  const persistValidation = validateDocumentForPersist(currentRaw, cleaned, {
    fieldLabel: documentPersistFieldLabel(fieldName),
  });
  if (!persistValidation.ok) {
    setState({ synced: true, error: persistValidation.message });
    return { ok: false, error: persistValidation.message };
  }
  const localAtSaveStart = String(
    ((getState() as unknown as Record<string, unknown>)[fieldName] as string | null | undefined) ??
      "",
  );
  setState({ synced: false, error: null, notice: null });

  const stageIdForPatch =
    fieldName === "mddContent" || isStageScopedDeliverableField(fieldName)
      ? activeStageId ?? undefined
      : undefined;

  try {
    const r = await fetchWithRetry(`${API_BASE}/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [fieldName]: cleaned,
        ...(stageIdForPatch ? { stageId: stageIdForPatch } : {}),
      }),
    });
    if (r.ok) {
      const data = (await r.json()) as Project & { mddGovernancePatternsReverted?: boolean };
      const stages = data.stages ?? project.stages ?? [];
      let mergedProject: Project = { ...data, stages };
      if (stageIdForPatch && (isStageScopedDeliverableField(fieldName) || fieldName === "mddContent")) {
        mergedProject = {
          ...mergedProject,
          stages: stages.map((s) =>
            s.id === stageIdForPatch ? { ...s, [fieldName]: cleaned } : s,
          ),
        };
      }
      const focused = workshopStateFromProjectStage(mergedProject, activeStageId);
      const serverRaw =
        fieldName === "mddContent"
          ? ((focused.project.mddContent as string | undefined) ?? cleaned)
          : isStageScopedDeliverableField(fieldName)
            ? (focused[fieldName] ?? cleaned)
            : ((data[fieldName as keyof Project] as string | undefined) ?? cleaned);
      const serverCleaned =
        normalizeWorkshopDocumentForEditor(serverRaw) ?? cleanDoc(serverRaw) ?? serverRaw ?? "";
      const patternsReverted =
        fieldName === "mddContent" && data.mddGovernancePatternsReverted === true;
      const localNow = String(
        ((getState() as unknown as Record<string, unknown>)[fieldName] as string | null | undefined) ??
          "",
      );
      const stateNow = getState();
      const localFields = Object.fromEntries(
        WORKSHOP_PERSIST_BASELINE_FIELDS.map((f) => [
          f,
          (stateNow as unknown as Record<string, unknown>)[f] as string | null | undefined,
        ]),
      );
      const alignedProject = mergeProjectBaselinesAfterPersist(
        focused.project as unknown as Record<string, unknown>,
        {
          savedField: fieldName,
          prevProject: project as unknown as Record<string, unknown>,
          activeStageId,
          localFields,
        },
      ) as unknown as Project;
      const editorBaseline = serverCleaned;
      (alignedProject as unknown as Record<string, unknown>)[fieldName] = editorBaseline;
      if (fieldName === "mddContent" && activeStageId && alignedProject.stages?.length) {
        alignedProject.stages = alignedProject.stages.map((s) =>
          s.id === activeStageId ? { ...s, mddContent: editorBaseline } : s,
        );
      } else if (isStageScopedDeliverableField(fieldName) && activeStageId && alignedProject.stages?.length) {
        alignedProject.stages = alignedProject.stages.map((s) =>
          s.id === activeStageId ? { ...s, [fieldName]: editorBaseline } : s,
        );
      }
      const patch: Partial<WorkshopState> = {
        project: alignedProject,
        synced: true,
        error: null,
        notice: patternsReverted ? SSOT_PATTERNS_RESTORED_NOTICE : null,
      };
      const fieldTimestamps = extractWorkshopDocumentTimestamps(serverRaw);
      if (fieldTimestamps) {
        patch.documentTimestamps = {
          ...getState().documentTimestamps,
          [fieldName]: fieldTimestamps,
        };
      }
      if (shouldApplyPersistedFieldContent(localNow, localAtSaveStart, cleaned) || patternsReverted) {
        (patch as Record<string, unknown>)[fieldName] = serverCleaned;
      }
      if (fieldName === "mddContent" && alignedProject.stages?.length) {
        patch.workshopStages = alignedProject.stages;
      }
      if (
        fieldName === "mddContent" &&
        (shouldApplyPersistedFieldContent(localNow, localAtSaveStart, cleaned) || patternsReverted)
      ) {
        patch.mddPersistedBaseline = serverCleaned;
      }
      setState(patch);
      // Flush offline queue oportunistically
      flushOfflineQueue().catch(() => {});
      if (fieldName === "dbgaContent" || fieldName === "phase0SummaryContent") {
        void getState().fetchGenerationStatus(projectId);
      }
      return { ok: true };
    }

    const errText = await parseErrorMessageFromResponse(r, "Error al guardar");
    if (r.status >= 400 && r.status < 500) {
      setState({ synced: true, error: `Error: ${errText}` });
      return { ok: false, error: errText };
    }
    addToOfflineQueue({
      field: fieldName,
      content: cleaned,
      projectId,
      stageId: stageIdForPatch ?? null,
      timestamp: Date.now(),
      contentHash: hashOfflineContent(cleaned),
    });
    setState({ synced: true, error: `Error: ${errText}. Cambio guardado localmente.` });
    return { ok: false, error: errText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addToOfflineQueue({
      field: fieldName,
      content: cleaned,
      projectId,
      stageId: stageIdForPatch ?? null,
      timestamp: Date.now(),
      contentHash: hashOfflineContent(cleaned),
    });
    setState({ synced: true, error: `Sin conexión: ${msg}. Cambio guardado localmente.` });
    return { ok: false, error: msg };
  }
}
