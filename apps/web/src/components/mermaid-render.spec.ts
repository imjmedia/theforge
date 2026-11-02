import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  MermaidParseResult,
  MermaidResolution,
} from "@theforge/shared-types/mermaid-oracle";
import { resolveMermaidWithOracle } from "@theforge/shared-types/mermaid-oracle";
import { proposeExtendedMermaidRepairs } from "./mermaid-render-prep.util.js";
import {
  MERMAID_NO_AUTO_REPAIR_MESSAGE,
  describeMermaidError,
  mermaidKey,
  mermaidRenderReducer,
  MERMAID_IDLE_STATE,
  runMermaidRenderPipeline,
  startMermaidRender,
  truncateMermaidError,
  type MermaidErrorState,
  type MermaidReadyState,
  type MermaidRenderAction,
  type MermaidRenderDeps,
  type MermaidRenderState,
} from "./mermaid-render.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const VALID = "flowchart TD\n  A --> B";
const BROKEN = "flowchart TD\n  A[Inicio --> B(";
const FIXED = "flowchart TD\n  A[Inicio] --> B";

interface FakeLog {
  render: string[];
  resolve: string[];
}

/** Dependencias falsas: `render` falla para los textos de `failing`; `resolve` devuelve `resolution`. */
function makeDeps(opts: {
  failing?: Set<string>;
  resolution?: (body: string) => MermaidResolution;
  log?: FakeLog;
}): MermaidRenderDeps {
  const log = opts.log ?? { render: [], resolve: [] };
  return {
    parse: async (): Promise<MermaidParseResult> => ({ status: "ok" }),
    render: async (text, id) => {
      log.render.push(text);
      if (opts.failing?.has(text)) throw new Error(`Parse error en: ${text.split("\n")[1]?.trim()}`);
      return { svg: `<svg id="${id}">${text.length}</svg>` };
    },
    resolve: async (body) => {
      log.resolve.push(body);
      if (!opts.resolution) throw new Error("resolve no esperado");
      return opts.resolution(body);
    },
  };
}

const resolution = (r: Partial<MermaidResolution> & Pick<MermaidResolution, "status" | "text">) =>
  (body: string): MermaidResolution => ({ original: body, attempts: 1, ...r });

describe("mermaidRenderReducer", () => {
  const ready: MermaidReadyState = {
    status: "ready",
    svg: "<svg/>",
    text: VALID,
    repair: "original",
  };
  const error: MermaidErrorState = { status: "error", message: "boom", text: BROKEN };

  it("start lleva a loading desde cualquier estado y es estable si ya carga", () => {
    const loading = mermaidRenderReducer(MERMAID_IDLE_STATE, { type: "start" });
    assert.deepEqual(loading, { status: "loading" });
    assert.equal(mermaidRenderReducer(loading, { type: "start" }), loading);
    assert.deepEqual(mermaidRenderReducer(error, { type: "start" }), { status: "loading" });
    assert.deepEqual(mermaidRenderReducer(ready, { type: "start" }), { status: "loading" });
  });

  it("resolved sustituye el estado por ready o error", () => {
    assert.equal(mermaidRenderReducer({ status: "loading" }, { type: "resolved", state: ready }), ready);
    assert.equal(mermaidRenderReducer({ status: "loading" }, { type: "resolved", state: error }), error);
  });

  it("reset vuelve a idle y es estable si ya está en idle", () => {
    assert.deepEqual(mermaidRenderReducer(ready, { type: "reset" }), { status: "idle" });
    assert.equal(mermaidRenderReducer(MERMAID_IDLE_STATE, { type: "reset" }), MERMAID_IDLE_STATE);
  });

  it("un error no queda pegado: error -> start -> resolved(ready)", () => {
    let state: MermaidRenderState = error;
    state = mermaidRenderReducer(state, { type: "start" });
    state = mermaidRenderReducer(state, { type: "resolved", state: ready });
    assert.equal(state.status, "ready");
  });
});

