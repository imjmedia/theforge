import { test } from "node:test";
import assert from "node:assert/strict";
import { patchMddFromBrdTraceability } from "./brd-mdd-pre-patch.util.js";
import { computeCrossDocumentConsistency } from "../ai-analysis/estimation/consistency.util.js";

const SAMPLE_BRD = `# BRD — Plataforma de Telemedicina

## 1. Contexto
Plataforma de consulta en línea para pacientes y especialistas.

## 2. Capacidades Funcionales del Producto

### 9 Continuidad de sesión y gestión de incidencias
- Continuidad de sesión tras reconexión de red y gestión de incidencias clínicas con registro auditable.
- Reasignación automática de consulta cuando el especialista sufre desconexión prolongada.

### Reglas de operación
- Penalización por cancelación tardía menor a dos horas antes del inicio programado.
`;

const SAMPLE_MDD_PARTIAL = `# MDD — Plataforma de Telemedicina

## 1. Contexto y Alcance
Sistema de sesiones de videoconsulta para pacientes y especialistas.

## 4. Contratos de API
| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | /api/v1/sessions | Iniciar sesión |

## 5. Lógica de Negocio
- El sistema registra cada sesión creada por un paciente autenticado.
`;

test("patchMddFromBrdTraceability cierra brechas parciales detectadas por computeCrossDocumentConsistency", () => {
  const before = computeCrossDocumentConsistency({
    brdContent: SAMPLE_BRD,
    mddContent: SAMPLE_MDD_PARTIAL,
  });
  assert.ok(before.gaps.length >= 2, `esperaba >= 2 gaps previos, obtuve ${before.gaps.length}`);
  assert.ok(
    before.gaps.some((g) => /continuidad de sesi[oó]n y gesti[oó]n de incidencias/i.test(g.concept)),
    "debe detectar cobertura parcial de la capacidad de continuidad/incidencias",
  );

  const patched = patchMddFromBrdTraceability(SAMPLE_MDD_PARTIAL, SAMPLE_BRD);
  assert.ok(patched.injected.length >= 2, "debe inyectar los conceptos faltantes en §1/§5");

  const after = computeCrossDocumentConsistency({
    brdContent: SAMPLE_BRD,
    mddContent: patched.markdown,
  });
  assert.equal(after.gaps.length, 0, `esperaba 0 gaps tras parchear, quedaron: ${after.gaps.map((g) => g.concept).join("; ")}`);
  assert.equal(after.score, 100);
});
