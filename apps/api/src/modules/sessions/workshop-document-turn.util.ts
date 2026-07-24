import type { ChatMessage } from "@theforge/shared-types";
import { workshopFinDelimiterCovenant } from "@theforge/shared-types";
import type { WorkshopChatAction } from "../ai/intent-route.types.js";
import {
  canPersistChatDocumentEdit,
  isWorkshopFrozenDeliverableTab,
  workshopFrozenTabChatSystemNote,
} from "@theforge/shared-types";
import { stripThinkingTags } from "../ai-analysis/utils/mdd-security-parse.js";
import type { DocPersistFlags } from "./orchestrator-doc-guard.util.js";

/** Delimitador ---FIN_*--- por pestaña del Workshop. */
export const WORKSHOP_TAB_FIN_TAG: Record<string, string> = {
  mdd: "MDD",
  spec: "SPEC",
  architecture: "ARCH",
  "use-cases": "USECASES",
  "user-stories": "STORIES",
  blueprint: "BLUEPRINT",
  "api-contracts": "API",
  "logic-flows": "FLOWS",
  tasks: "TASKS",
  infra: "INFRA",
  brd: "BRD",
  benchmark: "DBGA",
  "ux-ui-guide": "UX_UI",
  phase0: "PHASE0",
};

export function shouldAllowDocumentPersist(
  action: WorkshopChatAction,
  tab?: string,
): boolean {
  return canPersistChatDocumentEdit(tab ?? "mdd", action);
}

export function frozenTabSystemPromptBlock(tab: string): string | null {
  if (!isWorkshopFrozenDeliverableTab(tab)) return null;
  return workshopFrozenTabChatSystemNote(tab);
}

export function sanitizeLlmResponse(raw: string): string {
  return stripThinkingTags(raw ?? "").trim();
}

export function buildEditModeUserPrompt(userMessage: string, activeTab?: string): string {
  const msg = userMessage.trim();
  if (!msg) return msg;
  const tab = (activeTab ?? "mdd").trim();
  const finTag = WORKSHOP_TAB_FIN_TAG[tab] ?? "DOC";
  const covenant = workshopFinDelimiterCovenant(finTag, tab === "benchmark" ? "DBGA" : tab);
  return (
    `[MODO EDICIÓN — persistir en el panel del documento]\n` +
    `${covenant}\n\n` +
    `Petición del usuario:\n${msg}`
  );
}

export function getLastAssistantMessage(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "assistant" && m.content?.trim()) {
      return m.content.trim();
    }
  }
  return undefined;
}

export function applyIntentPersistGate(
  action: WorkshopChatAction,
  flags: DocPersistFlags,
  tab?: string,
): DocPersistFlags {
  if (shouldAllowDocumentPersist(action, tab)) return flags;
  return {
    hasMdd: false,
    hasSpec: false,
    hasArch: false,
    hasUseCases: false,
    hasStories: false,
    hasBlue: false,
    hasApi: false,
    hasFlows: false,
    hasTasks: false,
    hasInfra: false,
    hasBrd: false,
    hasDbga: false,
    hasUx: false,
    hasPhase0: false,
  };
}

export function isDocumentContentNearlyIdentical(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, " ").trim();
  const nb = b.replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 200 && nb.length > 200) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    if (ratio > 0.98) return true;
  }
  return false;
}

/** Validación estructural mínima del MDD (7 secciones canónicas). */
export function validateMddStructure(content: string): { ok: true } | { ok: false; message: string } {
  const t = content.trim();
  if (t.length < 120) {
    return { ok: false, message: "MDD demasiado corto tras edición." };
  }
  const required = [1, 2, 3, 4, 5, 6, 7];
  const missing = required.filter((n) => !new RegExp(`^##\\s+${n}\\.`, "im").test(t));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `MDD incompleto: faltan secciones ${missing.join(", ")}.`,
    };
  }
  return { ok: true };
}

export function validateStructuralForTab(
  tab: string,
  content: string,
): { ok: true } | { ok: false; message: string } {
  if (tab === "mdd") return validateMddStructure(content);
  const t = content.trim();
  if (t.length < 40) {
    return { ok: false, message: "Documento demasiado corto tras edición." };
  }
  return { ok: true };
}

export type DocumentTurnMetrics = {
  tab: string;
  action: WorkshopChatAction;
  source: string;
  confidence: number;
  hadDelimiter: boolean;
  persisted: boolean;
  retried: boolean;
};

export function logDocumentTurnMetrics(
  logger: { log: (msg: string) => void },
  metrics: DocumentTurnMetrics,
): void {
  logger.log(
    `[DocumentTurn] tab=${metrics.tab} action=${metrics.action} source=${metrics.source} ` +
      `confidence=${metrics.confidence.toFixed(2)} hadDelimiter=${metrics.hadDelimiter} ` +
      `persisted=${metrics.persisted} retried=${metrics.retried}`,
  );
}

export function hadAnyDocumentDelimiter(flags: DocPersistFlags): boolean {
  return Boolean(
    flags.hasMdd ||
      flags.hasSpec ||
      flags.hasArch ||
      flags.hasUseCases ||
      flags.hasStories ||
      flags.hasBlue ||
      flags.hasApi ||
      flags.hasFlows ||
      flags.hasTasks ||
      flags.hasInfra ||
      flags.hasBrd ||
      flags.hasDbga ||
      flags.hasUx ||
      flags.hasPhase0,
  );
}
