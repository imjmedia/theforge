import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildMddDeliveryGateConflictBody,
  evaluateMddDeliveryGatePrepared,
  MDD_DELIVERY_GATE_ERR,
} from "./mdd-delivery-gate-guard.util.js";
import {
  mergeDeliveryGateIntoShortTermContext,
  readDeliveryGateSnapshot,
} from "./mdd-delivery-gate.util.js";

const VALID_MDD = `# Master Design Document

## 1. Contexto

Producto de exportación controlada con aprobación dual para cumplir políticas de compliance interno.
El MVP cubre solicitudes de exportación, flujo de aprobación en dos etapas, auditoría en security_events
y notificaciones al solicitante cuando la exportación es aprobada o rechazada con motivo trazable.

## 2. Arquitectura y Stack

Backend NestJS 10 sobre Node 20 LTS, PostgreSQL 16 con RLS multi-tenant, Redis para colas BullMQ,
API REST versionada bajo /api/v1, despliegue Docker Compose en VPS dedicado con healthchecks activos.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE TABLE security_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| POST | /auth/login | Inicio de sesión |

\`\`\`json
{ "email": "user@example.com", "password": "secret" }
\`\`\`

\`\`\`json
{ "accessToken": "jwt", "refreshToken": "rt" }
\`\`\`

## 5. Lógica y Edge Cases

Dado un usuario autenticado cuando solicita exportación entonces requiere aprobación dual.
Si el primer aprobador rechaza, la solicitud queda cerrada sin pasar al segundo aprobador.
Los intentos fallidos de login se registran en security_events con IP y user agent para auditoría.

## 6. Seguridad

Argon2id para hashing de contraseñas; intentos fallidos en security_events; JWT de acceso 15 min
y refresh rotativo; MFA TOTP opcional para roles admin; re-prompt MFA en acciones críticas de exportación.
Política de bloqueo progresivo tras cinco intentos fallidos en ventana de quince minutos.

## 7. Infraestructura

### Manifest de Infraestructura

\`\`\`json
{
  "stack": {
    "runtime": "node:20-alpine",
    "database": { "engine": "postgresql@16" },
    "security": { "hashing_algorithm": "Argon2id" }
  }
}
\`\`\`

Despliegue Docker Compose con PostgreSQL y Redis para colas BullMQ.
`;

describe("evaluateMddDeliveryGatePrepared", () => {
  it("aprueba MDD válido tras pipeline determinista", async () => {
    const gate = await evaluateMddDeliveryGatePrepared(VALID_MDD);
    assert.equal(gate.ok, true);
    assert.equal(gate.blockers.length, 0);
  });

  it("bloquea MDD incompleto", async () => {
    const gate = await evaluateMddDeliveryGatePrepared("## 1. Contexto\n\nIncompleto.");
    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.length > 0);
  });
});

describe("buildMddDeliveryGateConflictBody", () => {
  it("expone code ERR_MDD_DELIVERY_GATE y blockers en español", async () => {
    const gate = await evaluateMddDeliveryGatePrepared("## 1. Contexto\n\nIncompleto.");
    const body = buildMddDeliveryGateConflictBody(gate);
    assert.equal(body.code, MDD_DELIVERY_GATE_ERR);
    assert.ok(body.message.length > 0);
    assert.equal(body.deliveryGate.ok, false);
    assert.ok(body.deliveryGate.blockers.length > 0);
  });
});

describe("deliveryGate snapshot helpers", () => {
  it("merge y read round-trip en shortTermContext", async () => {
    const gate = await evaluateMddDeliveryGatePrepared(VALID_MDD);
    const merged = mergeDeliveryGateIntoShortTermContext({ mddAuditSnapshot: { x: 1 } }, gate);
    assert.ok(merged.mddAuditSnapshot);
    const read = readDeliveryGateSnapshot(merged);
    assert.ok(read);
    assert.equal(read.ok, gate.ok);
    assert.equal(read.score, gate.score);
    assert.ok(read.updatedAt.length > 0);
  });
});
