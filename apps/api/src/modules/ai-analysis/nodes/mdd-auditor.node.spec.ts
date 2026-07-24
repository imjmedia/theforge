import { describe, it } from "node:test";
import assert from "node:assert";
import { draftIsSubstantialForScopedRepair } from "../utils/mdd-section-preserve.util.js";
import {
  guardFixTargetAgainstSection5Blockers,
  resolveDeliveryGateFixTargetFromGate,
} from "../utils/mdd-delivery-gate-loop.util.js";

const SUBSTANTIAL_DRAFT = `# MDD
## 1. Contexto
${"Alcance detallado del dominio. ".repeat(80)}
## 2. Arquitectura y Stack
${"NestJS + React + PostgreSQL con colas BullMQ. ".repeat(20)}
## 3. Modelo de Datos
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
## 4. Contratos de API
| POST | /api/v1/orders | Crear pedido |
${"| detalle endpoint ".repeat(40)}
## 5. Lógica y Edge Cases
${"- regla de negocio con detalle suficiente. ".repeat(30)}
## 6. Seguridad
${"JWT RS256 con rotación y rate limit. ".repeat(15)}
## 7. Infraestructura
${"Docker Compose con healthchecks y despliegue. ".repeat(15)}
${"padding para superar 15k chars en draft sustancial. ".repeat(220)}`;

describe("MDD Auditor score-only (sin re-loop Architect desde gaps)", () => {
  it("draft sustancial cumple umbral scoped repair", () => {
    assert.equal(draftIsSubstantialForScopedRepair(SUBSTANTIAL_DRAFT), true);
  });

  it("gate §5 blocker + warnings contratos → fixTarget section5 (gate > auditor gaps)", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (41 chars; mínimo 200).",
    ];
    const warnings = [
      "§4 Contratos de API no tiene endpoints reales con request/response JSON",
    ];
    const fixTarget = resolveDeliveryGateFixTargetFromGate(blockers, warnings, {
      splitArchitectPipeline: true,
    });
    assert.equal(fixTarget, "section5");
  });

  it("guard evita api_contracts mientras §5 sigue bloqueado", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (41 chars; mínimo 200).",
    ];
    assert.equal(
      guardFixTargetAgainstSection5Blockers(blockers, "api_contracts"),
      "section5",
    );
  });

  it("sin blockers §5 no aplica guard aunque warnings mencionen §4", () => {
    const fixTarget = resolveDeliveryGateFixTargetFromGate(
      [],
      ["§4 Contratos de API no tiene endpoints reales con request/response JSON"],
      { splitArchitectPipeline: true },
    );
    assert.equal(fixTarget, "software_architect");
  });
});
