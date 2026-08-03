/**
 * Hidratación de tasksJson / tasksContent desde handoff Ariadne (integración NEW→LEG).
 * @see docs/contracts/theforge-tasks-hydration-from-ariadne-v1.md (Ariadne)
 */

import type { IntegrationHandoffItem, IntegrationHandoffItemKind } from "./project-integration.js";

export const INTEGRATION_HANDOFF_ITEM_KINDS = [
  "requirement",
  "tasks_json_seed",
  "cursor_tasks_markdown",
  "integration_scope",
] as const satisfies readonly IntegrationHandoffItemKind[];

export type AriadneTasksHydrationSource =
  | "ariadne_tasks_json_seed"
  | "ariadne_cursor_tasks_markdown"
  | "handoff_items";

export interface AriadneIntegrationScopePayload {
  mode?: string;
  taskSource?: string;
  taskSourceFallback?: string;
  skipBaselineDeliverables?: string[];
}

export interface AriadneTasksJsonSeedTask {
  id: string;
  title: string;
  files?: string[];
  symbols?: string[];
  phase?: string;
  criterion?: string;
  status?: string;
  source?: string;
  description?: string;
}

export interface AriadneTasksJsonSeedPayload {
  schemaVersion: string;
  source?: string;
  projectId?: string;
  changeDescription?: string;
  ariadneChangeId?: string;
  promotionScope?: string;
  tasks: AriadneTasksJsonSeedTask[];
  files?: Array<{ path?: string; repoId?: string }>;
}

export type StoredTasksJsonV2 = {
  version: string;
  schemaVersion?: string;
  source?: string;
  projectId?: string;
  changeDescription?: string;
  ariadneChangeId?: string;
  promotionScope?: string;
  tasks: Array<Record<string, unknown>>;
  files?: unknown[];
};

export type ValidateTasksJsonV2Result =
  | { ok: true; payload: AriadneTasksJsonSeedPayload }
  | { ok: false; errors: string[] };

export type HydrateTasksFromAriadnePackResult = {
  /** Present when seed JSON validated; markdown-only fallback omits (auto-parse on persist). */
  tasksJson?: StoredTasksJsonV2 | null;
  tasksContent: string;
  source: AriadneTasksHydrationSource;
  integrationScope: AriadneIntegrationScopePayload | null;
  skipBaselineDeliverables: string[];
};

function handoffKind(item: IntegrationHandoffItem): IntegrationHandoffItemKind {
  const k = (item as IntegrationHandoffItem & { kind?: string }).kind;
  if (k && INTEGRATION_HANDOFF_ITEM_KINDS.includes(k as IntegrationHandoffItemKind)) {
    return k as IntegrationHandoffItemKind;
  }
  return "requirement";
}

function readHandoffPayload(item: IntegrationHandoffItem): unknown {
  const payload = (item as IntegrationHandoffItem & { payload?: unknown }).payload;
  if (payload != null) {
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        return payload;
      }
    }
    return payload;
  }
  const desc = item.description?.trim();
  if (!desc) return null;
  if (desc.startsWith("{") || desc.startsWith("[")) {
    try {
      return JSON.parse(desc) as unknown;
    } catch {
      return desc;
    }
  }
  return desc;
}

export function findHandoffItemByKind(
  items: IntegrationHandoffItem[],
  kind: IntegrationHandoffItemKind,
): IntegrationHandoffItem | undefined {
  return items.find((item) => handoffKind(item) === kind);
}

export function extractIntegrationScopeFromHandoff(
  items: IntegrationHandoffItem[],
): AriadneIntegrationScopePayload | null {
  const item = findHandoffItemByKind(items, "integration_scope");
  if (!item) return null;
  const raw = readHandoffPayload(item);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    mode: typeof o.mode === "string" ? o.mode : undefined,
    taskSource: typeof o.taskSource === "string" ? o.taskSource : undefined,
    taskSourceFallback: typeof o.taskSourceFallback === "string" ? o.taskSourceFallback : undefined,
    skipBaselineDeliverables: Array.isArray(o.skipBaselineDeliverables)
      ? o.skipBaselineDeliverables.map(String)
      : undefined,
  };
}

