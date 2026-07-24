import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countContratosEndpointRows,
  isContratosSectionRegression,
  isContratosSubstantial,
  repairStrayFencesInContratosTable,
} from "./contratos-format.js";

describe("isContratosSectionRegression", () => {
  const richBaseline =
    "GET /api/v1/resource-item-alpha\n".repeat(50) +
    "\n```json\n{\"ok\":true}\n```\n";

  it("detecta regresión por longitud", () => {
    const thin = "GET /api/v1/resource-alpha\nPOST /api/v1/resource-beta\n".repeat(8);
    assert.equal(isContratosSubstantial(richBaseline), true);
    assert.equal(isContratosSubstantial(thin), true);
    assert.equal(isContratosSectionRegression(richBaseline, thin), true);
  });

  it("no marca regresión cuando baseline es corto", () => {
    const short = "| GET | /api/v1/health |\n";
    assert.equal(isContratosSectionRegression(short, short), false);
  });

  it("countContratosEndpointRows cuenta métodos HTTP", () => {
    assert.equal(countContratosEndpointRows("GET /a\nPOST /b\n"), 2);
    assert.equal(countContratosEndpointRows("| GET | /a |\n| POST | /b |\n"), 2);
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
