import { Annotation } from "@langchain/langgraph";
import type { MddDeliveryGateResult } from "@theforge/shared-types";
import type { MddStructured } from "./mdd-structured.schema.js";
import type { AuditorGapsState, MDDAuditorDecision, MddPlanStep } from "./mdd-state.schema.js";
import type { DeliveryGateFixTarget } from "../utils/mdd-delivery-gate-loop.util.js";

/**
 * Combina actualizaciones concurrentes de mddDraft en el mismo paso del grafo.
 * Evita INVALID_CONCURRENT_GRAPH_UPDATE (LastValue) cuando resume + nodo escriben el borrador.
 * Prefiere la actualización más reciente (right); solo conserva left si right parece fragmento roto.
 */
export function reduceMddDraft(left: string, right: string): string {
  const a = (left ?? "").trim();
  const b = (right ?? "").trim();
  if (!b) return a;
  if (!a) return b;
  if (b.length >= a.length) return b;

  const looksLikeFullMdd =
    /^#\s*Master\s+Design\s+Document/i.test(b) && /##\s*1\.\s*Contexto/i.test(b);
  if (looksLikeFullMdd) return b;

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
  auditorScore: Annotation<number>(),
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
  } | undefined>(),
  planUserIntent: Annotation<string | undefined>(),
  executorControlled: Annotation<boolean | undefined>(),
  mddPlanCurrentStep: Annotation<number | undefined>(),
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
});

export type MDDStateType = typeof MDDStateAnnotation.State;
export type MDDStateUpdate = typeof MDDStateAnnotation.Update;
