import { createHash } from "node:crypto";
import type { MDDStateType } from "../state/index.js";

// ---------------------------------------------------------------------------
// Input-hash helpers for each LLM node.
//
// Each function extracts ALL the state fields that the node actually reads as
// input. Omitting a read field makes the cache replay a stale output when only
// that field changes (e.g. auditorFeedback or currentStepGoal), so the lists
// below are derived from `state.<field>` usages in each node.
//
// Large strings (drafts, snapshots) are hashed IN FULL (sha256) instead of
// truncated, so an edit past any prefix still changes the key.
// ---------------------------------------------------------------------------

export function clarifierInput(state: MDDStateType): Record<string, unknown> {
  return {
    dbgaContent: hashStr(state.dbgaContent),
    mddDraft: hashStr(state.mddDraft),
    mddStructured: hashValue(state.mddStructured),
    previousMddDraftForMerge: hashStr(state.previousMddDraftForMerge),
    clarifiedScope: hashStr(state.clarifiedScope),
    auditorFeedback: state.auditorFeedback,
    auditorScore: state.auditorScore,
    userInputAccumulated: state.userInputAccumulated,
    lastUserMessage: state.lastUserMessage,
    mddComplexity: state.mddComplexity,
    managerQuestions: state.managerQuestions,
    requestQuestionsOnly: state.requestQuestionsOnly,
    deliveryGateFixTarget: state.deliveryGateFixTarget,
    deliveryGateLoopActive: state.deliveryGateLoopActive,
    mddIteration: state.mddIteration,
  };
}

export function softwareArchitectInput(state: MDDStateType): Record<string, unknown> {
  return {
    clarifiedScope: hashStr(state.clarifiedScope),
    dbgaContent: hashStr(state.dbgaContent),
    brdContent: hashStr(state.brdContent),
    mddDraft: hashStr(state.mddDraft),
    previousMddDraftForMerge: hashStr(state.previousMddDraftForMerge),
    mddStructured: hashValue(state.mddStructured),
    acceptedProposalDirective: state.acceptedProposalDirective,
    architectCriticFeedback: state.architectCriticFeedback,
    auditorFeedback: state.auditorFeedback,
    currentStepGoal: state.currentStepGoal,
    currentStepAllowedTools: state.currentStepAllowedTools,
    deliveryGateFixTarget: state.deliveryGateFixTarget,
    deliveryGateLoopActive: state.deliveryGateLoopActive,
    userInputAccumulated: state.userInputAccumulated,
    lastUserMessage: state.lastUserMessage,
    internalDirectives: state.internalDirectives,
    stackArchitectAttempt: state.stackArchitectAttempt,
    stackArchitectMddDraftSnapshot: hashStr(state.stackArchitectMddDraftSnapshot),
    dataModelArchitectMddDraftSnapshot: hashStr(state.dataModelArchitectMddDraftSnapshot),
    apiContractsArchitectMddDraftSnapshot: hashStr(state.apiContractsArchitectMddDraftSnapshot),
    clarifierMddDraftSnapshot: hashStr(state.clarifierMddDraftSnapshot),
    sectionsToRun: state.sectionsToRun,
    mddComplexity: state.mddComplexity,
    mddIteration: state.mddIteration,
    isLegacyProject: state.isLegacyProject,
    theforgeProjectId: state.theforgeProjectId,
  };
}

export function securityInput(state: MDDStateType): Record<string, unknown> {
  return {
    clarifiedScope: hashStr(state.clarifiedScope),
    mddDraft: hashStr(state.mddDraft),
    mddStructured: hashValue(state.mddStructured),
    securitySectionMd: hashStr(state.securitySectionMd),
    securityArchitectMddDraftSnapshot: hashStr(state.securityArchitectMddDraftSnapshot),
    acceptedProposalDirective: state.acceptedProposalDirective,
    auditorFeedback: state.auditorFeedback,
    deliveryGateFixTarget: state.deliveryGateFixTarget,
    deliveryGateLoopActive: state.deliveryGateLoopActive,
    userInputAccumulated: state.userInputAccumulated,
    lastUserMessage: state.lastUserMessage,
    internalDirectives: state.internalDirectives,
  };
}

