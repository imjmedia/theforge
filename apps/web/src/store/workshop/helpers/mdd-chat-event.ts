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
  semaphore?: import("@theforge/shared-types").MddSemaphoreVerdict;
  persistedStale?: boolean;
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

/**
 * Códigos con los que el servidor descarta el resultado del turno y conserva el documento guardado:
 * `blocked` `MDD_PERSIST_FLOOR` / `MDD_PERSIST_TOO_SHORT` (anti-wipe) y `error` `LEASE_LOST` /
 * `LOCK_UNAVAILABLE` (el turno no pudo mantener el lock de escritura). En todos, los `draft` previos del stream
 * NO se guardaron. `blocked` y `LOCK_UNAVAILABLE` restauran el estado previo al turno; `LEASE_LOST` recarga lo
 * guardado en el servidor solo si no hubo edición del usuario (ni antes ni durante el turno).
 */
const MDD_BLOCKED_PERSIST_CODES = new Set(["MDD_PERSIST_FLOOR", "MDD_PERSIST_TOO_SHORT"]);
const MDD_ERROR_DISCARD_CODES = new Set(["LEASE_LOST", "LOCK_UNAVAILABLE"]);

/** true si el evento indica que el servidor descartó el resultado del turno (ver códigos arriba). */
export function isMddStreamResultDiscarded(event: { type?: string; code?: string }): boolean {
  if (typeof event.code !== "string") return false;
  if (event.type === "blocked") return MDD_BLOCKED_PERSIST_CODES.has(event.code);
  if (event.type === "error") return MDD_ERROR_DISCARD_CODES.has(event.code);
  return false;
}

const MDD_DISCARDED_FALLBACK_MESSAGE = "El servidor no pudo guardar el resultado de este turno.";
const MDD_DISCARDED_SUFFIX =
  "Se conservó el documento guardado; la vista previa de este turno no se guardó.";

/** Aviso (no error de red) para un resultado descartado: mensaje del servidor + qué se conservó. */
export function mddStreamDiscardedNotice(message: string | undefined): string {
  const base = (message ?? "").trim() || MDD_DISCARDED_FALLBACK_MESSAGE;
  return `${base} ${MDD_DISCARDED_SUFFIX}`;
}

/** Aviso cuando el usuario editó durante el stream y el servidor descartó el resultado del turno. */
export function mddStreamDiscardedUserEditNotice(message: string | undefined): string {
  const detail = (message ?? "").trim() || "sin detalle del servidor";
  return `Tu edición se conservó, pero no está guardada: el servidor descartó el resultado de este turno (${detail})`;
}

/** Aviso tras perder el lock de escritura sin edición del usuario: el documento se recargó desde el servidor. */
export const MDD_LEASE_RELOADED_NOTICE =
  "Otro turno actualizó el documento; se recargó la versión guardada.";

/** Aviso cuando el usuario editó y el turno perdió el lock: su edición queda sin guardar frente a una versión más nueva. */
export function mddLeaseLostUserEditNotice(message: string | undefined): string {
  const detail = (message ?? "").trim() || "sin detalle del servidor";
  return `Tu edición se conservó, pero no está guardada: hay una versión más nueva guardada en el servidor (${detail})`;
}

/** Aviso cuando el turno no pudo tomar el lock de escritura (Redis no disponible). No se recarga nada. */
export const MDD_LOCK_UNAVAILABLE_NOTICE =
  "No se pudo tomar el bloqueo del hilo (Redis no disponible). Reintenta en unos segundos.";

/** Aviso de bloqueo cuando el usuario tiene una edición sin guardar que se conserva en el editor. */
export const MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE = `Tu edición se conservó, pero no está guardada. ${MDD_LOCK_UNAVAILABLE_NOTICE}`;

const MDD_STREAM_LOADING_REASONS = new Set<string>(["mdd", "mdd-section", "legacy-mdd"]);

