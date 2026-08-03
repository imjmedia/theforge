/**
 * Cross-artifact trace: pantalla → US → API → task.
 * Detects orphan user stories, missing frontend tasks, and duplicate routes.
 */

import { parseTasksV2 } from "./task-v2/tasks-parser-v2.js";
import { extractHttpEndpointsFromMarkdown } from "../ui-mcp/api-contract-endpoints.util.js";
import { parseUserStoriesMarkdown } from "../ui-mcp/ui-screens-plan.util.js";
import {
  extractV1InScopePantallaRoutes,
  extractPantallaPlanMetaFromMarkdown,
} from "../ui-mcp/ui-screens-v1-scope.util.js";

export type CrossArtifactTraceGap = {
  kind:
    | "orphan_user_story"
    | "screen_without_us"
    | "screen_without_api"
    | "screen_without_frontend_task"
    | "us_without_task"
    | "duplicate_route"
    | "api_without_task"
    | "surface_without_shell"
    | "task_ui_missing_responsive";
  ref: string;
  detail?: string;
};

export type CrossArtifactTraceReport = {
  gaps: CrossArtifactTraceGap[];
  orphanUserStories: string[];
  duplicateRoutes: string[];
  v1ScreenRoutes: string[];
};

function extractUsIdsFromMarkdown(userStoriesMarkdown: string): Set<string> {
  const ids = new Set<string>();
  for (const story of parseUserStoriesMarkdown(userStoriesMarkdown)) {
    if (story.id?.trim()) ids.add(story.id.trim());
  }
  for (const m of userStoriesMarkdown.matchAll(/\b(US-(?:CRUD|JRN|)[A-Z0-9_-]+)\b/g)) {
    if (m[1]) ids.add(m[1]);
  }
  return ids;
}

function taskCoversUserStory(tasksMarkdown: string, usId: string): boolean {
  const md = tasksMarkdown.toLowerCase();
  const id = usId.toLowerCase();
  if (md.includes(id)) return true;
  const parsed = parseTasksV2(tasksMarkdown);
  return parsed.tasks.some((t) => (t.storyRef ?? "").toLowerCase() === id);
}

function taskCoversRoute(tasksMarkdown: string, route: string): boolean {
  const norm = route.replace(/\/+$/, "") || route;
  const parsed = parseTasksV2(tasksMarkdown);
  const frontend = parsed.tasks.filter((t) => /^frontend$/i.test(t.section?.trim() ?? ""));
  const blob = frontend.length > 0
    ? frontend.map((t) => `${t.title} ${t.description} ${t.rawMarkdown}`).join("\n")
    : tasksMarkdown;
  return blob.toLowerCase().includes(norm.toLowerCase());
}

function taskCoversEndpoint(tasksMarkdown: string, method: string, path: string): boolean {
  const key = `${method.toUpperCase()} ${path}`.toLowerCase();
  return tasksMarkdown.toLowerCase().includes(key);
}

function frontendTaskMissingResponsive(tasksMarkdown: string): string[] {
  const parsed = parseTasksV2(tasksMarkdown);
  const missing: string[] = [];
  for (const t of parsed.tasks) {
    if (!/^frontend$/i.test(t.section?.trim() ?? "")) continue;
    const blob = `${t.title}\n${t.description ?? ""}\n${t.rawMarkdown ?? ""}`.toLowerCase();
    if (!/\bresponsive\s*:/i.test(blob) && !/\bviewport\b/i.test(blob)) {
      missing.push(t.id);
    }
  }
  return missing;
}

function adminRoutesWithoutShell(uiMd: string, routes: string[]): string[] {
  const hasAdminShellDoc = /admin\s*shell|adminshell/i.test(uiMd);
  if (hasAdminShellDoc) return [];
  return routes.filter((r) => /^\/admin\b/i.test(r));
}

