/**
 * Tests del almacén de MDD del eval (Redis con fallback a disco) y de su uso en el ejecutor y en el
 * servicio web: claves y TTL, round trip en memoria, degradación ante fallos y 404.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  type MddEvalArtifactBackend,
  InMemoryMddEvalArtifactBackend,
  MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS,
  MddEvalArtifactStore,
  RedisMddEvalArtifactBackend,
  mddEvalArtifactIndexKey,
  mddEvalArtifactKey,
  resolveMddEvalArtifactTtlSeconds,
  type MddEvalRedisClient,
  type MddEvalRedisMulti,
} from "./mdd-eval-artifact-store.js";
import { MddEvalQueueService } from "./mdd-eval-queue.service.js";
import { MddEvalRunStore, type MddEvalRunMeta } from "./mdd-eval-run-store.util.js";
import { executeMddEvalRun } from "./mdd-eval-run.executor.js";
import { writeEvalResults } from "./mdd-eval-report.util.js";
import { MddEvalService } from "./mdd-eval.service.js";
import {
  makeEvalCase,
  makeFakeDeps,
  makeRecord,
  makeSummary,
  tempDir,
  waitFor,
  writeCasesDir,
} from "./mdd-eval-web.test-fixtures.js";

/** Cliente Redis en memoria: registra las llamadas de escritura y puede simular una caída. */
function fakeRedis(options: { down?: string } = {}) {
  const calls: unknown[][] = [];
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const check = (): void => {
    if (options.down) throw new Error(options.down);
  };
  const client: MddEvalRedisClient = {
    multi() {
      const ops: unknown[][] = [];
      const builder: MddEvalRedisMulti = {
        set(key, value, mode, seconds) {
          ops.push(["set", key, value, mode, seconds]);
          return builder;
        },
        sadd(key, member) {
          ops.push(["sadd", key, member]);
          return builder;
        },
        expire(key, seconds) {
          ops.push(["expire", key, seconds]);
          return builder;
        },
        async exec() {
          check();
          for (const op of ops) {
            calls.push(op);
            if (op[0] === "set") values.set(String(op[1]), String(op[2]));
            if (op[0] === "sadd") {
              const set = sets.get(String(op[1])) ?? new Set<string>();
              set.add(String(op[2]));
              sets.set(String(op[1]), set);
            }
          }
          return ops.map((): [Error | null, unknown] => [null, "OK"]);
        },
      };
      return builder;
    },
    async get(key) {
      check();
      return values.get(key) ?? null;
    },
    async exists(key) {
      check();
      return values.has(key) ? 1 : 0;
    },
    async smembers(key) {
      check();
      return [...(sets.get(key) ?? [])];
    },
  };
  return { client, calls, values, sets };
}

function storeWith(backend: MddEvalArtifactBackend): MddEvalArtifactStore {
  const store = new MddEvalArtifactStore();
  store.useBackend(backend);
  return store;
}

describe("TTL y claves", () => {
  it("TTL: 7 días por defecto; MDD_EVAL_ARTIFACT_TTL_SECONDS lo cambia; valores no válidos usan el default", () => {
    assert.equal(MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS, 604_800);
    assert.equal(resolveMddEvalArtifactTtlSeconds({}), 604_800);
    assert.equal(resolveMddEvalArtifactTtlSeconds({ MDD_EVAL_ARTIFACT_TTL_SECONDS: "3600" }), 3600);
    for (const bad of ["abc", "0", "-5", "1.5", ""]) {
      assert.equal(resolveMddEvalArtifactTtlSeconds({ MDD_EVAL_ARTIFACT_TTL_SECONDS: bad }), 604_800, bad);
    }
  });

  it("nombres de claves: theforge:mdd-eval:md:<runId>:<caseKey> y theforge:mdd-eval:md-index:<runId>", () => {
    assert.equal(mddEvalArtifactKey("20261031T001433Z-web", "caso-a-2"), "theforge:mdd-eval:md:20261031T001433Z-web:caso-a-2");
    assert.equal(mddEvalArtifactIndexKey("20261031T001433Z-web"), "theforge:mdd-eval:md-index:20261031T001433Z-web");
  });
});

