/**
 * Integración eval: la rúbrica usa el mismo scan que shared-types (vía re-export API).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMarkdownFences } from "./fence-scan.util.js";
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

describe("normalizeMarkdownFences — rúbrica eval (shared-types scan)", () => {
  it("la rúbrica encuentra cuerpo no nulo para §3, §5, §6 y §7 tras normalizar golden clínica", () => {
    const normalized = normalizeMarkdownFences(CLINICA_GOLDEN);
    for (const n of [3, 5, 6, 7]) {
      const body = extractMddSectionBody(normalized, n);
      assert.ok(body !== null && body.length > 0, `§${n} debe tener cuerpo`);
    }
  });
});
