import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichBlueprintWithUiDesignSystem } from "./blueprint-enrich-ui-system.js";

const MDD_WITH_SECTION3 = `# MDD

## 1. Contexto

Producto para inversor y superadmin.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE orders (id UUID PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE settings (id UUID PRIMARY KEY, key TEXT NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /health |
`;

const BASE_BLUEPRINT = `## 1. Visión

Blueprint base sin sección UI.
`;

const PANTALLAS = `# Pantallas — Demo

## Inversor

| Ruta | Página | US | Componentes UI | API principal | Estados |
|------|--------|-----|------------------|---------------|---------|
| /dashboard | DashboardPage | US-001 | DashboardKPI | GET /health | loading, empty |
`;

describe("enrichBlueprintWithUiDesignSystem", () => {
  it("anexa §8 con layout transversal y referencia a pantallas.md", async () => {
    const out = await enrichBlueprintWithUiDesignSystem(MDD_WITH_SECTION3, BASE_BLUEPRINT, undefined, {
      pantallasContent: PANTALLAS,
    });
    assert.match(out, /## 9\. UI Design System & Component Mapping/);
    assert.match(out, /pantallas\.md/);
    assert.match(out, /AppLayout/);
    assert.match(out, /prohibido `GET \/api\/v1\/\{tabla\}` inventado/);
    assert.ok(out.startsWith(BASE_BLUEPRINT.trim()));
  });

  it("sin pantallas.md advierte generar deliverable antes de UI", async () => {
    const out = await enrichBlueprintWithUiDesignSystem(MDD_WITH_SECTION3, BASE_BLUEPRINT);
    assert.match(out, /Genera `pantallas\.md`/);
    assert.match(out, /Entidades §3/);
  });

  it("no duplica §8 si el blueprint ya la incluye", async () => {
    const withSection = `${BASE_BLUEPRINT}\n\n## 9. UI Design System & Component Mapping\n\nExistente.\n`;
    const out = await enrichBlueprintWithUiDesignSystem(MDD_WITH_SECTION3, withSection);
    assert.equal(out, withSection);
  });

  it("usa Tailwind + Radix en §9 cuando el MDD lo declara", async () => {
    const radixMdd = `# MDD

## 1. Contexto

Producto admin.

## 2. Stack

React 18 + Vite + Tailwind + Radix UI.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE orders (id UUID PRIMARY KEY);
\`\`\`
`;
    const out = await enrichBlueprintWithUiDesignSystem(radixMdd, BASE_BLUEPRINT, undefined, {
      pantallasContent: PANTALLAS,
    });
    assert.match(out, /Tailwind \+ Radix UI/);
    assert.ok(!out.includes("shadcn/ui"));
  });
});