describe("runMermaidRenderPipeline", () => {
  it("válido: ready/original sin pasar por el oráculo", async () => {
    const log: FakeLog = { render: [], resolve: [] };
    const result = await runMermaidRenderPipeline(VALID, makeDeps({ log }));
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.repair, "original");
    assert.equal(result.text, VALID);
    assert.deepEqual(log.render, [VALID]);
    assert.deepEqual(log.resolve, []);
  });

  it("conserva bindFunctions del render", async () => {
    const bind = () => undefined;
    const deps = makeDeps({});
    deps.render = async () => ({ svg: "<svg/>", bindFunctions: bind });
    const result = await runMermaidRenderPipeline(VALID, deps);
    assert.equal(result.status === "ready" && result.bindFunctions, bind);
  });

  it("inválido reparable: ready/repaired con el texto reparado", async () => {
    const log: FakeLog = { render: [], resolve: [] };
    const deps = makeDeps({
      failing: new Set([BROKEN]),
      resolution: resolution({ status: "repaired", text: FIXED }),
      log,
    });
    const result = await runMermaidRenderPipeline(BROKEN, deps);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.repair, "repaired");
    assert.equal(result.text, FIXED);
    assert.deepEqual(log.render, [BROKEN, FIXED]);
    assert.deepEqual(log.resolve, [BROKEN]);
  });

  it("inválido irreparable: error con el mensaje del parser y el texto ORIGINAL", async () => {
    const log: FakeLog = { render: [], resolve: [] };
    const deps = makeDeps({
      failing: new Set([BROKEN]),
      resolution: resolution({
        status: "invalid",
        text: BROKEN,
        error: "Parse error on line 2: expected 'SQE'",
      }),
      log,
    });
    const result = await runMermaidRenderPipeline(BROKEN, deps);
    assert.deepEqual(result, {
      status: "error",
      message: "Parse error on line 2: expected 'SQE'",
      text: BROKEN,
    });
    // `invalid` no vuelve a renderizar.
    assert.deepEqual(log.render, [BROKEN]);
  });

  it("unavailable: ready/unverified si el render del texto original pasa", async () => {
    // El primer render falla (p. ej. el módulo aún no cargaba) y el segundo, tras el oráculo, pasa.
    let calls = 0;
    const deps = makeDeps({
      resolution: resolution({ status: "unverified", text: BROKEN, error: "módulo no disponible" }),
    });
    deps.render = async (text, id) => {
      calls++;
      if (calls === 1) throw new Error("fallo transitorio");
      return { svg: `<svg id="${id}"/>` };
    };
    const result = await runMermaidRenderPipeline(BROKEN, deps);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.repair, "unverified");
    assert.equal(result.text, BROKEN);
  });

  it("unavailable y el render sigue fallando: error con el mensaje real del render y el original", async () => {
    const deps = makeDeps({
      failing: new Set([BROKEN]),
      resolution: resolution({ status: "unverified", text: BROKEN, error: "módulo no disponible" }),
    });
    const result = await runMermaidRenderPipeline(BROKEN, deps);
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.match(result.message, /Parse error/);
    assert.equal(result.text, BROKEN);
  });

  it("parser acepta el original pero el render falló: error directo con el fallo real, sin segundo render", async () => {
    const log: FakeLog = { render: [], resolve: [] };
    const deps = makeDeps({
      failing: new Set([VALID]),
      resolution: resolution({ status: "original", text: VALID }),
      log,
    });
    const result = await runMermaidRenderPipeline(VALID, deps);
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.match(result.message, /Parse error/);
    assert.equal(result.text, VALID);
    assert.deepEqual(log.render, [VALID]);
  });

  it("pasa el signal a render y a parse", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();
    const deps = makeDeps({ failing: new Set([BROKEN]) });
    deps.render = async (text, _id, opts) => {
      seen.push(opts?.signal);
      throw new Error(`fallo ${text.length}`);
    };
    deps.parse = async (_text, opts) => {
      seen.push(opts?.signal);
      return { status: "invalid", error: "mal" };
    };
    deps.resolve = (body, parse, opts) => resolveMermaidWithOracle(body, parse, opts);
    await runMermaidRenderPipeline(BROKEN, deps, { signal: controller.signal });
    assert.ok(seen.length >= 2);
    assert.ok(seen.every((s) => s === controller.signal));
  });

  it("si el oráculo lanza, devuelve error con el original", async () => {
    const deps = makeDeps({ failing: new Set([BROKEN]) }); // resolve sin resolution lanza
    const result = await runMermaidRenderPipeline(BROKEN, deps);
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.text, BROKEN);
  });

  it("texto vacío: error sin invocar render", async () => {
    const log: FakeLog = { render: [], resolve: [] };
    const result = await runMermaidRenderPipeline("  \n ", makeDeps({ log }));
    assert.equal(result.status, "error");
    assert.deepEqual(log.render, []);
  });

  it("usa un id de render distinto por intento", async () => {
    const ids: string[] = [];
    const deps = makeDeps({
      failing: new Set([BROKEN]),
      resolution: resolution({ status: "repaired", text: FIXED }),
    });
    const original = deps.render;
    deps.render = async (text, id) => {
      ids.push(id);
      return original(text, id);
    };
    await runMermaidRenderPipeline(BROKEN, deps);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });

  it("abortado durante el render: devuelve aborted", async () => {
    const gate = deferred();
    const deps = makeDeps({});
    deps.render = async () => {
      await gate.promise;
      return { svg: "<svg/>" };
    };
    const controller = new AbortController();
    const pending = runMermaidRenderPipeline(VALID, deps, { signal: controller.signal });
    controller.abort();
    gate.resolve();
    assert.deepEqual(await pending, { status: "aborted" });
  });
});

