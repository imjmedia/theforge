import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countCostDrivers } from "./cost-drivers.js";

describe("countCostDrivers", () => {
  it("CL-09: PostgreSQL no cuenta como endpoint POST", () => {
    const md = `## 3. Modelo de datos
Usamos PostgreSQL 16 como motor principal.
\`\`\`sql
CREATE TABLE users (id uuid PRIMARY KEY);
\`\`\`
## 4. Contratos de API
Sin rutas aún.
`;
    const c = countCostDrivers(md);
    assert.equal(c.extraEndpointCount, 0);
    assert.equal(c.entityCount, 1);
  });

  it("CREATE TABLE cuenta entidades", () => {
    const md = `## 3. Modelo
\`\`\`sql
CREATE TABLE orders (id int);
CREATE TABLE IF NOT EXISTS \`items\` (id int);
\`\`\`
`;
    const c = countCostDrivers(md);
    assert.equal(c.entityCount, 2);
  });

  it("GET/POST fuera de §4 no cuentan como endpoints", () => {
    const md = `## 2. Contexto
POST /webhook externo no es contrato.
## 4. Contratos de API
- GET /api/v1/products
- POST /api/v1/cart
`;
    const c = countCostDrivers(md);
    assert.equal(c.extraEndpointCount, 2);
  });

  it("líneas con verbo HTTP fuera de §4 ignoradas", () => {
    const md = `## 2. Alcance
DELETE /legacy/hook en integración legacy.
## 3. Datos
CREATE TABLE foo (id int);
`;
    const c = countCostDrivers(md);
    assert.equal(c.extraEndpointCount, 0);
    assert.equal(c.entityCount, 1);
  });
});