/** Builds cross-artifact conformance report for W4 retry and preflight. */
export function buildCrossArtifactTraceReport(params: {
  userStoriesMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  tasksMarkdown?: string | null;
}): CrossArtifactTraceReport {
  const gaps: CrossArtifactTraceGap[] = [];
  const usMd = (params.userStoriesMarkdown ?? "").trim();
  const uiMd = (params.uiScreensMarkdown ?? "").trim();
  const apiMd = (params.apiContractsMarkdown ?? "").trim();
  const tasksMd = (params.tasksMarkdown ?? "").trim();

  const allUsIds = extractUsIdsFromMarkdown(usMd);
  const screenMeta = uiMd ? extractPantallaPlanMetaFromMarkdown(uiMd) : [];
  const v1Routes = uiMd ? extractV1InScopePantallaRoutes(uiMd) : [];
  const linkedUsIds = new Set<string>();

  const routeCounts = new Map<string, number>();
  for (const row of screenMeta) {
    if (row.route) {
      routeCounts.set(row.route, (routeCounts.get(row.route) ?? 0) + 1);
    }
    if (row.userStoryId) linkedUsIds.add(row.userStoryId);
    if (!row.v1InScope) continue;

    if (!row.userStoryId) {
      gaps.push({
        kind: "screen_without_us",
        ref: row.route ?? row.screenName,
        detail: "Pantalla v1 sin US trazable",
      });
    }
    if (row.v1RequiresApi && !row.primaryApi) {
      gaps.push({
        kind: "screen_without_api",
        ref: row.route ?? row.screenName,
        detail: "Pantalla v1 requiere API — generar contrato o excluir de alcance",
      });
    }
    if (row.v1RequiresApi && row.route && tasksMd && !taskCoversRoute(tasksMd, row.route)) {
      gaps.push({
        kind: "screen_without_frontend_task",
        ref: row.route,
        detail: "Pantalla v1 con API sin task Frontend",
      });
    }
  }

  for (const route of adminRoutesWithoutShell(uiMd, v1Routes)) {
    gaps.push({
      kind: "surface_without_shell",
      ref: route,
      detail: "Ruta admin sin AdminShell documentado en pantallas.md",
    });
  }

  const duplicateRoutes = [...routeCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([route]) => route);
  for (const route of duplicateRoutes) {
    gaps.push({ kind: "duplicate_route", ref: route, detail: "Ruta duplicada en pantallas.md" });
  }

  const orphanUserStories = [...allUsIds].filter((id) => !linkedUsIds.has(id));
  for (const usId of orphanUserStories) {
    gaps.push({ kind: "orphan_user_story", ref: usId, detail: "HU sin pantalla v1 enlazada" });
    if (tasksMd && !taskCoversUserStory(tasksMd, usId)) {
      gaps.push({ kind: "us_without_task", ref: usId, detail: "HU sin task con story_ref" });
    }
  }

  if (tasksMd.length > 0) {
    for (const taskId of frontendTaskMissingResponsive(tasksMd)) {
      gaps.push({
        kind: "task_ui_missing_responsive",
        ref: taskId,
        detail: "Task Frontend sin línea Responsive: o AC-UI viewport",
      });
    }
  }

  if (apiMd.length > 80 && tasksMd.length > 0) {
    for (const ep of extractHttpEndpointsFromMarkdown(apiMd)) {
      if (!taskCoversEndpoint(tasksMd, ep.method, ep.path)) {
        gaps.push({
          kind: "api_without_task",
          ref: `${ep.method} ${ep.path}`,
          detail: "Endpoint sin task Backend",
        });
      }
    }
  }

  return {
    gaps,
    orphanUserStories,
    duplicateRoutes,
    v1ScreenRoutes: v1Routes,
  };
}

export function formatCrossArtifactTraceGaps(report: CrossArtifactTraceReport, limit = 12): string[] {
  return report.gaps.slice(0, limit).map((g) => `${g.kind}: ${g.ref}${g.detail ? ` — ${g.detail}` : ""}`);
}
