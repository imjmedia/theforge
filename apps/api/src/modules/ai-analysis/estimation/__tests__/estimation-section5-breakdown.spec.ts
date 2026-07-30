import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../estimation.service.js";

const KMS_SECTION5_MDD = `
## 1. Contexto y alcance

KMS corporativo con rotación de claves y aprobación dual.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| POST | /api/v1/crypto/encrypt | Cifrar payload |

\`\`\`json
{ "key_id": "uuid", "plaintext": "..." }
\`\`\`

## 5. Lógica y Edge Cases

Reglas de negocio (formato BDD/AAA)
Dado un usuario con rol admin_security, cuando solicita exportar una clave activa, entonces el sistema crea una solicitud de exportación en estado pendiente.
Dado un certificado SAT cuyo estado es por renovar, cuando el worker ejecuta la tarea programada, entonces el sistema genera un nuevo par de llaves.

Edge cases
Condición de carrera en rotación de claves: solo una solicitud se ejecuta; la segunda recibe HTTP 409.
Idempotencia en operaciones criptográficas: reenvío con idempotency_key devuelve resultado previo.

## 6. Seguridad

Autenticación JWT, RBAC, cifrado envelope con KEK.

## 7. Infraestructura

Docker Compose, PostgreSQL, BullMQ, Redis.
`.trim();

describe("getPrecisionBreakdown — §5 Lógica y Edge Cases", () => {
  const service = new EstimationService(null as never);

  it("§5 sustancial con BDD y edge cases → 100%", () => {
    const breakdown = service.getPrecisionBreakdown(KMS_SECTION5_MDD, { complexity: "HIGH" });
    assert.equal(breakdown.logicaEdgeCases, 100);
    assert.equal(breakdown.sectionReasons?.logicaEdgeCases, undefined);
  });

  it("§5 ausente → 0% con motivo", () => {
    const md = KMS_SECTION5_MDD.replace(/## 5\.[\s\S]*?(?=## 6\.)/, "");
    const breakdown = service.getPrecisionBreakdown(md, { complexity: "HIGH" });
    assert.equal(breakdown.logicaEdgeCases, 0);
    assert.match(breakdown.sectionReasons?.logicaEdgeCases ?? "", /ausente|no detectable/i);
  });

  it("§5 placeholder pipeline → 0%", () => {
    const md = KMS_SECTION5_MDD.replace(
      /## 5\.[\s\S]*?(?=## 6\.)/,
      "## 5. Lógica y Edge Cases\n\n(Pendiente: paso dedicado Lógica y Edge Cases)\n\n",
    );
    const breakdown = service.getPrecisionBreakdown(md, { complexity: "HIGH" });
    assert.equal(breakdown.logicaEdgeCases, 0);
    assert.match(breakdown.sectionReasons?.logicaEdgeCases ?? "", /placeholder/i);
  });

  it("§5 sin BDD ni edge cases explícitos → penaliza", () => {
    const md = `
## 5. Lógica y Edge Cases

El sistema procesa operaciones de cifrado validando roles antes de ejecutar cada solicitud.
Los workers programados revisan certificados próximos a vencer y disparan renovación automática.
Los administradores reciben alertas cuando una rotación falla tras agotar los reintentos configurados.

## 6. Seguridad
JWT.
`.trim();
    const breakdown = service.getPrecisionBreakdown(md, { complexity: "HIGH" });
    assert.equal(breakdown.logicaEdgeCases, 60);
    assert.match(breakdown.sectionReasons?.logicaEdgeCases ?? "", /BDD|edge cases/i);
  });

  it("§5 tras fence ```json abierto en §4 → detectable (no ausente)", () => {
    const md = `
## 4. Contratos de API

### POST /api/v1/crypto/encrypt

\`\`\`json
{ "keyId": "uuid", "plaintext": "..." }

## 5. Lógica y Edge Cases

Reglas de negocio (formato BDD/AAA)
Dado un usuario con rol admin_security, cuando solicita exportar una clave activa, entonces el sistema crea una solicitud de exportación en estado pendiente y notifica a los aprobadores designados.
Dado un certificado SAT cuyo estado es por renovar, cuando el worker ejecuta la tarea programada, entonces genera un nuevo par de llaves y registra la operación en auditoría inmutable.

Edge cases
Condición de carrera en rotación de claves: la segunda solicitud recibe HTTP 409 (Conflicto).
Idempotencia en operaciones criptográficas: reenvío con idempotency_key devuelve resultado previo en caché Redis TTL 24h.

## 6. Seguridad
JWT RS256, RBAC, envelope encryption con KEK corporativa.
`.trim();
    const breakdown = service.getPrecisionBreakdown(md, { complexity: "HIGH" });
    assert.ok(breakdown.logicaEdgeCases >= 85, `expected ≥85 got ${breakdown.logicaEdgeCases}`);
    assert.doesNotMatch(breakdown.sectionReasons?.logicaEdgeCases ?? "", /ausente|no detectable/i);
  });
});
