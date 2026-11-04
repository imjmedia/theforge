import { Annotation } from "@langchain/langgraph";
import type { MddDeliveryGateResult } from "@theforge/shared-types";
import type { MddStructured } from "./mdd-structured.schema.js";
import type { AuditorGapsState, AuditorOutcome, AuditorUnavailableReason, MDDAuditorDecision, MddPlanStep } from "./mdd-state.schema.js";
import type { DeliveryGateFixTarget } from "../utils/mdd-delivery-gate-loop.util.js";

/** True si el texto parece un MDD completo (título + §1), no un parche/fragmento de sección. */
export function looksLikeFullMdd(text: string): boolean {
  return /^#\s*Master\s+Design\s+Document/i.test(text) && /##\s*1\.\s*Contexto/i.test(text);
}

/** Primeros 60 caracteres en una línea, para diagnóstico sin volcar el documento. */
function draftPreview(text: string): string {
  return text.slice(0, 60).replace(/\s+/g, " ");
}

/**
 * Combina actualizaciones concurrentes de mddDraft en el mismo paso del grafo.
 * Evita INVALID_CONCURRENT_GRAPH_UPDATE (LastValue) cuando resume + nodo escriben el borrador.
 * Prefiere la actualización más reciente (right); solo conserva left si right parece fragmento roto.
 *
 * Aviso de pérdida: solo salta cuando AMBOS valores parecen un MDD completo, son distintos y ninguno
 * contiene al otro (dos escritores reales de documento completo: uno de los dos se pierde). Un parche
 * de sección o una edición normal del formatter (un valor contiene al otro, o `b` es un fragmento) no
 * avisa, para que el warn no tape el caso que debe detectar.
 */
export function reduceMddDraft(left: string, right: string): string {
  const a = (left ?? "").trim();
  const b = (right ?? "").trim();
  if (!b) return a;
  if (!a) return b;
  if (a !== b && looksLikeFullMdd(a) && looksLikeFullMdd(b) && !a.includes(b) && !b.includes(a)) {
    console.warn(
      `[MDD:reduceMddDraft] dos MDD completos distintos en el mismo paso (len ${a.length}/${b.length}); ` +
        `se conserva el último. left="${draftPreview(a)}" right="${draftPreview(b)}"`,
    );
  }
  if (b.length >= a.length) return b;

  if (looksLikeFullMdd(b)) return b;

  if (b.length < a.length * 0.2) return a;

  // Fragmento sin estructura MDD completa.
  return b;
}

/** Fusiona escrituras concurrentes de escalares (p. ej. projectId en Command.update + nodo reanudado). */
export function reducePreferDefined<T>(left: T | undefined, right: T | undefined): T | undefined {
  if (right !== undefined && right !== null) return right;
  return left;
}

/**
 * LangGraph State annotation for the MDD workflow.
 * Use when building StateGraph<typeof MDDStateAnnotation.State>.
 */
