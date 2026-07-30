import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countContratosEndpointRows,
  extractContratosSectionBody,
  isContratosSectionRegression,
  isContratosSubstantial,
  normalizeGluedSection4HeadingInDraft,
  repairStrayFencesInContratosTable,
  stripLeadingContratosPlaceholder,
} from "./contratos-format.js";
import { extractSection3Body, tryMergeSingleArchitectSectionIntoDraft } from "./section-merge.js";
import {
  mergeApiContractsBodyIntoDraft,
} from "../mdd-api-contracts-merge.util.js";
import { draftHasSubstantialSection4 } from "../mdd-section-preserve.util.js";
import { mergeApiContractsChunkBodies } from "../mdd-api-contracts-chunk.util.js";

describe("isContratosSectionRegression", () => {
  const richBaseline =
    "GET /api/v1/resource-item-alpha\n".repeat(50) +
    "\n```json\n{\"ok\":true}\n```\n";

  it("detecta regresión por longitud", () => {
    const thin =
      "GET /api/v1/resource-alpha\nPOST /api/v1/resource-beta\n".repeat(8) +
      "\n```json\n{\"ok\":true}\n```\n";
    assert.equal(isContratosSubstantial(richBaseline), true);
    assert.equal(isContratosSubstantial(thin), true);
    assert.equal(isContratosSectionRegression(richBaseline, thin), true);
  });

  it("detecta colapso catálogo endpoint (73→25) con longitud aún sustancial", () => {
    const baseline =
      "| GET | /api/v1/ep-01 |\n".repeat(73) +
      "\n```json\n{\"ok\":true}\n```\n".repeat(20);
    const candidate =
      "| GET | /api/v1/ep-01 |\n".repeat(25) +
      "\n```json\n{\"ok\":true}\n```\n".repeat(10);
    assert.equal(isContratosSubstantial(baseline), true);
    assert.equal(isContratosSubstantial(candidate), true);
    assert.equal(countContratosEndpointRows(baseline), 73);
    assert.equal(countContratosEndpointRows(candidate), 25);
    assert.equal(isContratosSectionRegression(baseline, candidate), true);
  });

  it("rechaza shrink ~26% longitud cuando baseline sustancial", () => {
    const baseline = "GET /api/v1/x\n".repeat(200) + "\n```json\n{}\n```\n";
    const candidate = baseline.slice(0, Math.floor(baseline.length * 0.74));
    assert.equal(isContratosSectionRegression(baseline, candidate), true);
  });

  it("no marca regresión cuando baseline es corto", () => {
    const short = "| GET | /api/v1/health |\n";
    assert.equal(isContratosSectionRegression(short, short), false);
  });

  it("countContratosEndpointRows cuenta métodos HTTP", () => {
    assert.equal(countContratosEndpointRows("GET /a\nPOST /b\n"), 2);
    assert.equal(countContratosEndpointRows("| GET | /a |\n| POST | /b |\n"), 2);
  });

  it("stripLeadingContratosPlaceholder quita stub cuando hay tabla debajo", () => {
    const raw = `(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco.)

| Método | Ruta |
| GET | /api/v1/health |`;
    const stripped = stripLeadingContratosPlaceholder(raw);
    assert.doesNotMatch(stripped, /Falta: definir endpoints/i);
    assert.match(stripped, /GET \| \/api\/v1\/health/);
  });

  it("Falta + tabla journey sin json no es sustancial (evita bucle preserve)", () => {
    const stub =
      `(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco; en la siguiente iteración se deben completar los contratos.)

### Endpoints journey core

| Método | Ruta | Descripción |
| GET | /api/v1/strategies | list |`;
    assert.equal(isContratosSubstantial(stub), false);
  });
});

