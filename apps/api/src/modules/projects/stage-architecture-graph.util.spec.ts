import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import {
  resolveProjectOpenApiPag,
  resolveStageProjectArchitectureGraph,
  stageJsonHasPagEndpoints,
} from "./stage-architecture-graph.util.js";

const pagA: ProjectArchitectureGraph = {
  version: "1.0.0",
  projectName: "FromArchitectureGraph",
  stack: {
    runtime: "Node",
    backendFramework: "NestJS",
    frontendFramework: "React",
    database: "PostgreSQL",
    orm: "Prisma",
  },
  entities: [],
  endpoints: [{ path: "/a", method: "GET", description: "a", authRequired: false, rolesAllowed: [], targetEntity: "X", errorCodes: [] }],
  services: [],
  modules: [],
};

const pagLegacy: ProjectArchitectureGraph = {
  ...pagA,
  projectName: "FromDocumentAst",
  endpoints: [{ path: "/legacy", method: "GET", description: "l", authRequired: false, rolesAllowed: [], targetEntity: "X", errorCodes: [] }],
};

describe("stage-architecture-graph.util", () => {
  it("stageJsonHasPagEndpoints exige clave endpoints", () => {
    assert.equal(stageJsonHasPagEndpoints(pagA), true);
    assert.equal(stageJsonHasPagEndpoints({ entities: [] }), false);
    assert.equal(stageJsonHasPagEndpoints(null), false);
  });

  it("resolveStageProjectArchitectureGraph prioriza architectureGraph sobre documentAst", () => {
    const resolved = resolveStageProjectArchitectureGraph({
      architectureGraph: pagA,
      documentAst: pagLegacy,
    });
    assert.equal(resolved?.projectName, "FromArchitectureGraph");
  });

  it("resolveStageProjectArchitectureGraph usa documentAst si architectureGraph no tiene endpoints", () => {
    const resolved = resolveStageProjectArchitectureGraph({
      architectureGraph: { note: "not a pag" },
      documentAst: pagLegacy,
    });
    assert.equal(resolved?.projectName, "FromDocumentAst");
  });

  it("resolveProjectOpenApiPag usa la etapa primaria y recorre el resto", () => {
    const onlySecondary = resolveProjectOpenApiPag([
      { id: "1", ordinal: 1, workflowStatus: "DRAFT", documentAst: pagLegacy } as any,
    ]);
    assert.equal(onlySecondary?.projectName, "FromDocumentAst");

    const primaryWins = resolveProjectOpenApiPag([
      { id: "1", ordinal: 1, workflowStatus: "ACTIVE", architectureGraph: pagA } as any,
      { id: "2", ordinal: 2, workflowStatus: "DRAFT", documentAst: pagLegacy } as any,
    ]);
    assert.equal(primaryWins?.projectName, "FromArchitectureGraph");
  });
});
