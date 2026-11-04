import type { StateCreator } from "zustand";
import type {
  CompileDesignContractBody,
  DesignReadResponse,
  DesignSpec,
  PutDesignDataNeedsBody,
  PutDesignScreensBody,
} from "@theforge/shared-types";
import {
  acceptDesignProposal,
  DesignFirstApiError,
  fetchDesignState,
  importDesignFigma,
  importDesignImages,
  compileDesignContract,
  proposeDesignDataNeeds,
  putDesignDataNeeds,
  putDesignScreens,
  rejectDesignProposal,
  type DesignProposalResponse,
} from "@/lib/design-first-api";
import { formatDesignApiError } from "@/views/workshop/design/design-panels.util";
import type { WorkshopState } from "./workshop-state.types";
import type { DesignWorkshopSliceState } from "./types";

export const DESIGN_REVISION_CONFLICT_NOTICE =
  "Otro cambio actualizó el diseño; recargamos la versión del servidor. Revisa y vuelve a guardar.";

export function applyDesignReadToPatch(read: DesignReadResponse): Partial<DesignWorkshopSliceState> {
  return {
    designSpec: read.designSpec,
    designRevision: read.revision,
    designGates: read.gates,
    designStale: read.stale,
    designRevisionConflictNotice: null,
    designPanelError: null,
  };
}

