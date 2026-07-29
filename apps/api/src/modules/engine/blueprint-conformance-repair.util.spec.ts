import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectBlueprintHardQualityGaps,
  injectMissingBlueprintEntities,
  injectMissingBlueprintStackKeywords,
  repairBlueprintProgrammaticGaps,
} from "./blueprint-conformance-repair.util.js";
import { checkBlueprintSelfContained } from "./conformance.service.js";

const MDD = `# MDD

## 2. Arquitectura y Stack

Backend **NestJS** con API REST; frontend **React** (Vite); persistencia **PostgreSQL**; cache **Redis**; contenedores **Docker** y despliegue en VPS.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE orders (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;

describe("blueprint-conformance-repair", () => {
  it("inyecta entidades §3 faltantes como cabeceras ###", () => {
    const bp =
      "## 1. Stack\n\nNestJS + React para el producto. PostgreSQL como base principal.\n\n" +
      "Detalle de módulos y despliegue documentado en secciones siguientes.\n";
    const out = injectMissingBlueprintEntities(MDD, bp);
    assert.match(out, /### orders/);
    assert.match(out, /### users/);
  });

  it("inyecta tecnologías §2 faltantes por nombre", () => {
    const bp =
      "## 1. Stack\n\nNestJS y React en el monorepo. API modular con capas de dominio.\n\n" +
      "Persistencia documentada en la sección de datos.\n";
    const out = injectMissingBlueprintStackKeywords(MDD, bp);
    assert.match(out, /postgresql/i);
    assert.match(out, /redis/i);
    assert.match(out, /docker/i);
  });

  it("repairBlueprintProgrammaticGaps cubre entidades y stack", () => {
    const bp =
      "## 1. Estructura\n\nAPI NestJS con módulos por dominio. Frontend React.\n\n" +
      "Plan de fases y riesgos en secciones dedicadas del documento.\n";
    const out = repairBlueprintProgrammaticGaps(MDD, bp);
    assert.match(out, /### orders/);
    assert.match(out, /Stack MDD §2/);
  });

  it("autocontenido permite metadatos explícito del MDD §N en títulos", () => {
    const bp =
      "## 1. Stack\n\n### Stack técnico (explícito del MDD §2)\n\nNestJS, PostgreSQL.\n";
    const result = checkBlueprintSelfContained(bp);
    assert.equal(result.ok, true, result.gaps.join("; "));
  });

  it("autocontenido sigue bloqueando delegación ver §4 del MDD", () => {
    const bp =
      "## 3. API\n\nLos contratos se listan en ver §4 del MDD para no duplicar.\n";
    const result = checkBlueprintSelfContained(bp);
    assert.equal(result.ok, false);
    assert.ok(result.gaps.length > 0);
  });

  it("autocontenido ignora checklist de cumplimiento al final", () => {
    const bp =
      "## 1. Stack\n\nNestJS.\n\n## Checklist\n\n- Autocontenido: ver §3 del MDD\n";
    const result = checkBlueprintSelfContained(bp);
    assert.equal(result.ok, true, result.gaps.join("; "));
  });

  it("collectBlueprintHardQualityGaps excluye autocontenido del retry", () => {
    const checks = {
      entity: { ok: true, gaps: [] as string[] },
      section: { ok: true, gaps: [] as string[] },
      apiTable: { ok: true, gaps: [] as string[] },
      spanish: { ok: true, gaps: [] as string[] },
      selfContained: { ok: false, gaps: ["delega: ver §4 del MDD"] },
      generalTable: { ok: true, gaps: [] as string[] },
      vsMdd: { ok: true, gaps: [] as string[] },
    };
    assert.equal(collectBlueprintHardQualityGaps(checks).length, 0);
    checks.entity = { ok: false, gaps: ['Entidad "orders" faltante'] };
    assert.equal(collectBlueprintHardQualityGaps(checks).length, 1);
  });
});
