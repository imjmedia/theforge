import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeAsciiDiagramLine,
  repairGluedSqlTokens,
  repairAsciiDiagramBlocks,
  repairMetadataCoverTable,
  repairOrphanSqlBlocks,
  repairOrphanContratosApiFences,
  repairOrphanFenceBeforeContractLabels,
  repairPastedMarkdown,
  repairJsonFenceIntegrity,
  repairTableBoundaries,
  repairTabSeparatedTables,
  repairUnclosedCodeFences,
  repairIndentedProseBlocks,
  repairMddInfraManifestJsonBlock,
  repairPromoteBareSectionHeadings,
} from "./repair-pasted-markdown.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("repairGluedSqlTokens", () => {
  it("separa tipos SQL pegados con guion bajo", () => {
    const raw = "nombre_VARCHAR(255) NOT NULL,\n  id UUID PRIMARY KEY DEFAULT_gen_random_uuid()";
    const out = repairGluedSqlTokens(raw);
    assert.match(out, /nombre VARCHAR/);
    assert.match(out, /DEFAULT gen_random_uuid\(\)/);
  });

  it("repara NOT_NULL_REFERENCES y ON_tabla", () => {
    const raw =
      "pais_id UUID NOT NULL_REFERENCES_paises(id);\nCREATE INDEX idx_medios_ciudad_ON_medios(ciudad_id);";
    const out = repairGluedSqlTokens(raw);
    assert.match(out, /NOT NULL REFERENCES/);
    assert.match(out, /ON medios\(/);
  });
});

