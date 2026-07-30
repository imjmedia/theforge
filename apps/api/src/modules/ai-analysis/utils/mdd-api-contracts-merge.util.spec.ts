import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeApiContractsChunkBodies } from "./mdd-api-contracts-chunk.util.js";
import { mergeApiContractsBodyIntoDraft } from "./mdd-api-contracts-merge.util.js";
import { extractContratosSectionBody, extractSection3Body, replaceMddSection4Body } from "./mdd-sanitize.js";
import { stripEmbeddedTailSectionsFromContratosBody } from "./mdd-sanitize/contratos-format.js";
import { draftHasSubstantialSection4, draftHasPersistableSection4 } from "./mdd-section-preserve.util.js";

describe("mergeApiContractsBodyIntoDraft", () => {
  it("§3 con endpoints absorbidos + chunk merge → §4 sustancial y §3 recortada", () => {
    const endpointBlock =
      "### GET /api/v1/items\n\n```json\n{\"items\":[]}\n```\n\n" +
      "### POST /api/v1/items\n\n```json\n{\"id\":\"1\"}\n```\n";
    const baseline = `# Master Design Document

## 1. Contexto

Alcance.

## 2. Arquitectura y Stack

Stack.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE items (id UUID PRIMARY KEY);
CREATE TABLE orders (id UUID PRIMARY KEY);
\`\`\`

TechnicalMetadata: [external_api]

${endpointBlock}

## 4. Contratos de API(Pendiente: Arquitecto de Software)

## 5. Lógica y Edge Cases

(Pendiente)
`;
    const s3Before = extractSection3Body(baseline)?.length ?? 0;
    const mergedSection4 = mergeApiContractsChunkBodies([endpointBlock, endpointBlock]);
    const out = mergeApiContractsBodyIntoDraft(baseline, mergedSection4);
    const s4Body = extractContratosSectionBody(out);
    assert.ok(draftHasPersistableSection4(out));
    assert.ok(draftHasSubstantialSection4(out));
    assert.ok(s4Body != null && s4Body.length > 80);
    const s3After = extractSection3Body(out)?.length ?? 0;
    assert.ok(s3After <= s3Before * 2);
    assert.doesNotMatch(extractSection3Body(out) ?? "", /### GET \/api\/v1\/items/);
    assert.equal((out.match(/^##\s*4\./gm) ?? []).length, 1);
  });

  it("elimina H2 §5–§7 embebidos en el cuerpo §4 al mergear", () => {
    const baseline = `# MDD
## 1. Contexto
${"Alcance. ".repeat(40)}
## 2. Arquitectura y Stack
${"Stack. ".repeat(40)}
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE t (id UUID PRIMARY KEY);
\`\`\`
## 4. Contratos de API
(Pendiente)
## 5. Lógica y Edge Cases
(Pendiente)
## 6. Seguridad
${"Seg. ".repeat(40)}
## 7. Infraestructura
${"Infra. ".repeat(40)}`;
    const polluted = `### GET /api/v1/health

\`\`\`json
{"status":"ok"}
\`\`\`

## 5. Lógica y Edge Cases

(Pendiente: paso dedicado Lógica y Edge Cases)`;
    const cleaned = stripEmbeddedTailSectionsFromContratosBody(polluted);
    assert.match(cleaned, /GET \/api\/v1\/health/);
    assert.doesNotMatch(cleaned, /^##\s+5\./m);
    assert.doesNotMatch(cleaned, /paso dedicado Lógica/i);

    const out = replaceMddSection4Body(baseline, polluted);
    const s4 = extractContratosSectionBody(out) ?? "";
    assert.match(s4, /GET \/api\/v1\/health/);
    assert.doesNotMatch(s4, /^##\s+5\./m);
  });
});
