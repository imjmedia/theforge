import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AIFactory } from "../../ai/ai.factory.js";
import type { UserLLMRuntime } from "../../ai/providers/llm-runtime.types.js";
import { reduceMddDraft } from "../state/mdd-state.annotation.js";
import { createMddGraph, createMddGraphWithManager } from "./mdd-graph.js";

/**
 * Nodos que escriben `mddDraft` (grep de `mddDraft:` en nodes/ + mdd-graph.ts).
 * Dos de ellos en el mismo superstep => reduceMddDraft descarta uno de los parches (H3).
 */
const MDD_DRAFT_WRITERS: ReadonlySet<string> = new Set([
  "clarifier",
  "software_architect",
  "stack_architect",
  "data_model",
  "data_model_patch",
  "api_contracts",
  "architect_critic",
  "format_after_architect",
  "security_integration",
  "integration",
  "format_sec_int",
  "format_after_redactor",
  "cross_consistency_checker",
  "diagram_injector",
  "auditor",
  "section5",
  "tail_parallel",
  "post_critic_parallel",
  "prepare_output",
  "merge_section1",
  "security",
  "redactor",
  "llm_formatter",
]);

const STUB_RUNTIME: UserLLMRuntime = {
  providerId: "openai",
  apiKey: "test-key-not-real",
  baseURL: "http://localhost:0",
  chatModel: "test-model",
  chatModelFallbacks: [],
  embeddingModel: null,
  embeddingDimension: null,
  embeddingsEnabled: false,
  sttModel: null,
  visionModel: "test-model",
  imageModel: null,
};

const STUB_FACTORY = {
  resolveRuntime: async () => STUB_RUNTIME,
  resolveAuditorRuntime: async () => STUB_RUNTIME,
  resolveHighComplexityRuntime: async () => STUB_RUNTIME,
} as unknown as AIFactory;

interface DrawableEdge {
  source: string;
  target: string;
  conditional?: boolean;
}
interface DrawableGraph {
  nodes: Record<string, unknown>;
  edges: DrawableEdge[];
}

function edgesOf(graph: { getGraph(): unknown }): DrawableEdge[] {
  const g = graph.getGraph() as DrawableGraph;
  assert.ok(Array.isArray(g.edges), "getGraph() debe exponer edges");
  return g.edges.map((e) => ({ source: String(e.source), target: String(e.target), conditional: e.conditional }));
}

/** Destinos de un origen agrupados por tipo de arista. */
function targetsFrom(edges: DrawableEdge[], source: string, conditional: boolean): string[] {
  return edges.filter((e) => e.source === source && Boolean(e.conditional) === conditional).map((e) => e.target);
}

/**
 * Fan-out: un origen con >1 arista estática (estas disparan todos los destinos en el mismo superstep).
 * Las aristas condicionales eligen un destino y no cuentan.
 * Devuelve los pares de escritores de mddDraft que quedarían en el mismo superstep.
 */
function parallelDraftWriterPairs(edges: DrawableEdge[]): string[] {
  const pairs: string[] = [];
  const sources = new Set(edges.map((e) => e.source));
  for (const source of sources) {
    const staticTargets = [...new Set(targetsFrom(edges, source, false))].filter((t) => MDD_DRAFT_WRITERS.has(t));
    for (let i = 0; i < staticTargets.length; i++) {
      for (let j = i + 1; j < staticTargets.length; j++) {
        pairs.push(`${source} -> {${staticTargets[i]}, ${staticTargets[j]}}`);
      }
    }
  }
  return pairs;
}

describe("topología de los grafos MDD (H3: sin carrera sobre mddDraft)", () => {
  it("one-shot: ningún fan-out hacia dos escritores de mddDraft", async () => {
    const graph = await createMddGraph(STUB_FACTORY, "user-test", { preflightRuntime: STUB_RUNTIME });
    const edges = edgesOf(graph);
    assert.deepEqual(parallelDraftWriterPairs(edges), []);
  });

  it("one-shot: stack_architect tiene destinos pinned (section5, post_critic_parallel)", async () => {
    const graph = await createMddGraph(STUB_FACTORY, "user-test", { preflightRuntime: STUB_RUNTIME });
    const edges = edgesOf(graph);
    const targets = [...new Set(targetsFrom(edges, "stack_architect", true))].sort();
    assert.ok(targets.includes("section5"));
    assert.ok(targets.includes("post_critic_parallel"));
  });

  it("one-shot: format_after_redactor -> cross_consistency_checker -> diagram_injector en serie", async () => {
    const graph = await createMddGraph(STUB_FACTORY, "user-test", { preflightRuntime: STUB_RUNTIME });
    const edges = edgesOf(graph);
    assert.deepEqual(targetsFrom(edges, "format_after_redactor", false), ["cross_consistency_checker"]);
    assert.deepEqual(targetsFrom(edges, "cross_consistency_checker", false), ["diagram_injector"]);
    assert.deepEqual(targetsFrom(edges, "cross_consistency_checker", true), []);
    assert.deepEqual(
      [...targetsFrom(edges, "diagram_injector", true)].sort(),
      ["auditor", "prepare_output"],
    );
  });

  it("grafo con Manager: ningún fan-out estático hacia dos escritores de mddDraft", async () => {
    const graph = await createMddGraphWithManager(STUB_FACTORY, "user-test", null, null, null, {
      preflightRuntime: STUB_RUNTIME,
    });
    const edges = edgesOf(graph);
    assert.deepEqual(parallelDraftWriterPairs(edges), []);
  });
});

describe("reduceMddDraft: aviso de escritura concurrente", () => {
  function captureWarns(fn: () => void): string[] {
    const warn = mock.method(console, "warn", () => {});
    try {
      fn();
      return warn.mock.calls.map((c) => String(c.arguments[0]));
    } finally {
      warn.mock.restore();
    }
  }

  it("avisa cuando llegan dos borradores distintos y ninguno contiene al otro", () => {
    const a = "# Master Design Document\n\n## 1. Contexto\n\nParche de consistencia.";
    const b = "# Master Design Document\n\n## 1. Contexto\n\nER inyectado distinto.";
    const warns = captureWarns(() => {
      reduceMddDraft(a, b);
    });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[MDD:reduceMddDraft\] dos MDD completos distintos en el mismo paso \(len \d+\/\d+\)/);
  });

  it("no avisa si alguno de los dos es un parche de sección (no un MDD completo)", () => {
    const full = "# Master Design Document\n\n## 1. Contexto\n\nBase completa.";
    const patch = "## 3. Modelo de datos\n\nTabla nueva.";
    const warns = captureWarns(() => {
      reduceMddDraft(full, patch);
      reduceMddDraft(patch, full);
    });
    assert.deepEqual(warns, []);
  });

  it("no avisa cuando uno contiene al otro, son iguales o alguno está vacío", () => {
    const base = "# Master Design Document\n\n## 1. Contexto\n\nBreve.";
    const extended = `${base}\n\n## 2. Arquitectura\n\nMás.`;
    const warns = captureWarns(() => {
      reduceMddDraft(base, extended);
      reduceMddDraft(extended, base);
      reduceMddDraft(base, base);
      reduceMddDraft("", base);
      reduceMddDraft(base, "  ");
    });
    assert.deepEqual(warns, []);
  });
});
