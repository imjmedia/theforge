/**
 * Semántica única de fences: `scanMarkdownFences` y `normalizeMarkdownFences`.
 * Golden del caso clínica-citas-historial: §3 con ```sql sin cerrar, ER con ```mermaid pegado a
 * ```TechnicalMetadata, y §5/§6/§7 que la rúbrica veía ausentes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanMarkdownFences, normalizeMarkdownFences } from "./fence-scan.util.js";
import { extractMddSectionBody } from "../../eval/mdd-eval-rubric.js";

const prose = (label: string): string =>
  `${label}. ${"Texto explicativo del apartado con contexto suficiente para la rúbrica. ".repeat(3)}`;

/** Golden: el documento tal como lo dejó el pipeline (fence de §3 sin cerrar, mermaid pegado). */
const CLINICA_GOLDEN = [
  "# Master Design Document",
  "",
  "## 1. Contexto",
  prose("Contexto de la clínica"),
  "",
  "## 2. Arquitectura y Stack",
  prose("Stack NestJS y PostgreSQL"),
  "",
  "## 3. Modelo de Datos",
  prose("Modelo de historial clínico"),
  "",
  "```sql",
  "CREATE TABLE clinicas (id UUID PRIMARY KEY, nombre TEXT NOT NULL);",
  "CREATE TABLE citas (id UUID PRIMARY KEY, clinica_id UUID REFERENCES clinicas(id));",
  "CREATE INDEX idx_citas_clinica ON citas (clinica_id);",
  "",
  "### Diagrama entidad-relación",
  "```mermaid",
  "erDiagram",
  "  CLINICAS {",
  "    uuid id PK",
  "  }",
  "  CITAS {",
  "    uuid id PK",
  "  }",
  "  CLINICAS ||--o{ CITAS : agenda",
  "```TechnicalMetadata",
  "{",
  '  "security": "high_security",',
  '  "tenant": "clinica",',
  '  "retention": "5y"',
  "}",
  "```",
  "",
  "## 5. Lógica y Edge Cases",
  prose("Reglas de citas y casos borde"),
  "",
  "## 6. Seguridad",
  prose("Autenticación, roles y auditoría de historial"),
  "",
  "## 7. Infraestructura",
  prose("Despliegue, backups y observabilidad"),
  "",
  "```json",
  '{"manifest":1}',
  "```",
  "",
].join("\n");

function lineIndex(lines: string[], predicate: (line: string) => boolean): number {
  const idx = lines.findIndex(predicate);
  assert.notEqual(idx, -1, "línea no encontrada en el golden");
  return idx;
}

describe("scanMarkdownFences", () => {
  it("un bloque abierto solo se cierra con una línea de marcador; ```mermaid dentro es contenido", () => {
    const lines = ["```sql", "CREATE TABLE a (id int);", "```mermaid", "erDiagram", "```", "fin"];
    const scan = scanMarkdownFences(lines);
    assert.equal(scan.unclosed, false);
    assert.equal(scan.blocks.length, 1);
    assert.equal(scan.blocks[0]!.lang, "sql");
    assert.equal(scan.blocks[0]!.content, "CREATE TABLE a (id int);\n```mermaid\nerDiagram");
    assert.equal(scan.blocks[0]!.startLine, 1);
    assert.equal(scan.blocks[0]!.endLine, 5);
    assert.deepEqual(scan.inFence, [true, true, true, true, true, false]);
  });

  it("un bloque sin cerrar queda marcado como unclosed con endLine null", () => {
    const scan = scanMarkdownFences(["## 3. A", "```sql", "SELECT 1;", "## 5. B"]);
    assert.equal(scan.unclosed, true);
    assert.equal(scan.blocks[0]!.closed, false);
    assert.equal(scan.blocks[0]!.endLine, null);
    assert.equal(scan.blocks[0]!.startLine, 2);
  });

  it("el cierre necesita longitud >= a la del opener y la misma clase de carácter", () => {
    const scan = scanMarkdownFences(["````md", "```", "texto", "````"]);
    assert.equal(scan.unclosed, false);
    assert.equal(scan.blocks[0]!.endLine, 4);
    const tilde = scanMarkdownFences(["~~~", "```", "~~~"]);
    assert.equal(tilde.blocks[0]!.endLine, 3);
  });

  it("un cierre con texto (```## 4.) no cierra el bloque", () => {
    const scan = scanMarkdownFences(["```sql", "SELECT 1;", "```## 4. X"]);
    assert.equal(scan.unclosed, true);
  });
});

