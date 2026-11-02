import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MermaidAbortError,
  MermaidTimeoutError,
  WEB_MERMAID_CONFIG,
  createMermaidRuntime,
  isMermaidLoadError,
  type MermaidRuntimeOptions,
} from "./mermaid-runtime.js";

type FakeMermaid = Awaited<ReturnType<NonNullable<MermaidRuntimeOptions["importer"]>>>;

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

interface FakeOptions {
  parse?: (text: string) => Promise<unknown>;
  render?: (id: string, text: string) => Promise<{ svg: string }>;
}

function makeFakeMermaid(calls: string[], opts: FakeOptions = {}): FakeMermaid {
  const fake = {
    initialize: (cfg: unknown) => {
      calls.push(`initialize:${JSON.stringify(cfg)}`);
    },
    parse: async (text: string, popts: unknown) => {
      calls.push(`parse:${text}:${JSON.stringify(popts)}`);
      return opts.parse ? opts.parse(text) : { diagramType: "flowchart-v2" };
    },
    render: async (id: string, text: string) => {
      calls.push(`render:${id}`);
      return opts.render ? opts.render(id, text) : { svg: `<svg id="${id}"/>` };
    },
  };
  return fake as unknown as FakeMermaid;
}

describe("runExclusive", () => {
  it("ejecuta las tareas en orden FIFO", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const order: number[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const runs = gates.map((g, i) =>
      rt.runExclusive(async () => {
        order.push(i);
        await g.promise;
        return i;
      }),
    );
    // Se liberan en orden inverso: aun así deben terminar en orden de encolado.
    gates[2]!.resolve();
    gates[1]!.resolve();
    gates[0]!.resolve();
    assert.deepEqual(await Promise.all(runs), [0, 1, 2]);
    assert.deepEqual(order, [0, 1, 2]);
  });

  it("no solapa tareas (exclusión mutua)", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
    };
    await Promise.all([rt.runExclusive(task), rt.runExclusive(task), rt.runExclusive(task)]);
    assert.equal(maxActive, 1);
  });

  it("un rechazo no bloquea las siguientes y se propaga a su llamador", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const first = rt.runExclusive(async () => {
      throw new Error("falla");
    });
    const second = rt.runExclusive(async () => "ok");
    await assert.rejects(first, /falla/);
    assert.equal(await second, "ok");
  });

  it("tolera una tarea que lanza de forma síncrona", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const first = rt.runExclusive((() => {
      throw new Error("sync");
    }) as () => Promise<never>);
    await assert.rejects(first, /sync/);
    assert.equal(await rt.runExclusive(async () => 1), 1);
  });
});

describe("loadMermaid", () => {
  it("cachea la promesa cuando resuelve", async () => {
    let imports = 0;
    const fake = makeFakeMermaid([]);
    const rt = createMermaidRuntime({
      importer: async () => {
        imports++;
        return fake;
      },
    });
    const [a, b] = await Promise.all([rt.loadMermaid(), rt.loadMermaid()]);
    await rt.loadMermaid();
    assert.equal(a, fake);
    assert.equal(b, fake);
    assert.equal(imports, 1);
  });

  it("no cachea un rechazo: el siguiente intento vuelve a importar", async () => {
    let imports = 0;
    const fake = makeFakeMermaid([]);
    const rt = createMermaidRuntime({
      importer: async () => {
        imports++;
        if (imports === 1) throw new Error("chunk no disponible");
        return fake;
      },
    });
    await assert.rejects(rt.loadMermaid(), /chunk no disponible/);
    assert.equal(await rt.loadMermaid(), fake);
    assert.equal(imports, 2);
  });

  it("un importador que lanza de forma síncrona se trata como rechazo", async () => {
    let imports = 0;
    const fake = makeFakeMermaid([]);
    const rt = createMermaidRuntime({
      importer: (() => {
        imports++;
        if (imports === 1) throw new Error("sync");
        return Promise.resolve(fake);
      }) as () => Promise<FakeMermaid>,
    });
    await assert.rejects(rt.loadMermaid(), /sync/);
    assert.equal(await rt.loadMermaid(), fake);
  });
});

