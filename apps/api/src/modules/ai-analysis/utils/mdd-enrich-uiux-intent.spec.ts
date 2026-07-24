import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichMddWithUiUxDesignIntent, reconcileUiUxDesignIntent } from "./mdd-enrich-uiux-intent.js";

const MDD_WITH_ENTITIES = `# Master Design Document

## 1. Contexto

Contexto mínimo.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE orders (id UUID PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE customers (id UUID PRIMARY KEY, email TEXT NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /orders |
`;

describe("enrichMddWithUiUxDesignIntent", () => {
  it("anexa ## UI/UX Design Intent cuando hay entidades en §3", async () => {
    const out = await enrichMddWithUiUxDesignIntent(MDD_WITH_ENTITIES);
    assert.match(out, /^## UI\/UX Design Intent/im);
    assert.match(out, /Personas y journeys/);
    assert.match(out, /Matriz pantalla/);
    assert.match(out, /pantallas\.md/);
    assert.doesNotMatch(out, /Entity Classification/);
    assert.doesNotMatch(out, /dataSource.*GET \/api\/v1\//);
    assert.doesNotMatch(out, /quota LLM/);
    assert.ok(out.includes("CREATE TABLE orders"), "no debe borrar §3 previa");
  });

  it("no duplica la sección si ya existe (formato completo)", async () => {
    const withIntent = `${MDD_WITH_ENTITIES.trim()}\n\n## UI/UX Design Intent\n\n### Personas y journeys\n\nPrevio.\n\n### Matriz pantalla→componente\n\n### Reglas de composición\n\n### Componentes transversales\n\n### Fuera de alcance UI v1\n\n`;
    const out = await enrichMddWithUiUxDesignIntent(withIntent);
    assert.equal(out, withIntent);
    assert.equal((out.match(/## UI\/UX Design Intent/g) ?? []).length, 1);
  });

  it("reemplaza sección legacy Entity Classification", async () => {
    const legacy = `${MDD_WITH_ENTITIES.trim()}\n\n## UI/UX Design Intent\n\n### Entity Classification\n\n| Entidad |\n`;
    const out = await enrichMddWithUiUxDesignIntent(legacy);
    assert.doesNotMatch(out, /Entity Classification/);
    assert.match(out, /Personas y journeys/);
  });

  it("devuelve el markdown sin cambios si falta §3", async () => {
    const sinModelo = `## 1. Contexto\n\nSolo texto.\n`;
    const out = await enrichMddWithUiUxDesignIntent(sinModelo);
    assert.equal(out, sinModelo);
  });

  it("devuelve vacío o entrada sin tocar cuando no hay contenido útil", async () => {
    assert.equal(await enrichMddWithUiUxDesignIntent(""), "");
    const soloEspacios = "   \n";
    assert.equal(await enrichMddWithUiUxDesignIntent(soloEspacios), soloEspacios);
  });

  it("no añade UI/UX cuando §1 declara MVP API+CLI sin panel web", async () => {
    const apiOnly = `${MDD_WITH_ENTITIES.replace(
      "## 1. Contexto\n\nContexto mínimo.",
      "## 1. Contexto\n\nMVP solo APIs REST y CLI; sin panel web.",
    )}`;
    const out = await enrichMddWithUiUxDesignIntent(apiOnly);
    assert.ok(!/##\s*UI\/UX\s+Design\s+Intent/i.test(out));
  });

  it("mapea endpoints GET reales de §4 y no inventa /api/v1/{entity}", async () => {
    const mdd = `# Master Design Document

## 1. Contexto

Contexto.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE pedidos (id UUID PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE clientes (id UUID PRIMARY KEY, email TEXT NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /api/v1/clientes |
| GET | /api/v1/pedidos |
`;
    const out = await enrichMddWithUiUxDesignIntent(mdd);
    assert.match(out, /pantallas\.md/);
    assert.ok(!out.includes("GET /api/v1/customers"));
    assert.ok(!out.includes("GET /api/v1/orders"));
  });

  it("marca (sin endpoint en §4) cuando no hay GET para la entidad", async () => {
    const mdd = `${MDD_WITH_ENTITIES.replace(
      "| GET | /orders |",
      "| POST | /orders |",
    )}`;
    const out = await enrichMddWithUiUxDesignIntent(mdd);
    assert.match(out, /Fuera de alcance UI v1/);
    assert.ok(!out.includes("GET /api/v1/customers"));
  });

  it("mapea GET /api/v1/eventos y GET /api/v1/pagos (lista, no solo detalle)", async () => {
    const mdd = `# Master Design Document

## 1. Contexto

Contexto.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE eventos (id UUID PRIMARY KEY, payload_json JSONB, procesado BOOLEAN);
CREATE TABLE pagos (id UUID PRIMARY KEY, monto NUMERIC, estado TEXT);
CREATE TABLE outbox (id UUID PRIMARY KEY);
CREATE TABLE sesiones (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /api/v1/eventos |
| GET | /api/v1/pagos |
| GET | /api/v1/pagos/:id |
| GET | /api/v1/metricas/noshow |
`;
    const out = await enrichMddWithUiUxDesignIntent(mdd);
    assert.match(out, /pantallas\.md/);
    assert.ok(!out.includes("#### outbox"));
    assert.ok(!out.includes("#### sesiones"));
  });

  it("bug4: elimina bloque embebido ### Design Intent roto y deja una sola sección canónica", async () => {
    const embeddedBroken = `${MDD_WITH_ENTITIES.trim()}

### Design Intent

> Directrices de alto nivel.

\`\`\`
**Usuario autenticado** accede al producto.
\`\`\`

### Personas y journeys

Rotas.

## UI/UX Design Intent

### Personas y journeys

Canónica.
`;
    const out = await reconcileUiUxDesignIntent(embeddedBroken);
    assert.equal((out.match(/## UI\/UX Design Intent/gi) ?? []).length, 1);
    assert.doesNotMatch(out, /\n### Design Intent\b/i);
    assert.doesNotMatch(out, /\bRotas\b/);
    assert.match(out, /### Personas y journeys/);
  });
});
