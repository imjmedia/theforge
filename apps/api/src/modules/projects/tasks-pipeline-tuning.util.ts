import {
  TASKS_PIPELINE_MAX_REPAIRS,
  TASKS_PIPELINE_MAX_REPAIRS_TRUNCATED,
} from "@theforge/shared-types";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Ítems del plan por llamada al redactor (default 24; perfil tasksDoc permite salida grande). */
export function resolveTasksRedactorBatchSize(): number {
  return clampInt(readEnvInt("TASKS_REDACTOR_BATCH_SIZE", 24), 8, 36);
}

/** Lotes de redacción en paralelo (default 3; subir/bajar vía TASKS_REDACTOR_CONCURRENCY). */
export function resolveTasksRedactorConcurrency(): number {
  return clampInt(readEnvInt("TASKS_REDACTOR_CONCURRENCY", 3), 1, 4);
}

export function resolveTasksPipelineMaxRepairs(options: {
  truncated: boolean;
  taskDeficitRatio: number;
}): number {
  const base = options.truncated
    ? clampInt(
        readEnvInt("TASKS_PIPELINE_MAX_REPAIRS_TRUNCATED", TASKS_PIPELINE_MAX_REPAIRS_TRUNCATED),
        1,
        5,
      )
    : clampInt(
        readEnvInt("TASKS_PIPELINE_MAX_REPAIRS", TASKS_PIPELINE_MAX_REPAIRS),
        0,
        4,
      );

  if (options.taskDeficitRatio < 0.5) {
    return Math.max(base, clampInt(readEnvInt("TASKS_PIPELINE_MAX_REPAIRS_DEFICIT", 3), 1, 5));
  }
  return base;
}

/** Umbral de estancamiento del auditor LLM entre reparaciones (early exit). */
export function resolveTasksRepairStagnantDelta(): number {
  return clampInt(readEnvInt("TASKS_REPAIR_STAGNANT_DELTA", 3), 1, 15);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}
