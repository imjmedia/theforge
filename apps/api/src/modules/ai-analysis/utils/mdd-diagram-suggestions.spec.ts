import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  injectMddDiagrams,
  regenerateErDiagramFromSql,
  sqlToErDiagramContent,
  suggestMddDiagrams,
  wrapErDiagramAsMermaidFence,
} from "./mdd-diagram-suggestions.js";

const sampleSql = `CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL
);
CREATE TABLE tenant_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL
);`;

describe("sqlToErDiagramContent", () => {
  it("genera erDiagram válido desde REFERENCES", () => {
    const out = sqlToErDiagramContent(sampleSql);
    assert.ok(out);
    assert.match(out!, /^erDiagram/);
    assert.doesNotMatch(out!, /uuid default/i);
    assert.match(out!, /tenants \|\|--o\{ tenant_users/);
    assert.match(out!, /: "tenant"/);
  });

  it("no emite PK FK cuando la columna es PK y FK", () => {
    const sql = `CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id)
);`;
    const out = sqlToErDiagramContent(sql);
    assert.ok(out);
    assert.doesNotMatch(out!, /\bPK\s+FK\b/i);
    assert.match(out!, /uuid id PK/);
  });
});

describe("wrapErDiagramAsMermaidFence", () => {
  it("no duplica encabezado erDiagram", () => {
    const inner = sqlToErDiagramContent(sampleSql)!;
    const fence = wrapErDiagramAsMermaidFence(inner);
    assert.match(fence, /^```mermaid\nerDiagram/);
    assert.doesNotMatch(fence, /erDiagram\s*\nerDiagram/);
  });
});

describe("injectMddDiagrams — reemplaza erDiagram del LLM", () => {
  it("pisa diagrama roto del LLM con uno derivado del SQL", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
${sampleSql}
\`\`\`

### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  tenants {
    uuid id PK
    uuid default FK
    string name FK
  }
  tenant_users ||--o{ campaigns : "name"
\`\`\`

## 4. Contratos de API`;

    const suggestions = suggestMddDiagrams(draft);
    const out = injectMddDiagrams(draft, suggestions);
    assert.doesNotMatch(out, /uuid default/i);
    assert.match(out, /tenants \|\|--o\{ tenant_users/);
    assert.doesNotMatch(out, /campaigns : "name"/);
  });
});

describe("regenerateErDiagramFromSql", () => {
  it("inserta diagrama cuando falta", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
${sampleSql}
\`\`\`

## 4. Contratos de API`;
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.match(out!, /```mermaid[\s\S]*erDiagram[\s\S]*```/);
  });
});

/** MDD con §3 partida en 3.1 (SQL) y 3.2 (diagrama ER) antes de §4. */
const SPLIT_DRAFT = `# MDD de prueba

## 1. Contexto y alcance

Plataforma de facturación multi-tenant para despachos con proyectos, usuarios y facturas emitidas.

## 2. Arquitectura y Stack

Backend NestJS con módulos por dominio, frontend React 18 y PostgreSQL 16 como base principal.

## 3. Modelo de datos

## 3.1 Esquema SQL

\`\`\`sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id)
);
\`\`\`

## 3.2 Diagrama ER

\`\`\`mermaid
erDiagram
  tenants ||--o{ projects : has
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/tenants | Listar tenants |
| GET | /api/v1/projects | Listar proyectos |

### GET /api/v1/tenants

Devuelve los tenants del usuario autenticado con paginación y filtros por nombre.

## 5. Lógica y Edge Cases

Sin casos especiales.

## 6. Seguridad

JWT con rotación de refresh tokens.

## 7. Infraestructura

Docker Compose en un único host.
`;

describe("§3 con subsecciones N.M (no cortar en ## 3.2)", () => {
  it("suggestMddDiagrams, regenerateErDiagramFromSql e injectMddDiagrams ven ambas tablas y conservan §4", () => {
    const suggestions = suggestMddDiagrams(SPLIT_DRAFT);
    const er = suggestions.find((x) => x.type === "erDiagram");
    assert.ok(er);
    assert.match(er!.mermaidBlock, /tenants/);
    assert.match(er!.mermaidBlock, /projects/);

    const regenerated = regenerateErDiagramFromSql(SPLIT_DRAFT);
    assert.ok(regenerated);
    assert.match(regenerated!, /## 3\.2 Diagrama ER/);
    assert.match(regenerated!, /erDiagram[\s\S]*tenants[\s\S]*projects[\s\S]*```/);
    assert.ok(regenerated!.indexOf("## 4. Contratos de API") > regenerated!.indexOf("## 3.2 Diagrama ER"));

    const injected = injectMddDiagrams(SPLIT_DRAFT, suggestions);
    assert.match(injected, /## 4\. Contratos de API/);
    assert.match(injected, /### GET \/api\/v1\/tenants/);
  });
});