describe("extractContratosSectionBody fence-aware (job 83)", () => {
  const s4Payload =
    "### GET /api/v1/health\n\n" +
    "| Método | Ruta |\n| GET | /api/v1/health |\n\n" +
    "```json\n{\"status\":\"ok\"}\n```\n".repeat(15);

  it("§3 no trunca en ## embebido en fence; §4 lee el H2 canónico", () => {
    const draft = `# Master Design Document

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
\`\`\`

Ejemplo en documentación interna:

\`\`\`markdown
Plantilla del MDD:

## 4. Contratos de API
(ejemplo dentro del fence — no cortar §3 aquí)
\`\`\`

${"Metadatos técnicos del modelo. ".repeat(20)}

## 4. Contratos de API

(Pendiente)

## 5. Lógica y Edge Cases

(Pendiente: paso dedicado)
`;

    const s3 = extractSection3Body(draft);
    const s4 = extractContratosSectionBody(draft);
    assert.ok(s3 != null && s3.length > 200, "§3 debe incluir SQL y metadatos tras el fence markdown");
    assert.match(s3!, /Metadatos técnicos del modelo/);
    assert.ok(s4 != null, "§4 debe encontrarse");
    assert.match(s4!, /\(Pendiente\)/);
    assert.doesNotMatch(s4!, /ejemplo dentro del fence/);
  });

  it("merge quirúrgico §4 deja contenido LLM en slot canónico", () => {
    const baseline = `# Master Design Document

## 1. Contexto y alcance

${"Alcance del KMS con rotación de claves. ".repeat(30)}

## 2. Arquitectura y Stack

${"NestJS monolito modular. ".repeat(30)}

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
\`\`\`

${"Modelo relacional completo. ".repeat(25)}

## 4. Contratos de API

(Pendiente)

## 5. Lógica y Edge Cases

(Pendiente: paso dedicado Lógica y Edge Cases)
`;

    const architectFragment = `## 4. Contratos de API\n\n${s4Payload}`;
    const fragmentBody = extractContratosSectionBody(architectFragment);
    assert.ok(fragmentBody != null && fragmentBody.length > 80, `fragment body len=${fragmentBody?.length ?? 0}`);
    const merged = tryMergeSingleArchitectSectionIntoDraft(baseline, architectFragment, 4);
    assert.equal(
      merged.merged,
      true,
      `merge debe aceptar §4 sustancial (reason=${merged.rejectReason ?? "none"})`,
    );
    const outBody = extractContratosSectionBody(merged.draft);
    assert.match(merged.draft, /GET \/api\/v1\/health/, "el draft mergeado debe contener el contrato");
    assert.ok(outBody != null && outBody.length > 80, `§4 releída len=${outBody?.length ?? 0}`);
    assert.match(outBody!, /GET \/api\/v1\/health/);
    assert.doesNotMatch(outBody!, /^\(Pendiente\)/);
    assert.equal(isContratosSubstantial(outBody), true);
  });

  it("normaliza heading pegado ## 4. Contratos de API(Pendiente…)", () => {
    const glued = `# MDD

## 4. Contratos de API(Pendiente: Arquitecto de Software)

## 5. Lógica y Edge Cases
`;
    const out = normalizeGluedSection4HeadingInDraft(glued);
    assert.match(out, /^## 4\. Contratos de API\n\n\(Pendiente: Arquitecto de Software\)/m);
    const body = extractContratosSectionBody(out);
    assert.match(body ?? "", /Pendiente: Arquitecto de Software/);
  });

  it("§3 fence abierto + chunk merge deja §4 sustancial sin inflar §3", () => {
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
    const s3After = extractSection3Body(out)?.length ?? 0;
    const s4Body = extractContratosSectionBody(out);
    assert.ok(draftHasSubstantialSection4(out), "§4 debe ser sustancial tras merge");
    assert.ok(s4Body != null && s4Body.length > 80, `§4 len=${s4Body?.length ?? 0}`);
    assert.ok(s3After <= s3Before * 2, `§3 inflada ${s3Before}→${s3After}`);
    assert.doesNotMatch(s3After > 0 ? extractSection3Body(out)! : "", /### GET \/api\/v1\/items/);
  });
});

describe("repairStrayFencesInContratosTable", () => {
  it("quita fence huérfano entre filas de tabla", () => {
    const raw = `| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | \`/api/v1/keys\` | Listar | Bearer |
\`\`\`
| POST | \`/api/v1/keys\` | Crear | Bearer |`;
    const out = repairStrayFencesInContratosTable(raw);
    assert.doesNotMatch(out, /\n```\n\| POST/);
    assert.match(out, /\| POST \|/);
  });

  it("separa ```json pegado al final de fila de tabla", () => {
    const raw =
      "| GET | `/api/v1/secrets` | Detalle | Bearer | ```json";
    const out = repairStrayFencesInContratosTable(raw);
    assert.match(out, /\| GET \|/);
    assert.match(out, /```json/);
    assert.doesNotMatch(out, /Bearer \| ```json/);
  });
});
