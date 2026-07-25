import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateBrdToMddTraceability,
  hasBrdToMddTraceabilityBlockers,
} from "../brd-mdd-traceability.util.js";

describe("brd-mdd-traceability.util", () => {
  it("detecta permiso BRD ausente en MDD como blocker", () => {
    const brd = `## 1. Contexto y Objetivos
Plataforma de ventas institucional con cumplimiento regulatorio SEC Reg BI y trazabilidad completa de operaciones.

## 5. Reglas de Negocio, Políticas y Fórmulas
### Matriz de permisos
| Capacidad | Admin | Comercial |
| Aprobar descuento excepcional sin gerencia | Sí | No |
| Liquidar posición forzada por riesgo | Sí | No |
`;
    const mdd = `## 1. Contexto
Sistema de ventas.

## 4. Contratos de API
GET /api/v1/orders

## 5. Lógica
Reglas de cotización estándar.
`;
    const r = evaluateBrdToMddTraceability(brd, mdd);
    assert.ok(r.missingGaps.length > 0 || r.blockers.length > 0);
    assert.equal(hasBrdToMddTraceabilityBlockers(brd, mdd), true);
    assert.ok(r.blockers[0]?.includes("brd-mdd-traceability:"));
  });

  it("sin BRD sustancial no emite blockers", () => {
    const r = evaluateBrdToMddTraceability("## Corto", "## 1. Contexto\nx");
    assert.equal(r.blockers.length, 0);
    assert.equal(hasBrdToMddTraceabilityBlockers("## Corto", "## 1. Contexto\nx"), false);
  });
});
