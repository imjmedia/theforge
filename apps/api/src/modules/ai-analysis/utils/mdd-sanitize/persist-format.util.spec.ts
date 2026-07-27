import { describe, it } from "node:test";
import assert from "node:assert";
import {
  repairGluedClosingFenceToHeading,
  repairSplitMarkdownBullets,
  stripHashDashSeparatorLines,
  stripLoneBacktickPairLines,
} from "./persist-format.util.js";
import { normalizeMddFormat } from "./persist-pipeline.js";
import { fixDeterministicMddCoherence } from "./cross-consistency.js";
import { deduplicateAndReorderMddSections } from "./section-merge.js";

describe("stripHashDashSeparatorLines", () => {
  it("elimina # --- entre secciones", () => {
    const raw = `# MDD\n\n## 1. Contexto\n\nTexto.\n\n# ---\n\n---\n\n## 2. Arquitectura y Stack\n\nStack.`;
    const out = stripHashDashSeparatorLines(raw);
    assert.doesNotMatch(out, /^#\s+---/m);
    assert.match(out, /## 2\. Arquitectura/);
  });
});

describe("repairSplitMarkdownBullets", () => {
  it("une viñetas partidas en §1 (UAT / riesgos)", () => {
    const raw = `- **Criterios de Aceptación (UAT):**\n\n-\n\n **Escenario 2 - Costos:** detalle.\n\n-\n\n **Riesgo 2:** fuga de datos.`;
    const out = repairSplitMarkdownBullets(raw);
    assert.match(out, /-\s+\*\*Escenario 2/);
    assert.doesNotMatch(out, /-\s*\n+\s+\*\*Escenario/);
  });
});

describe("repairGluedClosingFenceToHeading", () => {
  it("despega ``` pegado a ## 4. Contratos", () => {
    const raw =
      "```TechnicalMetadata\n[high_security]\n```## 4. Contratos de API\n\n| GET | /health |";
    const out = repairGluedClosingFenceToHeading(raw);
    assert.match(out, /```\n\n## 4\. Contratos de API/);
  });
});

describe("stripLoneBacktickPairLines", () => {
  it("elimina líneas `` vacías", () => {
    const raw = "## 4. Contratos\n\nTabla.\n\n``\n\n## 5. Lógica";
    const out = stripLoneBacktickPairLines(raw);
    assert.doesNotMatch(out, /``/);
  });
});

describe("fixDeterministicMddCoherence erDiagram en §4", () => {
  it("mueve erDiagram de §4 a §3", () => {
    const raw = `# MDD
## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE t (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| GET | /api/v1/health |

\`\`\`mermaid
erDiagram
  t { uuid id PK }
\`\`\`
`;
    const out = fixDeterministicMddCoherence(raw);
    assert.match(out, /## 3\. Modelo de Datos[\s\S]*erDiagram/);
    assert.doesNotMatch(out, /## 4\. Contratos de API[\s\S]*erDiagram/);
  });
});

describe("deduplicateAndReorderMddSections §4 duplicada", () => {
  it("fusiona §4 principal con bloque journey core", () => {
    const raw = `# MDD
## 1. Contexto
${"Alcance del producto. ".repeat(40)}
## 2. Arquitectura y Stack
NestJS stack.
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE t (id UUID PRIMARY KEY);
\`\`\`
## 4. Contratos de API
| POST | /api/v1/tenants | create |
## 5. Lógica y Edge Cases
Reglas.
## 4. Contratos de API
### Endpoints journey core (sincronización determinista)
| GET | /api/v1/credentials | list |
`;
    const out = deduplicateAndReorderMddSections(raw);
    assert.equal((out.match(/## 4\. Contratos de API/g) ?? []).length, 1);
    assert.match(out, /journey core/i);
    assert.match(out, /\/api\/v1\/tenants/);
  });
});

describe("normalizeMddFormat pipeline parcial HIGH", () => {
  it("limpia # --- y TechnicalMetadata duplicado pegado a §4", () => {
    const raw = `# Master Design Document
## 1. Contexto
${"Contexto del copiloto multiempresa. ".repeat(30)}
# ---

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE tenants (id UUID PRIMARY KEY);
\`\`\`
\`\`\`TechnicalMetadata
[high_security]
\`\`\`
\`\`\`TechnicalMetadata
[high_security]
\`\`\`## 4. Contratos de API
| GET | /health | ok |
`;
    const out = normalizeMddFormat(raw);
    assert.doesNotMatch(out, /^#\s+---/m);
    assert.doesNotMatch(out, /```## 4\. Contratos/);
    assert.match(out, /## 4\. Contratos de API/);
    assert.ok((out.match(/```TechnicalMetadata/g) ?? []).length <= 1);
  });
});