describe("parseMermaid", () => {
  it("devuelve ok con el tipo de diagrama y usa suppressErrors:false", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    const res = await rt.parseMermaid("flowchart TD\nA-->B");
    assert.deepEqual(res, { status: "ok", diagramType: "flowchart-v2" });
    assert.ok(calls.some((c) => c.includes('{"suppressErrors":false}')));
  });

  it("devuelve invalid con el mensaje real del parser", async () => {
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], {
          parse: async () => {
            throw new Error("Parse error on line 2");
          },
        }),
    });
    assert.deepEqual(await rt.parseMermaid("x"), {
      status: "invalid",
      error: "Parse error on line 2",
    });
  });

  it("devuelve unavailable (nunca invalid) si el import falla", async () => {
    const rt = createMermaidRuntime({
      importer: async () => {
        throw new Error("sin red");
      },
    });
    assert.deepEqual(await rt.parseMermaid("flowchart TD\nA-->B"), {
      status: "unavailable",
      error: "sin red",
    });
  });

  it("un parse inválido no bloquea el siguiente", async () => {
    let n = 0;
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], {
          parse: async () => {
            if (n++ === 0) throw new Error("mal");
            return { diagramType: "sequence" };
          },
        }),
    });
    const [a, b] = await Promise.all([rt.parseMermaid("a"), rt.parseMermaid("b")]);
    assert.equal(a.status, "invalid");
    assert.deepEqual(b, { status: "ok", diagramType: "sequence" });
  });
});

describe("renderMermaid", () => {
  it("inicializa con la config web justo antes de cada render", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    const cfg = `initialize:${JSON.stringify(WEB_MERMAID_CONFIG)}`;
    await rt.renderMermaid("flowchart TD\nA-->B", "m1");
    await rt.renderMermaid("flowchart TD\nA-->C", "m2");
    assert.deepEqual(calls, [cfg, "render:m1", cfg, "render:m2"]);
  });

  it("la config web mantiene loose, tema dark y sin render de errores", () => {
    assert.equal(WEB_MERMAID_CONFIG.securityLevel, "loose");
    assert.equal(WEB_MERMAID_CONFIG.theme, "dark");
    assert.equal(WEB_MERMAID_CONFIG.startOnLoad, false);
    assert.equal(WEB_MERMAID_CONFIG.suppressErrorRendering, true);
  });

  it("tras un fallo limpia los huérfanos, propaga el error y no bloquea la cola", async () => {
    const cleaned: string[] = [];
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], {
          render: async (id) => {
            if (id === "bad") throw new Error("render roto");
            return { svg: "<svg/>" };
          },
        }),
      cleanupOrphans: (id) => cleaned.push(id),
    });
    const bad = rt.renderMermaid("x", "bad");
    const good = rt.renderMermaid("y", "good");
    await assert.rejects(bad, /render roto/);
    assert.deepEqual(await good, { svg: "<svg/>" });
    assert.deepEqual(cleaned, ["bad"]);
  });

  it("serializa renders concurrentes", async () => {
    const gate = deferred();
    const calls: string[] = [];
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid(calls, {
          render: async (id) => {
            if (id === "a") await gate.promise;
            return { svg: id };
          },
        }),
    });
    const a = rt.renderMermaid("x", "a");
    const b = rt.renderMermaid("y", "b");
    await tick();
    await tick();
    assert.ok(!calls.includes("render:b"), "b no debe empezar antes de que termine a");
    gate.resolve();
    await Promise.all([a, b]);
    assert.ok(calls.indexOf("render:a") < calls.indexOf("render:b"));
  });

  it("propaga el bindFunctions de mermaid", async () => {
    const bind = () => undefined;
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], { render: async () => ({ svg: "<svg/>", bindFunctions: bind } as never) }),
    });
    const out = await rt.renderMermaid("x", "i");
    assert.equal(out.bindFunctions, bind);
  });
});

describe("reinitializeMermaid", () => {
  it("restaura la config web (uso tras convertir a Excalidraw)", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    await rt.runExclusive(async () => {
      await rt.reinitializeMermaid();
    });
    assert.deepEqual(calls, [`initialize:${JSON.stringify(WEB_MERMAID_CONFIG)}`]);
  });
});

describe("runExclusive con timeout", () => {
  it("un timeout rechaza, libera la cola y no bloquea a las siguientes", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const never = deferred();
    const stuck = rt.runExclusive(() => never.promise, { timeoutMs: 20 });
    const next = rt.runExclusive(async () => "siguiente", { timeoutMs: 1000 });
    await assert.rejects(stuck, (err: unknown) => err instanceof MermaidTimeoutError && err.name === "TimeoutError");
    assert.equal(await next, "siguiente");
    never.resolve();
  });

  it("el timeout cuenta desde que la tarea empieza, no desde que se encola", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const gate = deferred();
    const first = rt.runExclusive(() => gate.promise, { timeoutMs: 1000 });
    // Espera en cola ~60 ms con un timeout propio de 40 ms: no debe vencer mientras espera.
    const second = rt.runExclusive(async () => "ok", { timeoutMs: 40 });
    await new Promise((r) => setTimeout(r, 60));
    gate.resolve();
    await first;
    assert.equal(await second, "ok");
  });

  it("usa el timeout por defecto del runtime si no se indica", async () => {
    const rt = createMermaidRuntime({
      importer: async () => makeFakeMermaid([]),
      taskTimeoutMs: 20,
    });
    await assert.rejects(rt.runExclusive(() => new Promise<never>(() => undefined)), /superó el límite/);
  });
});