describe("backend en memoria (sin REDIS_URL)", () => {
  it("round trip: put, get, has y listCaseKeys ordenado", async () => {
    const store = storeWith(new InMemoryMddEvalArtifactBackend());
    await store.putMarkdown("run-1", "caso-b", "# B");
    await store.putMarkdown("run-1", "caso-a", "# A");
    assert.equal(await store.getMarkdown("run-1", "caso-a"), "# A");
    assert.equal(await store.hasMarkdown("run-1", "caso-b"), true);
    assert.equal(await store.hasMarkdown("run-1", "caso-z"), false);
    assert.equal(await store.getMarkdown("run-2", "caso-a"), undefined);
    assert.deepEqual(await store.listCaseKeys("run-1"), ["caso-a", "caso-b"]);
    assert.deepEqual(await store.listCaseKeys("run-2"), []);
  });

  it("sin REDIS_URL el almacén por defecto es en memoria y funciona sin configurar nada", async () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      const store = new MddEvalArtifactStore();
      await store.putMarkdown("run-mem", "caso-a", "# mem");
      assert.equal(await store.getMarkdown("run-mem", "caso-a"), "# mem");
      await store.onModuleDestroy();
    } finally {
      if (saved === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = saved;
    }
  });

  it("TTL: a los ttl segundos el valor y el índice caducan", async () => {
    let now = 1_000_000;
    const store = storeWith(new InMemoryMddEvalArtifactBackend(10, () => now));
    await store.putMarkdown("run-t", "caso-a", "# T");
    now += 9_999;
    assert.equal(await store.getMarkdown("run-t", "caso-a"), "# T");
    now += 1;
    assert.equal(await store.getMarkdown("run-t", "caso-a"), undefined);
    assert.equal(await store.hasMarkdown("run-t", "caso-a"), false);
    assert.deepEqual(await store.listCaseKeys("run-t"), []);
  });

  it("rechaza referencias inseguras: put lanza y las lecturas devuelven vacío", async () => {
    const store = storeWith(new InMemoryMddEvalArtifactBackend());
    await assert.rejects(store.putMarkdown("../otra", "caso-a", "x"), /no válida/);
    await assert.rejects(store.putMarkdown("run-1", "a/b", "x"), /no válida/);
    assert.equal(await store.getMarkdown("run-1", "../caso-a"), undefined);
    assert.equal(await store.hasMarkdown("a/b", "caso-a"), false);
    assert.deepEqual(await store.listCaseKeys(".."), []);
  });
});

describe("backend Redis (cliente falso)", () => {
  it("escribe el valor con EX y el índice con SADD + EXPIRE, con el TTL configurado", async () => {
    const redis = fakeRedis();
    const store = storeWith(new RedisMddEvalArtifactBackend(redis.client, 3600));
    await store.putMarkdown("run-r", "caso-a", "# R");
    assert.deepEqual(redis.calls, [
      ["set", "theforge:mdd-eval:md:run-r:caso-a", "# R", "EX", 3600],
      ["sadd", "theforge:mdd-eval:md-index:run-r", "caso-a"],
      ["expire", "theforge:mdd-eval:md-index:run-r", 3600],
    ]);
    await store.putMarkdown("run-r", "caso-b", "# R2");
    assert.equal(await store.getMarkdown("run-r", "caso-a"), "# R");
    assert.equal(await store.hasMarkdown("run-r", "caso-b"), true);
    assert.deepEqual(await store.listCaseKeys("run-r"), ["caso-a", "caso-b"]);
  });

  it("con Redis caído: las lecturas degradan a 'no existe' y la escritura lanza", async () => {
    const store = storeWith(new RedisMddEvalArtifactBackend(fakeRedis({ down: "ECONNREFUSED" }).client));
    assert.equal(await store.getMarkdown("run-d", "caso-a"), undefined);
    assert.equal(await store.hasMarkdown("run-d", "caso-a"), false);
    assert.deepEqual(await store.listCaseKeys("run-d"), []);
    await assert.rejects(store.putMarkdown("run-d", "caso-a", "x"), /ECONNREFUSED/);
  });
});

