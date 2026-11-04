import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "./project-architecture-graph.js";
import { exportPagToOpenApiSpec } from "./document-compiler.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "design-first/__fixtures__");

describe("exportPagToOpenApiSpec", () => {
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
      cache: "Redis 7",
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
            trackingCode: { type: "string" },
            status: { type: "string" },
          },
        },
        errorCodes: [401, 404],
        rolesAllowed: ["OPERATOR", "ADMIN"],
      },
    ],
    services: [
      {
        name: "ShipmentModule",
        layer: "backend_module",
        handledEndpoints: ["/api/v1/shipments", "/api/v1/shipments/{id}"],
        dependencies: [],
      },
    ],
  };

  it("NEW PAG sin fuentes coincide byte a byte con golden de regresión", () => {
    const goldenPath = join(fixtureDir, "new-sample.openapi.json");
    const golden = readFileSync(goldenPath, "utf8");
    const actual = `${JSON.stringify(exportPagToOpenApiSpec(samplePag), null, 2)}\n`;
    assert.equal(actual, golden);
  });

  it("PAG Design-First three-screens coincide con golden extendido", () => {
    const pag = JSON.parse(
      readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
    ) as ProjectArchitectureGraph;
    const golden = readFileSync(join(fixtureDir, "three-screens.openapi.json"), "utf8");
    const actual = `${JSON.stringify(exportPagToOpenApiSpec(pag), null, 2)}\n`;
    assert.equal(actual, golden);
  });
});
