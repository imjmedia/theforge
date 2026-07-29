import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractSection5Body,
  replaceMddSection5Body,
  mddHasDuplicateSectionHeadings,
} from "./section-merge.js";

/**
 * Job 79: §5 entraba en bucle infinito preserve↔gate. El patrón de preserve
 * (`##\s*5\.`, sin anclar) casaba dentro de `### 5. …` mientras el delivery gate
 * (`/^##\s+5\./`) leía el `## 5.` real. Preserve "restauraba" un subheading y el
 * gate seguía viendo el placeholder de 36 chars.
 */
describe("colisión H3 vs H2 en secciones canónicas", () => {
  const draft = `# Master Design Document

## 4. Contratos de API

### GET /api/v1/keys

Lista claves. ${"Detalle del contrato. ".repeat(30)}

### 5. Lógica y Edge Cases

Subheading dentro de §4 que imita el heading canónico. ${"Texto de relleno. ".repeat(60)}

## 5. Lógica y Edge Cases

(Pendiente: paso dedicado)

## 6. Seguridad

${"Controles de seguridad. ".repeat(30)}
`;

  it("extractSection5Body lee el H2 real, no el subheading ### 5.", () => {
    const body = extractSection5Body(draft);
    assert.ok(body != null, "§5 debe encontrarse");
    assert.match(body!, /Pendiente: paso dedicado/);
    assert.doesNotMatch(
      body!,
      /Subheading dentro de §4/,
      "no debe leer el cuerpo del ### 5. embebido en §4",
    );
  });

  it("replaceMddSection5Body escribe en el H2 real y el resultado se relee igual", () => {
    const nuevo = `### 5.1 Reglas de negocio\n\n${"Regla verificable. ".repeat(40)}`;
    const out = replaceMddSection5Body(draft, nuevo);

    // Invariante que fallaba en job 79: escribir y releer debe converger.
    const releido = extractSection5Body(out);
    assert.ok(releido != null);
    assert.match(releido!, /Regla verificable/);
    assert.ok(
      releido!.length > 200,
      `§5 debe quedar sustancial tras el replace (len=${releido!.length})`,
    );

    // El §4 y su subheading no se tocan.
    assert.match(out, /### GET \/api\/v1\/keys/);
    assert.match(out, /Subheading dentro de §4/);
    // §6 sigue presente (no se la traga el replace).
    assert.match(out, /## 6\. Seguridad/);
  });
});

describe("mddHasDuplicateSectionHeadings ignora headings dentro de fences", () => {
  it("un ## 6. Seguridad de ejemplo dentro de ``` no cuenta como duplicado", () => {
    const draft = `# Master Design Document

## 1. Contexto

${"Alcance. ".repeat(40)}

## 6. Seguridad

Ejemplo de plantilla que documenta la estructura del MDD:

\`\`\`markdown
## 6. Seguridad

Aquí va el contenido de seguridad.
\`\`\`

Controles reales. ${"Detalle. ".repeat(30)}
`;
    assert.equal(
      mddHasDuplicateSectionHeadings(draft),
      false,
      "el heading dentro del fence no es una sección duplicada",
    );
  });

  it("sigue detectando duplicados reales fuera de fences", () => {
    const draft = `# Master Design Document

## 6. Seguridad

Primero.

## 6. Seguridad

Segundo.
`;
    assert.equal(mddHasDuplicateSectionHeadings(draft), true);
  });
});
