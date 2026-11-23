import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendAgentProgressDone,
  agentProgressFromMddJobProgress,
  findActiveAgentProgressStep,
  mergeAgentProgressFromMddEvent,
  resolveAgentProgressDisplayLabel,
} from "./agentProgress.js";

describe("appendAgentProgressDone", () => {
  it("deduplicates consecutive identical poll progress (same agent + message)", () => {
    const first = appendAgentProgressDone([], {
      agent: "Inyector de diagramas (MDD)",
      message: "Diagramas Mermaid añadidos",
    });
    assert.equal(first.length, 1);

    const second = appendAgentProgressDone(first, {
      agent: "Inyector de diagramas (MDD)",
      message: "Diagramas Mermaid añadidos",
    });
    assert.equal(second.length, 1);
  });

  it("appends again when the same step runs after other nodes (delivery gate loop)", () => {
    let progress = appendAgentProgressDone([], {
      agent: "Arquitecto de Software",
      message: "Schema SQL y contratos de API definidos",
    });
    progress = appendAgentProgressDone(progress, {
      agent: "Auditor (calidad MDD)",
      message: "Calidad del MDD evaluada",
    });
    progress = appendAgentProgressDone(progress, {
      agent: "Arquitecto de Software",
      message: "Schema SQL y contratos de API definidos",
    });
    assert.equal(progress.length, 3);
  });

  it("builds active step from accumulated job progress", () => {
    const items = agentProgressFromMddJobProgress({
      steps: [
        { agent: "Arquitecto de Software", message: "Schema SQL y contratos de API definidos" },
      ],
      active: { agent: "Auditor (calidad MDD)", message: "Evaluando calidad del MDD…" },
    });
    assert.equal(items.length, 2);
    assert.equal(items[1]?.status, "generando");
    assert.equal(items[1]?.agent, "Auditor (calidad MDD)");
  });
});

describe("mergeAgentProgressFromMddEvent", () => {
  it("does not shrink when job snapshot is a subsequence of stream history", () => {
    let progress = mergeAgentProgressFromMddEvent([], {
      agent: "Clarificador (MDD)",
      message: "Alcance y requisitos clarificados",
    });
    progress = mergeAgentProgressFromMddEvent(progress, {
      agent: "Arquitecto de Software",
      message: "Schema SQL y contratos de API definidos",
    });
    progress = mergeAgentProgressFromMddEvent(progress, {
      agent: "Auditor (calidad MDD)",
      message: "Calidad del MDD evaluada",
    });
    assert.equal(progress.length, 3);

    const fromJobPoll = mergeAgentProgressFromMddEvent(progress, {
      steps: [
        { agent: "Clarificador (MDD)", message: "Alcance y requisitos clarificados" },
        { agent: "Arquitecto de Software", message: "Schema SQL y contratos de API definidos" },
      ],
      active: { agent: "Auditor (calidad MDD)", message: "Evaluando calidad del MDD…" },
    });
    assert.equal(fromJobPoll.length, 4);
    assert.equal(fromJobPoll[2]?.agent, "Auditor (calidad MDD)");
    assert.equal(fromJobPoll[2]?.status, "done");
    assert.equal(fromJobPoll[3]?.status, "generando");
  });

  it("extends history when job reports new completed steps", () => {
    const prev = mergeAgentProgressFromMddEvent([], {
      agent: "Clarificador (MDD)",
      message: "Alcance y requisitos clarificados",
    });
    const next = mergeAgentProgressFromMddEvent(prev, {
      steps: [
        { agent: "Clarificador (MDD)", message: "Alcance y requisitos clarificados" },
        { agent: "Inyector de diagramas (MDD)", message: "Diagramas Mermaid añadidos" },
      ],
      active: null,
    });
    assert.equal(next.length, 2);
    assert.equal(next[1]?.agent, "Inyector de diagramas (MDD)");
  });

  it("sets active step from phase=active events", () => {
    const next = mergeAgentProgressFromMddEvent([], {
      agent: "Clarificador (MDD)",
      message: "Sincronizando §1 Contexto y alcance…",
      phase: "active",
    });
    assert.equal(next.length, 1);
    assert.equal(next[0]?.status, "generando");
  });
});

describe("resolveAgentProgressDisplayLabel & findActiveAgentProgressStep", () => {
  it("muestra el nombre del documento en cascadas de entregables sin «(revisión)» falso", () => {
    const items = [
      { agent: "Entregables", step: "MDD Canonical", message: "✅ MDD Canonical — Terminado", status: "terminado" as const },
      { agent: "Entregables", step: "Spec", message: "✅ Spec — Terminado", status: "terminado" as const },
      { agent: "Entregables", step: "Arquitectura", message: "⚡ Arquitectura — Generando…", status: "generando" as const },
      { agent: "Entregables", step: "Blueprint", message: "⚪ Blueprint — Generando…", status: "generando" as const },
    ];
    assert.equal(resolveAgentProgressDisplayLabel(items, 0, false), "MDD Canonical");
    assert.equal(resolveAgentProgressDisplayLabel(items, 2, true), "Arquitectura");
  });

  it("mantiene «(revisión)» cuando el mismo agente del grafo MDD reaparece activo", () => {
    const items = [
      { agent: "Arquitecto de Software", message: "Schema SQL definido", status: "done" as const },
      { agent: "Auditor (calidad MDD)", message: "Calidad evaluada", status: "done" as const },
      { agent: "Arquitecto de Software", message: "Refinando §4…", status: "generando" as const },
    ];
    assert.equal(resolveAgentProgressDisplayLabel(items, 2, true), "Arquitecto de Software (revisión)");
  });

  it("prioriza el paso con ⚡ en ejecución sobre pasos ⚪ pendientes", () => {
    const items = [
      { agent: "Entregables", step: "Casos de Uso", message: "⚪ Casos de Uso — Generando…", status: "generando" as const },
      { agent: "Entregables", step: "Contratos API", message: "⚡ Contratos API — Generando…", status: "generando" as const },
    ];
    const active = findActiveAgentProgressStep(items);
    assert.equal(active?.step, "Contratos API");
  });
});
