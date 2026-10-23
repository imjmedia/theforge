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
  });
});