export function integrationInput(state: MDDStateType): Record<string, unknown> {
  return {
    clarifiedScope: hashStr(state.clarifiedScope),
    mddDraft: hashStr(state.mddDraft),
    mddStructured: hashValue(state.mddStructured),
    previousMddDraftForMerge: hashStr(state.previousMddDraftForMerge),
    integrationSectionMd: hashStr(state.integrationSectionMd),
    integrationArchitectMddDraftSnapshot: hashStr(state.integrationArchitectMddDraftSnapshot),
    acceptedProposalDirective: state.acceptedProposalDirective,
    auditorFeedback: state.auditorFeedback,
    userInputAccumulated: state.userInputAccumulated,
    lastUserMessage: state.lastUserMessage,
    deliveryGateFixTarget: state.deliveryGateFixTarget,
    deliveryGateLoopActive: state.deliveryGateLoopActive,
    sectionsToRun: state.sectionsToRun,
    internalDirectives: state.internalDirectives,
  };
}

/** Combined Security + Integration node: union of both nodes' input fields to avoid stale cache. */
export function securityIntegrationInput(state: MDDStateType): Record<string, unknown> {
  return {
    ...securityInput(state),
    ...integrationInput(state),
  };
}

export function llmFormatterInput(state: MDDStateType): Record<string, unknown> {
  return {
    mddStructuredKeys: state.mddStructured ? Object.keys(state.mddStructured).sort() : undefined,
    mddStructuredSnap: snapMddStructured(state.mddStructured),
  };
}

export function crossConsistencyInput(state: MDDStateType): Record<string, unknown> {
  return {
    mddDraft: hashStr(state.mddDraft),
    mddComplexity: state.mddComplexity,
  };
}

export function architectCriticInput(state: MDDStateType): Record<string, unknown> {
  return {
    // Only §§3-4 are relevant for the critic (hashed in full)
    mddDraftSection3_4: hashStr(extractSections3And4(state.mddDraft ?? "")),
    acceptedProposalDirective: state.acceptedProposalDirective,
  };
}

// ---- helpers --------------------------------------------------------------

/** sha256 (hex) of the FULL string; `undefined`/empty pass through unchanged. */
export function hashStr(s: string | undefined | null): string | undefined {
  if (!s) return s ?? undefined;
  return createHash("sha256").update(s).digest("hex");
}

/** sha256 of the JSON serialization of a (possibly large) structured value. */
function hashValue(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return hashStr(JSON.stringify(v));
}

/** Per-key sha256 of the FULL value of each mddStructured entry. */
function snapMddStructured(s: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!s) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) {
    const str = typeof v === "string" ? v : JSON.stringify(v ?? "");
    out[k] = hashStr(str) ?? "";
  }
  return out;
}

/** Extract only §§3-4 from the draft for the architect critic. */
function extractSections3And4(draft: string): string {
  const section3 = extractSectionBody(draft, /^##\s*3\.\s*Modelo\s+(?:de\s+)?datos/im);
  const section4 = extractSectionBody(draft, /^##\s*4\.\s*Contratos\s+de\s+API/im);
  return [section3, section4].filter(Boolean).join("\n\n---\n\n");
}

function extractSectionBody(draft: string, heading: RegExp): string {
  const match = heading.exec(draft);
  if (!match) return "";
  const start = match.index;
  const nextSection = /^##\s*\d+\./gm;
  nextSection.lastIndex = start + match[0].length;
  const nextMatch = nextSection.exec(draft);
  const end = nextMatch ? nextMatch.index : draft.length;
  return draft.slice(start, end).trim();
}