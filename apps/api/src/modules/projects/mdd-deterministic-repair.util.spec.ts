import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDeterministicMddRepairs,
  prepareMddForDeliveryGateValidation,
} from "./mdd-deterministic-repair.util.js";
import { validateMddForDelivery } from "../ai-analysis/utils/mdd-delivery-gate.util.js";

describe("prepareMddForDeliveryGateValidation", () => {
  it("inyecta entidades de inventario en §3 (agnóstico de dominio)", () => {
    const brd = `
## 1. Contexto
Plataforma de pedidos B2B con líneas de pedido y calendarios de pago.

## 3. Definición de entidades de negocio
- order_lines
- payment_schedules
`;
    const mdd = `
## 1. Contexto
SaaS.

## 3. Modelo de Datos
CREATE TABLE users (id UUID PRIMARY KEY);

## 4. Contratos de API
| GET | /api/v1/users | List users |

## 5. Lógica y Edge Cases
Reglas básicas.

## 6. Seguridad
JWT.

## 7. Infraestructura
### Manifest
\`\`\`json
{"stack":{"runtime":"node","security":{"hashing_algorithm":"Argon2id"}}}
\`\`\`
`;
    const prepared = prepareMddForDeliveryGateValidation(mdd, { brdMarkdown: brd });
    assert.match(prepared.markdown, /CREATE TABLE order_lines/i);
    assert.match(prepared.markdown, /CREATE TABLE payment_schedules/i);
    assert.equal(prepared.changed, true);
  });

  it("parchea permisos BRD y el gate no bloquea por trazabilidad", () => {
    const brd = `## 1. Contexto y Objetivos
Plataforma con cumplimiento regulatorio.

## 5. Reglas de Negocio, Políticas y Fórmulas
### Matriz de permisos
| Capacidad | Admin | Comercial |
| Aprobar descuento excepcional sin gerencia | Sí | No |
`;
    const mdd = `
## 1. Contexto
Sistema.

## 2. Arquitectura y Stack
NestJS + Postgres.

## 3. Modelo de Datos
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API
| GET | /api/v1/orders | List orders |
\`\`\`json
{"200":{"type":"array"}}
\`\`\`

## 5. Lógica y Edge Cases
Reglas estándar.

## 6. Seguridad
JWT Bearer.

## 7. Infraestructura
### Manifest
\`\`\`json
{"stack":{"runtime":"node","security":{"hashing_algorithm":"Argon2id"}}}
\`\`\`
`;
    const gate = validateMddForDelivery(mdd, { brdMarkdown: brd });
    const traceBlockers = gate.blockers.filter((b) => b.includes("brd-mdd-traceability"));
    assert.equal(traceBlockers.length, 0, `trace blockers: ${traceBlockers.join("; ")}`);
    const traceWarnings = gate.warnings.filter((w) => w.includes("brd-mdd-traceability"));
    assert.ok(
      traceWarnings.length === 0 || gate.warnings.some((w) => /BRD sin traza/i.test(w)),
      "trazabilidad residual va a warnings, no blockers",
    );
  });
});

describe("applyDeterministicMddRepairs", () => {
  it("idempotente cuando no hay contexto BRD", () => {
    const mdd = "## 1. Contexto\n\nTexto.";
    const r = applyDeterministicMddRepairs(mdd, {});
    assert.equal(r.changed, false);
  });
});
