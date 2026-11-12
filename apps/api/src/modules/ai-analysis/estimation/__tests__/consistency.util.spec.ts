import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCrossDocumentConsistency,
  extractBrdBusinessConcepts,
  extractBrdTraceabilityItems,
  extractMddTraceabilityCorpus,
} from "../consistency.util.js";

describe("extractBrdTraceabilityItems", () => {
  it("extrae capacidades y UAT, no títulos plantilla H3", () => {
    const brd = `## 1. Contexto y Objetivos
### Problema de negocio
Texto.

## 3. Capacidades Funcionales del Producto
### Sincronización de costos reales desde ERP
- Recibir costos reales desde Odoo de forma automática
- Mantener historial auditable de costos

## 5. Reglas de Negocio, Políticas y Fórmulas
### Definición de entidades de negocio
- **Costo Base**: costo de referencia antes de ajustes comerciales
- **Margen Teórico**: porcentaje mínimo exigido por política corporativa

### Fórmulas y umbrales
- Precio de venta = costo ÷ (1 − margen mínimo)
- Bloqueo automático si margen < 15%

### Criterios de aceptación de negocio (UAT)
- Dado un vendedor sin nivel 5, cuando cotice bajo margen mínimo, entonces el sistema bloquea hasta autorización
`;
    const items = extractBrdTraceabilityItems(brd);
    assert.ok(items.some((i) => i.label.includes("sincronización") || i.label.includes("costos reales")));
    assert.ok(items.some((i) => i.kind === "entity" && i.label.includes("Costo Base")));
    assert.ok(items.some((i) => i.kind === "formula" && i.label.includes("Precio de venta")));
    assert.ok(items.some((i) => i.kind === "uat" && i.label.includes("vendedor")));
    assert.equal(items.some((i) => i.label === "Definición de entidades de negocio"), false);
    assert.equal(items.some((i) => i.label === "Fórmulas y umbrales"), false);
  });
});

describe("extractBrdBusinessConcepts", () => {
  it("compat: devuelve labels de ítems trazables", () => {
    const brd = `## 3. Capacidades Funcionales del Producto
### Cotización con control de margen mínimo
- El comercial no puede cotizar por debajo del margen sin autorización de gerencia
`;
    const concepts = extractBrdBusinessConcepts(brd);
    assert.ok(concepts.some((c) => c.includes("comercial") || c.includes("margen")));
    assert.equal(concepts.includes("necesidad"), false);
  });
});

