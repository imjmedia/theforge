import type {
  AriadneTasksJsonSeedPayload,
  ValidateTasksJsonV2Result,
} from "./hydrate-tasks-from-ariadne-pack.util.js";
import { validateTasksJsonV2 } from "./hydrate-tasks-from-ariadne-pack.util.js";

export type AriadneChangePlanSeedTask = {
  id?: string;
  title?: string;
  files?: string[];
  filesToModify?: string[];
  symbols?: string[];
  phase?: string;
  criterion?: string;
  dependsOn?: string[];
  depends_on?: string[];
  status?: string;
  evidence?: unknown[];
};

export type AriadneChangePlanSeedPayload = {
  version?: string;
  projectId?: string;
  changeDescription?: string;
  ariadneChangeId?: string;
  tasks?: AriadneChangePlanSeedTask[];
  filesToModify?: Array<{ path?: string; repoId?: string } | string>;
};

function normalizeFiles(task: AriadneChangePlanSeedTask): string[] {
  const fromFiles = Array.isArray(task.files) ? task.files.map(String).filter(Boolean) : [];
  if (fromFiles.length) return fromFiles;
  const fromModify = Array.isArray(task.filesToModify)
    ? task.filesToModify.map(String).filter(Boolean)
    : [];
  return fromModify;
}

/** Maps Ariadne ChangePlan v1.0 seed (Gate 2) → Forge tasksJson v2 seed shape. */
export function mapChangePlanSeedToTasksJsonPayload(
  raw: unknown,
  meta?: { projectId?: string; changeDescription?: string; ariadneChangeId?: string },
): ValidateTasksJsonV2Result {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["change_plan_seed must be an object"] };
  }
  const plan = raw as AriadneChangePlanSeedPayload;
  const tasksRaw = Array.isArray(plan.tasks) ? plan.tasks : [];
  const tasks = tasksRaw
    .map((task, i) => {
      const id = String(task.id ?? `T-${String(i + 1).padStart(3, "0")}`).trim();
      const title = String(task.title ?? id).trim();
      const files = normalizeFiles(task);
      if (!id || !title || !files.length) return null;
      return {
        id,
        title,
        files,
        symbols: task.symbols ?? [],
        phase: task.phase,
        criterion: task.criterion,
        status: task.status ?? "pending",
        dependsOn: task.dependsOn ?? task.depends_on ?? [],
        evidence: task.evidence ?? [],
        source: "ariadne_change_plan_seed",
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const filePaths = new Set<string>();
  for (const t of tasks) for (const f of t.files) filePaths.add(f);
  if (Array.isArray(plan.filesToModify)) {
    for (const entry of plan.filesToModify) {
      if (typeof entry === "string" && entry.trim()) filePaths.add(entry.trim());
      else if (entry && typeof entry === "object" && typeof entry.path === "string") {
        filePaths.add(entry.path.trim());
      }
    }
  }

  const payload: AriadneTasksJsonSeedPayload = {
    schemaVersion: "2",
    source: "ariadne",
    projectId: plan.projectId ?? meta?.projectId,
    changeDescription: plan.changeDescription ?? meta?.changeDescription,
    ariadneChangeId: meta?.ariadneChangeId,
    promotionScope: "integration_handoff",
    tasks,
    files: [...filePaths].map((path) => ({ path })),
  };

  return validateTasksJsonV2(payload);
}
