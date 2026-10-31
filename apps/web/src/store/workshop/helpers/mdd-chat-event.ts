import type { StateCreator } from "zustand";
import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { apiFetch, API_BASE } from "../../../utils/apiClient";
import { mergeAgentProgressFromMddEvent } from "../../../utils/agentProgress";
import { normalizeWorkshopDocumentForEditor } from "../../../utils/workshop-document-content.util";
import { deliveryGateFromStreamEvent } from "./delivery-gate";
import {
  mddContentForEditor,
  normalizedMddForPersistCompare,
  persistMddFromChatStream,
  streamMarkdownPreservesGovernancePatterns,
} from "./mdd-editor";
import { workshopFlatFromStage } from "./stage-focus";
import { sessionMessageBody } from "./session-message";
import { streamErrorPatch } from "./store-errors";
import { shouldApplyWorkshopUpdate } from "./workshop-scope";
import type { PrecisionBreakdown, Project, Session } from "../types";
import type { WorkshopState } from "../workshop-state.types";

/** `set` de zustand tal como lo recibe el slice del chat. */
export type WorkshopSet = Parameters<StateCreator<WorkshopState, [], []>>[0];
export type WorkshopGet = () => WorkshopState;

/**
 * Evento del chat MDD con Manager. Es el mismo contrato por ambos transportes: el NDJSON legacy
 * (`mdd/stream/manager|resume`) y el relay con cursor de la cola (`mdd/jobs/:id/events`, que añade `cursor`).
 */
export type MddChatStreamEvent = {
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
  /** Solo transporte cola: índice de la siguiente entrada del relay. */
  cursor?: number;
};

export type MddChatEventContext = {
  set: WorkshopSet;
  get: WorkshopGet;
  requestProjectId: string;
  sessionId: string;
  /** Borrador del editor al iniciar el turno (detecta "el chat dijo que editó pero el MDD no cambió"). */
  mddSnapshotBeforeStream: string;
};

/** `terminal`: el turno terminó (interrupt / done / blocked / error) y el consumidor debe dejar de leer. */
export type MddChatEventOutcome = "continue" | "terminal";

/**
 * Crea `handleMddChatEvent(event)`: el manejo por evento del chat MDD (progress, draft, interrupt, done,
 * blocked, error). Lo comparten el NDJSON legacy y el consumo de eventos de la cola, para que la UX sea
 * idéntica con cualquiera de los dos transportes.
 */
export function createMddChatEventHandler(
  ctx: MddChatEventContext,
): (raw: Record<string, unknown> | MddChatStreamEvent) => Promise<MddChatEventOutcome> {
  const { set, get, requestProjectId, sessionId, mddSnapshotBeforeStream } = ctx;
  return async function handleMddChatEvent(raw): Promise<MddChatEventOutcome> {
    try {
      const event = raw as MddChatStreamEvent;
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
        if (!shouldApplyWorkshopUpdate(get, requestProjectId)) return "continue";
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
        const precisionBreakdown = event.precisionBreakdown;
        const auditTrail = event.auditTrail;
        const auditorFeedback = event.auditorFeedback;
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
          const appendAssistant = await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
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
        return "terminal";
      } else if (event.type === "done" && event.markdown != null) {
        set({ managerThreadId: null, pendingPlanApproval: null });
        // Un nodo escritor falló (LLM vacío / sin salida usable): el backend conservó el borrador o dejó
        // la sección como placeholder y omitió el Auditor. Se avisa en vez de mostrarlo como "calidad baja".
        const failedStep = (event as { failedStep?: { node: string; error: string } }).failedStep;
        if (failedStep?.node) {
          set({
            error: `El paso "${failedStep.node}" falló (${failedStep.error}). El resto del documento se conservó; reintenta o regenera esa sección (p. ej. /seguridad, /infraestructura).`,
          });
        }
        const markdownOk = event.markdown.trim().length > 80;
        const mddBeforeFetch = (get().mddContent ?? "").trim();
        if (
          markdownOk &&
          streamMarkdownPreservesGovernancePatterns(mddBeforeFetch, event.markdown)
        ) {
          set({ mddContent: mddContentForEditor(event.markdown) });
        }

        const precisionBreakdown = event.precisionBreakdown;
        const auditTrail = event.auditTrail;
        const auditorFeedback = event.auditorFeedback;
        const doneGate = deliveryGateFromStreamEvent(event as { deliveryGate?: MddDeliveryGateResult });

        if (precisionBreakdown || auditTrail || auditorFeedback || doneGate) {
          set({
            precisionBreakdown: precisionBreakdown ?? get().precisionBreakdown,
            auditTrail: auditTrail ?? get().auditTrail,
            auditorFeedback: auditorFeedback ?? get().auditorFeedback,
            ...(doneGate ? { deliveryGate: doneGate } : {}),
          });
        }

        if (markdownOk && (event as { persistedOnServer?: boolean }).persistedOnServer) {
          // El servidor ya persistió este markdown en `done`: fijar baseline y marcar sincronizado
          // sin repetir el PATCH (el doble guardado reseteaba pendingCascadeDelta). Se recarga el
          // proyecto para reflejar status/semáforo/delta calculados en servidor.
          const incoming = event.markdown.trim();
          if (get().project?.id === requestProjectId) {
            set({
              mddContent: mddContentForEditor(incoming),
              synced: true,
              mddPersistedBaseline: normalizedMddForPersistCompare(incoming),
            });
            get().fetchProject(requestProjectId).catch(() => { });
          }
        } else if (markdownOk) {
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
        const assistantRes = await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
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
        return "terminal";
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
        return "terminal";
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
        return "terminal";
      }
    } catch (_) {
      // ignore
    }
    return "continue";
  };
}
