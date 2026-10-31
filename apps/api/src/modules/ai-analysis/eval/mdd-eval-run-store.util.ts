/**
 * @fileoverview Persistencia en disco de las corridas del eval de MDDs lanzadas desde la web.
 *
 * Cada corrida vive en `eval/mdd/results/<runId>/`: `run.json` (metadatos y estado de la corrida,
 * escrito por este módulo) junto a `summary.json`, `summary.md`, `<caso>.md` y `<caso>.score.json`
 * (escritos por `writeEvalResults`). Con eso una corrida terminada se reconstruye por completo tras
 * un reinicio. Las corridas del CLI no tienen `run.json`: se derivan del `summary.json`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { MddEvalRunProgressDto, MddEvalRunStatus } from "@theforge/shared-types";
import { resolveDefaultMddEvalCasesDir } from "./mdd-eval-cases.util.js";
import { evalFileKeys, loadEvalSummary } from "./mdd-eval-report.util.js";
import { MDD_EVAL_RESULTS_DIR, type MddEvalSummary } from "./mdd-eval.types.js";

/** Contenido de `run.json`. */
export interface MddEvalRunMeta {
  runId: string;
  status: MddEvalRunStatus;
  requestedByUserId: string;
  groupId: string;
  caseIds: string[];
  concurrency: number;
  keepProjects: boolean;
  /** Tope por caso (ms); undefined = default del runner. */
  timeoutMs?: number;
  /** Momento de encolado; se reescribe con el inicio real cuando la corrida pasa a `running`. */
  startedAt: string;
  finishedAt?: string;
  error?: string;
  progress: MddEvalRunProgressDto;
  gitSha?: string;
}

export const MDD_EVAL_RUN_META_FILE = "run.json";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** true si el id es un nombre de fichero/carpeta seguro (sin separadores ni `..`). */
export function isSafeMddEvalId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes("..");
}

/**
 * Raíz de resultados: `MDD_EVAL_RESULTS_DIR` si está definida; si no, la carpeta `results` hermana
 * de `cases` (apps/api/eval/mdd/results); y como último recurso `<cwd>/eval/mdd/results`.
 */
export function resolveMddEvalResultsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.MDD_EVAL_RESULTS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  try {
    return path.join(path.dirname(resolveDefaultMddEvalCasesDir()), "results");
  } catch {
    return path.resolve(process.cwd(), MDD_EVAL_RESULTS_DIR);
  }
}

/** Id de corrida estilo CLI (`20261031T001433Z`) con sufijo `-web`; añade `-2`, `-3`… si ya existe. */
export function buildMddEvalRunId(now: Date, exists: (runId: string) => boolean): string {
  const base = `${now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "")}-web`;
  if (!exists(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRunMeta(value: unknown): value is MddEvalRunMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<MddEvalRunMeta>;
  return typeof v.runId === "string" && typeof v.status === "string" && Array.isArray(v.caseIds);
}

export class MddEvalRunStore {
  constructor(public readonly root: string = resolveMddEvalResultsRoot()) {}

  runDir(runId: string): string {
    if (!isSafeMddEvalId(runId)) throw new Error(`runId inválido: ${runId}`);
    return path.join(this.root, runId);
  }

  runExists(runId: string): boolean {
    if (!isSafeMddEvalId(runId)) return false;
    return existsSync(path.join(this.root, runId));
  }

  /** `run.json` de la corrida, o undefined si no existe o no es legible. */
  readMeta(runId: string): MddEvalRunMeta | undefined {
    if (!isSafeMddEvalId(runId)) return undefined;
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(path.join(this.root, runId, MDD_EVAL_RUN_META_FILE), "utf8"),
      );
      return isRunMeta(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Escritura atómica (tmp + rename): un lector nunca ve un JSON a medias. */
  async writeMeta(meta: MddEvalRunMeta): Promise<void> {
    const dir = this.runDir(meta.runId);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, MDD_EVAL_RUN_META_FILE);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  /** `summary.json` de la corrida, o undefined si falta o no es válido. */
  readSummary(runId: string): MddEvalSummary | undefined {
    if (!isSafeMddEvalId(runId)) return undefined;
    const file = path.join(this.root, runId, "summary.json");
    if (!existsSync(file)) return undefined;
    try {
      return loadEvalSummary(file);
    } catch {
      return undefined;
    }
  }

  /** Ids de las corridas presentes en disco (carpetas), más recientes primero por nombre. */
  listRunIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => {
        if (!isSafeMddEvalId(name)) return false;
        try {
          return statSync(path.join(this.root, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
  }

  /** Nombre de fichero (`<key>.md`) del MDD de un caso, o undefined si el caso no existe en el summary. */
  markdownFileName(summary: MddEvalSummary, caseId: string): string | undefined {
    const keys = evalFileKeys(summary.cases);
    const index = summary.cases.findIndex((record, i) => record.caseId === caseId || keys[i] === caseId);
    if (index < 0) return undefined;
    return summary.cases[index].markdownPath ?? `${keys[index]}.md`;
  }

  /** Ruta absoluta del markdown de un caso si el fichero existe (nunca fuera de la carpeta de la corrida). */
  markdownPath(runId: string, summary: MddEvalSummary, caseId: string): string | undefined {
    if (!isSafeMddEvalId(runId)) return undefined;
    const name = this.markdownFileName(summary, caseId);
    if (!name || !isSafeMddEvalId(name.replace(/\.md$/i, ""))) return undefined;
    const file = path.join(this.root, runId, name);
    return existsSync(file) ? file : undefined;
  }
}

/** Metadatos sintéticos para corridas sin `run.json` (CLI): se derivan del summary. */
export function metaFromSummary(summary: MddEvalSummary): MddEvalRunMeta {
  const args = summary.args ?? {};
  const concurrency = typeof args.concurrency === "number" ? args.concurrency : 1;
  const total = summary.cases.length;
  return {
    runId: summary.runId,
    status: "completed",
    requestedByUserId: "",
    groupId: "",
    caseIds: summary.cases.map((record) => record.caseId),
    concurrency,
    keepProjects: args.keep === true,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    progress: { total, done: total, running: [] },
    ...(summary.gitSha ? { gitSha: summary.gitSha } : {}),
  };
}
