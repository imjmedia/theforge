import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countContratosEndpointRows,
  isContratosSectionRegression,
  isContratosSubstantial,
  repairStrayFencesInContratosTable,
  stripLeadingContratosPlaceholder,
} from "./contratos-format.js";

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