describe("ejecutor: un MDD por caso con las mismas claves que el disco", () => {
  function meta(runId: string, caseIds: string[]): MddEvalRunMeta {
    return {
      runId,
      status: "queued",
      requestedByUserId: "user-1",
      groupId: "group-1",
      caseIds,
      concurrency: 1,
      keepProjects: false,
      startedAt: "2026-10-30T10:00:00.000Z",
      progress: { total: caseIds.length, done: 0, running: [] },
    };
  }

  it("guarda una clave por caso, incluidas las repetidas (caso-a, caso-a-2), igual que los .md", async () => {
    const runDir = new MddEvalRunStore(tempDir());
    const artifacts = storeWith(new InMemoryMddEvalArtifactBackend());
    const { deps } = makeFakeDeps();
    const outcome = await executeMddEvalRun({
      meta: meta("run-dup", ["caso-a"]),
      cases: [makeEvalCase("caso-a")],
      store: runDir,
      artifacts,
      deps,
      signal: new AbortController().signal,
      runSuite: async (_deps, _cases, _opts, onCaseDone) => {
        const records = [makeRecord("caso-a"), makeRecord("caso-a")];
        records.forEach((record, i) => onCaseDone?.(record, `# MDD ${i + 1}`, makeEvalCase("caso-a")));
        return makeSummary("run-dup", records);
      },
    });
    assert.equal(outcome.status, "completed");
    assert.deepEqual(await artifacts.listCaseKeys("run-dup"), ["caso-a", "caso-a-2"]);
    assert.equal(await artifacts.getMarkdown("run-dup", "caso-a-2"), "# MDD 2");
    assert.ok(existsSync(path.join(runDir.root, "run-dup", "caso-a-2.md")), "el disco usa la misma clave");
  });

  it("si el almacén falla, la corrida termina completed igualmente y los .md quedan en disco", async () => {
    const runDir = new MddEvalRunStore(tempDir());
    const { deps } = makeFakeDeps();
    const outcome = await executeMddEvalRun({
      meta: meta("run-sink", ["caso-a"]),
      cases: [makeEvalCase("caso-a")],
      store: runDir,
      artifacts: {
        putMarkdown: async () => {
          throw new Error("redis caído");
        },
      },
      deps,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, "completed");
    assert.equal(runDir.readMeta("run-sink")?.status, "completed");
    assert.ok(existsSync(path.join(runDir.root, "run-sink", "caso-a.md")));
  });
});

describe("servicio: hasMarkdown y markdown por caso con disco vacío", () => {
  function setup(artifacts = new MddEvalArtifactStore()) {
    const store = new MddEvalRunStore(tempDir());
    const casesDir = writeCasesDir(["caso-a", "caso-b"]);
    const queue = new MddEvalQueueService({} as never, {} as never, {} as never, artifacts);
    queue.store = store;
    queue.casesDir = casesDir;
    const service = new MddEvalService({} as never, {} as never, queue, artifacts);
    service.store = store;
    service.casesDir = casesDir;
    return { store, queue, service, artifacts };
  }

  it("hasMarkdown es true vía almacén aunque el disco no tenga los .md", async () => {
    const { store, service, artifacts } = setup();
    await writeEvalResults(makeSummary("run-x", [makeRecord("caso-a"), makeRecord("caso-b")]), store.runDir("run-x"), new Map());
    assert.equal(existsSync(path.join(store.runDir("run-x"), "caso-a.md")), false);
    await artifacts.putMarkdown("run-x", "caso-a", "# MDD desde Redis");
    const dto = await service.getRun("run-x");
    assert.deepEqual(dto.records.map((r) => [r.caseId, r.hasMarkdown]), [
      ["caso-a", true],
      ["caso-b", false],
    ]);
  });

  it("el endpoint sirve el markdown del almacén y responde 404 si ni disco ni almacén lo tienen", async () => {
    const { store, service, artifacts } = setup();
    await writeEvalResults(makeSummary("run-x", [makeRecord("caso-a"), makeRecord("caso-b")]), store.runDir("run-x"), new Map());
    await artifacts.putMarkdown("run-x", "caso-a", "# MDD desde Redis");
    assert.equal(await service.getCaseMarkdown("run-x", "caso-a"), "# MDD desde Redis");
    await assert.rejects(service.getCaseMarkdown("run-x", "caso-b"), /no encontrado/);
    await assert.rejects(service.getCaseMarkdown("run-x", "../summary"), /no encontrado/);
  });

  it("el disco gana al almacén cuando ambos tienen el markdown", async () => {
    const { store, service, artifacts } = setup();
    await writeEvalResults(makeSummary("run-y", [makeRecord("caso-a")]), store.runDir("run-y"), new Map([["caso-a", "# MDD desde disco"]]));
    await artifacts.putMarkdown("run-y", "caso-a", "# MDD desde Redis");
    assert.equal(await service.getCaseMarkdown("run-y", "caso-a"), "# MDD desde disco");
  });

  it("sin resumen visible en este proceso la clave es el caseId", async () => {
    const { service, artifacts } = setup();
    await artifacts.putMarkdown("run-z", "caso-a", "# solo Redis");
    assert.equal(await service.getCaseMarkdown("run-z", "caso-a"), "# solo Redis");
    await assert.rejects(service.getCaseMarkdown("run-z", "caso-b"), /no encontrado/);
  });

  it("extremo a extremo: el worker guarda en el almacén y otro servicio sin disco sirve el markdown", async () => {
    const artifacts = new MddEvalArtifactStore();
    const worker = setup(artifacts);
    const fake = makeFakeDeps({ delayMs: 2 });
    worker.queue.depsFactory = () => fake.deps;
    const runId = "run-e2e";
    await worker.queue.enqueue({
      runId,
      status: "queued",
      requestedByUserId: "user-1",
      groupId: "group-1",
      caseIds: ["caso-a", "caso-b"],
      concurrency: 1,
      keepProjects: false,
      startedAt: "2026-10-30T10:00:00.000Z",
      progress: { total: 2, done: 0, running: [] },
    });
    await waitFor(async () => (await worker.queue.getLiveState(runId))?.state === "completed");
    assert.deepEqual(await artifacts.listCaseKeys(runId), ["caso-a", "caso-b"]);

    // La API: otro disco (vacío), mismo almacén; no tiene resumen ni run.json.
    const api = setup(artifacts);
    assert.match(await api.service.getCaseMarkdown(runId, "caso-a"), /^# MDD/);
    assert.match(await api.service.getCaseMarkdown(runId, "caso-b"), /^# MDD/);
  });
});