describe("runMermaidRenderPipeline con reintento ampliado", () => {
  // Cuerpo con un fence suelto: el candidato ampliado (`prepareMermaidDiagramForRender`) lo corta; los
  // candidatos del pase automático no producen ese texto.
  const NEEDS_EXTENDED = "flowchart TD\n  A --> B\n```\ntexto";
  const EXTENDED_FIX = "flowchart TD\n  A --> B";

  /** Render y parser falsos: solo `EXTENDED_FIX` es válido. */
  function oracleDeps(log: { parse: string[]; render: string[] }): MermaidRenderDeps {
    return {
      parse: async (text): Promise<MermaidParseResult> => {
        log.parse.push(text);
        return text === EXTENDED_FIX
          ? { status: "ok" }
          : { status: "invalid", error: "Parse error on line 3" };
      },
      render: async (text, id) => {
        log.render.push(text);
        if (text !== EXTENDED_FIX) throw new Error("Parse error on line 3");
        return { svg: `<svg id="${id}"/>` };
      },
      resolve: resolveMermaidWithOracle,
    };
  }

  it("precondición: el candidato ampliado no está entre los del pase automático", () => {
    assert.deepEqual(proposeExtendedMermaidRepairs(NEEDS_EXTENDED), [EXTENDED_FIX]);
  });

  it("sin extended, el inválido queda en error y sin marca de reintento", async () => {
    const log = { parse: [] as string[], render: [] as string[] };
    const result = await runMermaidRenderPipeline(NEEDS_EXTENDED, oracleDeps(log));
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.extendedTried, undefined);
    assert.ok(!log.parse.includes(EXTENDED_FIX));
  });

  it("con extended, el candidato ampliado que el parser acepta queda ready/repaired", async () => {
    const log = { parse: [] as string[], render: [] as string[] };
    const result = await runMermaidRenderPipeline(NEEDS_EXTENDED, oracleDeps(log), { extended: true });
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.repair, "repaired");
    assert.equal(result.text, EXTENDED_FIX);
    assert.ok(log.parse.includes(EXTENDED_FIX), "el candidato se valida con el parser antes de pintarse");
    assert.deepEqual(log.render, [NEEDS_EXTENDED, EXTENDED_FIX]);
  });

  it("con extended nunca se pinta un candidato que el parser rechaza", async () => {
    const log = { parse: [] as string[], render: [] as string[] };
    const deps = oracleDeps(log);
    deps.parse = async (text) => {
      log.parse.push(text);
      return { status: "invalid", error: "Parse error on line 3" };
    };
    const result = await runMermaidRenderPipeline(NEEDS_EXTENDED, deps, { extended: true });
    assert.equal(result.status, "error");
    // Solo el render del original: ningún candidato rechazado llegó a render.
    assert.deepEqual(log.render, [NEEDS_EXTENDED]);
  });

  it("con extended e irreparable: error con el texto original y extendedTried", async () => {
    const log = { parse: [] as string[], render: [] as string[] };
    const deps = oracleDeps(log);
    deps.parse = async () => ({ status: "invalid", error: "Parse error on line 3" });
    const result = await runMermaidRenderPipeline(NEEDS_EXTENDED, deps, { extended: true });
    assert.deepEqual(result, {
      status: "error",
      message: "Parse error on line 3",
      text: NEEDS_EXTENDED,
      extendedTried: true,
    });
    assert.match(MERMAID_NO_AUTO_REPAIR_MESSAGE, /Regenerar con IA/);
  });

  it("con extended y parser no disponible: no se marca extendedTried (Reparar sigue disponible)", async () => {
    const deps = makeDeps({
      failing: new Set([NEEDS_EXTENDED]),
      resolution: resolution({ status: "unverified", text: NEEDS_EXTENDED, error: "sin módulo" }),
    });
    const result = await runMermaidRenderPipeline(NEEDS_EXTENDED, deps, { extended: true });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.extendedTried, undefined);
  });

  it("con extended pide al oráculo candidatos ampliados y hasta 6 intentos; sin extended, los de por defecto", async () => {
    const seen: Array<{ propose?: unknown; maxAttempts?: number }> = [];
    const make = (): MermaidRenderDeps => {
      const deps = makeDeps({ failing: new Set([BROKEN]) });
      deps.resolve = async (body, _parse, opts) => {
        seen.push({ propose: opts?.propose, maxAttempts: opts?.maxAttempts });
        return { status: "invalid", text: body, original: body, error: "x", attempts: 1 };
      };
      return deps;
    };
    await runMermaidRenderPipeline(BROKEN, make());
    await runMermaidRenderPipeline(BROKEN, make(), { extended: true });
    assert.equal(seen[0]?.propose, undefined);
    assert.equal(seen[0]?.maxAttempts, undefined);
    assert.equal(seen[1]?.propose, proposeExtendedMermaidRepairs);
    assert.equal(seen[1]?.maxAttempts, 6);
  });

  it("startMermaidRender con extended=true: el reintento ampliado repara tras un error", async () => {
    const log = { parse: [] as string[], render: [] as string[] };
    const deps = oracleDeps(log);
    let state: MermaidRenderState = MERMAID_IDLE_STATE;
    const dispatch = (a: MermaidRenderAction) => {
      state = mermaidRenderReducer(state, a);
    };
    startMermaidRender(NEEDS_EXTENDED, deps, dispatch);
    await tick();
    assert.equal(state.status, "error");
    startMermaidRender(NEEDS_EXTENDED, deps, dispatch, undefined, true); // retry({ extended: true })
    await tick();
    assert.equal(state.status, "ready");
    assert.equal(state.status === "ready" && state.repair, "repaired");
  });
});

