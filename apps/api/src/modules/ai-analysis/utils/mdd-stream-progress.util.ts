/**
 * @fileoverview Emisión de eventos de progreso durante streaming MDD.
 */

import { getAgentLabel } from "../state/state-to-markdown.js";
import {
  getMddNodeActiveProgressMessage,
  getMddNodeProgressMessage,
} from "./mdd-progress-messages.js";
import { resolveMddHighPipelinePhase } from "./mdd-high-pipeline-phases.js";

export type MddStreamProgressPhase = "active" | "done";

export function buildMddStreamProgressEvent(
  nodeName: string,
  phase: MddStreamProgressPhase,
): {
  type: "progress";
  agent: string;
  message: string;
  phase: MddStreamProgressPhase;
  phaseGroup?: { current: number; total: number; label: string };
} {
  const label =
    nodeName === "auditor"
      ? getAgentLabel("auditor", "mdd")
      : nodeName === "manager"
        ? "Manager (entrevista)"
        : getAgentLabel(nodeName);
  const message =
    phase === "active"
      ? getMddNodeActiveProgressMessage(nodeName)
      : getMddNodeProgressMessage(nodeName);
  const pipelinePhase = resolveMddHighPipelinePhase(nodeName);
  return {
    type: "progress",
    agent: label,
    message,
    phase,
    ...(pipelinePhase
      ? { phaseGroup: { current: pipelinePhase.index, total: pipelinePhase.total, label: pipelinePhase.label } }
      : {}),
  };
}

export function createMddNodeStartTracker(): {
  onNodeStart: (nodeName: string) => void;
  takePendingNodeStart: () => string | null;
} {
  let pending: string | null = null;
  return {
    onNodeStart: (nodeName) => {
      pending = nodeName;
    },
    takePendingNodeStart: () => {
      const next = pending;
      pending = null;
      return next;
    },
  };
}
