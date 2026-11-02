import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MermaidConfig } from "mermaid";
import {
  WEB_MERMAID_CONFIG,
  createMermaidRuntime,
  MermaidTimeoutError,
  type MermaidRuntimeOptions,
} from "./mermaid-runtime.js";
import {
  buildExcalidrawLibraryMermaidConfig,
  convertMermaidToExcalidrawExclusive,
} from "./mermaid-excalidraw-convert.js";

type FakeMermaid = Awaited<ReturnType<NonNullable<MermaidRuntimeOptions["importer"]>>>;

/** Constantes por defecto de `@excalidraw/mermaid-to-excalidraw` 2.2.2 (`dist/constants.js`). */
const LIB_DEFAULTS: MermaidConfig = {
  startOnLoad: false,
  flowchart: { curve: "linear" },
  themeVariables: { fontSize: "20px" },
  maxEdges: 500,
  maxTextSize: 50000,
};

describe("buildExcalidrawLibraryMermaidConfig", () => {
  it("reproduce la config que construye la librería: defaults + fontSize en raíz y themeVariables", () => {
    assert.deepEqual(buildExcalidrawLibraryMermaidConfig(LIB_DEFAULTS), {
      startOnLoad: false,
      flowchart: { curve: "linear" },
      themeVariables: { fontSize: "20px" },
      maxEdges: 500,
      maxTextSize: 50000,
      fontSize: "20px",
    });
  });

  it("no comparte la config web: no incluye theme ni securityLevel", () => {
    const cfg = buildExcalidrawLibraryMermaidConfig(LIB_DEFAULTS);
    assert.equal(cfg.theme, undefined);
    assert.equal(cfg.securityLevel, undefined);
  });
});

/**
 * Simula el comportamiento de la librería: solo llama `mermaid.initialize` cuando cambia el hash de su
 * config (`lastConfigHash`). Si el runtime no aplicara su config antes de cada conversión, la segunda
 * conversión no re-inicializaría y correría con la config web.
 */
function makeScenario() {
  const calls: string[] = [];
  const fake = {
    initialize: (cfg: unknown) => {
      calls.push(`initialize:${JSON.stringify(cfg)}`);
    },
  } as unknown as FakeMermaid;
  const rt = createMermaidRuntime({ importer: async () => fake });
  const libraryConfig = buildExcalidrawLibraryMermaidConfig(LIB_DEFAULTS);
  let lastConfigHash: string | null = null;
  const libraryConvert = async (): Promise<string> => {
    const hash = JSON.stringify(libraryConfig);
    if (hash !== lastConfigHash) {
      (fake as unknown as { initialize: (c: unknown) => void }).initialize(libraryConfig);
      lastConfigHash = hash;
    }
    calls.push("convert");
    return "escena";
  };
  const convert = (convertFn = libraryConvert) =>
    convertMermaidToExcalidrawExclusive({
      runExclusive: rt.runExclusive,
      initializeFor: rt.initializeMermaidFor,
      restoreWebConfig: rt.reinitializeMermaid,
      libraryConfig,
      convert: convertFn,
    });
  return { calls, rt, convert, libraryConfig };
}

describe("convertMermaidToExcalidrawExclusive", () => {
  it("dos conversiones seguidas: initialize(lib) -> convert -> initialize(web), las dos veces", async () => {
    const { calls, convert, libraryConfig } = makeScenario();
    const lib = `initialize:${JSON.stringify(libraryConfig)}`;
    const web = `initialize:${JSON.stringify(WEB_MERMAID_CONFIG)}`;
    assert.equal(await convert(), "escena");
    assert.equal(await convert(), "escena");
    // Primera conversión: el runtime aplica la config de la librería y la librería (hash nuevo) la
    // vuelve a aplicar. Segunda: la librería NO re-inicializa (mismo hash), pero el runtime sí aplica
    // su config antes de convertir. Siempre se cierra restaurando la config web.
    assert.deepEqual(calls, [lib, lib, "convert", web, lib, "convert", web]);
  });

  it("restaura la config web aunque la conversión lance", async () => {
    const { calls, convert, libraryConfig } = makeScenario();
    await assert.rejects(
      convert(async () => {
        throw new Error("conversión rota");
      }),
      /conversión rota/,
    );
    assert.deepEqual(calls, [
      `initialize:${JSON.stringify(libraryConfig)}`,
      `initialize:${JSON.stringify(WEB_MERMAID_CONFIG)}`,
    ]);
  });

  it("un timeout rechaza, restaura la config web al terminar la zombi y no bloquea la cola", async () => {
    const calls: string[] = [];
    const fake = { initialize: (c: unknown) => calls.push(JSON.stringify(c)) } as unknown as FakeMermaid;
    const rt = createMermaidRuntime({ importer: async () => fake });
    let release!: () => void;
    const hang = new Promise<void>((r) => {
      release = r;
    });
    const stuck = convertMermaidToExcalidrawExclusive({
      runExclusive: rt.runExclusive,
      initializeFor: rt.initializeMermaidFor,
      restoreWebConfig: rt.reinitializeMermaid,
      libraryConfig: { theme: "default" },
      convert: () => hang,
      timeoutMs: 20,
    });
    const next = rt.renderMermaid("x", "m1");
    // La tarea siguiente se ejecuta (el fake no tiene `render`, así que rechaza, pero la cola avanzó).
    await assert.rejects(stuck, (e: unknown) => e instanceof MermaidTimeoutError);
    await next.catch(() => undefined);
    release();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(calls.includes(JSON.stringify({ theme: "default" })));
    assert.equal(calls[calls.length - 1], JSON.stringify(WEB_MERMAID_CONFIG));
  });
});