/** Valida payload Ariadne tasks_json_seed (schemaVersion 2, tasks con id/title/files). */
export function validateTasksJsonV2(raw: unknown): ValidateTasksJsonV2Result {
  const errors: string[] = [];
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["payload must be an object"] };
  }
  const o = raw as Record<string, unknown>;
  const schemaVersion = String(o.schemaVersion ?? o.version ?? "").trim();
  if (schemaVersion !== "2" && schemaVersion !== "2.0") {
    errors.push(`schemaVersion must be "2" (got "${schemaVersion || "missing"}")`);
  }
  if (!Array.isArray(o.tasks) || o.tasks.length === 0) {
    errors.push("tasks[] must be non-empty");
  } else {
    o.tasks.forEach((task, i) => {
      if (!task || typeof task !== "object") {
        errors.push(`tasks[${i}] must be an object`);
        return;
      }
      const t = task as Record<string, unknown>;
      if (typeof t.id !== "string" || !t.id.trim()) {
        errors.push(`tasks[${i}].id is required`);
      }
      if (typeof t.title !== "string" || !t.title.trim()) {
        errors.push(`tasks[${i}].title is required`);
      }
      const files = t.files ?? t.targetFiles;
      if (!Array.isArray(files) || files.length === 0) {
        errors.push(`tasks[${i}].files[] must be non-empty`);
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: o as unknown as AriadneTasksJsonSeedPayload };
}

export function normalizeAriadneTasksJsonSeedToStore(
  payload: AriadneTasksJsonSeedPayload,
): StoredTasksJsonV2 {
  return {
    version: "2.0",
    schemaVersion: "2",
    source: payload.source ?? "ariadne",
    projectId: payload.projectId,
    changeDescription: payload.changeDescription,
    ariadneChangeId: payload.ariadneChangeId,
    promotionScope: payload.promotionScope,
    files: payload.files,
    tasks: payload.tasks.map((task) => ({
      id: task.id.trim(),
      title: task.title.trim(),
      description: (task.criterion ?? task.description ?? "").trim(),
      status: task.status ?? "pending",
      targetFiles: [...(task.files ?? [])],
      files: [...(task.files ?? [])],
      symbols: task.symbols ?? [],
      phase: task.phase,
      criterion: task.criterion,
      source: task.source ?? "ariadne_change_plan_seed",
      section: task.phase?.trim() || "Integration",
      checkpoint: "Handoff",
      changeType: "modify",
      scopeInclude: [],
      scopeExclude: [],
      dependencies: [],
      parallel: false,
      requirements: task.criterion ? [task.criterion] : [],
      constraints: [],
      doneWhen: [],
      inferenceRules: [],
      verification: {},
    })),
  };
}

/** Markdown preview con checkboxes + paths (Workshop / fallback legible). */
export function buildTasksPreviewMarkdownFromTasksJson(tasksJson: unknown): string {
  if (tasksJson == null || typeof tasksJson !== "object") return "";
  const root = tasksJson as Record<string, unknown>;
  const tasks = Array.isArray(root.tasks) ? root.tasks : [];
  if (!tasks.length) return "";

  const lines: string[] = [
    "# Tasks",
    "",
    "> SSOT hidratado desde pack Ariadne (tasks_json_seed / cursor_tasks_markdown).",
    "",
    "## Integration",
    "",
  ];

  for (const raw of tasks) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = String(t.id ?? "").trim();
    const title = String(t.title ?? "").trim();
    if (!id || !title) continue;
    const done = String(t.status ?? "").toLowerCase() === "done";
    const files = Array.isArray(t.targetFiles)
      ? t.targetFiles.map(String)
      : Array.isArray(t.files)
        ? t.files.map(String)
        : [];
    lines.push(`- [${done ? "x" : " "}] ${id}: ${title}`);
    if (files.length) {
      lines.push(`  - **Files:** ${files.map((f) => `\`${f}\``).join(", ")}`);
    }
    const criterion = typeof t.criterion === "string" ? t.criterion.trim() : "";
    if (criterion) lines.push(`  - **Criterion:** ${criterion}`);
  }
  return lines.join("\n");
}

function extractTasksJsonSeedFromHandoff(
  items: IntegrationHandoffItem[],
): ValidateTasksJsonV2Result {
  const item = findHandoffItemByKind(items, "tasks_json_seed");
  if (!item) return { ok: false, errors: ["missing tasks_json_seed handoff item"] };
  const raw = readHandoffPayload(item);
  return validateTasksJsonV2(raw);
}

function extractCursorTasksMarkdownFromHandoff(
  items: IntegrationHandoffItem[],
  packCursorMarkdown?: string | null,
): string | null {
  const pack = packCursorMarkdown?.trim();
  if (pack) return pack;
  const item = findHandoffItemByKind(items, "cursor_tasks_markdown");
  if (!item) return null;
  const raw = readHandoffPayload(item);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (item.description?.trim() && handoffKind(item) === "cursor_tasks_markdown") {
    return item.description.trim();
  }
  return null;
}

export function isIntegrationHandoffScope(
  scope: AriadneIntegrationScopePayload | null,
): boolean {
  return scope?.mode === "integration_handoff";
}

/**
 * Resuelve tasksJson + tasksContent desde handoff Ariadne.
 * Prioridad: integration_scope.taskSource → fallback → pack.cursorTasksMarkdown.
 */
export function hydrateTasksFromAriadnePack(input: {
  handoffItems?: IntegrationHandoffItem[];
  cursorTasksMarkdown?: string | null;
}): HydrateTasksFromAriadnePackResult | null {
  const items = input.handoffItems ?? [];
  const scope = extractIntegrationScopeFromHandoff(items);
  const skipBaseline = scope?.skipBaselineDeliverables ?? [];
  const primarySource = scope?.taskSource ?? "tasks_json_seed";
  const fallbackSource = scope?.taskSourceFallback ?? "cursor_tasks_markdown";

  const trySeed = (): HydrateTasksFromAriadnePackResult | null => {
    const validated = extractTasksJsonSeedFromHandoff(items);
    if (!validated.ok) return null;
    const tasksJson = normalizeAriadneTasksJsonSeedToStore(validated.payload);
    const cursorMd = extractCursorTasksMarkdownFromHandoff(items, input.cursorTasksMarkdown);
    const tasksContent =
      cursorMd?.trim() || buildTasksPreviewMarkdownFromTasksJson(tasksJson);
    return {
      tasksJson,
      tasksContent,
      source: "ariadne_tasks_json_seed",
      integrationScope: scope,
      skipBaselineDeliverables: skipBaseline,
    };
  };

  const tryCursorMarkdown = (): HydrateTasksFromAriadnePackResult | null => {
    const md = extractCursorTasksMarkdownFromHandoff(items, input.cursorTasksMarkdown);
    if (!md) return null;
    return {
      tasksContent: md,
      source: "ariadne_cursor_tasks_markdown",
      integrationScope: scope,
      skipBaselineDeliverables: skipBaseline,
    };
  };

  if (primarySource === "tasks_json_seed") {
    const fromSeed = trySeed();
    if (fromSeed) return fromSeed;
    if (fallbackSource === "cursor_tasks_markdown") {
      const fromMd = tryCursorMarkdown();
      if (fromMd) return fromMd;
    }
  } else if (primarySource === "cursor_tasks_markdown") {
    const fromMd = tryCursorMarkdown();
    if (fromMd) return fromMd;
    if (fallbackSource === "tasks_json_seed") {
      const fromSeed = trySeed();
      if (fromSeed) return fromSeed;
    }
  }

  // Sin integration_scope: intentar seed directo, luego markdown empaquetado
  const directSeed = trySeed();
  if (directSeed) return directSeed;
  const directMd = tryCursorMarkdown();
  if (directMd) return directMd;

  return null;
}

/** True cuando el pack incluye scope de integración o ítems seed de tasks. */
export function packHasAriadneTasksHydration(input: {
  handoffItems?: IntegrationHandoffItem[];
  cursorTasksMarkdown?: string | null;
}): boolean {
  return hydrateTasksFromAriadnePack(input) != null;
}