describe("startMermaidRender", () => {
  function collector() {
    const actions: MermaidRenderAction[] = [];
    return { actions, dispatch: (a: MermaidRenderAction) => actions.push(a) };
  }

  it("publica start y luego el resultado", async () => {
    const { actions, dispatch } = collector();
    startMermaidRender(VALID, makeDeps({}), dispatch);
    await tick();
    assert.equal(actions[0]?.type, "start");
    assert.equal(actions[1]?.type, "resolved");
    const last = actions[1];
    assert.ok(last && last.type === "resolved" && last.state.status === "ready");
  });

  it("cambio de raw: el resultado obsoleto se descarta y solo publica el vigente", async () => {
    const gateA = deferred();
    const deps = makeDeps({});
    const baseRender = deps.render;
    deps.render = async (text, id) => {
      if (text === VALID) await gateA.promise; // el render A es lento
      return baseRender(text, id);
    };
    const { actions, dispatch } = collector();

    const cancelA = startMermaidRender(VALID, deps, dispatch); // raw A
    cancelA(); // cambia raw: el efecto cancela A...
    startMermaidRender(FIXED, deps, dispatch); // ...y lanza B
    await tick();
    gateA.resolve(); // A termina tarde
    await tick();

    const resolved = actions.filter((a) => a.type === "resolved");
    assert.equal(resolved.length, 1);
    const only = resolved[0];
    assert.ok(only && only.type === "resolved" && only.state.status === "ready");
    if (only && only.type === "resolved" && only.state.status === "ready") {
      assert.equal(only.state.text, FIXED);
    }
  });

  it("retry tras un fallo de render con parser ok: el siguiente arranque se recupera", async () => {
    // El render falla de forma transitoria aunque el parser acepta el texto: error directo (sin segundo
    // render) y, al reintentar, el render pasa.
    let transient = true;
    const log: FakeLog = { render: [], resolve: [] };
    const deps = makeDeps({
      resolution: resolution({ status: "original", text: VALID }),
      log,
    });
    deps.render = async (text, id) => {
      log.render.push(text);
      if (transient) throw new Error("fallo transitorio de render");
      return { svg: `<svg id="${id}"/>` };
    };

    let state: MermaidRenderState = MERMAID_IDLE_STATE;
    const dispatch = (a: MermaidRenderAction) => {
      state = mermaidRenderReducer(state, a);
    };

    startMermaidRender(VALID, deps, dispatch);
    await tick();
    assert.equal(state.status, "error");
    assert.equal(state.status === "error" && state.message, "fallo transitorio de render");

    transient = false;
    startMermaidRender(VALID, deps, dispatch); // retry()
    assert.equal(state.status, "loading");
    await tick();
    assert.equal(state.status, "ready");
    assert.deepEqual(log.render, [VALID, VALID]);
  });

  it("cancelar tras desmontar no publica nada", async () => {
    const gate = deferred();
    const deps = makeDeps({});
    deps.render = async () => {
      await gate.promise;
      return { svg: "<svg/>" };
    };
    const { actions, dispatch } = collector();
    const cancel = startMermaidRender(VALID, deps, dispatch);
    cancel();
    gate.resolve();
    await tick();
    assert.deepEqual(actions.map((a) => a.type), ["start"]);
  });
});