describe("normalizeMarkdownFences — golden clínica", () => {
  const normalized = normalizeMarkdownFences(CLINICA_GOLDEN);
  const lines = normalized.split("\n");

  it("deja todos los fences cerrados y §5, §6 y §7 fuera de cualquier bloque", () => {
    const scan = scanMarkdownFences(lines);
    assert.equal(scan.unclosed, false);
    for (const n of [5, 6, 7]) {
      const idx = lineIndex(lines, (line) => new RegExp(`^## ${n}\\.`).test(line));
      assert.equal(scan.inFence[idx], false, `## ${n}. no debe quedar dentro de un bloque`);
    }
  });

  it("la rúbrica encuentra cuerpo no nulo para §3, §5, §6 y §7", () => {
    for (const n of [3, 5, 6, 7]) {
      const body = extractMddSectionBody(normalized, n);
      assert.ok(body !== null && body.length > 0, `§${n} debe tener cuerpo`);
    }
  });

  it("es idempotente: normalizar dos veces da el mismo string", () => {
    assert.equal(normalizeMarkdownFences(normalized), normalized);
  });

  it("cierra el bloque sql antes de '### Diagrama' y el mermaid antes de '```TechnicalMetadata'", () => {
    const scan = scanMarkdownFences(lines);
    const sql = scan.blocks.find((b) => b.lang === "sql");
    const mermaid = scan.blocks.find((b) => b.lang === "mermaid");
    const diagramIdx = lineIndex(lines, (line) => line.startsWith("### Diagrama"));
    const metaIdx = lineIndex(lines, (line) => line.startsWith("```TechnicalMetadata"));
    assert.ok(sql && sql.closed, "bloque sql cerrado");
    assert.ok(sql!.endLine! <= diagramIdx, "el sql se cierra antes del heading ###");
    assert.ok(mermaid && mermaid.closed, "bloque mermaid cerrado");
    assert.ok(mermaid!.endLine! <= metaIdx, "el mermaid se cierra antes de TechnicalMetadata");
  });
});

describe("normalizeMarkdownFences — reglas a/b/c/d/e", () => {
  it("b) opener pegado a prosa: '…la firma.```sql' → prosa y opener en líneas distintas", () => {
    const out = normalizeMarkdownFences("Cláusula posterior a la firma.```sql\nSELECT 1;\n```");
    assert.equal(out, "Cláusula posterior a la firma.\n```sql\nSELECT 1;\n```");
  });

  it("a) cierre pegado: '  A --> B```' dentro de bloque → texto y luego cierre", () => {
    const out = normalizeMarkdownFences("```mermaid\nflowchart LR\n  A --> B```\nfin");
    assert.equal(out, "```mermaid\nflowchart LR\n  A --> B\n```\nfin");
  });

  it("c) opener anidado con info string cierra el bloque anterior con línea en blanco", () => {
    const out = normalizeMarkdownFences("```sql\nCREATE TABLE a (id int);\n```json\n{}\n```");
    assert.equal(out, "```sql\nCREATE TABLE a (id int);\n```\n\n```json\n{}\n```");
  });

  it("c) no toca un opener dentro de un bloque markdown de 4 backticks (es contenido de ejemplo)", () => {
    const md = "````markdown\n```mermaid\nx\n```\n````";
    assert.equal(normalizeMarkdownFences(md), md);
  });

  it("d) heading canónico dentro de bloque abierto cierra el bloque antes del heading", () => {
    const out = normalizeMarkdownFences("```json\n{\"a\":1}\n## 5. Lógica y Edge Cases\ntexto");
    assert.equal(out, "```json\n{\"a\":1}\n```\n\n## 5. Lógica y Edge Cases\ntexto");
  });

  it("e) bloque abierto al EOF se cierra con su marcador", () => {
    assert.equal(normalizeMarkdownFences("intro\n```sql\nSELECT 1;\n"), "intro\n```sql\nSELECT 1;\n```\n");
  });

  it("sin fences rotos devuelve el mismo texto byte a byte", () => {
    const text = "# T\n\n## 1. Contexto\nTexto con `código` inline.\n\n```sql\nSELECT 1;\n```\n";
    assert.equal(normalizeMarkdownFences(text), text);
    assert.equal(normalizeMarkdownFences(""), "");
  });
});
