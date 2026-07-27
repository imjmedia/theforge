/**
 * @fileoverview Log de ediciones de agentes MDD — tracking y diffs.
 */

import type { MDDState } from "../state/index.js";
import type { MddAgentEditKind, MddAgentEditLogEntry } from "../estimation/estimation.types.js";
import { diffMddSectionTouches } from "./mdd-section-diff.util.js";

export const MDD_AGENT_EDIT_LOG_MAX_ENTRIES = 100;

const WHY_MAX_LEN = 280;

const DETERMINISTIC_NODES = new Set([
  "cross_consistency_checker",
  "diagram_injector",
  "format_after_architect",
  "format_after_redactor",
  "format_sec_int",
  "structured_hydrator",
  "prepare_output",
]);

const MERGE_NODES = new Set(["merge_section1_only", "tail_parallel"]);

type InternalDirective = { from: string; to: string; message: string };

function truncateWhy(text: string | undefined): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length <= WHY_MAX_LEN ? t : `${t.slice(0, WHY_MAX_LEN - 1)}…`;
}

export function inferMddAgentEditKind(node: string): MddAgentEditKind {
  if (MERGE_NODES.has(node)) return "merge";
  if (DETERMINISTIC_NODES.has(node) || node.startsWith("format_")) return "deterministic";
  return "llm";
}

export function buildMddEditWhy(state: MDDState): string | undefined {
  const parts = [
    state.currentStepGoal,
    state.acceptedProposalDirective,
    state.planUserIntent,
    state.auditorFeedback,
  ]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return truncateWhy(parts.join(" | "));
}

function directivesForNode(
  directives: InternalDirective[] | undefined,
  node: string,
): InternalDirective[] | undefined {
  const list = directives ?? [];
  const incoming = list.filter((d) => d.to === node || d.to === "all");
  return incoming.length > 0 ? incoming : undefined;
}

function directivesAddedByNode(
  before: InternalDirective[] | undefined,
  after: InternalDirective[] | undefined,
  node: string,
): InternalDirective[] | undefined {
  const prevKeys = new Set((before ?? []).map((d) => `${d.from}|${d.to}|${d.message}`));
  const added = (after ?? []).filter(
    (d) => d.from === node && !prevKeys.has(`${d.from}|${d.to}|${d.message}`),
  );
  return added.length > 0 ? added : undefined;
}

export function appendMddAgentEditLog(
  log: MddAgentEditLogEntry[],
  entry: MddAgentEditLogEntry,
  cap = MDD_AGENT_EDIT_LOG_MAX_ENTRIES,
): void {
  log.push(entry);
  if (log.length > cap) {
    log.splice(0, log.length - cap);
  }
}

/** Tracks draft mutations during LangGraph stream (updates → values) for edit log entries. */
export class MddStreamEditLogTracker {
  readonly log: MddAgentEditLogEntry[] = [];
  private lastDraft: string;
  private lastDirectives: InternalDirective[] | undefined;
  private pendingNode: string | null = null;

  constructor(initialDraft: string, initialDirectives?: InternalDirective[]) {
    this.lastDraft = (initialDraft ?? "").trim();
    this.lastDirectives = initialDirectives;
  }

  noteNodeUpdate(nodeName: string | undefined): void {
    if (nodeName && nodeName !== "__interrupt__") {
      this.pendingNode = nodeName;
    }
  }

  /** Nodo cuyo `updates` precedió al último `values` (para live draft scoped). */
  peekPendingNode(): string | null {
    return this.pendingNode;
  }

  /** Borrador antes del último `noteValuesState` (para no publicar MDD completo sin merge). */
  getLastDraft(): string {
    return this.lastDraft;
  }

  noteValuesState(state: MDDState): void {
    const afterDraft = (state.mddDraft ?? "").trim();
    if (afterDraft === this.lastDraft) return;

    const node = this.pendingNode ?? "unknown";
    const diff = diffMddSectionTouches(this.lastDraft, afterDraft);
    const hasDraftLenChange = diff.beforeLen !== diff.afterLen;
    if (diff.sectionsTouched.length === 0 && !hasDraftLenChange) {
      this.lastDraft = afterDraft;
      this.lastDirectives = state.internalDirectives;
      return;
    }

    appendMddAgentEditLog(this.log, {
      ts: new Date().toISOString(),
      node,
      kind: inferMddAgentEditKind(node),
      sectionsTouched: diff.sectionsTouched,
      why: buildMddEditWhy(state),
      directivesIn: directivesForNode(state.internalDirectives, node),
      directivesOut: directivesAddedByNode(
        this.lastDirectives,
        state.internalDirectives,
        node,
      ),
      beforeLen: diff.beforeLen,
      afterLen: diff.afterLen,
      sectionLens: Object.keys(diff.sectionLens).length > 0 ? diff.sectionLens : undefined,
    });

    this.lastDraft = afterDraft;
    this.lastDirectives = state.internalDirectives;
  }
}
