import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeterministicDeliverableConformancePatches } from "./deliverable-conformance-enforce.util.js";
import { repairApiProgrammaticGaps } from "./api-conformance-repair.util.js";

const MDD = `# MDD

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/users | Lista usuarios |
| POST | /api/users | Crea usuario |
`;

const API = `# Contratos API

| Método | Ruta | Descripción | Auth | Notas |
|--------|------|-------------|------|-------|
| GET | \`/api/users\` | Lista usuarios | Bearer | ok |
| POST | \`/api/users\` | Crea usuario | Bearer | ok |

Texto adicional del documento para superar el mínimo de longitud.
`;

describe("buildDeterministicDeliverableConformancePatches", () => {
  it("un API ya conforme no produce parche", () => {
    const patches = buildDeterministicDeliverableConformancePatches(MDD, {
      apiContractsContent: API,
    });
    assert.equal(patches.apiContractsContent, undefined);
  });

  it("un API con endpoint faltante produce parche estable", () => {
    const incompleto = API.replace(/\| POST[^\n]*\n/, "");
    const patches = buildDeterministicDeliverableConformancePatches(MDD, {
      apiContractsContent: incompleto,
    });
    assert.ok(patches.apiContractsContent?.includes("POST"));
    const again = buildDeterministicDeliverableConformancePatches(MDD, {
      apiContractsContent: patches.apiContractsContent,
    });
    assert.equal(again.apiContractsContent, undefined);
    assert.equal(
      repairApiProgrammaticGaps(MDD, patches.apiContractsContent!).trim(),
      patches.apiContractsContent!.trim(),
    );
  });
});
