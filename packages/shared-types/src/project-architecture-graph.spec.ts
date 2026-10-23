import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectArchitectureGraphSchema,
  validateProjectArchitectureGraph,
  type ProjectArchitectureGraph,
} from "./project-architecture-graph.js";
import {
  compilePagToApiContractsMarkdown,
  compilePagToPersistenceMarkdown,
  compilePagToBlueprintModulesMarkdown,
} from "./document-compiler.js";

describe("ProjectArchitectureGraph (PAG)", () => {
  const samplePag: ProjectArchitectureGraph = {
    version: "1.0.0",
    projectName: "Enterprise Logistics",
    description: "Sistema de gestión logística y despachos",
    stack: {
      runtime: "Node.js 20",
      backendFramework: "NestJS",
      frontendFramework: "React 18 + Vite",
      database: "PostgreSQL 16",
      orm: "Prisma",
    },
    entities: [
      {
        name: "User",
        tableName: "users",
        description: "Operador o cliente del sistema",
        primaryKey: "id",
        fields: [
          { name: "id", type: "UUID", required: true, constraints: [{ type: "unique" }] },
          { name: "email", type: "String", required: true, constraints: [{ type: "unique" }] },
          { name: "role", type: "String", required: true, constraints: [] },
        ],
        indexes: ["email"],
      },
      {
        name: "Shipment",
        tableName: "shipments",
        description: "Envío o paquete en tránsito",
        primaryKey: "id",
        fields: [
          { name: "id", type: "UUID", required: true, constraints: [{ type: "unique" }] },
          {
            name: "userId",
            type: "UUID",
            required: true,
            constraints: [
              {
                type: "foreign_key",
                reference: { entity: "User", field: "id", onDelete: "RESTRICT" },
              },
            ],
          },
          { name: "trackingCode", type: "String", required: true, constraints: [{ type: "unique" }] },
          { name: "status", type: "String", required: true, constraints: [] },
        ],
        indexes: ["trackingCode", "userId"],
      },
    ],
    endpoints: [
      {
        path: "/api/v1/shipments",
        method: "POST",
        description: "Crea un nuevo despacho logístico",
        authRequired: true,
        targetEntity: "Shipment",
        requestSchema: {
          type: "object",
          properties: {
            userId: { type: "string", format: "uuid" },
            destination: { type: "string" },
          },
          required: ["userId", "destination"],
        },
        responseSchema: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            trackingCode: { type: "string" },
          },
        },
        errorCodes: [400, 401, 403, 422],
        rolesAllowed: ["OPERATOR", "ADMIN"],
      },
      {
        path: "/api/v1/shipments/{id}",
        method: "GET",
        description: "Consulta estado de un despacho",
        authRequired: true,
        targetEntity: "Shipment",
        responseSchema: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            status: { type: "string" },
          },
        },
        errorCodes: [401, 404],
        rolesAllowed: ["OPERATOR", "CLIENT"],
      },
    ],
    services: [
      {
        name: "ShipmentModule",
        layer: "backend_module",
        handledEndpoints: ["/api/v1/shipments", "/api/v1/shipments/{id}"],
        dependencies: ["UserModule"],
      },
    ],
  };

  it("valida un PAG consistente sin errores", () => {
    const parsed = projectArchitectureGraphSchema.parse(samplePag);
    assert.equal(parsed.projectName, "Enterprise Logistics");
    const check = validateProjectArchitectureGraph(parsed);
    assert.equal(check.ok, true);
    assert.equal(check.errors.length, 0);
  });

  it("detecta inconsistencias referenciales (FK huérfana)", () => {
    const brokenPag: ProjectArchitectureGraph = {
      ...samplePag,
      entities: [
        {
          name: "Shipment",
          fields: [
            {
              name: "userId",
              type: "UUID",
              required: true,
              constraints: [
                {
                  type: "foreign_key",
                  reference: { entity: "NonExistentUser", field: "id" },
                },
              ],
            },
          ],
          primaryKey: "id",
          indexes: [],
        },
      ],
    };
    const check = validateProjectArchitectureGraph(brokenPag);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("NonExistentUser")));
  });

  it("compila contratos API deterministas a Markdown sin LLM", () => {
    const md = compilePagToApiContractsMarkdown(samplePag);
    assert.ok(md.includes("# Contratos de API — Enterprise Logistics"));
    assert.ok(md.includes("| **POST** | `/api/v1/shipments` |"));
    assert.ok(md.includes("JSON Schema"));
    assert.ok(md.includes("`422`"));
  });


  it("compila persistencia y módulos deterministas a Markdown", () => {
    const persistenceMd = compilePagToPersistenceMarkdown(samplePag);
    assert.ok(persistenceMd.includes("### User"));
    assert.ok(persistenceMd.includes("### Shipment"));
    assert.ok(persistenceMd.includes("FK → `User.id`"));

    const blueprintMd = compilePagToBlueprintModulesMarkdown(samplePag);
    assert.ok(blueprintMd.includes("`ShipmentModule`"));
    assert.ok(blueprintMd.includes("`ShipmentController`"));
  });
});
