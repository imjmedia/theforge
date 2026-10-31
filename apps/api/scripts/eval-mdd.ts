/**
 * @fileoverview CLI del eval de MDDs (ver `eval/mdd/README.md`).
 *
 *   node --import tsx scripts/eval-mdd.ts --user <userId> --group <groupId> [--cases a,b] ...
 *   node --import tsx scripts/eval-mdd.ts --dry-run [--input eval/mdd/fixtures] ...
 *
 * Modo real: arranca el AppModule de Nest (contexto sin HTTP), crea un proyecto temporal por caso
 * (con su etapa), genera el MDD con el pipeline real y lo puntúa. Modo dry-run: no toca Nest ni
 * el LLM; puntúa los `.md` de `--input` contra el caso que corresponde al nombre del fichero.
 *
 * Exit: 0 todo aprobado · 1 algún caso fallido (o expectativa good/bad incumplida) · 2 uso.
 */

import * as path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadMddEvalCases } from "../src/modules/ai-analysis/eval/mdd-eval-cases.util.js";
import { scoreMddAgainstCase } from "../src/modules/ai-analysis/eval/mdd-eval-rubric.js";
import {
  DEFAULT_EVAL_TIMEOUT_MS,
  MAX_EVAL_CONCURRENCY,
  runEvalSuite,
  type EvalStreamEvent,
  type MddEvalRunnerDeps,
} from "../src/modules/ai-analysis/eval/mdd-eval-runner.js";
import {
  compareSummaries,
  evalFileKeys,
  formatAggregatesLine,
  loadEvalSummary,
  writeEvalResults,
} from "../src/modules/ai-analysis/eval/mdd-eval-report.util.js";
import {
  MDD_EVAL_CASES_DIR,
  MDD_EVAL_FIXTURES_DIR,
  MDD_EVAL_RESULTS_DIR,
  type MddEvalCase,
  type MddEvalRunRecord,
  type MddEvalSummary,
} from "../src/modules/ai-analysis/eval/mdd-eval.types.js";

// apps/api es CommonJS: __dirname es scripts/. Si no existe (ESM), se usa el cwd (pnpm --filter lo fija).
const API_ROOT = path.resolve(typeof __dirname !== "undefined" ? __dirname : process.cwd(), "..");

const USAGE = `Uso:
  node --import tsx scripts/eval-mdd.ts --user <userId> --group <groupId> [opciones]
  node --import tsx scripts/eval-mdd.ts --dry-run [opciones]
  pnpm --filter @theforge/api eval:mdd -- --user <userId> --group <groupId> [opciones]

Opciones:
  --cases a,b          Ids de caso separados por coma (por defecto, todos los de eval/mdd/cases)
  --dry-run            Sin Nest ni LLM: puntúa los .md de --input (ver README)
  --input <dir>        Carpeta de fixtures para --dry-run (default: eval/mdd/fixtures)
  --user <userId>      Usuario real dueño de los proyectos temporales (BYOK). Obligatorio sin --dry-run
  --group <groupId>    Grupo de proyectos para los temporales. Obligatorio sin --dry-run
  --concurrency <n>    Casos en paralelo, 1..${MAX_EVAL_CONCURRENCY} (default 1)
  --timeout-ms <ms>    Tiempo máximo por caso (default ${DEFAULT_EVAL_TIMEOUT_MS})
  --keep               No borrar los proyectos temporales
  --out <dir>          Carpeta de resultados (default eval/mdd/results/<runId>)
  --compare <file>     summary.json de una corrida previa: imprime los deltas
  --json               Imprime el summary en JSON por stdout (lo demás va a stderr)
  --help               Muestra esta ayuda
`;

class UsageError extends Error {}

type CliArgs = {
  cases?: string[];
  dryRun: boolean;
  input?: string;
  user?: string;
  group?: string;
  concurrency: number;
  timeoutMs: number;
  keep: boolean;
  out?: string;
  compare?: string;
  json: boolean;
  help: boolean;
};

