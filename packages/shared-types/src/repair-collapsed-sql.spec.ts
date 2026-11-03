import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  expandCollapsedSqlText,
  extractCreateStatements,
  extractCreateIndexStatements,
  repairCollapsedSqlParagraphs,
  repairFragmentedSqlFences,
  splitEsquemaSqlHeadingFromPayload,
} from "./repair-collapsed-sql.js";
import { repairPastedMarkdown } from "./repair-pasted-markdown.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

const OBP_COLLAPSED = `-- Tabla espejo de ubicaciones (desde OBP — estructura plana) CREATE TABLE ubicaciones_obp ( id UUID PRIMARY KEY, nombre_VARCHAR(255) NOT NULL, siglas_VARCHAR(10), audiencia BIGINT, geolocalizacion JSONB, tipo_VARCHAR(50), -- 'PAIS', 'ESTADO', 'CIUDAD' (se infiere del contexto) pais_referencia_VARCHAR(255), -- campo libre mientras no se normalice estado_referencia_VARCHAR(255), created_at TIMESTAMPTZ DEFAULT_NOW(), updated_at TIMESTAMPTZ DEFAULT_NOW() );

-- Tabla espejo de formatos de medio (desde OBP) CREATE TABLE formatos_medio_obp ( id UUID PRIMARY KEY, nombre_VARCHAR(255) NOT NULL, siglas_VARCHAR(10), descripcion TEXT, ubicacion_id UUID REFERENCES_ubicaciones_obp(id), -- mientras no haya país explícito created_at TIMESTAMPTZ DEFAULT_NOW(), updated_at TIMESTAMPTZ DEFAULT_NOW() );

-- Tabla espejo de medios (desde OBP) CREATE TABLE medios_obp ( id UUID PRIMARY KEY, ubicacion_id UUID NOT NULL REFERENCES_ubicaciones_obp(id) ON DELETE CASCADE, formato_medio_id UUID REFERENCES_formatos_medio_obp(id), clave_VARCHAR(100) NOT NULL, nombre_VARCHAR(255) NOT NULL, audiencia BIGINT, geolocalizacion JSONB, flags JSONB, activo BOOLEAN DEFAULT TRUE, calificacion INTEGER CHECK (calificacion >= 1 AND calificacion <= 5), created_at TIMESTAMPTZ DEFAULT_NOW(), updated_at TIMESTAMPTZ DEFAULT_NOW() );`;

describe("extractCreateStatements", () => {
  it("extrae 3 tablas OBP colapsadas", () => {
    const stmts = extractCreateStatements(OBP_COLLAPSED);
    assert.equal(stmts.length, 3);
    assert.equal(stmts[0]!.name, "ubicaciones_obp");
    assert.equal(stmts[2]!.name, "medios_obp");
  });
});

