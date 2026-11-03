import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  injectErDiagramBlockIntoDraft,
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

  it("etiqueta por la raíz de la FK y no inventa etiquetas semánticas por nombre de tabla", () => {
    const sql = `CREATE TABLE users (
  id UUID PRIMARY KEY
);
CREATE TABLE roles (
  id UUID PRIMARY KEY,
  application_id UUID REFERENCES applications(id)
);
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id)
);
CREATE TABLE user_application_roles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  role_id UUID REFERENCES roles(id)
);
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  actor UUID REFERENCES users(id),
  target_id UUID
);`;
    const out = sqlToErDiagramContent(sql);
    assert.ok(out);
    assert.match(out!, /users \|\|--o\{ sessions : "user"/);
    assert.match(out!, /applications \|\|--o\{ roles : "application"/);
    assert.match(out!, /roles \|\|--o\{ user_application_roles : "role"/);
    // FK sin sufijo _id: fallback por tabla padre, nunca una etiqueta inventada.
    assert.match(out!, /users \|\|--o\{ audit_log : "references users"/);
    assert.doesNotMatch(out!, /: "(has|defines|assigned|includes)"/);
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

/** MDD con otros diagramas en §3 además (o en lugar) del erDiagram. */
const FLOWCHART_FENCE = `\`\`\`mermaid
flowchart LR
  A[Cliente] --> B[API]
  B --> C[(Base de datos)]
\`\`\``;

const OLD_ER_FENCE = `\`\`\`mermaid
erDiagram
  tenants {
    uuid id PK
  }
\`\`\``;

function draftWithSection3(section3Diagrams: string): string {
  return `# MDD de prueba

## 1. Contexto y alcance

Plataforma de facturación multi-tenant para despachos con proyectos, usuarios y facturas emitidas.

## 2. Arquitectura y Stack

Backend NestJS con módulos por dominio, frontend React 18 y PostgreSQL 16 como base principal.

## 3. Modelo de Datos

\`\`\`sql
${sampleSql}
\`\`\`

${section3Diagrams}

## 4. Contratos de API

Listado de endpoints REST con autenticación JWT y paginación por cursor en todos los listados.
`;
}

function countFences(doc: string, re: RegExp): number {
  return (doc.match(re) ?? []).length;
}

describe("replaceErDiagramBlock localiza el ER (vía regenerateErDiagramFromSql / injectErDiagramBlockIntoDraft)", () => {
  it("(a) flowchart antes del ER: conserva el flowchart byte a byte y actualiza solo el ER", () => {
    const draft = draftWithSection3(`${FLOWCHART_FENCE}\n\n${OLD_ER_FENCE}`);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.ok(out!.includes(FLOWCHART_FENCE), "el flowchart debe quedar intacto");
    assert.equal(countFences(out!, /^```mermaid$/gm), 2, "un flowchart y un ER, sin duplicados");
    assert.equal(countFences(out!, /^erDiagram$/gm), 1);
    assert.match(out!, /tenants \|\|--o\{ tenant_users/);
    assert.doesNotMatch(out!, /uuid id PK\n  \}\n```\n\n## 4/);
    assert.ok(out!.indexOf(FLOWCHART_FENCE) < out!.indexOf("erDiagram"), "el orden se conserva");
    assert.ok(out!.includes("## 4. Contratos de API"));
  });

  it("(a2) mismo caso por injectErDiagramBlockIntoDraft (rama del nodo injector)", () => {
    const draft = draftWithSection3(`${FLOWCHART_FENCE}\n\n${OLD_ER_FENCE}`);
    const block = wrapErDiagramAsMermaidFence(sqlToErDiagramContent(sampleSql)!);
    const out = injectErDiagramBlockIntoDraft(draft, block);
    assert.ok(out.includes(FLOWCHART_FENCE));
    assert.equal(countFences(out, /^erDiagram$/gm), 1);
    assert.equal(countFences(out, /^```mermaid$/gm), 2);
    assert.ok(out.includes(block));
  });

  it("(a3) ER con comentario %% y front-matter antes de erDiagram sigue siendo el ER", () => {
    const er = `\`\`\`mermaid\n---\ntitle: Modelo\n---\n%% comentario\nerDiagram\n  x {\n    int id PK\n  }\n\`\`\``;
    const draft = draftWithSection3(`${FLOWCHART_FENCE}\n\n${er}`);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.ok(out!.includes(FLOWCHART_FENCE));
    assert.doesNotMatch(out!, /title: Modelo/);
    assert.equal(countFences(out!, /^erDiagram$/gm), 1);
  });

  it("(a4) con varios ER reemplaza solo el primero", () => {
    const secondEr = `\`\`\`mermaid\nerDiagram\n  otra {\n    int id PK\n  }\n\`\`\``;
    const draft = draftWithSection3(`${OLD_ER_FENCE}\n\n${FLOWCHART_FENCE}\n\n${secondEr}`);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.ok(out!.includes(FLOWCHART_FENCE));
    assert.ok(out!.includes(secondEr), "el segundo ER no se toca");
    assert.match(out!, /tenants \|\|--o\{ tenant_users/);
  });

  it("(a5) la palabra erDiagram en un flowchart no lo convierte en ER", () => {
    const flow = `\`\`\`mermaid\nflowchart LR\n  A[erDiagram] --> B\n\`\`\``;
    const draft = draftWithSection3(flow);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.ok(out!.includes(flow));
    assert.equal(countFences(out!, /^```mermaid$/gm), 2);
    assert.match(out!, /^erDiagram$/m);
  });

  it("(b) §3 sin ER pero con flowchart: inserta el ER y conserva el flowchart", () => {
    const draft = draftWithSection3(FLOWCHART_FENCE);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.ok(out!.includes(FLOWCHART_FENCE));
    assert.equal(countFences(out!, /^```mermaid$/gm), 2);
    assert.equal(countFences(out!, /^erDiagram$/gm), 1);
    assert.ok(out!.indexOf(FLOWCHART_FENCE) < out!.indexOf("erDiagram"));
    assert.ok(out!.indexOf("erDiagram") < out!.indexOf("## 4. Contratos de API"));

    const block = wrapErDiagramAsMermaidFence(sqlToErDiagramContent(sampleSql)!);
    const viaInject = injectErDiagramBlockIntoDraft(draft, block);
    assert.ok(viaInject.includes(FLOWCHART_FENCE));
    assert.equal(countFences(viaInject, /^erDiagram$/gm), 1);
  });

  it("(b2) injectMddDiagrams inserta el ER aunque §3 ya tenga un flowchart (y mencione erDiagram en prosa)", () => {
    const draft = draftWithSection3(`${FLOWCHART_FENCE}\n\nEl diagrama erDiagram se genera desde el SQL.`);
    const out = injectMddDiagrams(draft, suggestMddDiagrams(draft));
    assert.ok(out.includes(FLOWCHART_FENCE));
    assert.equal(countFences(out, /^erDiagram$/gm), 1);
  });

  it("(c) regresión: §3 con ER único se reemplaza como antes", () => {
    const draft = draftWithSection3(`### Diagrama entidad-relación\n\n${OLD_ER_FENCE}`);
    const out = regenerateErDiagramFromSql(draft);
    assert.ok(out);
    assert.equal(countFences(out!, /^```mermaid$/gm), 1);
    assert.equal(countFences(out!, /^erDiagram$/gm), 1);
    assert.match(out!, /tenants \|\|--o\{ tenant_users/);
    assert.ok(out!.includes("## 4. Contratos de API"));
    const injected = injectMddDiagrams(draft, suggestMddDiagrams(draft));
    assert.equal(countFences(injected, /^erDiagram$/gm), 1);
    assert.match(injected, /tenants \|\|--o\{ tenant_users/);
  });

  it("(d) idempotente: aplicar dos veces el mismo ER no cambia el resultado", () => {
    const draft = draftWithSection3(`${FLOWCHART_FENCE}\n\n${OLD_ER_FENCE}`);
    const block = wrapErDiagramAsMermaidFence(sqlToErDiagramContent(sampleSql)!);
    const once = injectErDiagramBlockIntoDraft(draft, block);
    const twice = injectErDiagramBlockIntoDraft(once, block);
    assert.equal(twice, once);

    const r1 = regenerateErDiagramFromSql(draft)!;
    const r2 = regenerateErDiagramFromSql(r1)!;
    assert.equal(r2, r1);

    const noEr = draftWithSection3(FLOWCHART_FENCE);
    const i1 = injectErDiagramBlockIntoDraft(noEr, block);
    assert.equal(injectErDiagramBlockIntoDraft(i1, block), i1);
  });
});