/** true mientras el chat MDD escribe el editor (`draft`): el documento aún no es un resultado final. */
export function isMddStreamingLoading(s: { loading: boolean; loadingReason?: string | null }): boolean {
  return s.loading && MDD_STREAM_LOADING_REASONS.has(s.loadingReason ?? "");
}

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
  // Semáforo de entrega previo al turno: los `draft` lo sobrescriben y también deben revertirse.
  const deliveryGateBeforeStream = get().deliveryGate;
  // Último borrador que este handler puso en `mddContent`. Si el editor ya no coincide, el usuario editó.
  let lastAppliedDraft: string | null = null;
  // El usuario ya tenía cambios sin guardar al enviar el mensaje: el snapshot no es el documento guardado.
  // Se calcula al crear el handler (antes de cualquier evento) para no verse afectado por cambios del turno.
  const userEditBeforeTurn =
    mddContentForEditor(mddSnapshotBeforeStream) !== mddContentForEditor(get().mddPersistedBaseline);

  /** El editor sigue con lo que puso el stream (último `draft` aplicado, o el snapshot si no hubo ninguno). */
  const editorHoldsStreamOutput = (): boolean => {
    const currentMdd = get().mddContent ?? "";
    return lastAppliedDraft !== null
      ? currentMdd === lastAppliedDraft
      : currentMdd === mddContentForEditor(mddSnapshotBeforeStream);
  };

  /**
   * `blocked` MDD_PERSIST_*: resultado descartado por el servidor, que conserva el documento guardado. Si el
   * editor sigue con lo que puso el stream, restaura el estado previo al turno: los `draft` ya habían metido el
   * borrador rechazado y un PATCH posterior (con `force`) lo guardaría. Si el usuario editó durante el stream,
   * NO toca `mddContent`: conserva su edición, la marca como no guardada y avisa. Siempre restaura
   * `deliveryGate` y limpia `error`. No toca el baseline persistido: los `draft` nunca lo cambian.
   */
  const discardedResultPatch = (event: MddChatStreamEvent): Partial<WorkshopState> => {
    if (!shouldApplyWorkshopUpdate(get, requestProjectId)) return {};
    if (!editorHoldsStreamOutput()) {
      return {
        synced: false,
        deliveryGate: deliveryGateBeforeStream,
        error: null,
        notice: mddStreamDiscardedUserEditNotice(event.message),
      };
    }
    return {
      mddContent: mddContentForEditor(mddSnapshotBeforeStream),
      deliveryGate: deliveryGateBeforeStream,
      error: null,
      notice: mddStreamDiscardedNotice(event.message),
    };
  };

  /**
   * `error` LEASE_LOST / LOCK_UNAVAILABLE: el turno no pudo mantener el lock de escritura y su resultado no se
   * guardó. Casos (el editor se compara con el snapshot previo al turno y con el baseline persistido):
   * - El usuario editó durante el stream: conserva su texto, `synced: false`, aviso de edición sin guardar, NO recarga.
   * - Había edición previa al turno (snapshot ≠ baseline): restaura el snapshot, que contiene esa edición,
   *   `synced: false`, aviso de edición sin guardar, NO recarga. Recargar la pisaría.
   * - Sin edición del usuario (snapshot == baseline) y el editor solo tenía la salida del stream:
   *   - LEASE_LOST: vuelve al baseline y `reloadSaved` pide recargar, porque otro turno pudo guardar un documento
   *     más nuevo (con `preferServerMdd` la recarga toma el servidor).
   *   - LOCK_UNAVAILABLE: restaura el snapshot y avisa del bloqueo. No recarga: no hubo otro turno que guardara.
   */
  const discardedErrorPatch = (
    event: MddChatStreamEvent,
  ): { patch: Partial<WorkshopState>; reloadSaved: boolean } => {
    if (!shouldApplyWorkshopUpdate(get, requestProjectId)) return { patch: {}, reloadSaved: false };
    const lockUnavailable = event.code === "LOCK_UNAVAILABLE";
    if (!editorHoldsStreamOutput()) {
      return {
        patch: {
          synced: false,
          deliveryGate: deliveryGateBeforeStream,
          error: null,
          notice: lockUnavailable
            ? MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE
            : mddLeaseLostUserEditNotice(event.message),
        },
        reloadSaved: false,
      };
    }
    if (userEditBeforeTurn) {
      return {
        patch: {
          mddContent: mddContentForEditor(mddSnapshotBeforeStream),
          synced: false,
          deliveryGate: deliveryGateBeforeStream,
          error: null,
          notice: lockUnavailable
            ? MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE
            : mddLeaseLostUserEditNotice(event.message),
        },
        reloadSaved: false,
      };
    }
    if (lockUnavailable) {
      return {
        patch: {
          mddContent: mddContentForEditor(mddSnapshotBeforeStream),
          deliveryGate: deliveryGateBeforeStream,
          error: null,
          notice: MDD_LOCK_UNAVAILABLE_NOTICE,
        },
        reloadSaved: false,
      };
    }
    return {
      patch: {
        mddContent: mddContentForEditor(get().mddPersistedBaseline),
        deliveryGate: deliveryGateBeforeStream,
        error: null,
      },
      reloadSaved: true,
    };
  };

  /** Recarga el proyecto desde el servidor; avisa solo si la recarga devolvió el proyecto del mismo ámbito. */
  const reloadSavedMdd = async (): Promise<void> => {
    const data = await get().fetchProject(requestProjectId, { preferServerMdd: true }).catch(() => null);
    if (data && shouldApplyWorkshopUpdate(get, requestProjectId)) {
      set({ notice: MDD_LEASE_RELOADED_NOTICE });
    }
  };
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
          const appliedDraft = mddContentForEditor(event.markdown);
          set({
            mddContent: appliedDraft,
            ...(draftGate ? { deliveryGate: draftGate } : {}),
          });
          lastAppliedDraft = appliedDraft;
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

        const doneSemaphore = (event as MddChatStreamEvent).semaphore;
        const donePersistedStale = (event as MddChatStreamEvent).persistedStale;
        if (
          precisionBreakdown ||
          auditTrail ||
          auditorFeedback ||
          doneGate ||
          doneSemaphore ||
          event.precision != null ||
          event.status
        ) {
          const prev = get().liveMetrics;
          set({
            precisionBreakdown: precisionBreakdown ?? get().precisionBreakdown,
            auditTrail: auditTrail ?? get().auditTrail,
            auditorFeedback: auditorFeedback ?? get().auditorFeedback,
            ...(doneGate ? { deliveryGate: doneGate } : {}),
            liveMetrics: {
              ...(prev ?? {
                precision: event.precision ?? 0,
                totalMXN: 0,
                totalMXNMarket: 0,
                totalHours: 0,
                roles: {},
                rolesHours: {},
                status: event.status ?? "yellow",
                totalMXNIA: 0,
                readinessHints: [],
                mddReadinessHints: [],
                traceabilityHints: [],
              }),
              ...(event.precision != null ? { precision: event.precision } : {}),
              ...(event.status ? { status: event.status } : {}),
              ...(doneSemaphore ? { semaphore: doneSemaphore } : {}),
              ...(donePersistedStale != null ? { persistedStale: donePersistedStale } : {}),
            },
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
      } else if (
        event.type === "blocked" &&
        (event.message || isMddStreamResultDiscarded(event))
      ) {
        set({
          managerThreadId: null,
          pendingPlanApproval: null,
          ...(isMddStreamResultDiscarded(event)
            ? discardedResultPatch(event)
            : { error: String(event.message) }),
          loading: false,
          loadingReason: null,
          agentProgress: [],
          streamingUserMessage: null,
          streamingUserImages: null,
          streamingContent: null,
          evaluatorCritique: null,
        });
        return "terminal";
      } else if (
        event.type === "error" &&
        (event.message || isMddStreamResultDiscarded(event))
      ) {
        const discarded = isMddStreamResultDiscarded(event) ? discardedErrorPatch(event) : null;
        set({
          managerThreadId: null,
          pendingPlanApproval: null,
          ...(discarded ? discarded.patch : streamErrorPatch(event as { message: string; code?: string })),
          loading: false,
          loadingReason: null,
          agentProgress: [],
          streamingUserMessage: null,
          streamingUserImages: null,
          streamingContent: null,
          evaluatorCritique: null,
        });
        if (discarded?.reloadSaved) await reloadSavedMdd();
        return "terminal";
      }
    } catch (_) {
      // ignore
    }
    return "continue";
  };
}
