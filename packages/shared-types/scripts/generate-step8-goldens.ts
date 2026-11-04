import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportPagToOpenApiSpec } from "../src/document-compiler.js";
import type { ProjectArchitectureGraph } from "../src/project-architecture-graph.js";
import { buildPagFixtures } from "../src/design-first/build-pag-fixtures.js";
import { exportPagToMswHandlers } from "../src/design-first/export-pag-to-msw.js";
import { parseDesignSpec } from "../src/design-first/design-spec.js";
import { renderDesignMarkdown } from "../src/design-first/render-design-markdown.js";

const fixtureDir = join(import.meta.dirname, "../src/design-first/__fixtures__");

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
            { type: "foreign_key", reference: { entity: "User", field: "id", onDelete: "RESTRICT" } },
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
        properties: { userId: { type: "string", format: "uuid" }, destination: { type: "string" } },
        required: ["userId", "destination"],
      },
      responseSchema: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" }, trackingCode: { type: "string" } },
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

const pag = JSON.parse(
  readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
) as ProjectArchitectureGraph;
const spec = parseDesignSpec(JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")));

writeFileSync(
  join(fixtureDir, "new-sample.openapi.json"),
  `${JSON.stringify(exportPagToOpenApiSpec(samplePag), null, 2)}\n`,
);
writeFileSync(
  join(fixtureDir, "three-screens.openapi.json"),
  `${JSON.stringify(exportPagToOpenApiSpec(pag), null, 2)}\n`,
);

const msw = exportPagToMswHandlers(pag);
writeFileSync(join(fixtureDir, "three-screens.handlers.txt"), msw.handlersTs);
writeFileSync(join(fixtureDir, "three-screens.browser.txt"), msw.browserTs);

writeFileSync(
  join(fixtureDir, "three-screens.fixtures.json"),
  `${JSON.stringify(buildPagFixtures(pag), null, 2)}\n`,
);

const md = renderDesignMarkdown(spec);
writeFileSync(join(fixtureDir, "three-screens.pantallas.md"), md.pantallasMd);
writeFileSync(join(fixtureDir, "three-screens.datos.md"), md.datosMd);

console.log("goldens ok");
