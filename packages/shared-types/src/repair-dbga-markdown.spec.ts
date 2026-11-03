import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import {
  promoteBareDbgaNumericHeadings,
  promoteBareDbgaSectionHeadings,
  repairDualDbgaTitles,
  repairFlowStepPseudoTables,
  repairGluedDbgaBullets,
  repairOrphanNumberHeadings,
  repairPipeBulletPseudoTables,
  unwrapMarkdownInTextFences,
} from "./repair-dbga-markdown.js";

const FASE0_HEADER = "# Fase 0 — Especificación Inicial\n# Domain Benchmark & Gap Analysis (DBGA)\n\n";
const DBGA_HEADER = "# Domain Benchmark & Gap Analysis (DBGA)\n\n";

describe("repair-dbga-markdown", () => {
  it("repairDualDbgaTitles demota el segundo H1 DBGA", () => {
    const out = repairDualDbgaTitles(FASE0_HEADER);
    assert.match(out, /^# Fase 0/m);
    assert.doesNotMatch(out, /^# Domain Benchmark/m);
    assert.match(out, /\*Domain Benchmark/);
  });

  it("unwrapMarkdownInTextFences libera ## 5. Reglas dentro de ```text", () => {
    const input = `${DBGA_HEADER}\`\`\`text
## 5. Reglas de Negocio
-**R5.1** - Ventana de Ejecución
\`\`\``;
    const out = unwrapMarkdownInTextFences(input);
    assert.match(out, /^## 5\. Reglas de Negocio/m);
    assert.doesNotMatch(out, /```text[\s\S]*## 5/);
  });

  it("repairFlowStepPseudoTables convierte | - 1. | a lista ordenada", () => {
    const input = `| - 1. | Al iniciar, detecta ausencia de Superadmin. |
| :--- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| - 2. | Redirige al formulario. |`;
    const out = repairFlowStepPseudoTables(input);
    assert.match(out, /^1\. Al iniciar/m);
    assert.match(out, /^2\. Redirige/m);
    assert.doesNotMatch(out, /^\|/m);
  });

  it("repairPipeBulletPseudoTables convierte reglas R5.x", () => {
    const input = `| • | R5.1 - Ventana de Ejecución y Bloqueo |
| :--- | :--- |
| • | R5.2 - Idempotencia Estricta |`;
    const out = repairPipeBulletPseudoTables(input);
    assert.match(out, /^- \*\*R5\.1\*\* - Ventana/m);
    assert.match(out, /^- \*\*R5\.2\*\* - Idempotencia/m);
  });

  it("repairOrphanNumberHeadings convierte ## 2. suelto", () => {
    const input = `1. **Stop-Loss Local**
$$formula$$
## 2.

**Trailing Shadow** texto`;
    const out = repairOrphanNumberHeadings(input);
    assert.match(out, /2\. \*\*Trailing Shadow\*\*/);
    assert.doesNotMatch(out, /^## 2\./m);
  });

  it("promoteBareDbgaSectionHeadings promueve 4. Microservicios", () => {
    const input = `${FASE0_HEADER}4. Microservicios y Arquitectura de Motores\nTexto`;
    const out = promoteBareDbgaSectionHeadings(input);
    assert.match(out, /^## 4\. Microservicios/m);
  });

  it("promoteBareDbgaNumericHeadings promueve 3.6 y 4.1", () => {
    const input = `${FASE0_HEADER}3.6 Módulo de Comunicación\n4.1 Definición y Responsabilidad`;
    const out = promoteBareDbgaNumericHeadings(input);
    assert.match(out, /### 3\.6 Módulo/);
    assert.match(out, /#### 4\.1 Definición/);
  });

  it("repairGluedDbgaBullets separa -**R5.1**", () => {
    const out = repairGluedDbgaBullets("-**R5.1** - Ventana de ejecución");
    assert.equal(out, "- **R5.1** - Ventana de ejecución");
  });

  it("formatDocumentMarkdown repara flujos con Fase 0 header", () => {
    const input = `${FASE0_HEADER}## 6. Flujos Principales
Primer arranque
| - 1. | Paso uno |
| :--- | :--- |
| - 2. | Paso dos |`;
    const out = formatDocumentMarkdown(input);
    assert.match(out, /## 6\. Flujos Principales/);
    assert.match(out, /^1\. Paso uno/m);
    assert.match(out, /^2\. Paso dos/m);
  });

  it("repairGluedDbgaBullets arregla viñetas pero ya no promueve «N. … Engine» a #### (regla de cliente retirada)", () => {
    const out = repairGluedDbgaBullets("•\tItem\n7. Translation Engine\n8. Alpha Engine\n");
    assert.match(out, /^- Item$/m);
    assert.match(out, /^7\. Translation Engine$/m);
    assert.match(out, /^8\. Alpha Engine$/m);
    assert.doesNotMatch(out, /^####/m);
  });
});
