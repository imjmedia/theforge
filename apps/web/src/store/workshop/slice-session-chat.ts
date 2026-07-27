import type { StateCreator } from "zustand";
import type {
  MddDeliveryGateResult,
  MddUpstreamSyncStatus,
} from "@theforge/shared-types";
import {
  mddMarkdownHasKnownFormatCorruption,
  mddMarkdownNeedsStructuralRepair,
} from "@theforge/shared-types";
import {
  isChangelogOnlyDocument,
  validateDocumentForPersist,
} from "@theforge/shared-types";
import { contentIncludesVisionBlock } from "@theforge/shared-types/session";
import {
  formatDbgaDocument,
  formatDocumentMarkdown,
} from "@theforge/shared-types/format-document-markdown";
import { apiFetch, API_BASE, fetchWithRetry, flushOfflineQueue, getOfflineQueue } from "../../utils/apiClient";
import { enqueueAndPollMddJob } from "../../utils/pollMddJob";
import {
  cleanDocForWorkshop as cleanDoc,
  normalizeWorkshopDocumentForEditor,
} from "../../utils/workshop-document-content.util";
import { parseApiErrorPayloadFromResponse } from "../../utils/httpError";
import { parseNdjsonLine } from "../../utils/ndjson";
import {
  mddHasSection5Heading,
  mddHasSection6Heading,
  buildMddSectionRegenNotice,
} from "../../utils/mddSectionRegen";
import { mergeAgentProgressFromMddEvent } from "../../utils/agentProgress";
import {
  buildPlanApprovalChatContents,
  isPlanApprovalResumeMessage,
} from "../../utils/planApprovalChat";
import {
  orchestratorDocSnapshot,
  resolveOrchestratorDocUnchangedError,
} from "../../utils/orchestratorDocGuard";
import { isFormatDocumentChatCommand } from "../../utils/documentFormatCommand";
import { isWorkshopConnectionError } from "../../utils/workshopSyncStatus";
import {
  appendWorkshopChatPair,
  applyAssistedMarkdownToState,
  countWorkshopTabMessages,
  ensureWorkshopChatSession,
  postPhase0AssistedAnswer,
} from "./helpers/phase0-assisted";
import { pickDefaultStageId } from "./helpers/pick-default-stage";
import { patchAgentProgressFromMddEvent } from "./helpers/agent-progress-patch";
import { persistField } from "./helpers/persist-field";
import {
  deliveryGateFromStreamEvent,
} from "./helpers/delivery-gate";
import { mergeGenerationStatusWithMddUpstreamSync } from "./helpers/generation-status";
import {
  applyMddEditorBaselineToWorkshop,
  mddContentForEditor,
  normalizedMddForPersistCompare,
  persistMddFromChatStream,
  selectRawMddFromStage,
  streamMarkdownPreservesGovernancePatterns,
} from "./helpers/mdd-editor";
import {
  effectiveMddContentForSectionRegen,
  legacyCodebaseDocFromStages,
  projectWithUxAfterStream,
  workshopFlatFromStage,
  workshopStateFromProjectStage,
} from "./helpers/stage-focus";
import {
  filterWorkshopSessionMessages,
  lastMddUserMessageContent,
  pickEvaluatorCritique,
  sessionMessageBody,
} from "./helpers/session-message";
import {
  errorStateFromCaught,
  friendlyFetchError,
  streamErrorPatch,
  throwStreamHttpError,
} from "./helpers/store-errors";
import { shouldApplyWorkshopUpdate } from "./helpers/workshop-scope";
import { selectPersistedMddBaseline } from "./selectors";
import type { PrecisionBreakdown, Project, Session } from "./types";
import type { WorkshopState } from "./workshop-state.types";

type SessionChatSliceActions = Pick<
  WorkshopState,
  | "setSession"
  | "retryWorkshopSync"
  | "fetchWelcome"
  | "clearChat"
  | "formatDocumentForActiveTab"
  | "sendMessage"
>;

