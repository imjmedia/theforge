/**
 * Heuristic ScreenSpec[] when MCP gráfico is inactive.
 */

import type { ScreenSpec } from "@theforge/shared-types";
import { resolveStackPreset, type StackPresetResolution } from "@theforge/shared-types";
import type { PantallaPlanItem } from "./ui-screens-plan.util.js";

export type UiStackHint = Pick<
  StackPresetResolution,
  "adapterLabel" | "packageScope" | "stackBase"
>;

const UI_HINT_COMPONENTS: Record<string, string[]> = {
  table: ["DataTable", "PageHeader", "EmptyState", "PaginationBar"],
  form: ["Form", "PageHeader", "Button", "Input"],
  dashboard: ["PageHeader", "Card", "Chart", "EmptyState"],
  chat: ["ChatShell", "MessageList", "Composer", "EmptyState"],
  kanban: ["KanbanBoard", "PageHeader", "Card"],
  calendar: ["Calendar", "PageHeader", "Form"],
  wizard: ["Wizard", "PageHeader", "Button", "Form"],
};

const DEFAULT_COMPONENTS = ["PageHeader", "DataTable", "EmptyState"];

/** Resolves UI stack from MDD/Blueprint (re-exported shape for pantallas sync). */
export function resolveUiStackHint(
  mddMarkdown?: string | null,
  blueprintMarkdown?: string | null,
): UiStackHint {
  const preset = resolveStackPreset(mddMarkdown, blueprintMarkdown);
  return {
    adapterLabel: preset.adapterLabel,
    packageScope: preset.packageScope,
    stackBase: preset.stackBase,
  };
}

function componentsForHint(uiHint?: string): string[] {
  if (!uiHint) return DEFAULT_COMPONENTS;
  return UI_HINT_COMPONENTS[uiHint] ?? DEFAULT_COMPONENTS;
}

function inferLayout(uiHint?: string, route?: string): string {
  const isAdmin = /\/admin\b/i.test(route ?? "");
  if (uiHint === "chat") return isAdmin ? "AdminShell + split-pane" : "AppShell + full-width";
  if (uiHint === "wizard") return "AppShell + centered narrow column";
  if (uiHint === "dashboard") return "AppShell + grid KPI 2×2";
  return isAdmin ? "AdminShell + content max-w-7xl" : "AppShell + content max-w-6xl";
}

function inferResponsive(uiHint?: string): string {
  if (uiHint === "table" || uiHint === "kanban" || uiHint === "dashboard") {
    return "sm stack · md table 2-col · lg full grid · xl sidebar+main";
  }
  if (uiHint === "chat") {
    return "sm full-screen · md split 40/60 · lg sidebar+chat";
  }
  if (uiHint === "form" || uiHint === "wizard") {
    return "sm single column · md max-w-md centered · lg max-w-lg";
  }
  return "sm single column · md 2-col where applicable · lg sidebar nav";
}

/** Builds ScreenSpec[] from pantallas plan without MCP resolve_component. */
export function buildHeuristicScreensFromPlan(
  plan: PantallaPlanItem[],
  stackHint: UiStackHint,
): ScreenSpec[] {
  const screens: ScreenSpec[] = [];

  for (const item of plan) {
    const componentNames = componentsForHint(item.uiHint);
    screens.push({
      name: item.screenName,
      purpose: item.purpose,
      components: componentNames.map((component) => ({
        component,
        package: stackHint.packageScope,
        entity: item.source === "hu-only" ? undefined : item.name,
        props: {
          layout: inferLayout(item.uiHint, item.route),
          responsive: inferResponsive(item.uiHint),
          surface: /\/admin\b/i.test(item.route ?? "") ? "admin" : "product",
        },
      })),
      endpoints: item.restEndpoint ? [item.restEndpoint] : [],
    });
  }

  return screens;
}

export { inferLayout, inferResponsive };