describe("AbortSignal", () => {
  it("renderMermaid con signal abortado no llama a mermaid y rechaza con AbortError", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      rt.renderMermaid("flowchart TD\nA-->B", "m1", { signal: controller.signal }),
      (err: unknown) => err instanceof MermaidAbortError && err.name === "AbortError",
    );
    assert.deepEqual(calls, []);
  });

  it("parseMermaid con signal abortado no llama a mermaid y rechaza con AbortError", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(rt.parseMermaid("x", { signal: controller.signal }), /cancelada/);
    assert.deepEqual(calls, []);
  });

  it("una tarea encolada cuyo signal se aborta mientras espera se descarta al empezar", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    const gate = deferred();
    const blocker = rt.runExclusive(() => gate.promise);
    const controller = new AbortController();
    const queued = rt.renderMermaid("x", "queued", { signal: controller.signal });
    await tick();
    controller.abort();
    gate.resolve();
    await blocker;
    await assert.rejects(queued, /cancelada/);
    assert.ok(!calls.some((c) => c.startsWith("render:") || c.startsWith("initialize:")));
    // La cola sigue operativa.
    assert.equal(await rt.runExclusive(async () => 1), 1);
  });

  it("sin abortar, el signal no afecta al render", async () => {
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid([]) });
    const controller = new AbortController();
    assert.deepEqual(await rt.renderMermaid("x", "i", { signal: controller.signal }), { svg: '<svg id="i"/>' });
  });
});

describe("clasificación de errores de parse", () => {
  it("un fallo de carga de chunk dinámico en parse es unavailable, no invalid", async () => {
    const messages = [
      "Failed to fetch dynamically imported module: https://x/assets/flowDiagram-abc.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/x.css",
    ];
    for (const message of messages) {
      const rt = createMermaidRuntime({
        importer: async () =>
          makeFakeMermaid([], {
            parse: async () => {
              throw new TypeError(message);
            },
          }),
      });
      const res = await rt.parseMermaid("flowchart TD\nA-->B");
      assert.equal(res.status, "unavailable", message);
    }
  });

  it("un error con name ChunkLoadError es unavailable", async () => {
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], {
          parse: async () => {
            const err = new Error("Loading chunk 12 failed.");
            err.name = "ChunkLoadError";
            throw err;
          },
        }),
    });
    assert.equal((await rt.parseMermaid("x")).status, "unavailable");
  });

  it("un fallo de mermaid.initialize es unavailable", async () => {
    const fake = makeFakeMermaid([]) as unknown as { initialize: () => void };
    fake.initialize = () => {
      throw new Error("config rota");
    };
    const rt = createMermaidRuntime({ importer: async () => fake as unknown as FakeMermaid });
    assert.deepEqual(await rt.parseMermaid("x"), { status: "unavailable", error: "config rota" });
  });

  it("los errores de sintaxis que lanza mermaid.parse siguen siendo invalid", async () => {
    const rt = createMermaidRuntime({
      importer: async () =>
        makeFakeMermaid([], {
          parse: async () => {
            throw new Error("Parse error on line 2:\n...expecting 'SQE'");
          },
        }),
    });
    assert.equal((await rt.parseMermaid("x")).status, "invalid");
  });

  it("isMermaidLoadError no confunde un error de sintaxis con uno de carga", () => {
    assert.equal(isMermaidLoadError(new Error("Parse error on line 1")), false);
    assert.equal(isMermaidLoadError(new TypeError("Failed to fetch dynamically imported module: x")), true);
  });
});

describe("initializeMermaidFor", () => {
  it("aplica la config indicada y no la web", async () => {
    const calls: string[] = [];
    const rt = createMermaidRuntime({ importer: async () => makeFakeMermaid(calls) });
    await rt.initializeMermaidFor({ theme: "default" });
    assert.deepEqual(calls, [`initialize:${JSON.stringify({ theme: "default" })}`]);
  });
});