describe("mermaidKey", () => {
  it("hashea TODO el contenido: cambios después de 256 caracteres cambian la clave", () => {
    const head = "flowchart TD\n" + "  A --> B\n".repeat(60);
    assert.ok(head.length > 256);
    assert.notEqual(mermaidKey(head + "  X --> Y"), mermaidKey(head + "  X --> Z"));
  });

  it("es estable y distingue contenidos distintos", () => {
    assert.equal(mermaidKey(VALID), mermaidKey(VALID));
    assert.notEqual(mermaidKey(VALID), mermaidKey(FIXED));
    assert.match(mermaidKey(VALID), /^mermaid-[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe("describeMermaidError / truncateMermaidError", () => {
  it("extrae el mensaje de Error, string y objetos de mermaid", () => {
    assert.equal(describeMermaidError(new Error("a")), "a");
    assert.equal(describeMermaidError("b"), "b");
    assert.equal(describeMermaidError({ str: "c", hash: {} }), "c");
    assert.equal(describeMermaidError(null), "Error desconocido de Mermaid");
  });

  it("recorta mensajes largos a ~300 caracteres", () => {
    const long = "x".repeat(1000);
    const out = truncateMermaidError(long);
    assert.ok(out.length <= 301);
    assert.ok(out.endsWith("…"));
    assert.equal(truncateMermaidError(" corto "), "corto");
  });
});
