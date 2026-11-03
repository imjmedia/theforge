import { describe, it } from "node:test";
import assert from "node:assert";
import {
  applyDeterministicCrossConsistencyFixes,
  detectCrossConsistencyIssues,
  draftHasRequestIdDualApprovalApi,
  draftRequiresDualApproval,
} from "./cross-consistency.js";

/**
 * La aprobación dual solo se DETECTA: el pipeline determinista no reescribe el borrador
 * (no añade columnas ni endpoints que el autor no escribió).
 */
describe("aprobación dual: detección sin reescritura", () => {
  it("dual approval en §6 y sin columnas en §3: la salida es igual a la entrada y se reporta el hallazgo", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY,
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);
\`\`\`

## 6. Seguridad

La exportación requiere aprobación dual por dos administradores distintos.
`;
    assert.ok(draftRequiresDualApproval(draft));
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.strictEqual(out, draft);
    assert.ok(!out.includes("second_approver_id"));
    assert.ok(!out.includes("first_approver_id"));
    assert.ok(!out.includes("first_approved"));

    const issues = detectCrossConsistencyIssues(out);
    assert.ok(issues.some((i) => i.includes("second_approver_id")));
    assert.ok(issues.some((i) => i.includes("approved_by")));
  });

  it("endpoint único export/approve: no se divide en approve-first/approve-second y se reporta", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 4. Contratos de API

| POST | \`/api/keys/:keyId/export/approve\` | Aprobar exportación (dual) | JWT (admin_security) |

#### POST /api/keys/:keyId/export/approve

Aprueba solicitud. Primer aprobador → first_approved; segundo → approved.
`;
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.ok(!out.includes("approve-first"));
    assert.ok(!out.includes("approve-second"));
    assert.ok(out.includes("/export/approve"));
    const issues = detectCrossConsistencyIssues(out);
    assert.ok(issues.some((i) => i.includes("approve-first")));
  });

  it("patrón :requestId/approve + execute: sin cambios y sin hallazgo de approve-first", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 4. Contratos de API

| POST | /api/v1/keys/:id/export/:requestId/approve | Aprobar (1.ª o 2.ª) | JWT |
| POST | /api/v1/keys/:id/export/:requestId/execute | Ejecutar exportación | JWT |
| POST | /api/v1/keys/:id/export/:requestId/reject | Rechazar | JWT |
`;
    assert.ok(draftHasRequestIdDualApprovalApi(draft));
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.ok(!out.includes("approve-first"));
    assert.ok(!detectCrossConsistencyIssues(out).some((i) => i.includes("approve-first")));
  });

  it("el ER mermaid con approved_by tampoco se reescribe", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 3. Modelo de Datos

\`\`\`mermaid
erDiagram
  approval_requests {
    uuid id PK
    uuid approved_by FK
  }
\`\`\`
`;
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.ok(!out.includes("second_approver_id"));
    assert.ok(out.includes("uuid approved_by FK"));
  });
});