describe("repairCollapsedSqlParagraphs", () => {
  it("envuelve Esquema SQL OBP en fence multilínea", () => {
    const raw = `Esquema SQL para tablas espejo (OBP — estructura desnormalizada)

${OBP_COLLAPSED}

### Flujo de sincronización`;
    const out = repairCollapsedSqlParagraphs(raw);
    assert.match(out, /### Esquema SQL/);
    assert.match(out, /```sql\n-- Tabla espejo de ubicaciones/);
    assert.match(out, /CREATE TABLE ubicaciones_obp/);
    assert.match(out, /CREATE TABLE formatos_medio_obp/);
    assert.match(out, /CREATE TABLE medios_obp/);
    assert.match(out, /CREATE TABLE ubicaciones_obp/);
    assert.match(out, /CREATE TABLE medios_obp/);
  });
});

describe("repairFragmentedSqlFences (Copiloto esquema relacional)", () => {
  const raw = `### Esquema Relacional

\`\`\`sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE authorized_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

\`\`\`text
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

### CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE
);

\`\`\`text
CREATE TABLE wasender_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

### CREATE INDEX idx_conversations_last_activity ON conversations(last_activity_at);
\`\`\`sql
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

\`\`\`
\`\`\`TechnicalMetadata
[high_security]
\`\`\``;

  it("une fences rotos y degrada ### CREATE TABLE/INDEX", () => {
    const out = repairFragmentedSqlFences(raw);
    assert.doesNotMatch(out, /### CREATE TABLE/);
    assert.doesNotMatch(out, /### CREATE INDEX/);
    assert.doesNotMatch(out, /```text[\s\S]*CREATE TABLE/);
    assert.match(out, /CREATE TABLE conversations/);
    assert.match(out, /CREATE INDEX idx_conversations_last_activity/);
  });

  it("converts ```text``` DDL to ```sql``` and preserves ```mermaid``` close before CREATE TABLE", () => {
    const raw = `\`\`\`mermaid
erDiagram
  tenants ||--o{ authorized_users : has
\`\`\`

\`\`\`text
CREATE TABLE authorized_users ( id UUID PRIMARY KEY );
\`\`\`
`;
    const out = repairFragmentedSqlFences(raw);
    assert.match(out, /```mermaid[\s\S]*```/);
    const mermaidBody = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.doesNotMatch(mermaidBody, /CREATE TABLE/);
    assert.match(out, /```sql[\s\S]*CREATE TABLE authorized_users/);
  });

  it("formatDocumentMarkdown deja un solo bloque sql coherente", () => {
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /### CREATE TABLE/);
    assert.match(out, /```sql[\s\S]*CREATE TABLE tenants[\s\S]*CREATE TABLE channels/);
    assert.match(out, /```TechnicalMetadata/);
  });
});

describe("repairPastedMarkdown OBP SQL", () => {
  it("formatea SQL colapsado del usuario", () => {
    const raw = `### Esquema SQL para tablas espejo (OBP — estructura desnormalizada)

${OBP_COLLAPSED}`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /```sql/);
    assert.match(out, /REFERENCES ubicaciones_obp/);
    assert.match(out, /DEFAULT NOW\(\)/);
    assert.doesNotMatch(out, /nombre_VARCHAR/);
    assert.doesNotMatch(out, /'CIUDAD' \(se infiere del contexto\) pais_referencia/);
  });
});

describe("OBP4MO tenant_id fixture", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "repair-collapsed-sql-user.fixture.txt"), "utf8");

  it("expand incluye CREATE INDEX", () => {
    const idxChunk =
      "-- Índices CREATE INDEX idx_medios_ciudad ON medios(ciudad_id); CREATE INDEX idx_paises_tenant ON paises(tenant_id);";
    const indexes = extractCreateIndexStatements(idxChunk);
    assert.equal(indexes.length, 2);
  });

  it("separa Esquema SQL pegado al SQL en la misma línea", () => {
    const glued = raw.split("\n")[0]! + " " + raw.split("\n")[2]!;
    const split = splitEsquemaSqlHeadingFromPayload(glued);
    assert.ok(split);
    assert.match(split!.heading, /OBP4MO/);
    assert.match(split!.rest, /CREATE TABLE paises/);
  });

  it("formatea fixture completo OBP4MO + OBP", () => {
    const out = formatDocumentMarkdown(raw);
    assert.equal((out.match(/CREATE TABLE/g) ?? []).length, 8);
    assert.ok((out.match(/CREATE INDEX/g) ?? []).length >= 10);
    assert.match(out, /```sql[\s\S]*CREATE TABLE paises/);
    assert.match(out, /CREATE TABLE ubicaciones_obp/);
    assert.doesNotMatch(out, /'CIUDAD' \(se infiere del contexto\) pais_referencia/);
  });

  it("formatea todo en una sola línea", () => {
    const oneLine = raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    const out = formatDocumentMarkdown(oneLine);
    assert.match(out, /```sql/);
    assert.match(out, /CREATE TABLE paises \(\n/);
    assert.equal((out.match(/CREATE TABLE/g) ?? []).length, 8);
  });
});

describe("SQL colapsado: corte genérico por comentario `--` y CREATE (sin literales de cliente)", () => {
  const GENERIC = `-- Pedidos del cliente CREATE TABLE pedidos ( id UUID PRIMARY KEY, total NUMERIC, -- en centavos creado_at TIMESTAMPTZ ); -- Líneas de pedido CREATE TABLE lineas ( id UUID PRIMARY KEY, pedido_id UUID REFERENCES pedidos(id) );`;

  it("extractCreateStatements conserva el comentario previo a cada CREATE, sea cual sea su texto", () => {
    const stmts = extractCreateStatements(GENERIC);
    assert.equal(stmts.length, 2);
    assert.equal(stmts[0]!.comment, "Pedidos del cliente");
    assert.equal(stmts[1]!.comment, "Líneas de pedido");
  });

  it("no toma un comentario de columna de la tabla anterior como comentario de la siguiente", () => {
    const stmts = extractCreateStatements(
      "CREATE TABLE a ( id UUID, -- nota interna x UUID ); CREATE TABLE b ( id UUID );",
    );
    assert.equal(stmts[1]!.comment, undefined);
  });

  it("splitEsquemaSqlHeadingFromPayload corta por `--` o CREATE sin depender de «Tabla espejo»", () => {
    const a = splitEsquemaSqlHeadingFromPayload("Esquema SQL del módulo -- Pedidos CREATE TABLE p (id UUID);");
    assert.equal(a?.heading, "Esquema SQL del módulo");
    const b = splitEsquemaSqlHeadingFromPayload("Esquema SQL del módulo CREATE TABLE p (id UUID);");
    assert.equal(b?.heading, "Esquema SQL del módulo");
    assert.equal(splitEsquemaSqlHeadingFromPayload("Esquema SQL del módulo -- sin create"), null);
  });

  it("repairCollapsedSqlParagraphs expande un esquema colapsado cualquiera en un fence sql", () => {
    const out = repairCollapsedSqlParagraphs(`Esquema SQL de pedidos\n\n${GENERIC}\n`);
    assert.match(out, /```sql\n-- Pedidos del cliente\nCREATE TABLE pedidos \(/);
    assert.match(out, /CREATE TABLE lineas \(/);
  });
});
