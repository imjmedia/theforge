/**
 * Validación estructural determinista de tasks.md (truncado, secciones, Frontend, API drift).
 */

import { parseTasksV2 } from "../engine/task-v2/tasks-parser-v2.js";
import {
  buildTasksCoverageChecklist,
  extractPantallaRoutes,
  formatTasksCoverageChecklistGaps,
} from "./tasks-coverage-checklist.util.js";
import { detectWebSurfaces } from "@theforge/shared-types";

export { extractPantallaRoutes };

export type TasksStructuralReport = {
  ok: boolean;
  gaps: string[];
  yamlTaskIds: number;
  parsedTaskCount: number;
  frontendTaskCount: number;
  pantallaRoutes: number;
  truncated: boolean;
};

function countYamlTaskIds(markdown: string): number {
  const ids = markdown.match(/^id:\s*(T-\d+)/gm);
  if (!ids) return 0;
  return new Set(ids.map((s) => s.replace(/^id:\s*/i, "").trim())).size;
}

/** Documento cortado o front-matter sin cerrar. */
export function isTasksDocumentTruncated(markdown: string): boolean {
  const trimmed = (markdown ?? "").trim();
  if (trimmed.length < 48) return true;

  let fenceCount = 0;
  for (const line of trimmed.split("\n")) {
    if (line.trim() === "---") fenceCount += 1;
  }
  if (fenceCount % 2 !== 0) return true;

  const tail = trimmed.split("\n").filter((l) => l.trim()).slice(-3).join("\n");
  if (/^target_files:\s*$/m.test(tail)) return true;
  if (/^\s+-\s+apps\/backend\/src\/application\/?\s*$/m.test(tail)) return true;

  // Detect unclosed YAML block: last task block has id/title/target_files but no closing ---
  // Pattern: id: T-xxx ... title: ... target_files: - file1 - file2 ... (end of document)
  // A complete block ends with "---" after the file list
  const lastTaskIdx = trimmed.lastIndexOf("id: T-");
  if (lastTaskIdx >= 0) {
    const tailFromLastTask = trimmed.slice(lastTaskIdx);
    // Has id: T-xxx, title:, and target_files: but no --- after target_files section
    if (
      /^id:\s*T-\d+[\s\S]*^title:\s*[^\n]+[\s\S]*^target_files:\s*$/m.test(tailFromLastTask.slice(0, 2_000)) &&
      !/\n---\s*\n/m.test(tailFromLastTask)
    ) {
      return true;
    }
  }

  return false;
}

function hasCanonicalSection(markdown: string, pattern: RegExp): boolean {
  return pattern.test(markdown);
}

function countFrontendTasks(markdown: string): number {
  let count = 0;
  for (const m of markdown.matchAll(/^section:\s*(.+)$/gim)) {
    if (/^frontend$/i.test((m[1] ?? "").trim())) count += 1;
  }
  if (count > 0) return count;
  if (hasCanonicalSection(markdown, /^##\s+Frontend tasks\b/im)) {
    const sectionBody = markdown.split(/^##\s+Frontend tasks\b/im)[1]?.split(/^##\s+/m)[0] ?? "";
    return countYamlTaskIds(sectionBody);
  }
  return 0;
}

export function evaluateTasksStructure(params: {
  tasksMarkdown: string;
  uiScreensMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  mddMarkdown?: string | null;
  blueprintMarkdown?: string | null;
  infraMarkdown?: string | null;
}): TasksStructuralReport {
  const tasksMarkdown = (params.tasksMarkdown ?? "").trim();
  const gaps: string[] = [];
  const truncated = isTasksDocumentTruncated(tasksMarkdown);
  const yamlTaskIds = countYamlTaskIds(tasksMarkdown);
  const parsed = parseTasksV2(tasksMarkdown);
  const parsedTaskCount = parsed.tasks.length;
  const pantallaRoutes = extractPantallaRoutes(params.uiScreensMarkdown ?? "").length;
  const frontendTaskCount = countFrontendTasks(tasksMarkdown);
  const hasWebSurfaces = detectWebSurfaces(params.mddMarkdown, params.blueprintMarkdown);

  if (truncated) {
    gaps.push("Tasks truncado: front-matter sin cerrar o documento cortado a mitad de tarea.");
  }

  if (!hasCanonicalSection(tasksMarkdown, /^##\s+Backend tasks\b/im)) {
    gaps.push("Falta sección canónica ## Backend tasks (no sustituir por ## Fase N).");
  }

  if (!hasCanonicalSection(tasksMarkdown, /^##\s+Infra(?:estructura)? tasks\b/im)) {
    gaps.push("Falta sección canónica ## Infra tasks o ## Infraestructura tasks.");
  }

  if (pantallaRoutes > 0 && frontendTaskCount === 0) {
    gaps.push(
      `${pantallaRoutes} rutas en pantallas.md pero 0 tareas con section: Frontend — requerido 1 task Frontend por vista.`,
    );
  }

  if (hasWebSurfaces && frontendTaskCount === 0) {
    gaps.push(
      "Superficie web declarada en MDD/Blueprint pero 0 tareas Frontend — genera pantallas upstream o tasks UI.",
    );
  }

  if (yamlTaskIds >= 5 && parsedTaskCount < Math.ceil(yamlTaskIds * 0.65)) {
    gaps.push(
      `Parser v2: ${parsedTaskCount} tareas vs ${yamlTaskIds} bloques id: — un bloque YAML --- por tarea, sin concatenar.`,
    );
  }

  const coverage = buildTasksCoverageChecklist({
    tasksMarkdown,
    apiContractsMarkdown: params.apiContractsMarkdown,
    uiScreensMarkdown: params.uiScreensMarkdown,
    mddMarkdown: params.mddMarkdown,
    infraMarkdown: params.infraMarkdown,
  });
  gaps.push(...formatTasksCoverageChecklistGaps(coverage));

  const parseErrors = parsed.errors.filter((e) => e.severity === "error");
  if (parseErrors.length > 0) {
    gaps.push(`Parser tasks v2: ${parseErrors.length} error(es) de formato YAML.`);
  }

  const orphans = parsed.tasks.filter(
    (t) =>
      (!taskHasScopeInStructure(t) || !taskHasVerificationInStructure(t)) &&
      t.changeType !== "run" &&
      t.changeType !== "configure",
  );
  if (orphans.length > 0) {
    gaps.push(
      `${orphans.length} tarea(s) huérfana(s) sin scope.include o verification/done_when: ${orphans.map((t) => t.id).slice(0, 5).join(", ")}`,
    );
  }

  return {
    ok: gaps.length === 0,
    gaps,
    yamlTaskIds,
    parsedTaskCount,
    frontendTaskCount,
    pantallaRoutes,
    truncated,
  };
}

function taskHasScopeInStructure(t: {
  targetFiles: string[];
  scopeInclude?: string[];
}): boolean {
  return t.targetFiles.length > 0 || (t.scopeInclude?.length ?? 0) > 0;
}

function taskHasVerificationInStructure(t: {
  verification: { command?: string; checklist?: string[]; steps?: unknown[] };
  doneWhen?: string[];
  testCommand?: string;
}): boolean {
  const v = t.verification;
  if (t.testCommand || v.command || (v.checklist?.length ?? 0) > 0 || (v.steps?.length ?? 0) > 0) {
    return true;
  }
  return (t.doneWhen?.length ?? 0) > 0;
}
