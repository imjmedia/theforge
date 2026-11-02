import { describe, it } from "node:test";
import assert from "node:assert";
import { checkLogicFlowsVsMdd } from "./conformance.service.js";

const MIN_FLOWS = "# Flujos de lógica\n\n".padEnd(120, "x");

describe("checkLogicFlowsVsMdd", () => {
  it("acepta sequenceDiagram cuando §5 menciona flowchart", () => {
    const mdd = `## 5. Lógica y edge cases

Usar flowchart para el onboarding y validaciones MFA.

### Reglas
- Validación de email corporativo.
`;
    const flows = `${MIN_FLOWS}

## Onboarding

Validación de email corporativo y verificación MFA al completar el registro.

\`\`\`mermaid
sequenceDiagram
  participant U as Usuario
  participant API as API
  U->>API: POST /onboarding
\`\`\`
`;
    const result = checkLogicFlowsVsMdd(mdd, flows);
    assert.equal(result.ok, true, result.gaps.join("; "));
  });

  it("marca gap si §5 menciona flowchart y Flujos no tiene diagramas", () => {
    const mdd = `## 5. Lógica y edge cases

Documentar con flowchart el flujo de pago.
`;
    const flows = `${MIN_FLOWS}

Solo texto narrativo sin mermaid.
`;
    const result = checkLogicFlowsVsMdd(mdd, flows);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => g.includes("flowchart")));
  });
});
