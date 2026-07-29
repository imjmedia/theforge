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
  fingerprintPlaceholderBlockers,
  hasUnresolvedAutoRepairableGateWarnings,
  resolveDeliveryGateFixTargetFromGate,
  shouldContinueDeliveryGateLoop,
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
    // gate.ok=true cierra el pipeline: warnings auto-reparables no re-disparan agentes.
    const loop = shouldContinueDeliveryGateLoop(gate, attempt);

    LOG(
      "gate ok=%s score=%s blockers=%d warnings=%d attempt=%d loop=%s qualityPending=%s",
      gate.ok,
      gate.score,
      gate.blockers.length,
      gate.warnings.length,
      attempt,
      loop,
      qualityPending,
    );

    if (loop) {
      const fixTarget = resolveDeliveryGateFixTargetFromGate(gate.blockers, gate.warnings, {
        splitArchitectPipeline: isHighSplitArchitectPipeline(state),
        previousPlaceholderFingerprint: state.deliveryGatePlaceholderFingerprint,
        deliveryGateAttempt: attempt + 1,
      });
      const agentFeedback = [
        formatDeliveryGateBlockersFeedback(gate.blockers),
        formatDeliveryGateQualityWarningsFeedback(gate.warnings),
      ]
        .filter(Boolean)
        .join("\n\n");
      const safeDraft = preserveValidatedSectionsIfSubstantial(baselineDraft ?? "", prepared);
      return {
        mddDraft: safeDraft,
        previousMddDraftForMerge: baselineDraft ?? state.mddDraft,
        deliveryGate: gate,
        deliveryGateAttempt: attempt + 1,
        deliveryGateLoopActive: true,
        deliveryGateFixTarget: fixTarget,
        deliveryGatePlaceholderFingerprint: fingerprintPlaceholderBlockers(gate.blockers),
        auditorFeedback: agentFeedback || state.auditorFeedback,
      };
    }

    return {
      mddDraft: prepared,
      deliveryGate: gate,
      deliveryGateLoopActive: false,
      deliveryGateFixTarget: undefined,
      deliveryGatePlaceholderFingerprint: undefined,
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