const VALUE_FLAGS = new Set(["--cases", "--input", "--user", "--group", "--concurrency", "--timeout-ms", "--out", "--compare"]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--keep", "--json", "--help", "-h"]);

function parsePositiveInt(flag: string, raw: string, max?: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new UsageError(`${flag} debe ser un entero entre 1 y ${max ?? "infinito"} (recibido "${raw}")`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    keep: false,
    json: false,
    help: false,
    concurrency: 1,
    timeoutMs: DEFAULT_EVAL_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eq = token.indexOf("=");
    const flag = token.startsWith("--") && eq > 0 ? token.slice(0, eq) : token;
    let value: string | undefined = eq > 0 && token.startsWith("--") ? token.slice(eq + 1) : undefined;

    if (BOOLEAN_FLAGS.has(flag)) {
      if (value !== undefined) throw new UsageError(`${flag} no admite valor`);
      if (flag === "--dry-run") args.dryRun = true;
      else if (flag === "--keep") args.keep = true;
      else if (flag === "--json") args.json = true;
      else args.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new UsageError(`argumento desconocido: ${token}`);
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} requiere un valor`);
      i += 1;
    }
    switch (flag) {
      case "--cases":
        args.cases = value.split(",").map((id) => id.trim()).filter(Boolean);
        if (args.cases.length === 0) throw new UsageError("--cases no contiene ids");
        break;
      case "--input":
        args.input = value;
        break;
      case "--user":
        args.user = value.trim();
        break;
      case "--group":
        args.group = value.trim();
        break;
      case "--concurrency":
        args.concurrency = parsePositiveInt(flag, value, MAX_EVAL_CONCURRENCY);
        break;
      case "--timeout-ms":
        args.timeoutMs = parsePositiveInt(flag, value);
        break;
      case "--out":
        args.out = value;
        break;
      case "--compare":
        args.compare = value;
        break;
      default:
        break;
    }
  }
  if (!args.help && !args.dryRun && (!args.user || !args.group)) {
    throw new UsageError("el modo real requiere --user y --group (o usa --dry-run)");
  }
  return args;
}

/**
 * Convención de fixtures de dry-run: `<caseId>.md` o `good-<caseId>.md` / `bad-<caseId>.md`.
 * good- debe aprobar y bad- debe fallar (si no, el run termina con exit 1). El caso se busca, en
 * orden: id exacto; id contenido en el nombre (el más largo); nombre contenido como segmentos en
 * el id (p. ej. `good-ecommerce-tienda-basica.md` casa con `ecommerce-tienda-artesanias`). Si ese último tramo
 * casa con varios casos, se considera ambiguo y el fichero se ignora.
 */
export function matchFixtureToCase(
  fileName: string,
  cases: readonly MddEvalCase[],
): { evalCase: MddEvalCase; expect?: "pass" | "fail" } | { ambiguous: string[] } | undefined {
  const stem = fileName.replace(/\.md$/i, "");
  const prefixed = /^(good|bad)-(.+)$/.exec(stem);
  const expect = prefixed ? (prefixed[1] === "good" ? "pass" : "fail") : undefined;
  const name = prefixed ? prefixed[2] : stem;
  const exact = cases.find((c) => c.id === name);
  if (exact) return { evalCase: exact, expect };
  const contained = cases
    .filter((c) => name.includes(c.id))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (contained) return { evalCase: contained, expect };
  const segment = new RegExp(`(^|-)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`);
  const candidates = cases.filter((c) => segment.test(c.id));
  if (candidates.length === 1) return { evalCase: candidates[0], expect };
  if (candidates.length > 1) return { ambiguous: candidates.map((c) => c.id) };
  return undefined;
}

type DryRunJob = { evalCase: MddEvalCase; markdown: string; expect?: "pass" | "fail"; fileName: string };

function loadDryRunJobs(inputDir: string, cases: readonly MddEvalCase[]): { jobs: DryRunJob[]; skipped: string[] } {
  const jobs: DryRunJob[] = [];
  const skipped: string[] = [];
  const files = readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith(".md")).sort();
  for (const fileName of files) {
    const match = matchFixtureToCase(fileName, cases);
    if (!match) {
      skipped.push(fileName);
      continue;
    }
    if ("ambiguous" in match) {
      skipped.push(`${fileName} (ambiguo: ${match.ambiguous.join(", ")})`);
      continue;
    }
    jobs.push({
      // Objeto nuevo por fixture: el runner identifica cada job por identidad (good/bad comparten caso).
      evalCase: { ...match.evalCase },
      markdown: readFileSync(path.join(inputDir, fileName), "utf8"),
      expect: match.expect,
      fileName,
    });
  }
  return { jobs, skipped };
}

function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** Dependencias de dry-run: el "pipeline" devuelve el fixture como `done`. */
function buildDryRunDeps(jobs: readonly DryRunJob[]): MddEvalRunnerDeps {
  const indexOf = (evalCase: MddEvalCase): number => jobs.findIndex((job) => job.evalCase === evalCase);
  return {
    async createTempProject(evalCase) {
      const index = indexOf(evalCase);
      return { projectId: `dry-${index}`, stageId: `dry-stage-${index}` };
    },
    async deleteTempProject() {},
    async *generate(_dbgaContent, projectId): AsyncGenerator<EvalStreamEvent> {
      const index = Number(projectId.replace("dry-", ""));
      yield { type: "done", markdown: jobs[index].markdown };
    },
    async getTokenUsage() {
      return {};
    },
    score: scoreMddAgainstCase,
    now: () => Date.now(),
  };
}

async function runRealSuite(
  args: CliArgs,
  cases: MddEvalCase[],
  runId: string,
  onCaseDone: (record: MddEvalRunRecord, markdown: string) => void,
): Promise<MddEvalSummary> {
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module.js");
  const { AiAnalysisService } = await import("../src/modules/ai-analysis/ai-analysis.service.js");
  const { TokenUsageService } = await import("../src/modules/ai-analysis/token-usage/token-usage.service.js");
  const { PrismaService } = await import("../src/prisma/prisma.service.js");
  const { buildMddEvalDeps } = await import("../src/modules/ai-analysis/eval/mdd-eval-nest-deps.js");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { id: args.user! }, select: { id: true } });
    if (!user) throw new UsageError(`usuario no encontrado: ${args.user}`);
    const group = await prisma.projectGroup.findUnique({ where: { id: args.group! }, select: { id: true } });
    if (!group) throw new UsageError(`grupo no encontrado: ${args.group}`);

    const deps = buildMddEvalDeps({
      prisma,
      aiService: app.get(AiAnalysisService),
      tokenUsage: app.get(TokenUsageService),
      userId: user.id,
      groupId: group.id,
      keepProjects: args.keep,
    });
    return await runEvalSuite(
      deps,
      cases,
      {
        concurrency: args.concurrency,
        timeoutMs: args.timeoutMs,
        keep: args.keep,
        runId,
        args: runArgs(args, cases, "real"),
      },
      (record, markdown) => onCaseDone(record, markdown),
    );
  } finally {
    await app.close();
  }
}

function runArgs(args: CliArgs, cases: readonly MddEvalCase[], mode: "real" | "dry-run"): MddEvalSummary["args"] {
  return {
    mode,
    cases: cases.map((c) => c.id).join(","),
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
    keep: args.keep,
    ...(mode === "dry-run" ? { input: args.input ?? MDD_EVAL_FIXTURES_DIR } : {}),
  };
}

function log(args: CliArgs, message: string): void {
  // Con --json el stdout es solo JSON; el resto va a stderr.
  if (args.json) process.stderr.write(`${message}\n`);
  else process.stdout.write(`${message}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let previous: MddEvalSummary | undefined;
  try {
    if (args.compare) previous = loadEvalSummary(path.resolve(process.cwd(), args.compare));
  } catch (error) {
    process.stderr.write(`Error de uso: --compare: ${(error as Error).message}\n`);
    return 2;
  }

  // Casos del dataset; en dry-run se añaden los `*.json` de --input (fixtures autocontenidos, p. ej.
  // `ecommerce-tienda-basica.json` junto a `good-ecommerce-tienda-basica.md`), que prevalecen por id.
  const datasetCases = await loadMddEvalCases(path.join(API_ROOT, MDD_EVAL_CASES_DIR));
  let allCases = datasetCases;
  if (args.dryRun) {
    const fixtureDir = path.resolve(API_ROOT, args.input ?? MDD_EVAL_FIXTURES_DIR);
    const hasFixtureCases =
      existsSync(fixtureDir) && readdirSync(fixtureDir).some((f) => f.toLowerCase().endsWith(".json"));
    if (hasFixtureCases) {
      const fixtureCases = await loadMddEvalCases(fixtureDir);
      const byId = new Map(datasetCases.map((c) => [c.id, c] as const));
      for (const c of fixtureCases) byId.set(c.id, c);
      allCases = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  let cases: MddEvalCase[];
  if (args.cases) {
    const unknown = args.cases.filter((id) => !allCases.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(
        `Error de uso: caso desconocido: ${unknown.join(", ")} (disponibles: ${allCases.map((c) => c.id).join(", ") || "ninguno"})\n`,
      );
      return 2;
    }
    cases = allCases.filter((c) => args.cases!.includes(c.id));
  } else {
    cases = [...allCases];
  }
  if (cases.length === 0) {
    process.stderr.write(`Error de uso: no hay casos en ${path.join(API_ROOT, MDD_EVAL_CASES_DIR)}\n`);
    return 2;
  }

  const runId = `${stamp(new Date())}${args.dryRun ? "-dry" : ""}`;
  const markdownByRecord = new Map<MddEvalRunRecord, { markdown: string; expect?: "pass" | "fail"; fileName?: string }>();
  let summary: MddEvalSummary;
  let mismatches: string[] = [];

  if (args.dryRun) {
    const inputDir = path.resolve(API_ROOT, args.input ?? MDD_EVAL_FIXTURES_DIR);
    if (!existsSync(inputDir)) {
      process.stderr.write(`Error de uso: no existe --input ${inputDir}\n`);
      return 2;
    }
    const { jobs, skipped } = loadDryRunJobs(inputDir, cases);
    for (const fileName of skipped) {
      process.stderr.write(`aviso: ${fileName} no casa con ningún caso; se ignora\n`);
    }
    if (jobs.length === 0) {
      process.stderr.write(`Error de uso: ningún .md en ${inputDir} casa con un caso (ver README: convención de fixtures)\n`);
      return 2;
    }
    const scopedCases = jobs.map((job) => job.evalCase);
    summary = await runEvalSuite(
      buildDryRunDeps(jobs),
      scopedCases,
      { concurrency: 1, timeoutMs: args.timeoutMs, runId, args: runArgs(args, scopedCases, "dry-run") },
      (record, markdown, evalCase) => {
        const job = jobs.find((j) => j.evalCase === evalCase)!;
        markdownByRecord.set(record, { markdown, expect: job.expect, fileName: job.fileName });
      },
    );
    for (const [record, info] of markdownByRecord) {
      if (info.expect === "pass" && !record.passed) mismatches.push(`${info.fileName}: se esperaba PASS (good-) y salió FAIL`);
      if (info.expect === "fail" && record.passed) mismatches.push(`${info.fileName}: se esperaba FAIL (bad-) y salió PASS`);
    }
  } else {
    summary = await runRealSuite(args, cases, runId, (record, markdown) => {
      markdownByRecord.set(record, { markdown });
    });
  }

  const outDir = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(API_ROOT, MDD_EVAL_RESULTS_DIR, runId);
  const keys = evalFileKeys(summary.cases);
  const markdownByKey = new Map<string, string>();
  summary.cases.forEach((record, index) => {
    const info = markdownByRecord.get(record);
    if (info) markdownByKey.set(keys[index], info.markdown);
  });
  const written = await writeEvalResults(summary, outDir, markdownByKey);

  for (const [index, record] of written.summary.cases.entries()) {
    const status = record.passed ? "PASS" : "FAIL";
    const reason = record.error ? ` · ${record.error}` : record.rubric.failures[0] ? ` · ${record.rubric.failures[0]}` : "";
    log(args, `${status} ${keys[index]} rúbrica ${record.rubric.total.toFixed(1)}${reason}`);
  }
  log(args, `Resultados: ${outDir}`);
  log(args, formatAggregatesLine(written.summary));
  for (const mismatch of mismatches) log(args, `EXPECTATIVA: ${mismatch}`);

  if (previous) {
    const comparison = compareSummaries(previous, written.summary);
    log(args, comparison.markdown);
  }

  if (args.json) process.stdout.write(`${JSON.stringify(written.summary, null, 2)}\n`);

  const failed = written.summary.aggregates.cases - written.summary.aggregates.passed;
  // Dry-run: los fixtures `bad-` deben fallar; el código de salida refleja solo expectativas incumplidas.
  if (args.dryRun) return mismatches.length > 0 ? 1 : 0;
  return failed > 0 || mismatches.length > 0 ? 1 : 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`Error inesperado: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
