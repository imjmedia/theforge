import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import { AiService } from "./ai.service.js";

function pagForProject(name: string): ProjectArchitectureGraph {
  return {
    version: "1.0.0",
    projectName: name,
    stack: {
      runtime: "Node.js 20",
      backendFramework: "NestJS",
      frontendFramework: "React",
      database: "PostgreSQL",
      orm: "Prisma",
    },
    entities: [
      {
        name: "Item",
        fields: [{ name: "id", type: "UUID", required: true, constraints: [] }],
        primaryKey: "id",
        indexes: [],
      },
    ],
    endpoints: [
      {
        path: `/api/v1/${name.toLowerCase()}`,
        method: "GET",
        description: `Lista ${name}`,
        authRequired: false,
        rolesAllowed: [],
        targetEntity: "Item",
        errorCodes: [500],
      },
    ],
    services: [
      {
        name: `${name}Module`,
        layer: "backend_module",
        handledEndpoints: [`/api/v1/${name.toLowerCase()}`],
        dependencies: [],
      },
    ],
  };
}

describe("AiService — aislamiento del PAG (sin singleton)", () => {
  const dummyFactory = {
    createForUser: () => ({
      generateResponse: async () => "{}",
      generateResponseStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      parseChecklist: async () => ({ ok: true, items: [] }),
      generateEmbedding: async () => [],
    }),
    resolveRuntime: async () => ({
      providerId: "openai",
      chatModel: "gpt-4o",
      apiKey: "test",
    }),
    resolveAuditorRuntime: async () => ({
      providerId: "openai",
      chatModel: "gpt-4o",
      apiKey: "test",
    }),
  } as any;

  const dummyTechDocs = { buildContextFromText: async () => null } as any;
  const dummyMermaid = { normalizeMermaid: async (s: string) => s } as any;

  function makeService(): AiService {
    return new AiService(dummyFactory, dummyTechDocs, null, dummyMermaid);
  }

  it("no guarda el PAG en propiedades de instancia del servicio", () => {
    const service = makeService();
    const legacyPagField = ["last", "Generated", "Pag"].join("");
    assert.equal(legacyPagField in service, false);
    const legacyGetter = ["get", "Last", "Generated", "Pag"].join("");
    assert.equal(typeof (service as Record<string, unknown>)[legacyGetter], "undefined");
  });

  it("generateApiContracts concurrente devuelve PAG distintos por MDD (retorno, no singleton)", async () => {
    const service = makeService();
    (service as any).generateProjectArchitectureGraph = async (mdd: string) => {
      if (mdd.includes("TenantAlpha")) return pagForProject("TenantAlpha");
      if (mdd.includes("TenantBeta")) return pagForProject("TenantBeta");
      throw new Error(`MDD inesperado: ${mdd.slice(0, 40)}`);
    };

    const [alpha, beta] = await Promise.all([
      service.generateApiContracts("# MDD TenantAlpha"),
      service.generateApiContracts("# MDD TenantBeta"),
    ]);

    assert.equal(alpha.pag?.projectName, "TenantAlpha");
    assert.equal(beta.pag?.projectName, "TenantBeta");
    assert.notEqual(alpha.pag?.endpoints[0].path, beta.pag?.endpoints[0].path);
  });

  it("generateLogicFlows e generateInfra usan pagFromStage sin mezclar proyectos en paralelo", async () => {
    const service = makeService();
    const pagA = pagForProject("LogicA");
    const pagB = pagForProject("LogicB");

    const [flowsA, flowsB, infraA, infraB] = await Promise.all([
      service.generateLogicFlows("# MDD LogicA", null, undefined, pagA),
      service.generateLogicFlows("# MDD LogicB", null, undefined, pagB),
      service.generateInfra("# MDD LogicA", null, null, undefined, pagA),
      service.generateInfra("# MDD LogicB", null, null, undefined, pagB),
    ]);

    assert.match(flowsA, /LogicA/);
    assert.match(flowsB, /LogicB/);
    assert.match(infraA, /LogicA/);
    assert.match(infraB, /LogicB/);
    assert.doesNotMatch(flowsA, /LogicB/);
    assert.doesNotMatch(flowsB, /LogicA/);
  });
});