export const MDDStateAnnotation = Annotation.Root({
  dbgaContent: Annotation<string>(),
  /** BRD stage markdown (capacidades de negocio) — domain fidelity / auth-skew gates. */
  brdContent: Annotation<string | undefined>({ reducer: reducePreferDefined }),
  clarifiedScope: Annotation<string>(),
  mddStructured: Annotation<MddStructured | undefined>({
    reducer: (old, newVal) => newVal !== undefined ? { ...(old ?? {}), ...newVal } : old,
  }),
  mddDraft: Annotation<string>({
    reducer: reduceMddDraft,
    default: () => "",
  }),
  /** Nota del Auditor; `undefined` cuando el Auditor no estuvo disponible (ver `auditorOutcome`). */
  auditorScore: Annotation<number | undefined>(),
  auditorFeedback: Annotation<string | undefined>(),
  auditorGaps: Annotation<AuditorGapsState | undefined>(),
  auditorDecision: Annotation<MDDAuditorDecision | undefined>(),
  mddIteration: Annotation<number | undefined>(),
  managerQuestions: Annotation<string[] | undefined>(),
  userInputAccumulated: Annotation<string | undefined>(),
  managerRound: Annotation<number | undefined>(),
  lastUserMessage: Annotation<string | undefined>(),
  requestQuestionsOnly: Annotation<boolean | undefined>(),
  clarifierJustGeneratedQuestions: Annotation<boolean | undefined>(),
  askedInitialTopicQuestion: Annotation<boolean | undefined>(),
  delegateTarget: Annotation<"clarifier_only" | "full_pipeline" | "sections" | undefined>(),
  previousMddDraftForMerge: Annotation<string | undefined>(),
  /** Borrador post-Clarificador (§1 anclada) para restaurar tras nodos scoped HIGH. */
  clarifierMddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post-stack_architect (§2 anclada) para restaurar tras data_model/api_contracts. */
  stackArchitectMddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post-data_model (§3 anclada) para restaurar tras api_contracts/format/SSOT. */
  dataModelArchitectMddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post-api_contracts (§4 anclada) para restaurar tras format/SSOT/tail. */
  apiContractsArchitectMddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post-section5 (§5 anclada) para restaurar tras format/SSOT/tail. */
  section5MddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post post_critic_parallel con §6 sustancial — ancla cola frente a format/dedupe/gate. */
  securityArchitectMddDraftSnapshot: Annotation<string | undefined>(),
  /** Borrador post post_critic_parallel con §7 sustancial — ancla cola frente a format/dedupe/gate. */
  integrationArchitectMddDraftSnapshot: Annotation<string | undefined>(),
  sectionsToRun: Annotation<string[] | undefined>(),
  acceptedProposalDirective: Annotation<string | undefined>(),
  lastStepFailed: Annotation<{ node: string; error: string } | undefined>(),
  mddPlan: Annotation<MddPlanStep[] | undefined>(),
  pendingPlanApproval: Annotation<{
    mddPlan: MddPlanStep[];
    delegateTarget: "clarifier_only" | "full_pipeline" | "sections";
    sectionsToRun?: string[];
    previousMddDraftForMerge?: string;
    goto: string;
    /** true → plan_approval no interrumpe; ejecuta directo (p. ej. tras responder preguntas del Clarifier). */
    autoApprove?: boolean;
  } | undefined>(),
  planUserIntent: Annotation<string | undefined>(),
  executorControlled: Annotation<boolean | undefined>(),
  mddPlanCurrentStep: Annotation<number | undefined>(),
  /** Saltos "mesh" (directiva → nodo anterior) consumidos en el plan actual; tope en el Executor. */
  meshJumpCount: Annotation<number | undefined>(),
  currentStepAllowedTools: Annotation<string[] | undefined>(),
  currentStepGoal: Annotation<string | undefined>(),
  architectCriticFeedback: Annotation<string | undefined>(),
  architectCriticAttempts: Annotation<number | undefined>(),
  architectCriticPhase: Annotation<"after_section3" | "after_full" | undefined>(),
  projectId: Annotation<string | undefined>({ reducer: reducePreferDefined }),
  activeStageId: Annotation<string | undefined>({ reducer: reducePreferDefined }),
  isLegacyProject: Annotation<boolean | undefined>({ reducer: reducePreferDefined }),
  theforgeProjectId: Annotation<string | undefined>({ reducer: reducePreferDefined }),
  episodicMemoryContext: Annotation<string | undefined>({ reducer: reducePreferDefined }),
  mddComplexity: Annotation<"LOW" | "MEDIUM" | "HIGH" | undefined>({ reducer: reducePreferDefined }),
  /** Lista de directivas internas enviadas entre agentes (Mesh Topology). */
  internalDirectives: Annotation<
    Array<{ from: string; to: string; message: string; timestamp?: string }> | undefined
  >({
    reducer: (old, newVal) => {
      // Si se pasa un array vacío, reseteamos la lista (consumo de directivas)
      if (newVal && Array.isArray(newVal) && newVal.length === 0) return [];
      if (!newVal) return old;
      return (old ?? []).concat(newVal);
    },
    default: () => [],
  }),
  impactSummary: Annotation<string | undefined>(),
  blackboardReasoning: Annotation<string | undefined>(),
  /** Staging fields for parallel Security ↔ Integration execution. */
  securitySectionMd: Annotation<string | undefined>(),
  integrationSectionMd: Annotation<string | undefined>(),
  /** Intentos del auto-loop Fase 4 (delivery gate). */
  deliveryGateAttempt: Annotation<number | undefined>(),
  /** Último resultado del gate de entrega tras prepareMddForOutput. */
  deliveryGate: Annotation<MddDeliveryGateResult | undefined>(),
  /** Si true, el grafo debe re-enrutar a arquitecto/integración. */
  deliveryGateLoopActive: Annotation<boolean | undefined>(),
  /** Destino del auto-loop cuando deliveryGateLoopActive. */
  deliveryGateFixTarget: Annotation<DeliveryGateFixTarget | undefined>(),
  /** Fingerprint placeholder blockers (circuit breaker). */
  deliveryGatePlaceholderFingerprint: Annotation<string | undefined>(),
  /** Fingerprint de TODOS los blockers del intento anterior (corta el loop sin progreso). */
  deliveryGateBlockersFingerprint: Annotation<string | undefined>(),
  /** F3: post_critic_parallel completó §4∥§6∥§7 (skip tail_parallel). */
  postCriticParallelDone: Annotation<boolean | undefined>(),
  /** §5 sin cambios: skip format_after_architect redundante. */
  section5FormatSkipped: Annotation<boolean | undefined>(),
  /** Reintentos stack_architect cuando §2 sigue placeholder. */
  stackArchitectAttempt: Annotation<number | undefined>(),
  /** True tras primera pasada del Auditor — evita re-auditoría en gate loop. */
  auditorRan: Annotation<boolean | undefined>(),
  /** `scored` (nota válida) | `unavailable` (sin nota; decide el gate determinista). Opcional por compat. con checkpoints viejos. */
  auditorOutcome: Annotation<AuditorOutcome | undefined>(),
  /** Motivo de `auditorOutcome: "unavailable"` (`invalid` no cuenta como caída de infraestructura en el eval). */
  auditorUnavailableReason: Annotation<AuditorUnavailableReason | undefined>(),
  /** Design-First pinned: §3/§4 selladas desde PAG. */
  designFirstPinned: Annotation<
    | {
        s3: string;
        s4: string;
        pagHash: string;
        pinnedSections?: (3 | 4)[];
      }
    | undefined
  >({ reducer: reducePreferDefined }),
});

export type MDDStateType = typeof MDDStateAnnotation.State;
export type MDDStateUpdate = typeof MDDStateAnnotation.Update;
