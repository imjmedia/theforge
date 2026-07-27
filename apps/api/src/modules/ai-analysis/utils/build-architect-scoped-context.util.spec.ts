import { describe, it } from "node:test";
import assert from "node:assert";
import type { MDDStateType } from "../state/index.js";
import {
  buildArchitectScopedContext,
  extractStackTableFromSection2,
  summarizeContextSection1,
} from "./build-architect-scoped-context.util.js";

const SAMPLE_DRAFT = `# Master Design Document

## 1. Contexto

Sistema KMS con claves y tenants.

## 2. Arquitectura y Stack

| Capa | Tecnología |
|------|------------|
| Backend | NestJS |
| DB | PostgreSQL |

Detalle adicional de arquitectura.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

(Pendiente)

## 5. Lógica y Edge Cases

(Pendiente)

## 6. Seguridad

(Pendiente)

## 7. Infraestructura

(Pendiente)`;

describe("build-architect-scoped-context.util", () => {
  const state = { mddDraft: SAMPLE_DRAFT, mddComplexity: "HIGH" } as MDDStateType;

  it("summarizeContextSection1 trunca cuerpos largos", () => {
    const long = "a".repeat(2000);
    const out = summarizeContextSection1(long, 500);
    assert.ok(out);
    assert.ok(out!.length < 600);
    assert.match(out!, /truncado/);
  });

  it("extractStackTableFromSection2 extrae tabla GFM", () => {
    const s2 = "| Capa | Tech |\n|------|------|\n| BE | Nest |\n\nProsa extra.";
    const table = extractStackTableFromSection2(s2);
    assert.ok(table?.includes("| Capa | Tech |"));
    assert.ok(!table?.includes("Prosa extra"));
  });

  it("stack: §1 + inventario, sin borrador completo", async () => {
    const { lines, contextChars } = await buildArchitectScopedContext(state, "stack");
    const text = lines.join("\n");
    assert.ok(contextChars > 0);
    assert.match(text, /§1 Contexto/);
    assert.match(text, /Sistema KMS/);
    assert.doesNotMatch(text, /## 5\. Lógica/);
    assert.doesNotMatch(text, /CREATE TABLE keys/);
    assert.ok(!text.includes("# Master Design Document"));
  });

  it("data_model: §1+§2, sin §4–§7", async () => {
    const { lines } = await buildArchitectScopedContext(state, "data_model");
    const text = lines.join("\n");
    assert.match(text, /§1 Contexto/);
    assert.match(text, /§2 Arquitectura/);
    assert.match(text, /NestJS/);
    assert.doesNotMatch(text, /## 4\. Contratos/);
    assert.doesNotMatch(text, /## 6\. Seguridad/);
  });

  it("api_contracts: resumen §1 + tabla §2 + SQL §3, sin §5–§7", async () => {
    const { lines } = await buildArchitectScopedContext(state, "api_contracts");
    const text = lines.join("\n");
    assert.match(text, /§1 Contexto \(resumen\)/);
    assert.match(text, /§2 Stack/);
    assert.match(text, /CREATE TABLE keys/);
    assert.doesNotMatch(text, /## 5\. Lógica/);
    assert.doesNotMatch(text, /## 7\. Infraestructura/);
  });
});
