import { describe, it } from "node:test";
import assert from "node:assert";
import {
  deduplicateAndReorderMddSections,
  deduplicateMddDraftSections,
  extractSection5Body,
} from "./section-merge.js";

/**
 * Job 80: Section5 generaba ~4.5k chars y los escribía bien, pero el MDD final conservaba
 * un stub de §5 (`### Reglas de negocio (formato BDD/AAA)` + `---`, ~40 chars) y el gate
 * bloqueaba con "36 chars; mínimo 200".
 *
 * Causa: `stripTrailingDuplicateMddSections` trunca por POSICIÓN todo lo posterior a la
 * primera §7. Con el stub arriba y la versión buena detrás de §7, el recorte borraba la
 * buena antes de que el reorder pudiera quedarse con la más larga.
 */
const GOOD_SECTION5_BODY = `### Reglas de negocio (formato BDD/AAA)

#### RN-01: Rotación de claves

**Dado** que una clave criptográfica alcanza su fecha de rotación programada,
**cuando** el scheduler ejecuta el job de rotación,
**entonces** se genera una nueva versión y la anterior pasa a estado \`deprecated\`.

${"Regla de negocio verificable con criterios de aceptación. ".repeat(40)}`;

const STUB_SECTION5_BODY = `### Reglas de negocio (formato BDD/AAA)`;

function buildDraftWithStubBeforeGoodTail(): string {
  return `# Master Design Document

## 1. Contexto y alcance

${"Alcance del KMS corporativo. ".repeat(30)}

## 2. Arquitectura y Stack

${"Stack tecnologico. ".repeat(30)}

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

### GET /api/v1/keys

${"Contrato del endpoint. ".repeat(30)}

## 5. Lógica y Edge Cases

${STUB_SECTION5_BODY}

## 6. Seguridad

${"Controles de seguridad. ".repeat(30)}

## 7. Infraestructura

${"Despliegue y observabilidad. ".repeat(30)}

## 5. Lógica y Edge Cases

${GOOD_SECTION5_BODY}
`;
}

describe("dedupe conserva la mejor versión de una sección, no la primera", () => {
  it("§5 buena detrás de §7 sobrevive al recorte posicional", () => {
    const raw = buildDraftWithStubBeforeGoodTail();
    const out = deduplicateAndReorderMddSections(raw);

    assert.equal(
      (out.match(/^## 5\. Lógica y Edge Cases/gm) ?? []).length,
      1,
      "debe quedar una sola §5",
    );

    const body = extractSection5Body(out);
    assert.ok(body != null, "§5 debe existir tras el dedupe");
    assert.ok(
      body!.length >= 200,
      `§5 debe conservar el cuerpo sustancial, no el stub (len=${body!.length})`,
    );
    assert.match(body!, /RN-01/, "debe conservar las reglas generadas");
  });

  it("deduplicateMddDraftSections tampoco pierde la §5 buena", () => {
    const raw = buildDraftWithStubBeforeGoodTail();
    const out = deduplicateMddDraftSections(raw);
    const body = extractSection5Body(out);
    assert.ok(body != null);
    assert.ok(
      body!.length >= 200,
      `§5 debe quedar sustancial (len=${body!.length})`,
    );
    assert.match(body!, /RN-01/);
  });

  it("§6/§7 siguen presentes y sin duplicar", () => {
    const raw = buildDraftWithStubBeforeGoodTail();
    const out = deduplicateAndReorderMddSections(raw);
    assert.equal((out.match(/^## 6\. Seguridad/gm) ?? []).length, 1);
    assert.equal((out.match(/^## 7\. Infraestructura/gm) ?? []).length, 1);
    assert.match(out, /Controles de seguridad/);
    assert.match(out, /Despliegue y observabilidad/);
  });
});
