import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeMddBySection, parseMddBySection } from "./mdd-section-merge.util.js";

const fullMdd = `# MDD — Test

---

## 1. Contexto
Lorem ipsum §1 contenido largo con muchos detalles que no se deben perder al hacer merge.
Más texto §1 para que tenga tamaño suficiente y dispare la heurística de truncado.

## 2. Stack
Backend: NestJS
Frontend: React

## 3. Modelo de Datos
Tabla tenants
Tabla licenses

## 4. Contratos de API
GET /health
POST /tenants

## 5. Seguridad
Argon2id
JWT RS256`;

describe("parseMddBySection", () => {
  it("devuelve front matter + secciones para un MDD estándar", () => {
    const md = `# Master Design Document — Foo

> intro
---

## 1. Contexto
texto contexto

## 2. Stack
texto stack
`;
    const r = parseMddBySection(md);
    assert.deepEqual(r.sections.map((s) => s.heading), ["## 1. Contexto", "## 2. Stack"]);
    assert.ok(r.frontMatter.includes("# Master Design Document"));
  });

  it("ignora ## dentro de code fences", () => {
    const md = `## 1. Real
\`\`\`
## 2. Falso (dentro de fence)
\`\`\`

## 3. Real otra vez
`;
    const r = parseMddBySection(md);
    assert.deepEqual(r.sections.map((s) => s.heading), ["## 1. Real", "## 3. Real otra vez"]);
  });

  it("tolera null/undefined", () => {
    assert.deepEqual(parseMddBySection(null).sections, []);
    assert.deepEqual(parseMddBySection(undefined).sections, []);
  });
});

describe("mergeMddBySection — PR #502 (incoming shrunk vs full-replace)", () => {
  it("incoming shrink (< 70% de existing) cae a section-merge preservando existing", () => {
    // Incoming tiene las 5 secciones pero cada sección es muy corta (~10 chars).
    // Existing ~700 chars con sustancia. Ratio incoming/existing = ~50/700 = 7%.
    const incoming = `# MDD regenerado corto
## 1. Contexto
xx
## 2. Stack
xx
## 3. Modelo de Datos
xx
## 4. Contratos de API
xx
## 5. Seguridad
xx
`;
    const r = mergeMddBySection(fullMdd, incoming);
    assert.equal(r.stats.mode, "section-merge");
    // existing tiene §4 "Contratos de API"; incoming tiene §4 "Contratos de API" (mismo heading).
    // La heurística per-sección incomingBodyLen * 5 < existingBodyLen de §4
    // (incoming 2 chars * 5 = 10 < existing 30 chars) → keep existing.
    assert.ok(r.content.includes("GET /health"), "§4 existing content preservado");
    assert.ok(r.content.includes("Lorem ipsum §1") || r.content.includes("Lorem ipsum"), "§1 contenido preservado");
  });

  it("incoming con contenido ≥ 70% de existing → section-merge preserva existing bueno", () => {
    // PR #503: full-replace eliminado. Siempre section-merge para preservar
    // contenido bueno de iter 1. La heurística per-sección de 20% protege
    // contra placeholders vacíos, y las secciones nuevas de incoming se
    // añaden al final.
    const incoming = `# MDD regenerado similar
## 1. Contexto
Lorem ipsum regenerated §1 con más detalles que el original para que el contenido tenga tamaño similar y dispare la heurística correcta de full-replace.
Más texto §1 para que tenga tamaño suficiente y dispare la heurística de regenerado.
## 2. Stack
Backend: NestJS. Frontend: React. Pagos: Stripe. Más cosas para alargar.
## 3. Modelo de Datos
Tabla tenants. Tabla licenses. Tabla payments. Tabla subscriptions. Indexes únicos.
## 4. Contratos de API
GET /health. POST /tenants. PATCH /tenants/:id. DELETE /tenants/:id. GET /licenses.
## 5. Seguridad
Argon2id. JWT RS256. Rotación de claves. Política de contraseñas. Auditoría continua.
`;
    const r = mergeMddBySection(fullMdd, incoming);
    // full-replace eliminado → siempre section-merge cuando existing no vacío
    assert.equal(r.stats.mode, "section-merge");
    // Las secciones de incoming reemplazan a existing sección por sección
    // (porque cada una tiene ≥ 20% de su contraparte, no hay placeholder vacío).
    assert.ok(r.stats.sectionsReplaced.length > 0, "secciones de incoming integradas");
    // El contenido de existing se mantiene en las secciones donde incoming
    // no aporta (defensa ante regeneraciones que solo tocan algunos campos).
    assert.ok(r.content.includes("Debe tener tamaño suficiente") || r.content.includes("regenerado"));
  });

  it("incoming vacío → keep existing", () => {
    const r = mergeMddBySection(fullMdd, "");
    assert.equal(r.stats.mode, "keep-existing");
    assert.equal(r.content, fullMdd);
  });

  it("incoming cubre > 50% de existing pero sigue < 70% → forzado a section-merge", () => {
    // 5 secciones, ~40 chars cada una = 200 chars. Existing ~700. Ratio 28%.
    const incoming = `# MDD
## 1. Contexto
Lorem ipsum regenerated §1 con más detalles que el original.
## 2. Stack
Backend: NestJS. Frontend: React.
## 3. Modelo de Datos
Tabla tenants. Tabla licenses.
## 4. Contratos de API
GET /health. POST /tenants.
## 5. Seguridad
Argon2id. JWT RS256.
`;
    const r = mergeMddBySection(fullMdd, incoming);
    // incoming shrunk (~40% de existing) → section-merge, no full-replace
    assert.equal(r.stats.mode, "section-merge");
  });

  it("§4: incoming sustancial reemplaza existing con stub Falta+tabla (ratio <20%)", () => {
    const existing = `# MDD
## 1. Contexto
Contexto del proyecto con suficiente detalle para pruebas de merge.

## 2. Arquitectura y Stack
NestJS y PostgreSQL.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE tenants (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco; en la siguiente iteración se deben completar los contratos.)

| Método | Ruta | Descripción |
| GET | /api/v1/strategies | list |
| POST | /api/v1/strategies | create |
${"| GET | /api/v1/extra | filler |\n".repeat(30)}

## 5. Lógica y Edge Cases
Reglas BDD.

## 6. Seguridad
JWT.

## 7. Infraestructura
Docker.
`;
    const incoming = existing.replace(
      /## 4\. Contratos de API[\s\S]*?(?=## 5\.)/,
      `## 4. Contratos de API

### POST /api/v1/auth/login

\`\`\`json
{"email":"a@b.c","password":"secret"}
\`\`\`

### GET /api/v1/portfolios

\`\`\`json
{"items":[]}
\`\`\`

`,
    );
    const r = mergeMddBySection(existing, incoming);
    assert.ok(r.stats.sectionsReplaced.some((h) => h.includes("4. Contratos")));
    assert.match(r.content, /POST \/api\/v1\/auth\/login/);
    assert.doesNotMatch(r.content, /Falta: definir endpoints/i);
  });
});
