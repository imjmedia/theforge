import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateMddForDelivery } from "./mdd-delivery-gate.util.js";
import { resolveDeliveryGateContext } from "./mdd-delivery-gate-context.util.js";

const SAMPLE_MDD = `## 1. Contexto y alcance
Negocio de inventario.

## 2. Arquitectura y Stack
NestJS y PostgreSQL.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE items (id UUID PRIMARY KEY, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
\`\`\`

## 4. Contratos de API
POST /api/items
\`\`\`json
{"name":"x"}
\`\`\`

## 5. Lógica y Edge Cases
Dado un ítem cuando se crea entonces persiste.

## 6. Seguridad
Argon2 y RBAC.

## 7. Infraestructura
Dockerfile FROM node:20.
`;

describe("resolveDeliveryGateContext", () => {
  it("mismo MDD y documentos → mismo ok, blockers y score", () => {
    const brd = "## 3. Capacidades\n- **Catálogo** de ítems";
    const a = resolveDeliveryGateContext({
      mddMarkdown: SAMPLE_MDD,
      brdMarkdown: brd,
      mddComplexity: "HIGH",
    });
    const b = resolveDeliveryGateContext({
      mddMarkdown: SAMPLE_MDD,
      brdMarkdown: brd,
      mddComplexity: "HIGH",
    });
    const ga = validateMddForDelivery(SAMPLE_MDD, a.options);
    const gb = validateMddForDelivery(SAMPLE_MDD, b.options);
    assert.equal(ga.ok, gb.ok);
    assert.deepEqual(ga.blockers, gb.blockers);
    assert.equal(ga.score, gb.score);
  });
});
