/**
 * @fileoverview Nodo preparador de salida — ensamblaje final del MDD completo.
 */

import type { MDDStateType } from "../state/index.js";
import { prepareMddForOutput } from "../utils/mdd-prepare-output.js";
import { validateMddForDelivery } from "../utils/mdd-delivery-gate.util.js";
import { preserveValidatedSectionsIfSubstantial } from "../utils/mdd-section-preserve.util.js";
import {
  formatDeliveryGateBlockersFeedback,
  formatDeliveryGateQualityWarningsFeedback,
  fingerprintGateBlockers,
  fingerprintPlaceholderBlockers,
  hasUnresolvedAutoRepairableGateWarnings,
  resolveDeliveryGateFixTargetFromGate,
  shouldContinueDeliveryGateLoop,
  shouldContinueDeliveryGateQualityLoop,
  shouldStopDeliveryGateLoop,
  DELIVERY_GATE_RESET_UPDATE,
} from "../utils/mdd-delivery-gate-loop.util.js";
import { isHighSplitArchitectPipeline } from "../utils/mdd-architect-pipeline.util.js";
import { resolveBrdFromMddState } from "../utils/mdd-domain-prompt.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:PrepareOutput] ${msg}`, ...args);

/**
 * Pipeline determinista final + evaluación del delivery gate (Fase 4).
 * Actualiza mddDraft con prepareMddForOutput y prepara feedback para auto-loop.
 */
export function createMddPrepareOutputNode(options?: { uiMcpLibraryLabel?: string | null }) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const gateRef: { current?: ReturnType<typeof validateMddForDelivery> } = {};
    const brdMarkdown = resolveBrdFromMddState(state) || null;
    const dbgaMarkdown = (state.dbgaContent ?? "").trim() || null;
    const baselineDraft = (state.mddDraft ?? "").trim() || null;
    const prepared = await prepareMddForOutput(
      { mddDraft: state.mddDraft, mddStructured: state.mddStructured },
      {
        deliveryGateRef: gateRef,
        uiMcpLibraryLabel: options?.uiMcpLibraryLabel ?? null,
        brdMarkdown,
        dbgaMarkdown,
        baselineDraft,
        mddComplexity: state.mddComplexity,
        formatForPersist: false,
        tailSnapshotSource: state,
      },
    );
    const gate =
      gateRef.current ??
      validateMddForDelivery(prepared, {
        brdMarkdown,
        dbgaMarkdown,
        mddComplexity: state.mddComplexity,
      });
    const attempt = state.deliveryGateAttempt ?? 0;
    const qualityPending = hasUnresolvedAutoRepairableGateWarnings(gate.warnings);
    const wantsLoop =
      shouldContinueDeliveryGateLoop(gate, attempt) ||
      shouldContinueDeliveryGateQualityLoop(gate, attempt);

    // fixTarget solo se resuelve si el loop seguiría; luego shouldStopDeliveryGateLoop corta los
    // loops sin progreso (sentinel "stop", integration sin referencias §6/§7, mismos blockers).
    const fixTarget = wantsLoop
      ? resolveDeliveryGateFixTargetFromGate(gate.blockers, gate.warnings, {
          splitArchitectPipeline: isHighSplitArchitectPipeline(state),
          previousPlaceholderFingerprint: state.deliveryGatePlaceholderFingerprint,
          deliveryGateAttempt: attempt + 1,
          sealedSections: {
            mddDraft: prepared,
            stackArchitectMddDraftSnapshot: state.stackArchitectMddDraftSnapshot,
            dataModelArchitectMddDraftSnapshot: state.dataModelArchitectMddDraftSnapshot,
            apiContractsArchitectMddDraftSnapshot: state.apiContractsArchitectMddDraftSnapshot,
          },
        })
      : undefined;
    const stopped =
      wantsLoop &&
      shouldStopDeliveryGateLoop(gate, fixTarget, attempt, state.deliveryGateBlockersFingerprint);
    const loop = wantsLoop && !stopped && fixTarget !== undefined && fixTarget !== "stop";

    LOG(
      "gate ok=%s score=%s blockers=%d warnings=%d attempt=%d loop=%s stopped=%s fixTarget=%s qualityPending=%s",
      gate.ok,
      gate.score,
      gate.blockers.length,
      gate.warnings.length,
      attempt,
      loop,
      stopped,
      fixTarget ?? "n/a",
      qualityPending,
    );

    if (loop && fixTarget) {
      const agentFeedback = [
        formatDeliveryGateBlockersFeedback(gate.blockers),
        formatDeliveryGateQualityWarningsFeedback(gate.warnings),
      ]
        .filter(Boolean)
        .join("\n\n");
      // Solo restaura secciones destruidas (ausentes/placeholder): nunca deshace un fix del loop.
      const safeDraft = preserveValidatedSectionsIfSubstantial(baselineDraft ?? "", prepared);
      return {
        mddDraft: safeDraft,
        previousMddDraftForMerge: baselineDraft ?? state.mddDraft,
        deliveryGate: gate,
        deliveryGateAttempt: attempt + 1,
        deliveryGateLoopActive: true,
        deliveryGateFixTarget: fixTarget,
        deliveryGatePlaceholderFingerprint: fingerprintPlaceholderBlockers(gate.blockers),
        deliveryGateBlockersFingerprint: fingerprintGateBlockers(gate.blockers, gate.warnings),
        auditorFeedback: agentFeedback || state.auditorFeedback,
      };
    }

    return {
      mddDraft: prepared,
      deliveryGate: gate,
      ...DELIVERY_GATE_RESET_UPDATE,
      auditorFeedback:
        gate.ok
          ? state.auditorFeedback
          : gate.blockers.length > 0
            ? formatDeliveryGateBlockersFeedback(gate.blockers)
            : state.auditorFeedback,
      auditorDecision: gate.ok ? "done" : state.auditorDecision,
    };
  };
}