describe("computeCrossDocumentConsistency", () => {
  it("retorna score 50 sin BRD ni Spec", () => {
    assert.equal(computeCrossDocumentConsistency({}).score, 50);
    assert.equal(computeCrossDocumentConsistency({ brdContent: "## Cap\n**x**" }).score, 50);
  });

  it("usa Spec como fuente de trazabilidad cuando no hay BRD (greenfield)", () => {
    const docs = {
      specContent: `## 3. Capacidades Funcionales del Producto
### Gestión de inquilinos multi-empresa
- **Aislar datos por tenant** con RLS en PostgreSQL
`,
      mddContent: `## 1. Contexto y alcance
Plataforma multi-empresa: **aislar datos por tenant** con políticas RLS en PostgreSQL.

## 4. Contratos de API
GET /api/v1/tenants — listar inquilinos

## 5. Lógica y Edge Cases
RLS por tenant_id en todas las tablas de negocio; ningún query sin contexto de tenant.
`,
    };
    const r = computeCrossDocumentConsistency(docs);
    assert.ok(r.score !== null && r.score >= 50);
    if (r.gaps.length > 0) {
      assert.equal(r.gaps[0]?.from, "Spec");
    }
  });

  it("RF-10: ítem BRD presente solo en Spec cuenta como gap (Spec no es destino)", () => {
    const docs = {
      brdContent: `## 3. Capacidades Funcionales del Producto
### Cotización multi-moneda
- **Facturación multi-moneda** con tipos de cambio diarios`,
      specContent: `## Spec
La facturación multi-moneda se documenta aquí para el equipo de producto.`,
      mddContent: `## 1. Contexto
Moneda única MXN.

## 4. Contratos de API
GET /api/health

## 5. Lógica
Healthcheck.
`,
    };
    const r = computeCrossDocumentConsistency(docs);
    const gap = r.gaps.find((g) => /multi-moneda|facturación/i.test(g.concept));
    assert.ok(gap, JSON.stringify(r.gaps));
    assert.equal(gap!.to, "MDD");
  });

  it("detecta cobertura BRD→MDD en §1/§4/§5", () => {
    const docs = {
      brdContent: `## 3. Capacidades Funcionales del Producto
### Cotización con control de margen mínimo
- El comercial no puede cotizar por debajo del margen sin autorización de gerencia
`,
      mddContent: `## 1. Contexto y alcance
Sistema de cotización con control de margen mínimo para comerciales.

## 4. Contratos de API
POST /quotes — crear cotización con validación de margen

## 5. Lógica y Edge Cases
Si margen < umbral, bloquear hasta autorización de gerencia.
`,
    };
    const r = computeCrossDocumentConsistency(docs);
    assert.ok(r.score >= 50);
    assert.ok(r.gaps.every((g) => g.from === "BRD"));
    assert.ok(r.gaps.every((g) => g.to === "MDD"));
  });

  it("marca gap con hint explícito cuando el MDD no refleja la capacidad", () => {
    const docs = {
      brdContent: `## 3. Capacidades Funcionales del Producto
### Soporte multi-moneda en listas de precios
- Cotizar en USD, MXN y EUR con tipo de cambio diario
`,
      mddContent: `## 1. Contexto
Sistema de cotización monolítico en pesos mexicanos.

## 4. Contratos de API
POST /quotes

## 5. Lógica
Validación de margen.
`,
    };
    const r = computeCrossDocumentConsistency(docs);
    const gap = r.gaps.find((g) => g.concept.includes("multi-moneda") || g.concept.includes("USD"));
    assert.ok(gap, `gaps=${JSON.stringify(r.gaps.map((g) => g.concept))}`);
    assert.ok(gap!.hint, `hint missing for ${gap!.concept}`);
    assert.match(gap!.hint!, /§1 Contexto|§4 Contratos|§5 Lógica/i, gap!.hint);
  });

  it("cierra gap «1 Objetivos de negocio» cuando el MDD refleja objetivos en §1", () => {
    const docs = {
      brdContent: `## 3. Capacidades Funcionales del Producto
### 1 Objetivos de negocio
- Eliminar Excel/NAS como fuente de verdad de costos
- Automatizar actualización de costos por evidencia real
`,
      mddContent: `## 1. Contexto
### Objetivos de negocio
| ID | Objetivo |
|----|----------|
| O1 | Eliminar Excel/NAS como SoT de costos |

<!-- trazabilidad BRD→MDD §1 -->
- **Objetivos de negocio** (trazabilidad BRD: Capacidades funcionales): los objetivos de negocio O1–O6 gobiernan el MVP.

## 4. Contratos de API
POST /cost-catalog

## 5. Lógica
Cron de promedio y auditoría Trade.
`,
    };
    const r = computeCrossDocumentConsistency(docs);
    const gap = r.gaps.find((g) => /objetivos de negocio/i.test(g.concept));
    assert.equal(gap, undefined, `gaps=${JSON.stringify(r.gaps.map((g) => g.concept))}`);
    assert.ok(r.score >= 50);
  });

  it("extractMddTraceabilityCorpus prioriza secciones 1, 4 y 5", () => {
    const mdd = `## 1. Contexto
Negocio de márgenes.

## 2. Arquitectura
NestJS

## 4. Contratos de API
POST /x

## 5. Lógica
Reglas

## 7. Infra
Docker
`;
    const corpus = extractMddTraceabilityCorpus(mdd);
    assert.match(corpus, /contexto/i);
    assert.match(corpus, /contratos/i);
    assert.match(corpus, /l[oó]gica/i);
    assert.doesNotMatch(corpus, /docker/i);
  });
});
