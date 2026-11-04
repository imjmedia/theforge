import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import { runWithRequestUserAsync } from "../../common/request-user.store.js";
import { ProjectsService } from "./projects.service.js";

const OWNER = "user-openapi-spec";

function minimalPag(projectName: string, path: string): ProjectArchitectureGraph {
  return {
    version: "1.0.0",
    projectName,
    stack: {
      runtime: "Node",
      backendFramework: "NestJS",
      frontendFramework: "React",
      database: "PostgreSQL",
      orm: "Prisma",
    },
    entities: [
      {
        name: "Entity",
        fields: [{ name: "id", type: "UUID", required: true, constraints: [] }],
        primaryKey: "id",
        indexes: [],
      },
    ],
    endpoints: [
      {
        path,
        method: "GET",
        description: "read",
        authRequired: false,
        rolesAllowed: [],
        targetEntity: "Entity",
        errorCodes: [],
      },
    ],
    services: [],
  };
}

function makeService(stages: unknown[]) {
  const prisma = {
    project: {
      findFirst: async () => ({
        id: "proj-openapi",
        userId: OWNER,
        visibility: "PRIVATE",
        stages,
        group: null,
      }),
    },
  };
  const deps: unknown[] = [prisma, ...Array.from({ length: 13 }, () => ({}))];
  return new ProjectsService(...(deps as unknown as ConstructorParameters<typeof ProjectsService>));
}

describe("ProjectsService OpenAPI (RF-15)", () => {
  it("getOpenApiSpec prioriza Stage.architectureGraph sobre documentAst", async () => {
    const pagArch = minimalPag("FromArchitectureGraph", "/api/from-architecture-graph");
    const pagLegacy = minimalPag("FromDocumentAst", "/api/from-document-ast");
    const service = makeService([
      {
        id: "stage-1",
        ordinal: 1,
        workflowStatus: "ACTIVE",
        architectureGraph: pagArch,
        documentAst: pagLegacy,
      },
    ]);

    await runWithRequestUserAsync(OWNER, async () => {
      const spec = await service.getOpenApiSpec("proj-openapi");
      assert.equal(spec.info.title, "FromArchitectureGraph");
      assert.ok(spec.paths["/api/from-architecture-graph"]);
      assert.equal(spec.paths["/api/from-document-ast"], undefined);
    });
  });

  it("getOpenApiSpec usa documentAst cuando architectureGraph no tiene endpoints", async () => {
    const pagLegacy = minimalPag("LegacyAst", "/api/legacy-fallback");
    const service = makeService([
      {
        id: "stage-1",
        ordinal: 1,
        workflowStatus: "ACTIVE",
        architectureGraph: { note: "sin endpoints" },
        documentAst: pagLegacy,
      },
    ]);

    await runWithRequestUserAsync(OWNER, async () => {
      const spec = await service.getOpenApiSpec("proj-openapi");
      assert.equal(spec.info.title, "LegacyAst");
      assert.ok(spec.paths["/api/legacy-fallback"]);
    });
  });

  it("getOpenApiYaml y getOpenApiSpec fallan si ninguna etapa tiene PAG con endpoints", async () => {
    const service = makeService([
      {
        id: "stage-1",
        ordinal: 1,
        workflowStatus: "ACTIVE",
        documentAst: { entities: [] },
      },
    ]);

    await runWithRequestUserAsync(OWNER, async () => {
      await assert.rejects(() => service.getOpenApiSpec("proj-openapi"), NotFoundException);
      await assert.rejects(() => service.getOpenApiYaml("proj-openapi"), NotFoundException);
    });
  });
});
