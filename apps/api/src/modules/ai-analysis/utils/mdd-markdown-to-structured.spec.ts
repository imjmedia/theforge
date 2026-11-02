import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToMddStructured } from "./mdd-markdown-to-structured.js";

/** MDD con §3 partida en 3.1 (SQL) y 3.2 (diagrama ER) antes de §4. */
const SPLIT_MDD = `# MDD de prueba

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

describe("markdownToMddStructured — §3 con subsecciones N.M", () => {
  it("hidrata modeloDatos con ambas tablas de 3.1, el ER de 3.2 y conserva §4", () => {
    const out = markdownToMddStructured(SPLIT_MDD);
    const sql = out.modeloDatos?.sql ?? "";
    assert.match(sql, /CREATE TABLE tenants/);
    assert.match(sql, /CREATE TABLE projects/);
    assert.match(out.modeloDatos?.diagramaEr ?? "", /erDiagram/);
    const endpoints = (out.contratosApi?.endpoints ?? []).map((e) => e.path);
    assert.ok(endpoints.includes("/api/v1/tenants"));
    assert.match(out.logicaEdgeCases ?? "", /Sin casos especiales/);
  });

  it("extrae SQL de fences postgresql/pgsql y sin tag que contengan CREATE TABLE", () => {
    const mdd = SPLIT_MDD
      .replace("```sql\n", "```postgresql\n")
      .replace("## 3.2 Diagrama ER", "```\nCREATE TABLE audit_log (id UUID PRIMARY KEY);\n```\n\n## 3.2 Diagrama ER");
    const sql = markdownToMddStructured(mdd).modeloDatos?.sql ?? "";
    assert.match(sql, /CREATE TABLE tenants/);
    assert.match(sql, /CREATE TABLE audit_log/);
  });
});