describe("repairOrphanSqlBlocks", () => {
  it("envuelve CREATE TABLE suelto", () => {
    const raw = "Intro\n\nCREATE TABLE foo (\n  id UUID\n);\n\n## Fin";
    const out = repairOrphanSqlBlocks(raw);
    assert.match(out, /```sql\nCREATE TABLE foo/);
    assert.match(out, /```\n\n## Fin/);
  });
});

describe("repairMetadataCoverTable", () => {
  it("inserta encabezados Campo/Valor", () => {
    const raw = "# T\n| | |\n|---|---|\n| **X** | Y |\n";
    const out = repairMetadataCoverTable(raw);
    assert.match(out, /\| Campo \| Valor \|/);
  });
});

describe("repairTabSeparatedTables", () => {
  it("convierte filas con tab a tabla GFM", () => {
    const raw = "Riesgo\tMitigación\nDesincronización\tWebhook diario";
    const out = repairTabSeparatedTables(raw);
    assert.match(out, /^\| Riesgo \| Mitigación \|/m);
    assert.match(out, /\| --- \|/);
  });
});

describe("repairUnclosedCodeFences", () => {
  it("cierra bloque abierto antes de un heading", () => {
    const raw = "```sql\nCREATE TABLE foo (\n  id UUID\n);\n\n## Siguiente sección";
    const out = repairUnclosedCodeFences(raw);
    assert.match(out, /```\n## Siguiente sección/);
  });

  it("does not treat mermaid close ``` as a new empty fence before ```sql", () => {
    const raw = `\`\`\`mermaid
erDiagram
  tenants ||--o{ authorized_users : has
\`\`\`

\`\`\`sql
CREATE TABLE authorized_users ( id UUID PRIMARY KEY );
\`\`\`
`;
    const out = repairUnclosedCodeFences(raw);
    assert.match(out, /```mermaid[\s\S]*```\s*\n+\s*```sql[\s\S]*CREATE TABLE authorized_users/);
    const mermaidBody = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.doesNotMatch(mermaidBody, /CREATE TABLE/);
  });
});

describe("repairTableBoundaries (tablas espejo)", () => {
  it("separa headings de tablas en fixture OBP", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "repair-mirror-tables.fixture.txt"), "utf8");
    const out = repairTableBoundaries(raw);
    assert.match(out, /#### Para OBP4MO[^\n]+\n\n\| Tabla espejo/);
    assert.match(out, /\| `paises`[^\n]+\n\n#### Para OBP/);
  });

  it("formatDocumentMarkdown mantiene tablas espejo y estrategia separadas", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "repair-mirror-tables.fixture.txt"), "utf8");
    const out = formatDocumentMarkdown(raw);
    assert.match(out, /^\| Sistema \|/m);
    assert.match(out, /^\| Tabla espejo \|/m);
    assert.match(out, /\| `paises`[^\n]+\n\n#### Para OBP/);
  });
});

describe("repairPastedMarkdown SQL OBP", () => {
  it("abre segundo bloque sql tras heading Esquema SQL OBP", () => {
    const raw =
      "```sql\nCREATE TABLE paises (id UUID);\n```\n### Esquema SQL para tablas espejo (OBP)\n\n-- Tabla espejo\nCREATE TABLE ubicaciones_obp (id UUID);\n";
    const out = repairPastedMarkdown(raw);
    assert.match(out, /### Esquema SQL[^\n]+\n\n```sql\n-- Tabla espejo/);
    assert.match(out, /CREATE TABLE ubicaciones_obp[\s\S]*```\s*$/);
  });
});

describe("repairAsciiDiagramBlocks", () => {
  it("detects pipe-heavy architecture lines", () => {
    assert.equal(looksLikeAsciiDiagramLine("| | |"), true);
    assert.equal(looksLikeAsciiDiagramLine("▼ ▼"), true);
    assert.equal(looksLikeAsciiDiagramLine("┌─────────────────┐"), true);
    assert.equal(looksLikeAsciiDiagramLine("| PostgreSQL 16 | Redis 7 | S3 / |"), false);
  });

  it("wraps consecutive ascii lines in a single text fence", () => {
    const raw = `### 2.1 Visión general

┌─────────────────────────────┐
│ CLIENTE (PWA / Navegador)   │
└─────────────────────────────┘
            │
            ▼
┌─────────────────────────────┐
│ API GATEWAY (Nginx)         │
└─────────────────────────────┘

### 2.2 Detalle`;
    const out = repairAsciiDiagramBlocks(raw);
    const fences = out.match(/```text/g) ?? [];
    assert.equal(fences.length, 1);
    assert.match(out, /CLIENTE \(PWA \/ Navegador\)/);
    assert.match(out, /API GATEWAY/);
    assert.match(out, /### 2\.2 Detalle/);
  });

  it("does not wrap CREATE TABLE lines as ```text``` after fragmented SQL repair (Copiloto Doris)", () => {
    const raw = `### Esquema relacional

\`\`\`sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY
);
\`\`\`

CREATE TABLE authorized_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE TABLE channels (
  id UUID PRIMARY KEY
);
`;
    const out = repairPastedMarkdown(raw);
    assert.doesNotMatch(out, /```text[\s\S]*CREATE TABLE/);
    assert.match(out, /CREATE TABLE authorized_users/);
    assert.match(out, /CREATE TABLE channels/);
  });

  it("keeps CREATE TABLE in ```sql``` after erDiagram when LLM used ```text``` (Entidades de BD)", () => {
    const sql = `CREATE TABLE authorized_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL
);`;
    const raw = `### Entidades de base de datos

\`\`\`mermaid
erDiagram
  tenants ||--o{ authorized_users : has
\`\`\`

\`\`\`text
${sql}
\`\`\`
`;
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /```text[\s\S]*CREATE TABLE/);
    const mermaidBody = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.doesNotMatch(mermaidBody, /CREATE TABLE authorized_users/);
    assert.match(out, /```sql[\s\S]*CREATE TABLE authorized_users/);
  });
});

describe("repairOrphanContratosApiFences", () => {
  it("removes orphan fence between --- and next endpoint (Copiloto Doris §4)", () => {
    const raw = `**Response 200:**

\`\`\`json
{ "ok": true }
\`\`\`

---
\`\`\`

### POST /api/v1/auth/sso/login
`;
    const out = repairOrphanContratosApiFences(raw);
    assert.match(out, /---\n\n### POST \/api\/v1\/auth\/sso\/login/);
    assert.doesNotMatch(out, /---\n```\n\n### POST/);
  });
});

describe("repairMddInfraManifestJsonBlock", () => {
  it("envuelve JSON suelto tras ### Manifest de Infraestructura", () => {
    const raw = `## 7. Infraestructura

### Manifest de Infraestructura

{ "project_id": "copiloto", "stack": { "backend": "NestJS" }, "integration_metadata": { "api_prefix": "/api/v1" } }

## UI/UX Design Intent

### Personas y journeys
`;
    const out = repairMddInfraManifestJsonBlock(raw);
    assert.match(out, /### Manifest de Infraestructura\n\n```json\n[\s\S]*"project_id"/);
    assert.match(out, /```\n+## UI\/UX Design Intent/);
  });
});

describe("repairIndentedProseBlocks", () => {
  it("desindenta headings y tablas UI/UX en lugar de convertirlos a bullets", () => {
    const raw = `    ### Personas y journeys
    | Ruta | Componentes |
    |------|---------------|
    | /login | LoginForm |`;
    const out = repairIndentedProseBlocks(raw);
    assert.match(out, /^### Personas y journeys/m);
    assert.match(out, /^\| Ruta \| Componentes \|/m);
    assert.doesNotMatch(out, /^- ### Personas/m);
  });
});

describe("MDD §4 API contract format repairs (patrones genéricos)", () => {
  it("quita --- pegado al final de prosa en riesgos §1", () => {
    const raw =
      "- **Bucle Infinito de Agentes:** Riesgo de ciclos. **Mitigación:** límite de iteraciones en el agente. ---\n\n---\n\n## 2. Arquitectura";
    const out = repairPastedMarkdown(raw);
    assert.match(out, /agente\.\n[\s\S]*---[\s\S]*## 2\. Arquitectura/);
    assert.doesNotMatch(out, /agente\. ---/);
  });

  it("elimina línea basura # ``` tras erDiagram §3", () => {
    const raw = "```mermaid\nerDiagram\n  tenants ||--o{ companies : tenant\n```\n# ```\n\n---\n\n## 4.";
    const out = repairPastedMarkdown(raw);
    assert.doesNotMatch(out, /^#\s*```/m);
    assert.match(out, /```[\s\S]*## 4\./);
  });

  it("repara JSON §4 sin cierre antes del siguiente endpoint", () => {
    const raw = `### POST /api/v1/auth/m2m/token
Intercambia credenciales.
**Response 200:**
\`\`\`json
{
  "access_token": "jwt_string",
  "expires_in": 3600,
  "token_type": "Bearer"

### POST /api/v1/chat/message
Recibe el mensaje.
**Request body:**
\`\`\`json
{ "device_token": "string" }
\`\`\`
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /"token_type": "Bearer"\n}\n```\n\n### POST \/api\/v1\/chat\/message/);
    assert.doesNotMatch(out, /\n}\n```\n\n\*\*Request body:\*\*/);
  });

  it("elimina } y fence huérfanos entre descripción y Request body", () => {
    const raw = `### POST /api/v1/chat/message
Recibe el mensaje del webhook.
}
\`\`\`

**Request body:**
\`\`\`json
{ "ok": true }
\`\`\`
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /webhook\.\n+\*\*Request body:\*\*/);
    assert.doesNotMatch(out, /webhook\.\n}\n```/);
  });

  it("elimina fence huérfano antes de Request body (§4)", () => {
    const raw = `### POST /api/v1/chat/message
Recibe el mensaje del webhook de WhatsApp y orquesta la respuesta.
\`\`\`

**Request body:**
\`\`\`json
{ "device_token": "string" }
\`\`\`
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /respuesta\.\n+\*\*Request body:\*\*/);
    assert.doesNotMatch(out, /respuesta\.\n```\n\n\*\*Request body/);
  });

  it("conserva cierre ```json antes de **Response 200:** (no confundir con huérfano)", () => {
    const raw = `**Request body:**
\`\`\`json
{
  "client_id": "string",
  "client_secret": "string"
}
\`\`\`

**Response 200:**
\`\`\`json
{ "access_token": "jwt" }
\`\`\`
`;
    const out = repairOrphanFenceBeforeContractLabels(raw);
    assert.match(out, /"client_secret": "string"\n}\n```\n\n\*\*Response 200:/);
  });

  it("normaliza Response 204 sin # No Content", () => {
    const raw = `**Response 204:**
# \`No Content\`
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /\*\*Response 204:\*\*\n\n_No Content_/);
    assert.doesNotMatch(out, /# `No Content`/);
  });

  it("normaliza Response 204 con # _No Content_", () => {
    const raw = `**Response 204:**
# _No Content_
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /\*\*Response 204:\*\*\n\n_No Content_/);
    assert.doesNotMatch(out, /# _No Content_/);
  });

  it("fusiona Matriz UI/UX partida por heading erróneo", () => {
    const raw = `### Matriz pantalla→componente

### Detalle ejecutable en

**\`pantallas.md\`** (spec-kit). Resumen:`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /### Matriz pantalla→componente\n\nDetalle ejecutable en \*\*`pantallas\.md`\*\*/);
    assert.doesNotMatch(out, /### Detalle ejecutable en/);
  });

  it("formatDocumentMarkdown repara §4 tras repairMarkdownFences sin perder cierres json", () => {
    const raw = `## 1. Contexto

- **Riesgo:** bucle. **Mitigación:** timeout. ---

---

## 4. Contratos de API

### POST /api/v1/auth/m2m/token
**Response 200:**
\`\`\`json
{ "access_token": "x", "token_type": "Bearer"

### POST /api/v1/chat/message
}
\`\`\`

**Request body:**
\`\`\`json
{ "msg": "hi" }
\`\`\`

## UI/UX Design Intent

### Matriz pantalla→componente

### Detalle ejecutable en

**\`pantallas.md\`**
`;
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /timeout\. ---/);
    assert.match(out, /"token_type": "Bearer"\n}\n```/);
    assert.match(out, /Detalle ejecutable en \*\*`pantallas\.md`\*\*/);
    assert.doesNotMatch(out, /### Detalle ejecutable en/);
  });

  it("repairJsonFenceIntegrity no elimina cierre válido antes de **Response N:**", () => {
    const raw = `**Request body:**
\`\`\`json
{ "a": 1 }
\`\`\`

**Response 200:**
\`\`\`json
{ "b": 2 }
\`\`\`

### POST /api/v1/next
`;
    const out = repairJsonFenceIntegrity(raw);
    assert.match(out, /\{ "a": 1 \}\n```\n+\*\*Response 200:/);
    assert.match(out, /\{ "b": 2 \}\n```\n+### POST/);
  });

  it("cadena de endpoints: json sin cierre antes de **Response** y ### DELETE", () => {
    const raw = `### POST /api/v1/a
**Request body:**
\`\`\`json
{ "id": "1" }

**Response 200:**
\`\`\`json
{ "ok": true }

### DELETE /api/v1/a/:id
**Response 204:**
# _No Content_
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /\{ "id": "1" \}\n```[\s\S]*?\*\*Response 200:/);
    assert.match(out, /\{ "ok": true \}\n```[\s\S]*?### DELETE/);
    assert.match(out, /\*\*Response 204:\*\*\n+_No Content_/);
  });
});

describe("repairPromoteBareSectionHeadings respeta fences", () => {
  it("no promueve a ### una línea dentro de ```mermaid sankey-beta (caso hw-sankey)", () => {
    const doc = "```mermaid\nsankey-beta\n\nIngresos,Gastos,50\nIngresos,Ahorro,20\n```";
    assert.equal(repairPromoteBareSectionHeadings(doc), doc);
    assert.equal(formatDocumentMarkdown(doc), doc);
  });

  it("sigue promoviendo un título suelto fuera del fence", () => {
    const out = repairPromoteBareSectionHeadings("Texto\n\nResumen ejecutivo\n\n- punto");
    assert.match(out, /^### Resumen ejecutivo$/m);
  });
});
