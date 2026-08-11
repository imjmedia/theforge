import { describe, it } from "node:test";
import assert from "node:assert";
import { repairGluedMarkdownHeadings } from "./repair-glued-headings.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

const COPIlOTO_SECTION1 = `## 1. Contexto y Alcance ### Propósito del Proyecto

El Copiloto Inteligente Multi-MCP es un sistema centralizado que orquesta la interacción entre empleados autorizados y sistemas corporativos (inicialmente Bitrix24) mediante canales de mensajería natural como WhatsApp. El objetivo es eliminar la ineficiencia operativa causada por la fragmentación de información entre múltiples plataformas, permitiendo a los usuarios acceder datos y ejecutar acciones simples directamente desde su canal de comunicación preferido. ### Alcance y Fronteras #### Servicios Core (Dentro del Alcance)

    Copiloto Central: Microservicio que clasifica solicitudes
`;

describe("repairGluedMarkdownHeadings", () => {
  it("despega H2/H3/H4 pegados en §1 estilo Copiloto", () => {
    const out = repairGluedMarkdownHeadings(COPIlOTO_SECTION1);
    assert.match(out, /## 1\. Contexto y Alcance\n\n### Propósito del Proyecto/);
    assert.match(out, /preferido\.\n\n### Alcance y Fronteras\n\n#### Servicios Core/);
    assert.doesNotMatch(out, /Contexto y Alcance ###/);
    assert.doesNotMatch(out, /Fronteras ####/);
  });

  it("formatDocumentMarkdown aplica la misma reparación", () => {
    const out = formatDocumentMarkdown(COPIlOTO_SECTION1);
    assert.match(out, /## 1\. Contexto y Alcance\n\n### Propósito del Proyecto/);
    assert.doesNotMatch(out, /Contexto y Alcance ###/);
  });

  it("parte título de heading y prosa en la misma línea", () => {
    const raw =
      "### Declaración de Independencia Este sistema es la raíz de la arquitectura.";
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /### Declaración de Independencia\n\nEste sistema es la raíz/);
  });

  it("parte ### 1.1 Propósito pegado a prosa (Jarvis)", () => {
    const raw =
      "### 1.1 Propósito Jarvis IMJ es un copiloto orquestador inteligente multi-tenant.";
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /### 1\.1 Propósito\n\nJarvis IMJ es un copiloto/);
  });

  it("promueve §1 sin ## y despega subheadings (muestra Copiloto pegada)", () => {
    const raw = `1. Contexto y Alcance ### Propósito del Proyecto

Texto. ### Alcance y Fronteras #### Servicios Core (Dentro del Alcance)

    item
    Autenticación SSO: Integración #### Servicios Extensiones (Fuera del Alcance)
    más texto ### Declaración de Independencia Este sistema es la raíz. ### Audiencia Técnica Desarrolladores Fullstack:`;
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /^## 1\. Contexto y Alcance\n\n### Propósito del Proyecto/m);
    assert.doesNotMatch(out, /Contexto y Alcance ###/);
    assert.doesNotMatch(out, /Técnica Desarrolladores/);
    assert.match(out, /### Audiencia Técnica\n\nDesarrolladores Fullstack/);
  });

  it("quita sufijo mermaid pegado al heading (BRD Copiloto)", () => {
    const raw = "#### Flujo 3: Configuración del copiloto por el Superadminmermaid";
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /Superadmin$/);
    assert.doesNotMatch(out, /Superadminmermaid/);
  });

  it("formatDocumentMarkdown repara heading-only fence y sufijo mermaid", () => {
    const raw = `\`\`\`
### 5.2 Flujo: Outbox Pattern (escrituras asíncronas)mermaid
\`\`\`

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
\`\`\``;
    const out = formatDocumentMarkdown(raw);
    assert.match(out, /### 5\.2 Flujo: Outbox Pattern \(escrituras asíncronas\)\n+\s*```mermaid/);
    assert.doesNotMatch(out, /asíncronas\)mermaid/);
    assert.doesNotMatch(out, /```\s*\n### 5\.2/);
  });

  it("homogeniza viñetas * a - en formatDocumentMarkdown", () => {
    const raw = "**Lista:**\n* item A\n* item B\n- item C";
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /^\* item/m);
    assert.match(out, /^- item A/m);
  });

  it("repara headings apilados ### ## N. Sección", () => {
    const raw = `## 5. Lógica y Edge Cases

### ## 6. Seguridad

### Aislamiento Multitenant y Autorización
- item`;
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /^## 6\. Seguridad/m);
    assert.doesNotMatch(out, /### ## 6\./);
  });

  it("despega heading de blockquote pegado con >", () => {
    const raw =
      "### Trazabilidad BRD → MDD (FR → módulo → §§) > Matriz canónica para el checker MaxPrime.";
    const out = repairGluedMarkdownHeadings(raw);
    assert.match(out, /### Trazabilidad BRD → MDD \(FR → módulo → §§\)\n\n>\s+Matriz canónica/);
  });
});
