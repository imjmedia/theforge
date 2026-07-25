/**
 * @fileoverview Store Zustand principal del Workshop. Compone slices: UI, project, MDD, deliverables, chat, clarify, legacy-debug.
 * Cada slice gestiona su propio estado y acciones; el store combina todos en {@link WorkshopState}.
 */
import { create } from "zustand";

import { workshopInitialState } from "./workshop/initial-state";
import type { WorkshopState } from "./workshop/workshop-state.types";
import { createUiSlice } from "./workshop/slice-ui";
import { createProjectSlice } from "./workshop/slice-project";
import { createSessionChatSlice } from "./workshop/slice-session-chat";
import { createMddSlice } from "./workshop/slice-mdd";
import { createDeliverablesSlice } from "./workshop/slice-deliverables";
import { createLegacyDebugSlice } from "./workshop/slice-legacy-debug";
import { createClarifySlice } from "./workshop/slice-clarify";

export {
  isMddEditorDirty,
  selectPersistedMddBaseline,
  selectWorkshopAgentsBusy,
} from "./workshop/selectors";
export { sessionMessageBody } from "./workshop/helpers/session-message";
export type {
  Status,
  ChatMessage,
  Estimation,
  LiveMetricsResult,
  PrecisionBreakdown,
  DocumentCompleteness,
  CrossDocumentGap,
  ConformanceResult,
  ApiConformanceResult,
  LegacyDeliverablesDebugStep,
  LegacySectionMergeTraceGroup,
  LegacySectionMergeTrace,
  LogicFlowsSection5CoverageReport,
  LegacyDeliverablesDebugReport,
  LegacyFlowState,
  WorkshopStage,
  ComplexityPending,
  Project,
  LegacyMcpDebugEntry,
  Session,
} from "./workshop/types";

export const useWorkshopStore = create<WorkshopState>((set, get, api) => ({
  ...workshopInitialState,
  ...createUiSlice(set, get, api),
  ...createProjectSlice(set, get, api),
  ...createSessionChatSlice(set, get, api),
  ...createMddSlice(set, get, api),
  ...createDeliverablesSlice(set, get, api),
  ...createLegacyDebugSlice(set, get, api),
  ...createClarifySlice(set, get, api),
}));
