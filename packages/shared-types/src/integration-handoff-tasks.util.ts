import type { IntegrationHandoffItem } from "./project-integration.js";
import type { AriadneTasksHydrationSource } from "./hydrate-tasks-from-ariadne-pack.util.js";
import { hydrateTasksFromAriadnePack } from "./hydrate-tasks-from-ariadne-pack.util.js";

export type { AriadneTasksHydrationSource };

/** Deliverable keys not copied from baseline snapshot when seeding integration handoff stages. */
export const INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS = [
  "tasksContent",
  "userStoriesContent",
  "logicFlowsContent",
] as const;

export type IntegrationHandoffSeedExcludeKey = (typeof INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS)[number];

export type IntegrationHandoffTasksSource =
  | "cursor_tasks_markdown"
  | "handoff_items"
  | "ariadne_tasks_json_seed"
  | "ariadne_cursor_tasks_markdown"
  | "ariadne_change_plan_seed";

/** Metadata persisted on Stage.legacyChangeState after handoff tasks import. */
export interface IntegrationHandoffTasksMeta {
  source: IntegrationHandoffTasksSource;
  importedAt: string;
  /** Alias legible para MCP/UI (p. ej. ariadne_tasks_json_seed). */
  tasksSource?: AriadneTasksHydrationSource;
  idempotencyKey?: string;
  packGeneratedAt?: string;
  validationWarnings?: string[];
}

/**
 * Builds spec-kit-compatible tasks markdown from NEW-LEG handoff items.
 * Domain-agnostic: one checklist item per handoff item (+ nested AC when present).
 */
export function buildHandoffTasksMarkdown(
  items: IntegrationHandoffItem[],
  options?: { title?: string },
): string {
  const title = options?.title?.trim() || "Integración handoff";
  const lines: string[] = [
    `# Tasks — ${title}`,
    "",
    "> SSOT desde handoff NEW-LEG. No regenerar vía legacy_generate_deliverables.",
    "",
    "## Handoff",
    "",
  ];
  for (const item of items) {
    const kind = item.kind ?? "requirement";
    if (kind !== "requirement") continue;
    const desc = (item.description ?? "").replace(/\s+/g, " ").trim();
    lines.push(`- [ ] **${item.id}** — ${item.title}${desc ? `: ${desc.slice(0, 240)}` : ""}`);
    if (item.acceptanceCriteria?.length) {
      for (const ac of item.acceptanceCriteria) {
        lines.push(`  - [ ] ${ac}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Resolves tasks markdown for an integration stage: Ariadne cursor_tasks_markdown wins;
 * otherwise synthesizes from handoff items.
 */
export function resolveIntegrationHandoffTasksMarkdown(input: {
  cursorTasksMarkdown?: string | null;
  handoffItems?: IntegrationHandoffItem[];
  title?: string;
}): { markdown: string; source: IntegrationHandoffTasksSource } | null {
  const hydrated = hydrateTasksFromAriadnePack({
    handoffItems: input.handoffItems,
    cursorTasksMarkdown: input.cursorTasksMarkdown,
  });
  if (hydrated) {
    return { markdown: hydrated.tasksContent, source: hydrated.source };
  }
  const items = (input.handoffItems ?? []).filter((i) => i.id?.trim() && i.title?.trim());
  if (!items.length) return null;
  return {
    markdown: buildHandoffTasksMarkdown(items, { title: input.title }),
    source: "handoff_items",
  };
}

/** True when legacy cascade must not LLM-regenerate tasks (handoff SSOT). */
export function shouldSkipLegacyTasksGeneration(stage: {
  legacyChangeState?: unknown;
}): boolean {
  if (stage.legacyChangeState == null || typeof stage.legacyChangeState !== "object") {
    return false;
  }
  const state = stage.legacyChangeState as {
    integrationHandoffTasks?: IntegrationHandoffTasksMeta | null;
    ariadneChangePack?: { tasksImportedFromHandoff?: boolean } | null;
  };
  if (state.integrationHandoffTasks?.source) return true;
  if (state.ariadneChangePack?.tasksImportedFromHandoff === true) return true;
  return false;
}