export function designApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DesignFirstApiError) {
    return formatDesignApiError(err.code, err.message, err.issues);
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

type DesignSliceActions = Pick<
  WorkshopState,
  | "fetchDesign"
  | "resetDesignState"
  | "clearDesignPanelError"
  | "clearDesignRevisionConflictNotice"
  | "saveDesignScreens"
  | "saveDesignDataNeeds"
  | "compileDesignContractAction"
  | "proposeDesignDataNeedsAction"
  | "importDesignImagesAction"
  | "importDesignFigmaAction"
  | "acceptDesignProposalAction"
  | "rejectDesignProposalAction"
  | "setPendingDesignProposal"
>;

async function reloadOnRevisionConflict(
  projectId: string,
  get: () => WorkshopState,
  set: (patch: Partial<WorkshopState>) => void,
): Promise<void> {
  try {
    const read = await fetchDesignState(projectId);
    if (get().projectId !== projectId) return;
    set({
      ...applyDesignReadToPatch(read),
      designRevisionConflictNotice: DESIGN_REVISION_CONFLICT_NOTICE,
      notice: DESIGN_REVISION_CONFLICT_NOTICE,
    });
  } catch {
    set({
      designRevisionConflictNotice: DESIGN_REVISION_CONFLICT_NOTICE,
      notice: DESIGN_REVISION_CONFLICT_NOTICE,
    });
  }
}

export const createDesignSlice: StateCreator<WorkshopState, [], [], DesignSliceActions> = (
  set,
  get,
) => ({
  fetchDesign: async (projectId) => {
    const id = projectId.trim();
    if (!id) return null;
    set({ designLoading: true, designError: null });
    try {
      const read = await fetchDesignState(id);
      if (get().projectId !== id && get().project?.id !== id) return read;
      set({ ...applyDesignReadToPatch(read), designLoading: false });
      return read;
    } catch (err) {
      const message = designApiErrorMessage(err, "No se pudo cargar el diseño");
      set({ designLoading: false, designError: message, designPanelError: message });
      return null;
    }
  },

  resetDesignState: () =>
    set({
      designLoading: false,
      designSaving: false,
      designError: null,
      designPanelError: null,
      designSpec: null,
      designRevision: null,
      designGates: null,
      designStale: false,
      pendingDesignProposal: null,
      designRevisionConflictNotice: null,
    }),

  clearDesignPanelError: () => set({ designPanelError: null }),
  clearDesignRevisionConflictNotice: () => set({ designRevisionConflictNotice: null }),

  setPendingDesignProposal: (proposal: DesignProposalResponse | null) =>
    set({ pendingDesignProposal: proposal }),

  saveDesignScreens: async (projectId, body: PutDesignScreensBody) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const read = await putDesignScreens(projectId, body);
      set({ ...applyDesignReadToPatch(read), designSaving: false });
      return read;
    } catch (err) {
      if (err instanceof DesignFirstApiError && err.code === "ERR_DESIGN_REVISION_CONFLICT") {
        await reloadOnRevisionConflict(projectId, get, set);
        set({ designSaving: false });
        return null;
      }
      const message = designApiErrorMessage(err, "No se pudieron guardar las pantallas");
      set({ designSaving: false, designPanelError: message, error: message });
      return null;
    }
  },

  saveDesignDataNeeds: async (projectId, body: PutDesignDataNeedsBody) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const read = await putDesignDataNeeds(projectId, body);
      set({ ...applyDesignReadToPatch(read), designSaving: false });
      return read;
    } catch (err) {
      if (err instanceof DesignFirstApiError && err.code === "ERR_DESIGN_REVISION_CONFLICT") {
        await reloadOnRevisionConflict(projectId, get, set);
        set({ designSaving: false });
        return null;
      }
      const message = designApiErrorMessage(err, "No se pudieron guardar los datos");
      set({ designSaving: false, designPanelError: message, error: message });
      return null;
    }
  },

  compileDesignContractAction: async (projectId, body: CompileDesignContractBody) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const read = await compileDesignContract(projectId, body);
      set({ ...applyDesignReadToPatch(read), designSaving: false, notice: "Contrato compilado correctamente." });
      return read;
    } catch (err) {
      if (err instanceof DesignFirstApiError && err.code === "ERR_DESIGN_REVISION_CONFLICT") {
        await reloadOnRevisionConflict(projectId, get, set);
        set({ designSaving: false });
        return null;
      }
      const message = designApiErrorMessage(err, "No se pudo compilar el contrato");
      set({ designSaving: false, designPanelError: message, error: message });
      return null;
    }
  },

  proposeDesignDataNeedsAction: async (projectId) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const proposal = await proposeDesignDataNeeds(projectId);
      set({ pendingDesignProposal: proposal, designSaving: false });
      return proposal;
    } catch (err) {
      const message = designApiErrorMessage(err, "No se pudo proponer necesidades de datos");
      set({ designSaving: false, designPanelError: message });
      return null;
    }
  },

  importDesignImagesAction: async (projectId, body) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const proposal = await importDesignImages(projectId, body);
      set({ pendingDesignProposal: proposal, designSaving: false });
      return proposal;
    } catch (err) {
      const message = designApiErrorMessage(err, "No se pudieron importar las imágenes");
      set({ designSaving: false, designPanelError: message });
      return null;
    }
  },

  importDesignFigmaAction: async (projectId, body) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const proposal = await importDesignFigma(projectId, body);
      set({ pendingDesignProposal: proposal, designSaving: false });
      return proposal;
    } catch (err) {
      const message = designApiErrorMessage(err, "No se pudo importar desde Figma");
      set({ designSaving: false, designPanelError: message });
      return null;
    }
  },

  acceptDesignProposalAction: async (projectId, proposalId, revision) => {
    set({ designSaving: true, designPanelError: null });
    try {
      const read = await acceptDesignProposal(projectId, proposalId, revision);
      set({
        ...applyDesignReadToPatch(read),
        pendingDesignProposal: null,
        designSaving: false,
        notice: "Propuesta aplicada.",
      });
      return read;
    } catch (err) {
      if (err instanceof DesignFirstApiError && err.code === "ERR_DESIGN_REVISION_CONFLICT") {
        await reloadOnRevisionConflict(projectId, get, set);
        set({ designSaving: false, pendingDesignProposal: null });
        return null;
      }
      const message = designApiErrorMessage(err, "No se pudo aceptar la propuesta");
      set({ designSaving: false, designPanelError: message });
      return null;
    }
  },

  rejectDesignProposalAction: async (projectId, proposalId) => {
    set({ designSaving: true });
    try {
      await rejectDesignProposal(projectId, proposalId);
      set({ pendingDesignProposal: null, designSaving: false });
      return true;
    } catch (err) {
      const message = designApiErrorMessage(err, "No se pudo rechazar la propuesta");
      set({ designSaving: false, designPanelError: message });
      return false;
    }
  },
});

export type { DesignSpec };