export const createSessionChatSlice: StateCreator<WorkshopState, [], [], SessionChatSliceActions> = (
  set,
  get,
) => ({
  setSession: (s) => set({ session: s }),
  retryWorkshopSync: async () => {
    const { projectId, error } = get();
    const pid = projectId?.trim();
    if (!pid) return;
    const hadConnectionError = isWorkshopConnectionError(error);
    if (hadConnectionError) set({ error: null, synced: false });
    try {
      await flushOfflineQueue();
      const r = await fetchWithRetry(`${API_BASE}/projects/${pid}`, undefined, 1);
      if (r.ok) {
        const data = (await r.json()) as Project;
        get().setProject(data);
        set({ synced: true, error: null });
        return;
      }
      if (hadConnectionError) {
        set({
          synced: true,
          error: "Sin conexión con el servidor. Reintenta en unos segundos.",
        });
      }
    } catch {
      if (hadConnectionError || getOfflineQueue().length > 0) {
        set({
          synced: true,
          error: "Sin conexión: cambios pendientes en cola local. Reintenta al reconectar.",
        });
      }
    }
  },
  fetchWelcome: async (projectId, activeTab, options) => {
    const { session, projectId: storeProjectId } = get();
    const pid = (projectId ?? storeProjectId ?? "").trim();
    if (!pid) return;
    const skipLoading = options?.skipLoading === true;
    if (!skipLoading) set({ loading: true, error: null });
    try {
      const stageWelcome = get().activeStageId;
      const r = await apiFetch(`${API_BASE}/ai-orchestrator/welcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: pid,
          sessionId: session?.id,
          activeTab: activeTab ?? undefined,
          ...(stageWelcome ? { stageId: stageWelcome } : {}),
          chatScope: get().chatScope,
        }),
      });
      if (!r.ok) {
        const payload = await parseApiErrorPayloadFromResponse(r, "Error al cargar bienvenida");
        set({
          ...streamErrorPatch(payload),
          synced: true,
          ...(skipLoading ? {} : { loading: false }),
        });
        return;
      }
      const data: { session: Session; project: Project } = await r.json();
      if (
        !shouldApplyWorkshopUpdate(get, pid) ||
        data.session.projectId !== pid ||
        data.project.id !== pid
      ) {
        return;
      }
      const p = data.project;
      const stages = p.stages ?? [];
      const prev = get().activeStageId;
      const activeStageId = prev && stages.some((s) => s.id === prev) ? prev : pickDefaultStageId(stages);
      const focused = workshopStateFromProjectStage({ ...p, stages }, activeStageId);
      const nextMdd = focused.mddContent || get().mddContent;
      set({
        session: data.session,
        project: focused.project,
        workshopStages: stages,
        activeStageId,
        mddContent: nextMdd,
        mddPersistedBaseline: focused.mddContent || get().mddPersistedBaseline,
        documentTimestamps: focused.documentTimestamps,
        uxUiGuideContent: focused.uxUiGuideContent,
        dbgaContent: focused.project.dbgaContent ?? normalizeWorkshopDocumentForEditor(p.dbgaContent ?? null),
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
        synced: true,
        error: null,
      });
    } catch (e) {
      set({
        ...errorStateFromCaught(e),
        synced: true,
      });
    } finally {
      if (!skipLoading) set({ loading: false });
    }
  },

  clearChat: async (projectId, activeTab) => {
    const { session } = get();
    if (!projectId?.trim()) return;
    set({ loading: true, error: null, managerThreadId: null });
    try {
      const r = await apiFetch(`${API_BASE}/ai-orchestrator/clear-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sessionId: session?.id }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? "Error al borrar historial");
      }
      const data: { session: Session | null; project: Project } = await r.json();
      const p = data.project;
      const stages = p.stages ?? [];
      const prev = get().activeStageId;
      const activeStageId = prev && stages.some((s) => s.id === prev) ? prev : pickDefaultStageId(stages);
      const flat = workshopFlatFromStage(p, activeStageId);
      set({
        session: data.session,
        project: { ...p, ...flat },
        activeStageId,
        error: null,
        managerThreadId: null,
        evaluatorCritique: null,
        streamingUserMessage: null,
        streamingUserImages: null,
        streamingContent: null,
        streamingTab: null,
      });
      if (data.session) {
        await get().fetchWelcome(projectId, activeTab);
      }
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Error al borrar historial",
      });
    } finally {
      set({ loading: false });
    }
  },

  formatDocumentForActiveTab: async (activeTab) => {
    const tab = activeTab ?? "mdd";
    const { projectId, project, activeStageId } = get();
    if (!projectId?.trim()) {
      return { ok: false, message: "No hay proyecto activo." };
    }

    const fmt = (raw: string | null | undefined) => formatDocumentMarkdown((raw ?? "").trim());

    const persistProjectField = async (
      field: keyof Project,
      raw: string | null | undefined,
      label: string,
    ): Promise<{ ok: boolean; message: string; changed: boolean }> => {
      const source = (raw ?? "").trim();
      if (!source) return { ok: false, message: `No hay contenido en ${label} para formatear.`, changed: false };
      const formatted = fmt(source);
      const toPersist = cleanDoc(formatted) || formatted;
      const currentProject = get().project;
      const currentServer = cleanDoc(
        String(
          ((currentProject as unknown as Record<string, unknown>)[field as string] as
            | string
            | null
            | undefined) ?? "",
        ),
      ) || String((currentProject as unknown as Record<string, unknown>)[field as string] ?? "");
      const changed = toPersist !== currentServer;
      if (!changed) {
        return { ok: true, message: `${label}: sin cambios detectables tras formatear.`, changed: false };
      }
      const validation = validateDocumentForPersist(currentServer, toPersist, { fieldLabel: label });
      if (!validation.ok) {
        return { ok: false, message: `${label}: ${validation.message}`, changed: false };
      }
      const saved = await persistField(field as string, formatted, get, set);
      if (!saved.ok) {
        return { ok: false, message: `${label}: ${saved.error}`, changed: false };
      }
      set({ [field]: formatted } as Partial<WorkshopState>);
      return {
        ok: true,
        message: `${label} formateado (tablas, SQL pegado, fences). Revisa el panel.`,
        changed: true,
      };
    };

    switch (tab) {
      case "benchmark": {
        const dbga = (get().dbgaContent ?? project?.dbgaContent ?? "").trim();
        const spec = (get().specContent ?? project?.specContent ?? "").trim();
        const p0 = (get().phase0SummaryContent ?? project?.phase0SummaryContent ?? "").trim();
        const parts: string[] = [];
        let anyChanged = false;
        let allOk = true;

        if (dbga.length > 0) {
          const { formatted, strippedMdd, deduplicated } = formatDbgaDocument(dbga);
          const changed = formatted !== dbga;
          if (!changed && !strippedMdd) {
            parts.push("Fase 0 (DBGA): sin cambios detectables tras formatear.");
          } else {
            const dbgaSaved = await persistField("dbgaContent", formatted, get, set);
            if (!dbgaSaved.ok) {
              parts.push(`Fase 0 (DBGA): ${dbgaSaved.error}`);
              allOk = false;
            } else {
              set({ dbgaContent: formatted });
              let msg = deduplicated
                ? "Fase 0 (DBGA) deduplicado y formateado (secciones repetidas fusionadas). Revisa el panel Análisis."
                : "Fase 0 (DBGA) formateado (tablas, SQL, secciones). Revisa el panel Análisis.";
              if (strippedMdd) {
                const kb = Math.round(strippedMdd.length / 1024);
                const mddEmpty = !(get().mddContent ?? project?.mddContent ?? "").trim();
                if (mddEmpty) {
                  const mddSaved = await persistField("mddContent", strippedMdd, get, set);
                  if (mddSaved.ok) {
                    set({ mddContent: strippedMdd });
                    msg += ` MDD duplicado al final del DBGA (~${kb} KB) movido a pestaña MDD (no se borró).`;
                  } else {
                    allOk = false;
                    msg += ` No se pudo mover el MDD embebido: ${mddSaved.error}`;
                  }
                } else {
                  msg += ` Hay un MDD pegado al final del DBGA (~${kb} KB) que se quitó del panel; el MDD del proyecto ya tenía contenido — revísalo en el chat/historial si lo necesitas.`;
                }
              }
              parts.push(msg);
              anyChanged = true;
            }
          }
        }
        if (spec.length > 0) {
          const specBody = cleanDoc(spec) || spec;
          if (isChangelogOnlyDocument(specBody)) {
            parts.push(
              "Fase 0 (Spec): omitido (solo registro de cambios; genera o edita el Spec antes de formatear).",
            );
          } else {
            const r = await persistProjectField("specContent", spec, "Fase 0 (Spec)");
            parts.push(r.message);
            if (!r.ok) allOk = false;
            anyChanged = anyChanged || r.changed;
          }
        }
        if (p0.length > 0) {
          const r = await persistProjectField("phase0SummaryContent", p0, "Benchmark (Deep Research)");
          parts.push(r.message);
          if (!r.ok) allOk = false;
          anyChanged = anyChanged || r.changed;
        }
        if (!dbga && !spec && !p0) {
          return { ok: false, message: "No hay documento en Fase 0 / Benchmark para formatear." };
        }
        return {
          ok: allOk,
          message: anyChanged
            ? parts.join(" ")
            : `${parts.join(" ")} Si el panel no cambió, confirma que estás en la pestaña correcta (Fase 0 vs Benchmark).`,
        };
      }
      case "brd": {
        const sid = activeStageId;
        const st = project?.stages?.find((s) => s.id === sid);
        const brd = (st?.brdContent ?? "").trim();
        if (!brd) return { ok: false, message: "No hay BRD en la etapa activa." };
        if (!sid) return { ok: false, message: "Selecciona una etapa para formatear el BRD." };
        const formatted = fmt(brd);
        if (formatted === brd) {
          return { ok: true, message: "BRD: sin cambios detectables tras formatear." };
        }
        const ok = await get().patchWorkshopStage(sid, { brdContent: formatted });
        return ok
          ? { ok: true, message: "BRD formateado (tablas, Mermaid, fences). Revisa el panel." }
          : { ok: false, message: "No se pudo guardar el BRD formateado." };
      }
      case "mdd-inicial":
      case "legacy": {
        const { activeStageId, workshopStages } = get();
        const stages = workshopStages.length > 0 ? workshopStages : (project?.stages ?? []);
        const doc = legacyCodebaseDocFromStages(stages, activeStageId);
        if (!doc) {
          return {
            ok: false,
            message: "No hay documentación de partida (MDD Inicial / legacy) para formatear.",
          };
        }
        const formatted = fmt(doc);
        const saved = await get().legacyUpdateCodebaseDoc(projectId, formatted);
        return saved
          ? { ok: true, message: "Documentación de partida formateada. Revisa el panel." }
          : { ok: false, message: "No se pudo guardar el documento formateado." };
      }
      case "adrs":
        return { ok: false, message: "ADRs: edita y formatea desde el panel del documento." };
      case "mdd": {
        const source = effectiveMddContentForSectionRegen(get);
        if (!source) return { ok: false, message: "No hay MDD para formatear." };
        const rawFromDb = selectRawMddFromStage(get());
        const repairInput = rawFromDb.length >= source.length ? rawFromDb : source;
        const needsStructuralRepair =
          mddMarkdownNeedsStructuralRepair(repairInput) ||
          mddMarkdownNeedsStructuralRepair(rawFromDb) ||
          mddMarkdownNeedsStructuralRepair(source);
        const hadFormatCorruption =
          mddMarkdownHasKnownFormatCorruption(repairInput) ||
          mddMarkdownHasKnownFormatCorruption(rawFromDb) ||
          mddMarkdownHasKnownFormatCorruption(source);
        const before = normalizedMddForPersistCompare(source);
        await get().persistMddContent(repairInput, { force: true, mddFormatOnly: true });
        const saved = selectPersistedMddBaseline(get());
        set({ mddContent: saved });
        const after = normalizedMddForPersistCompare(saved);
        const stillCorrupt = mddMarkdownHasKnownFormatCorruption(saved);
        if (!needsStructuralRepair && !hadFormatCorruption && after === before) {
          return { ok: true, message: "MDD: ya estaba bien formateado (sin cambios)." };
        }
        if (stillCorrupt) {
          return {
            ok: true,
            message:
              "MDD: se aplicó formato pero aún hay bloques §4 o secciones por revisar manualmente.",
          };
        }
        return {
          ok: true,
          message: needsStructuralRepair || hadFormatCorruption
            ? "MDD reparado (JSON §4, secciones y fences). Revisa el panel."
            : "MDD formateado (headings, fences, tablas y Mermaid). Revisa el panel.",
        };
      }
      case "spec": {
        const raw = (get().specContent ?? project?.specContent ?? "").trim();
        const body = cleanDoc(raw) || raw;
        if (!body) return { ok: false, message: "No hay contenido en Spec para formatear." };
        if (isChangelogOnlyDocument(body)) {
          return {
            ok: false,
            message:
              "Spec: solo tiene registro de cambios. Genera o escribe el Spec antes de formatear.",
          };
        }
        return persistProjectField("specContent", raw, "Spec");
      }
      case "ux-ui-guide":
        return persistProjectField(
          "uxUiGuideContent",
          get().uxUiGuideContent ?? project?.uxUiGuideContent,
          "Guía UX/UI",
        );
      case "blueprint":
        return persistProjectField("blueprintContent", get().blueprintContent, "Blueprint");
      case "tasks":
        return persistProjectField("tasksContent", get().tasksContent, "Tasks");
      case "api-contracts":
        return persistProjectField("apiContractsContent", get().apiContractsContent, "Contratos API");
      case "logic-flows":
        return persistProjectField("logicFlowsContent", get().logicFlowsContent, "Flujos");
      case "architecture":
        return persistProjectField("architectureContent", get().architectureContent, "Arquitectura");
      case "use-cases":
        return persistProjectField("useCasesContent", get().useCasesContent, "Casos de uso");
      case "user-stories":
        return persistProjectField("userStoriesContent", get().userStoriesContent, "Historias de usuario");
      case "infra":
        return persistProjectField("infraContent", get().infraContent, "Infraestructura");
      default:
        return { ok: false, message: `Tab «${tab}» sin documento formateable desde el chat.` };
    }
  },

  sendMessage: async (message, activeTab, options) => {
    const { projectId, session } = get();
    const images = options?.images ?? [];
    const requestProjectId = projectId?.trim() ?? "";
    if (!requestProjectId || (!message.trim() && !images.length)) return;
    const tab = activeTab ?? "mdd";
    const msg = message.trim();
    const regenerateSection = options?.regenerateSection;
    const regenerateSectionGaps = options?.regenerateSectionGaps?.filter((g) => g?.trim()) ?? [];

    const assisted =
      get().phase0AssistedActive &&
      (tab === "benchmark" || tab === "phase0") &&
      !images.length &&
      !!msg;
    if (assisted) {
      set({ loading: true, error: null, synced: false });
      try {
        const event = await postPhase0AssistedAnswer({
          projectId: requestProjectId,
          answer: msg,
          threadId: get().phase0AssistedAwaitingSeed
            ? undefined
            : get().phase0AssistedThreadId,
        });
        if (event.type === "error") {
          set({
            loading: false,
            error: event.message ?? "Error en modo asistido",
          });
          return;
        }
        applyAssistedMarkdownToState(set as (p: Record<string, unknown>) => void, get, event);
        const assistantContent =
          typeof event.message === "string" && event.message.trim()
            ? event.message.trim()
            : "Respuesta aplicada.";
        const chatSession = await ensureWorkshopChatSession({
          projectId: requestProjectId,
          tab: "benchmark",
          fetchWelcome: (pid, welcomeTab, opts) => get().fetchWelcome(pid, welcomeTab, opts),
          getSession: () => get().session,
        });
        const nextSession = await appendWorkshopChatPair({
          session: chatSession ?? get().session,
          stageId: get().activeStageId,
          tab: "benchmark",
          userContent: msg,
          assistantContent,
        });
        const persistedBenchmark = countWorkshopTabMessages(nextSession, "benchmark") > 0;
        const finished =
          event.type === "assisted_turn" && event.done === true
            ? true
            : event.type === "assisted_started" && !event.question?.trim() && !event.awaitingSeed;
        set({
          session: nextSession ?? chatSession ?? get().session,
          phase0AssistedActive: !finished,
          phase0AssistedThreadId: finished
            ? null
            : event.threadId?.trim() || get().phase0AssistedThreadId,
          phase0AssistedAwaitingSeed: !!event.awaitingSeed,
          phase0AssistedTemplateLabel:
            event.templateLabel?.trim() || get().phase0AssistedTemplateLabel,
          phase0AssistedBootstrapMessage: persistedBenchmark
            ? null
            : assistantContent,
          loading: false,
          error: null,
        });
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : "Error en modo asistido",
        });
      }
      return;
    }

    if (isFormatDocumentChatCommand(msg) && !images.length) {
      set({ loading: true, error: null, synced: false });
      try {
        const result = await get().formatDocumentForActiveTab(tab);
        if (session?.id) {
          const stageId = get().activeStageId;
          const userRes = await apiFetch(`${API_BASE}/sessions/${session.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: sessionMessageBody({ role: "user", content: msg, tab }, stageId),
          });
          let nextSession = session;
          if (userRes.ok) nextSession = (await userRes.json()) as Session;
          const asstRes = await apiFetch(`${API_BASE}/sessions/${session.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: sessionMessageBody(
              { role: "assistant", content: result.message, tab },
              stageId,
            ),
          });
          if (asstRes.ok) nextSession = (await asstRes.json()) as Session;
          set({ session: nextSession, error: result.ok ? null : result.message });
        } else {
          set({ error: result.ok ? null : result.message });
        }
      } catch (e) {
        set({ error: e instanceof Error ? e.message : "Error al formatear el documento" });
      } finally {
        set({ loading: false });
      }
      return;
    }

    // Comandos /: regenerar §N vía API (projectId + mddContent); sesión de chat opcional (historial).
    if (tab === "mdd" && typeof regenerateSection === "number" && regenerateSection >= 1 && regenerateSection <= 7) {
      set({
        loading: true,
        loadingReason: "mdd-section",
        notice: buildMddSectionRegenNotice(regenerateSection),
        error: null,
        synced: false,
        agentProgress: [],
      });
      try {
        const chatSessionId = session?.id;
        if (chatSessionId) {
          const appendRes = await apiFetch(`${API_BASE}/sessions/${chatSessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: sessionMessageBody({ role: "user", content: msg, tab: "mdd" }, get().activeStageId),
          });
          if (appendRes.ok) {
            const updatedSession = (await appendRes.json()) as Session;
            set({ session: updatedSession });
          }
        }
        const mddContent = effectiveMddContentForSectionRegen(get);
        const regStage = get().activeStageId;
        void get().fetchGenerationStatus(requestProjectId);
        const pollResult = await enqueueAndPollMddJob(
          {
            mode: "section",
            projectId: requestProjectId,
            section: regenerateSection,
            mddContent: mddContent || undefined,
            ...(regenerateSectionGaps.length ? { gapReasons: regenerateSectionGaps } : {}),
            ...(regStage ? { stageId: regStage } : {}),
          },
          requestProjectId,
          {
            onProgress: (p) => {
              patchAgentProgressFromMddEvent(set, p);
            },
            onEnqueued: () => {
              void get().fetchGenerationStatus(requestProjectId);
            },
          },
        );
        if (!shouldApplyWorkshopUpdate(get, requestProjectId)) return;
        const { fetchProject, fetchEstimation, fetchConformance } = get();
        await fetchProject(requestProjectId);
        const merged = selectPersistedMddBaseline(get()) || get().mddContent || "";
        if (merged.trim().length <= 80) {
          set({
            error:
              merged.trim().length > 0
                ? "La regeneración devolvió un documento demasiado corto; la sección no se aplicó al MDD."
                : "La regeneración terminó sin markdown actualizado.",
            loading: false,
            loadingReason: null,
            notice: null,
            agentProgress: [],
            evaluatorCritique: null,
          });
          return;
        }
        if (regenerateSection === 5 && !mddHasSection5Heading(merged)) {
          set({
            error:
              "El servidor respondió OK pero el MDD no incluye ## 5. Lógica y Edge Cases. Reintenta /logica o /5; si persiste, usa «Regenerar MDD» completo.",
            loading: false,
            loadingReason: null,
            notice: null,
            agentProgress: [],
            evaluatorCritique: null,
          });
          return;
        }
        if (regenerateSection === 6 && !mddHasSection6Heading(merged)) {
          set({
            error:
              "El servidor respondió OK pero el MDD no incluye ## 6. Seguridad. Reintenta /seguridad; si persiste, recarga la página.",
            loading: false,
            loadingReason: null,
            notice: null,
            agentProgress: [],
            evaluatorCritique: null,
          });
          return;
        }
        await fetchEstimation(requestProjectId, merged).catch(() => {});
        fetchConformance(requestProjectId).catch(() => {});
        await get().fetchGenerationStatus(requestProjectId, regStage ?? undefined);
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
        const sessAfterRegen = get().session?.id;
        if (sessAfterRegen) {
          const assistantRes = await apiFetch(`${API_BASE}/sessions/${sessAfterRegen}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: sessionMessageBody(
              {
                role: "assistant",
                content: `Sección §${regenerateSection} regenerada. Revisa el documento en el panel central (pestaña MDD).`,
                tab: "mdd",
              },
              get().activeStageId,
            ),
          });
          if (assistantRes.ok) {
            const sess = (await assistantRes.json()) as Session;
            set({ session: sess });
          }
        }
        return;
      } catch (e) {
        const msg = e instanceof Error ? friendlyFetchError(e) : "Error al regenerar sección";
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
      return;
    }

    if (tab === "mdd" && session?.id) {
      const managerThreadId = get().managerThreadId;
      const pendingPlan = get().pendingPlanApproval;
      const approvingPlan =
        Boolean(pendingPlan?.plan?.length) &&
        managerThreadId != null &&
        isPlanApprovalResumeMessage(msg);
      const wantsManager = true;

      const looksLikeMddDocument =
        msg.length > 500 &&
        /^#\s*Master\s+Design\s+Document/i.test(msg) &&
        /\n##\s*1\.\s*Contexto/i.test(msg);
      const messageToSend = looksLikeMddDocument ? "" : msg;
      const messageForApi =
        messageToSend ||
        (managerThreadId != null ? "sí" : "Quiero refinar el MDD según los requisitos que indiqué.");
      if (looksLikeMddDocument) {
        console.warn("[Workshop] El mensaje parece el documento MDD, no la petición del usuario; se envía texto por defecto al API.");
      }

      if (wantsManager) {
        set({
          loading: true,
          loadingReason: "mdd",
          error: null,
          synced: false,
          agentProgress: [],
          streamingUserMessage: looksLikeMddDocument
            ? messageForApi
            : msg || (images.length ? "(Imagen adjunta)" : ""),
          streamingUserImages: images.length ? images : null,
          pendingPlanApproval: null,
          mddJustGeneratedFromBenchmark: false,
          evaluatorCritique: null,
        });
        try {
          let sessionForManager: Session | null = session;
          if (!looksLikeMddDocument) {
            const appendRes = await apiFetch(`${API_BASE}/sessions/${session.id}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: sessionMessageBody(
                {
                  role: "user",
                  content: msg || (images.length ? "(Imagen adjunta)" : msg),
                  tab: "mdd",
                  ...(images.length ? { images } : {}),
                },
                get().activeStageId,
              ),
            });
            if (!appendRes.ok) throw new Error("Error al enviar mensaje");
            const updatedSession = (await appendRes.json()) as Session;
            sessionForManager = updatedSession;
            set({ session: updatedSession });
          }

          if (approvingPlan && pendingPlan && sessionForManager?.id) {
            const stageId = get().activeStageId;
            for (const content of buildPlanApprovalChatContents(
              pendingPlan.planMessage,
              pendingPlan.plan,
            )) {
              const planArchiveRes = await apiFetch(
                `${API_BASE}/sessions/${sessionForManager.id}/messages`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: sessionMessageBody({ role: "assistant", content, tab: "mdd" }, stageId),
                },
              );
              if (planArchiveRes.ok) {
                sessionForManager = (await planArchiveRes.json()) as Session;
                set({ session: sessionForManager });
              }
            }
          }

          set({ streamingUserMessage: null, streamingUserImages: null });

          const mddStage = get().activeStageId;
          const enrichedFromChat = lastMddUserMessageContent(
            filterWorkshopSessionMessages(
              sessionForManager?.chatLog,
              "mdd",
              mddStage,
              get().chatScope,
            ),
          );
          const managerText =
            enrichedFromChat && contentIncludesVisionBlock(enrichedFromChat)
              ? enrichedFromChat
              : messageForApi;
          const imagesForManager =
            images.length > 0 && !contentIncludesVisionBlock(managerText) ? images : [];

          const url =
            managerThreadId != null
              ? `${API_BASE}/ai-analysis/mdd/stream/resume`
              : `${API_BASE}/ai-analysis/mdd/stream/manager`;
          const draftForMdd = (get().mddContent ?? get().project?.mddContent ?? "").trim() || undefined;
          const mddSnapshotBeforeStream = draftForMdd ?? "";
          const body =
            managerThreadId != null
              ? {
                projectId: requestProjectId,
                threadId: managerThreadId,
                userMessage: managerText,
                mddContent: draftForMdd,
                ...(imagesForManager.length ? { images: imagesForManager } : {}),
              }
              : {
                projectId: requestProjectId,
                dbgaContent: (get().dbgaContent ?? get().project?.dbgaContent ?? "").trim() || undefined,
                initialMessage: managerText,
                mddContent: draftForMdd,
                ...(mddStage ? { stageId: mddStage } : {}),
                ...(imagesForManager.length ? { images: imagesForManager } : {}),
              };
          const r = await apiFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            await throwStreamHttpError(r, "Error en el flujo MDD");
          }
          const reader = r.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                for (const raw of parseNdjsonLine(line)) {
                try {
                  const event = raw as {
                    type: string;
                    agent?: string;
                    message?: string;
                    reply?: string;
                    questions?: string[];
                    threadId?: string;
                    markdown?: string;
                    precision?: number;
                    status?: "red" | "yellow" | "green";
                    precisionBreakdown?: PrecisionBreakdown;
                    auditorFeedback?: string;
                    auditTrail?: string[];
                    /** Plan para aprobación (HITL 4.4) */
                    plan?: Array<{ step_id: string; task_description: string; node: string }>;
                    planMessage?: string;
                    code?: string;
                  };
                  if (event.type === "progress" && event.agent != null && event.message != null) {
                    set((s) => {
                      if ((s.projectId ?? s.project?.id ?? "").trim() !== requestProjectId) return s;
                      return {
                        agentProgress: mergeAgentProgressFromMddEvent(s.agentProgress, {
                          agent: event.agent!,
                          message: event.message!,
                        }),
                      };
                    });
                  } else if (event.type === "draft" && event.markdown != null && event.markdown.trim().length > 80) {
                    if (!shouldApplyWorkshopUpdate(get, requestProjectId)) continue;
                    const draftGate = deliveryGateFromStreamEvent(event as { deliveryGate?: MddDeliveryGateResult });
                    const currentMdd = get().mddContent ?? "";
                    if (streamMarkdownPreservesGovernancePatterns(currentMdd, event.markdown)) {
                      set({
                        mddContent: mddContentForEditor(event.markdown),
                        ...(draftGate ? { deliveryGate: draftGate } : {}),
                      });
                    }
                  } else if (event.type === "interrupt") {
                    set({
                      managerThreadId: event.threadId ?? get().managerThreadId ?? null,
                      pendingPlanApproval:
                        Array.isArray(event.plan) && event.plan.length > 0
                          ? { plan: event.plan, planMessage: event.planMessage ?? "¿Ejecutar este plan?" }
                          : null,
                    });
                    if (event.markdown != null && event.markdown.trim().length > 80) {
                      const incoming = event.markdown.trim();
                      const unchanged =
                        mddSnapshotBeforeStream.length > 80 && incoming === mddSnapshotBeforeStream;
                      const replyClaimsEdit =
                        typeof event.reply === "string" &&
                        /\b(ajust|elimin|actualiz|modific|ya no contiene|sin referencias)\b/i.test(
                          event.reply,
                        );
                      if (unchanged && replyClaimsEdit) {
                        set({
                          error:
                            "El chat indicó cambios pero el MDD no se actualizó. Revisa si hay un plan pendiente de aprobar, o usa /infraestructura o /seguridad para forzar la regeneración.",
                        });
                      }
                      const currentMdd = get().mddContent ?? "";
                      if (streamMarkdownPreservesGovernancePatterns(currentMdd, incoming)) {
                        set({ mddContent: mddContentForEditor(incoming) });
                        if (!unchanged) {
                          await persistMddFromChatStream(get, set, incoming, requestProjectId);
                        }
                      }
                    }

                    // No sobrescribir mddContent con markdown vacío (auditar puede venir de checkpoint sin draft)
                    const precisionBreakdown = (event as any).precisionBreakdown;
                    const auditTrail = (event as any).auditTrail;
                    const auditorFeedback = (event as any).auditorFeedback;
                    const interruptGate = deliveryGateFromStreamEvent(event as { deliveryGate?: MddDeliveryGateResult });

                    // Actualizar estado para el semáforo/modal, NO enviar al chat
                    if (precisionBreakdown || auditTrail || auditorFeedback || interruptGate) {
                      set({
                        precisionBreakdown: precisionBreakdown ?? get().precisionBreakdown,
                        auditTrail: auditTrail ?? get().auditTrail,
                        auditorFeedback: auditorFeedback ?? get().auditorFeedback,
                        ...(interruptGate ? { deliveryGate: interruptGate } : {}),
                      });
                    }

                    const hasPlanForApproval =
                      Array.isArray(event.plan) && event.plan.length > 0;
                    // plan_approval: PlanApprovalCard ya muestra planMessage + tabla «Tareas y responsables»;
                    // no duplicar el mismo texto como burbuja en el historial del chat.
                    const clarifierContent = hasPlanForApproval
                      ? null
                      : event.reply != null && event.reply !== ""
                        ? event.reply
                        : Array.isArray(event.questions) && event.questions.length > 0
                          ? event.questions.join("\n\n")
                          : "Responde en el chat para continuar con la entrevista (objetivos del sistema, integraciones, etc.).";

                    let sess = get().session;
                    if (clarifierContent) {
                      const appendAssistant = await apiFetch(`${API_BASE}/sessions/${session.id}/messages`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: sessionMessageBody(
                          { role: "assistant", content: clarifierContent, tab: "mdd" },
                          get().activeStageId,
                        ),
                      });
                      if (appendAssistant.ok) {
                        sess = (await appendAssistant.json()) as Session;
                        set({ session: sess });
                      }
                    }
                    set({
                      loading: false,
                      loadingReason: null,
                      agentProgress: [],
                      streamingUserMessage: null,
                      streamingUserImages: null,
                      streamingContent: null,
                      evaluatorCritique: null,
                    });
                    return;
                  } else if (event.type === "done" && event.markdown != null) {
                    set({ managerThreadId: null, pendingPlanApproval: null });
                    const markdownOk = event.markdown.trim().length > 80;
                    const mddBeforeFetch = (get().mddContent ?? "").trim();
                    if (
                      markdownOk &&
                      streamMarkdownPreservesGovernancePatterns(mddBeforeFetch, event.markdown)
                    ) {
                      set({ mddContent: mddContentForEditor(event.markdown) });
                    }

                    const precisionBreakdown = (event as any).precisionBreakdown;
                    const auditTrail = (event as any).auditTrail;
                    const auditorFeedback = (event as any).auditorFeedback;
                    const doneGate = deliveryGateFromStreamEvent(event as { deliveryGate?: MddDeliveryGateResult });

                    if (precisionBreakdown || auditTrail || auditorFeedback || doneGate) {
                      set({
                        precisionBreakdown: precisionBreakdown ?? get().precisionBreakdown,
                        auditTrail: auditTrail ?? get().auditTrail,
                        auditorFeedback: auditorFeedback ?? get().auditorFeedback,
                        ...(doneGate ? { deliveryGate: doneGate } : {}),
                      });
                    }

                    if (markdownOk) {
                      await persistMddFromChatStream(get, set, event.markdown, requestProjectId);
                    } else if (mddBeforeFetch.length > 80) {
                      // `done` con markdown corto (p. ej. placeholder) no debe vaciar borradores ya mostrados por eventos `draft`.
                      const current = get();
                      const flat = workshopFlatFromStage(current.project as Project, get().activeStageId);
                      const serverMdd = (normalizeWorkshopDocumentForEditor(flat.mddContent) ?? "").trim();
                      if (serverMdd.length < mddBeforeFetch.length) {
                        set({
                          mddContent: mddBeforeFetch,
                          project: current.project ? { ...current.project, mddContent: mddBeforeFetch } : current.project,
                        });
                      }
                    }

                    const assistantContent = "MDD generado. Revisa el documento en el panel central.";
                    const assistantRes = await apiFetch(`${API_BASE}/sessions/${session.id}/messages`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: sessionMessageBody(
                        { role: "assistant", content: assistantContent, tab: "mdd" },
                        get().activeStageId,
                      ),
                    });
                    if (assistantRes.ok) {
                      const sess = (await assistantRes.json()) as Session;
                      set({ session: sess });
                    }
                    set({
                      loading: false,
                      loadingReason: null,
                      agentProgress: [],
                      streamingUserMessage: null,
                      streamingUserImages: null,
                      streamingContent: null,
                      pendingPlanApproval: null,
                      evaluatorCritique: null,
                    });
                    return;
                  } else if (event.type === "blocked" && event.message) {
                    set({
                      managerThreadId: null,
                      pendingPlanApproval: null,
                      error: String(event.message),
                      loading: false,
                      loadingReason: null,
                      agentProgress: [],
                      streamingUserMessage: null,
                      streamingUserImages: null,
                      streamingContent: null,
                      evaluatorCritique: null,
                    });
                    return;
                  } else if (event.type === "error" && event.message) {
                    set({
                      managerThreadId: null,
                      pendingPlanApproval: null,
                      ...streamErrorPatch(event as { message: string; code?: string }),
                      loading: false,
                      loadingReason: null,
                      agentProgress: [],
                      streamingUserMessage: null,
                      streamingUserImages: null,
                      streamingContent: null,
                      evaluatorCritique: null,
                    });
                    return;
                  }
                } catch (_) {
                  // ignore
                }
                }
              }
            }
          }
        } catch (e) {
          const msg = friendlyFetchError(e);
          const code =
            e instanceof Error && "code" in e && typeof (e as { code?: string }).code === "string"
              ? (e as { code?: string }).code
              : undefined;
          set({
            managerThreadId: null,
            pendingPlanApproval: null,
            ...streamErrorPatch({ message: msg, code }),
            loading: false,
            loadingReason: null,
            agentProgress: [],
            streamingUserMessage: null,
            streamingUserImages: null,
            evaluatorCritique: null,
          });
          return;
        }
      }

      // No encadenar `ai-orchestrator/chat/stream` tras el Manager MDD: un segundo stream vaciaba el
      // panel (done del orquestador trae `project` sin MDD persistido) y duplicaba respuesta en chat.
      set({
        loading: false,
        loadingReason: null,
        agentProgress: [],
        streamingUserMessage: null,
        streamingUserImages: null,
        streamingContent: null,
        streamingTab: null,
      });
      return;
    } else {
      // Chat genérico para Guía UX/UI, benchmark, spec, etc. (tabs que no usan el flujo MDD/Manager)
      set({
        loading: true,
        error: null,
        synced: false,
        streamingUserMessage: msg || (images.length ? "(Imagen adjunta)" : ""),
        streamingUserImages: images.length ? images : null,
        streamingContent: "",
        streamingTab: tab,
        evaluatorCritique: null,
      });
      const orchestratorDocSnapshotBefore = orchestratorDocSnapshot(get(), tab);
      try {
        const body: Record<string, unknown> = {
          projectId: requestProjectId,
          sessionId: session?.id,
          message: msg || "",
          activeTab: tab,
        };
        if (tab === "mdd") {
          body.mddContent = get().mddContent || undefined;
        }
        if (tab === "ux-ui-guide") {
          body.uxUiGuideContent = get().uxUiGuideContent ?? get().project?.uxUiGuideContent ?? undefined;
        }
        {
          const sf = get().activeStageId;
          if (sf) body.stageId = sf;
          body.chatScope = get().chatScope;
        }
        if (tab === "benchmark") {
          const dbga = get().dbgaContent ?? get().project?.dbgaContent ?? null;
          if (dbga != null) body.dbgaContent = dbga;
        }
        if (tab === "brd") {
          const aid = get().activeStageId;
          const st = get().project?.stages?.find((x) => x.id === aid);
          if (tab === "brd") body.brdContent = st?.brdContent ?? "";
        }
        if (tab === "spec") {
          const sc = get().specContent ?? get().project?.specContent;
          if (sc != null && String(sc).trim()) body.specContent = sc;
        }
        if (tab === "architecture") {
          const ac = get().architectureContent ?? get().project?.architectureContent;
          if (ac != null && String(ac).trim()) body.architectureContent = ac;
        }
        if (tab === "blueprint") {
          const bc = get().blueprintContent;
          if (bc != null && String(bc).trim()) body.blueprintContent = bc;
        }
        if (tab === "use-cases") {
          const uc = get().useCasesContent;
          if (uc != null && String(uc).trim()) body.useCasesContent = uc;
        }
        if (tab === "user-stories") {
          const us = get().userStoriesContent;
          if (us != null && String(us).trim()) body.userStoriesContent = us;
        }
        if (tab === "api-contracts") {
          const ac = get().apiContractsContent;
          if (ac != null && String(ac).trim()) body.apiContractsContent = ac;
        }
        if (tab === "logic-flows") {
          const lf = get().logicFlowsContent;
          if (lf != null && String(lf).trim()) body.logicFlowsContent = lf;
        }
        if (tab === "tasks") {
          const tc = get().tasksContent;
          if (tc != null && String(tc).trim()) body.tasksContent = tc;
        }
        if (tab === "infra") {
          const ic = get().infraContent;
          if (ic != null && String(ic).trim()) body.infraContent = ic;
        }
        if (images.length) body.images = images;
        const r = await apiFetch(`${API_BASE}/ai-orchestrator/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message ?? "Error en la entrevista");
        }
        const reader = r.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        if (!reader) throw new Error("No se pudo leer el stream");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const block of lines) {
            let event = "";
            let dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
            }
            if (!event || !dataStr) continue;
            try {
              const data = JSON.parse(dataStr) as Record<string, unknown>;
              if (event === "chunk" && typeof data.content === "string") {
                set((s) => {
                  if ((s.projectId ?? s.project?.id ?? "").trim() !== requestProjectId) return s;
                  return { streamingContent: (s.streamingContent ?? "") + data.content };
                });
              } else if (event === "done") {
                if (!shouldApplyWorkshopUpdate(get, requestProjectId)) continue;
                const sess = data.session as Session | undefined;
                if (sess && sess.projectId !== requestProjectId) continue;
                const proj = data.project as Project | undefined;
                if (proj && proj.id !== requestProjectId) continue;
                const docUnchangedError = resolveOrchestratorDocUnchangedError({
                  tab,
                  snapshotBefore: orchestratorDocSnapshotBefore,
                  data,
                  snapshotSource: get(),
                  userMessage: msg,
                  session: sess,
                });
                const uxFromApi = (data.uxUiGuideContent ?? proj?.uxUiGuideContent) as string | null | undefined;
                const packed = projectWithUxAfterStream(proj, uxFromApi, get().activeStageId);
                const nextStages = packed?.project?.stages ?? proj?.stages;
                const freshUx = cleanDoc(uxFromApi ?? get().uxUiGuideContent ?? null);
                const nextMdd = packed?.mddContent ?? get().mddContent;
                set({
                  session: sess ?? get().session,
                  project: packed?.project ?? get().project,
                  activeStageId: packed?.activeStageId ?? get().activeStageId,
                  mddContent: nextMdd,
                  ...(packed?.mddContent != null ? { mddPersistedBaseline: packed.mddContent } : {}),
                  workshopStages: nextStages && nextStages.length > 0 ? nextStages : get().workshopStages,
                  uxUiGuideContent: freshUx,
                  dbgaContent:
                    packed?.project?.dbgaContent ??
                    normalizeWorkshopDocumentForEditor(
                      (data.dbgaContent as string | null | undefined) ??
                        proj?.dbgaContent ??
                        null,
                    ) ??
                    get().dbgaContent,
                  phase0SummaryContent:
                    cleanDoc(
                      (data.phase0SummaryContent as string | null | undefined) ??
                        proj?.phase0SummaryContent ??
                        null,
                    ) ?? get().phase0SummaryContent,
                  specContent: cleanDoc(proj?.specContent ?? null) ?? get().specContent,
                  architectureContent: cleanDoc(proj?.architectureContent ?? null) ?? get().architectureContent,
                  useCasesContent: cleanDoc(proj?.useCasesContent ?? null) ?? get().useCasesContent,
                  userStoriesContent: cleanDoc(proj?.userStoriesContent ?? null) ?? get().userStoriesContent,
                  blueprintContent: cleanDoc(proj?.blueprintContent ?? null) ?? get().blueprintContent,
                  apiContractsContent: cleanDoc(proj?.apiContractsContent ?? null) ?? get().apiContractsContent,
                  logicFlowsContent: cleanDoc(proj?.logicFlowsContent ?? null) ?? get().logicFlowsContent,
                  tasksContent: cleanDoc(proj?.tasksContent ?? null) ?? get().tasksContent,
                  infraContent: cleanDoc(proj?.infraContent ?? null) ?? get().infraContent,
                  streamingUserMessage: null,
                  streamingUserImages: null,
                  streamingContent: null,
                  streamingTab: null,
                  synced: true,
                  error: docUnchangedError,
                  evaluatorCritique: pickEvaluatorCritique(data),
                });
                // Auto-persist UX/UI guide when the orchestrator returns content on its tab
                if (tab === "ux-ui-guide" && freshUx && !docUnchangedError) {
                  get().persistUxUiGuideContent(freshUx).catch(() => {});
                }
                if (typeof data.upstreamPropagateJobId === "string" && data.upstreamPropagateJobId.trim()) {
                  void get().fetchGenerationStatus(requestProjectId, get().activeStageId ?? undefined);
                }
              } else if (event === "error" && data.error) {
                set({
                  error: String(data.error),
                  streamingUserMessage: null,
                  streamingUserImages: null,
                  streamingContent: null,
                  streamingTab: null,
                  synced: true,
                });
              }
            } catch (_) {
              // ignore parse errors for partial chunks
            }
          }
        }
        if (buffer.trim()) {
          let event = "";
          let dataStr = "";
          for (const line of buffer.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
          }
          if (event && dataStr) {
            try {
              const data = JSON.parse(dataStr) as Record<string, unknown>;
              if (event === "chunk" && typeof data.content === "string") {
                set((s) => {
                  if ((s.projectId ?? s.project?.id ?? "").trim() !== requestProjectId) return s;
                  return { streamingContent: (s.streamingContent ?? "") + data.content };
                });
              } else if (event === "done") {
                const sessTail = data.session as Session | undefined;
                const projTail = data.project as Project | undefined;
                const scopeOk =
                  shouldApplyWorkshopUpdate(get, requestProjectId) &&
                  (!sessTail?.projectId || sessTail.projectId === requestProjectId) &&
                  (!projTail?.id || projTail.id === requestProjectId);
                if (scopeOk) {
                  const docUnchangedError = resolveOrchestratorDocUnchangedError({
                    tab,
                    snapshotBefore: orchestratorDocSnapshotBefore,
                    data,
                    snapshotSource: get(),
                    userMessage: msg,
                    session: sessTail,
                  });
                  const uxFromApi = (data.uxUiGuideContent ?? projTail?.uxUiGuideContent) as
                    | string
                    | null
                    | undefined;
                  const packed = projectWithUxAfterStream(projTail, uxFromApi, get().activeStageId);
                  const nextStagesB = packed?.project?.stages ?? projTail?.stages;
                  const freshUx = cleanDoc(uxFromApi ?? get().uxUiGuideContent ?? null);
                  const nextMddTail = packed?.mddContent ?? get().mddContent;
                  set({
                    session: sessTail ?? get().session,
                    project: packed?.project ?? get().project,
                    activeStageId: packed?.activeStageId ?? get().activeStageId,
                    mddContent: nextMddTail,
                    ...(packed?.mddContent != null ? { mddPersistedBaseline: packed.mddContent } : {}),
                    workshopStages: nextStagesB && nextStagesB.length > 0 ? nextStagesB : get().workshopStages,
                    uxUiGuideContent: freshUx,
                    dbgaContent:
                      packed?.project?.dbgaContent ??
                      normalizeWorkshopDocumentForEditor(
                        (data.dbgaContent as string | null | undefined) ??
                          projTail?.dbgaContent ??
                          null,
                      ) ??
                      get().dbgaContent,
                    phase0SummaryContent:
                      cleanDoc(
                        (data.phase0SummaryContent as string | null | undefined) ??
                          projTail?.phase0SummaryContent ??
                          null,
                      ) ?? get().phase0SummaryContent,
                    specContent: cleanDoc(projTail?.specContent ?? null) ?? get().specContent,
                    blueprintContent: cleanDoc(projTail?.blueprintContent ?? null) ?? get().blueprintContent,
                    apiContractsContent: cleanDoc(projTail?.apiContractsContent ?? null) ?? get().apiContractsContent,
                    logicFlowsContent: cleanDoc(projTail?.logicFlowsContent ?? null) ?? get().logicFlowsContent,
                    tasksContent: cleanDoc(projTail?.tasksContent ?? null) ?? get().tasksContent,
                    architectureContent: cleanDoc(projTail?.architectureContent ?? null) ?? get().architectureContent,
                    useCasesContent: cleanDoc(projTail?.useCasesContent ?? null) ?? get().useCasesContent,
                    userStoriesContent: cleanDoc(projTail?.userStoriesContent ?? null) ?? get().userStoriesContent,
                    infraContent: cleanDoc(projTail?.infraContent ?? null) ?? get().infraContent,
                    streamingUserMessage: null,
                    streamingUserImages: null,
                    streamingContent: null,
                    streamingTab: null,
                    synced: true,
                    error: docUnchangedError,
                    evaluatorCritique: pickEvaluatorCritique(data),
                  });
                  if (tab === "ux-ui-guide" && freshUx && !docUnchangedError) {
                    get().persistUxUiGuideContent(freshUx).catch(() => {});
                  }
                }
              } else if (event === "error" && data.error) {
                set({
                  error: String(data.error),
                  streamingUserMessage: null,
                  streamingUserImages: null,
                  streamingContent: null,
                  streamingTab: null,
                  synced: true,
                });
              }
            } catch (_) {
              // ignore
            }
          }
        }
      } catch (e) {
        set({
          error: e instanceof Error ? friendlyFetchError(e) : "Error al enviar",
          streamingUserMessage: null,
          streamingUserImages: null,
          streamingContent: null,
          streamingTab: null,
          synced: true,
        });
      } finally {
        set({ loading: false });
      }
    }
  },
});
