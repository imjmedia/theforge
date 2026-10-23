import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { AiService } from "./ai.service.js";
import {
  projectArchitectureGraphSchema,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";

describe("AiService — Structured Output & ProjectArchitectureGraph (PAG)", () => {
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

  const dummyTechDocs = {
    buildContextFromText: async () => null,
  } as any;

  it("generateObject desempaqueta JSON envuelto en bloques markdown", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    const mockJson = JSON.stringify({ name: "AuthModule", active: true });
    (service as any).generateResponse = async () => `\`\`\`json\n${mockJson}\n\`\`\``;

    const schema = z.object({
      name: z.string(),
      active: z.boolean(),
    });

    const result = await service.generateObject(schema, {
      prompt: "Dame la estructura",
      systemPrompt: "Eres un asistente estructurado",
    });

    assert.equal(result.name, "AuthModule");
    assert.equal(result.active, true);
  });

  it("generateProjectArchitectureGraph retorna un PAG válido y validado", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    const mockPag: ProjectArchitectureGraph = {
      version: "1.0.0",
      projectName: "InvoiceForge",
      description: "Sistema enterprise de facturación",
      stack: {
        runtime: "Node.js 20",
        backendFramework: "NestJS",
        frontendFramework: "React",
        database: "PostgreSQL",
        orm: "Prisma",
      },
      entities: [
        {
          name: "User",
          fields: [
            { name: "id", type: "UUID", required: true, constraints: [{ type: "required" }] },
            { name: "email", type: "String", required: true, constraints: [{ type: "unique" }] },
          ],
          primaryKey: "id",
          indexes: ["email"],
        },
        {
          name: "Invoice",
          fields: [
            { name: "id", type: "UUID", required: true, constraints: [{ type: "required" }] },
            {
              name: "userId",
              type: "UUID",
              required: true,
              constraints: [
                {
                  type: "foreign_key",
                  reference: { entity: "User", field: "id", onDelete: "CASCADE" },
                },
              ],
            },
            { name: "total", type: "Float", required: true, constraints: [] },
          ],
          primaryKey: "id",
          indexes: ["userId"],
        },
      ],
      endpoints: [
        {
          path: "/api/v1/invoices",
          method: "POST",
          description: "Crea una nueva factura para el usuario",
          authRequired: true,
          rolesAllowed: ["ADMIN", "BILLING"],
          targetEntity: "Invoice",
          errorCodes: [400, 401, 404, 500],
        },
      ],
      services: [
        {
          name: "InvoiceModule",
          layer: "backend_module",
          handledEndpoints: ["/api/v1/invoices"],
          dependencies: ["AuthModule"],
        },
      ],
    };

    (service as any).generateResponse = async () => JSON.stringify(mockPag);

    const pag = await service.generateProjectArchitectureGraph("# MDD InvoiceForge\n## §1 Visión...");
    assert.equal(pag.projectName, "InvoiceForge");
    assert.equal(pag.entities.length, 2);
    assert.equal(pag.endpoints[0].method, "POST");
    assert.equal(pag.endpoints[0].targetEntity, "Invoice");
  });

  it("generateApiContracts genera tablas Markdown compiladas sin prosa libre", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    const mockPag: ProjectArchitectureGraph = {
      version: "1.0.0",
      projectName: "OrderService",
      stack: {
        runtime: "Node.js 20",
        backendFramework: "NestJS",
        frontendFramework: "React",
        database: "PostgreSQL",
        orm: "Prisma",
      },
      entities: [
        {
          name: "Order",
          fields: [
            { name: "id", type: "UUID", required: true, constraints: [] },
            { name: "status", type: "String", required: true, constraints: [] },
          ],
          primaryKey: "id",
          indexes: [],
        },
      ],
      endpoints: [
        {
          path: "/api/v1/orders",
          method: "GET",
          description: "Lista todas las órdenes con paginación",
          authRequired: true,
          rolesAllowed: ["OPERATOR"],
          targetEntity: "Order",
          errorCodes: [401, 500],
        },
      ],
      services: [
        {
          name: "OrderModule",
          layer: "backend_module",
          handledEndpoints: ["/api/v1/orders"],
          dependencies: [],
        },
      ],
    };

    (service as any).generateResponse = async () => JSON.stringify(mockPag);

    const contractsMarkdown = await service.generateApiContracts("# MDD OrderService");
    assert.match(contractsMarkdown, /## 1\. Catálogo de Endpoints/);
    assert.match(contractsMarkdown, /\|\s+\*\*GET\*\*\s+\|\s+`\/api\/v1\/orders`\s+\|/);
    assert.match(contractsMarkdown, /## 3\. Códigos de Estado y Manejo de Errores/);

    const savedPag = service.getLastGeneratedPag();
    assert.ok(savedPag);
    assert.equal(savedPag?.projectName, "OrderService");
  });

  it("generateLogicFlows genera diagramas de secuencia Mermaid sin prosa libre", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    const mockPag: ProjectArchitectureGraph = {
      version: "1.0.0",
      projectName: "OrderService",
      stack: {
        runtime: "Node.js 20",
        backendFramework: "NestJS",
        frontendFramework: "React",
        database: "PostgreSQL",
        orm: "Prisma",
      },
      entities: [
        {
          name: "Order",
          fields: [{ name: "id", type: "UUID", required: true, constraints: [] }],
          primaryKey: "id",
          indexes: [],
        },
      ],
      endpoints: [
        {
          path: "/api/v1/orders",
          method: "POST",
          description: "Crea una orden nueva en el sistema",
          authRequired: true,
          rolesAllowed: ["BUYER"],
          targetEntity: "Order",
          errorCodes: [400, 401],
        },
      ],
      services: [
        {
          name: "OrderModule",
          layer: "backend_module",
          handledEndpoints: ["/api/v1/orders"],
          dependencies: [],
        },
      ],
    };

    (service as any).generateResponse = async () => JSON.stringify(mockPag);

    const lfMarkdown = await service.generateLogicFlows("# MDD OrderService");
    assert.match(lfMarkdown, /# Flujos Lógicos y Secuencias de Negocio — OrderService/);
    assert.match(lfMarkdown, /sequenceDiagram/);
    assert.match(lfMarkdown, /Client->>Controller: POST \/api\/v1\/orders/);
    assert.match(lfMarkdown, /Note over Controller: Validar JWT Guard \(BUYER\)/);
  });

  it("generateInfra genera topología Mermaid y docker-compose.yml determinista", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    const mockPag: ProjectArchitectureGraph = {
      version: "1.0.0",
      projectName: "OrderService",
      stack: {
        runtime: "Node.js 20",
        backendFramework: "NestJS",
        frontendFramework: "React",
        database: "PostgreSQL",
        orm: "Prisma",
        cache: "Redis",
      },
      entities: [],
      endpoints: [],
      services: [],
    };

    (service as any).generateResponse = async () => JSON.stringify(mockPag);

    const infraMarkdown = await service.generateInfra("# MDD OrderService");
    assert.match(infraMarkdown, /# Especificación de Infraestructura y Despliegue — OrderService/);
    assert.match(infraMarkdown, /graph TD/);
    assert.match(infraMarkdown, /```yaml/);
    assert.match(infraMarkdown, /image: postgres:16-alpine/);
    assert.match(infraMarkdown, /POSTGRES_DB: app_database/);
    assert.match(infraMarkdown, /`DATABASE_URL`/);
  });

  it("ejecuta Self-Healing Semántico guiado por el Compiler si el PAG inicial tiene errores", async () => {
    const service = new AiService(dummyFactory, dummyTechDocs, null);
    let callCount = 0;

    // Primer PAG con error: path no empieza con '/' y targetEntity inexistente
    const brokenPag: ProjectArchitectureGraph = {
      version: "1.0.0",
      projectName: "SelfHealingSystem",
      stack: {
        runtime: "Node.js 20",
        backendFramework: "NestJS",
        frontendFramework: "React",
        database: "PostgreSQL",
        orm: "Prisma",
      },
      entities: [],
      endpoints: [
        {
          path: "api/v1/items", // Invalido: falta '/'
          method: "GET",
          targetEntity: "Item", // Invalido: no existe en entities
          authRequired: true,
          rolesAllowed: [],
          errorCodes: [400],
        },
      ],
      services: [],
    };

    // Segundo PAG reparado
    const repairedPag: ProjectArchitectureGraph = {
      ...brokenPag,
      entities: [
        {
          name: "Item",
          fields: [{ name: "id", type: "String", required: true }],
          constraints: [],
          indexes: [],
        },
      ],
      endpoints: [
        {
          ...brokenPag.endpoints[0],
          path: "/api/v1/items",
        },
      ],
    };

    (service as any).generateResponse = async () => {
      callCount++;
      return callCount === 1 ? JSON.stringify(brokenPag) : JSON.stringify(repairedPag);
    };

    const result = await service.generateProjectArchitectureGraph("# MDD content");
    assert.equal(callCount, 2, "Debe haber llamado al LLM exactamente 2 veces (1 inicial + 1 reparación)");
    assert.equal(result.endpoints[0].path, "/api/v1/items");
    assert.equal(result.entities[0].name, "Item");
  });
});

