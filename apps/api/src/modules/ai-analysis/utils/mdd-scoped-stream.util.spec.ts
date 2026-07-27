import { describe, it } from "node:test";
import assert from "node:assert";
import {
  hasSecondCanonicalMddHeading,
  trimBeforeSecondCanonicalMddHeading,
} from "./mdd-scoped-stream.util.js";

describe("mdd-scoped-stream.util", () => {
  it("hasSecondCanonicalMddHeading false con un solo heading", () => {
    assert.strictEqual(hasSecondCanonicalMddHeading("## 3. Modelo de Datos\n\nSQL aquí"), false);
  });

  it("detecta y recorta al 2º heading canónico", () => {
    const raw = `## 4. Contratos de API

GET /health

## 5. Lógica y Edge Cases

no debe quedar`;
    assert.strictEqual(hasSecondCanonicalMddHeading(raw), true);
    assert.strictEqual(
      trimBeforeSecondCanonicalMddHeading(raw),
      `## 4. Contratos de API

GET /health`,
    );
  });
});
