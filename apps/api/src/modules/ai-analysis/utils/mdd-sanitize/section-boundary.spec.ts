/**
 * Subsecciones `## N.M` (p. ej. `## 3.1 Esquema SQL`, `## 4.1 Endpoints`) pertenecen a su sección:
 * el cuerpo de §3/§4 debe incluirlas y sólo cortar en `## N.` de otra sección, `## Título` sin número,
 * o H1. Los headings dentro de fences ``` no cortan.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ensureContratosSection, formatAllContratosSectionsInDraft, isContratosSubstantial } from "./contratos-format.js";
import {
  extractSection3Body,
  extractSection4Body,
  findNextCanonicalSectionBoundary,
  validateMddStructure,
} from "./section-merge.js";

const FENCE = "```";
const LONG =
  "Texto descriptivo suficientemente largo para no ser tratado como placeholder en el análisis del dominio.";

/** Documento con §3 y §4 subdivididos en `## N.M`, y §5/§6/§7 canónicas. */
const DOC_WITH_SUBSECTIONS = [
  "# Master Design Document",
  "",
  "## 1. Contexto y alcance",
  LONG,
  "",
  "## 2. Arquitectura y Stack",
  "Backend en NestJS con PostgreSQL como base de datos relacional principal del dominio de pedidos.",
  "",
  "## 3. Modelo de datos",
  "Modelo principal del dominio de pedidos.",
  "",
  "## 3.1 Esquema SQL",
  FENCE + "sql",
  "CREATE TABLE orders (",
  "  id uuid PRIMARY KEY,",
  "  total numeric(12,2) NOT NULL",
  ");",
  FENCE,
  "",
  "## 3.2 Diagrama ER",
  FENCE + "mermaid",
  "erDiagram",
  "  ORDER ||--o{ LINE_ITEM : contiene",
  FENCE,
  "",
  "## 4. Contratos de API",
  "Contratos principales de la API de pedidos.",
  "",
  "## 4.1 Endpoints",
  "| Método | Ruta | Descripción |",
  "|---|---|---|",
  "| GET | /api/v1/orders | Lista pedidos |",
  "| POST | /api/v1/orders | Crea pedido |",
  "| DELETE | /api/v1/orders/{id} | Elimina pedido |",
  "",
  FENCE + "json",
  '{ "id": "uuid" }',
  FENCE,
  "",
  "## 5. Lógica y Edge Cases",
  LONG,
  "",
  "## 6. Seguridad",
  "Autenticación con JWT. SEC_MARKER_6",
  "",
  "## 7. Infraestructura",
  "Docker y Dokploy.",
].join("\n");

describe("findNextCanonicalSectionBoundary", () => {
  it("does not treat ## N.M subsections of the same section as a boundary", () => {
    const text = "intro\n## 3.1 Esquema SQL\nsql\n## 3.2 Diagrama ER\ner";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), -1);
  });

  it("stops at ## N. of another section and returns the index of the preceding newline", () => {
    const text = "intro\n## 3.1 Esquema SQL\nsql\n## 4. Contratos\nx";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), text.indexOf("\n## 4."));
  });

  it("stops at ## N.M when N belongs to another section", () => {
    const text = "intro\n## 4.1 Endpoints\n| GET | /a |";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), text.indexOf("\n## 4.1"));
  });

  it("stops at a repeated bare ## N. of the same section (duplicate heading), not at ## N.M", () => {
    const text = "a\n## 4.1 Endpoints\nb\n## 4. Contratos de API\nc";
    assert.equal(findNextCanonicalSectionBoundary(text, 4), text.indexOf("\n## 4. Contratos"));
  });

  it("stops at an unnumbered ## Título", () => {
    const text = "intro\n## Seguridad\nb";
    assert.equal(findNextCanonicalSectionBoundary(text, 4), text.indexOf("\n## Seguridad"));
  });

  it("stops at a level-1 heading", () => {
    const text = "intro\n# Otro documento\nb";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), text.indexOf("\n# Otro"));
  });

  it("ignores ## N. headings inside a fence", () => {
    const text = "intro\n" + FENCE + "md\n## 4. ejemplo dentro de fence\n" + FENCE + "\nfin";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), -1);
  });

  it("ignores unnumbered and level-1 headings inside a fence", () => {
    const text = "a\n" + FENCE + "\n## Seguridad\n# Título\n" + FENCE + "\nb";
    assert.equal(findNextCanonicalSectionBoundary(text, 3), -1);
  });

  it("ignores ### sub-headings", () => {
    assert.equal(findNextCanonicalSectionBoundary("a\n### Sub\nb", 3), -1);
  });

  it("with an unknown section number, any ## heading is a boundary (legacy behaviour)", () => {
    const text = "a\n## 3.1 X";
    assert.equal(findNextCanonicalSectionBoundary(text, null), text.indexOf("\n## 3.1"));
  });
});

describe("§3 / §4 bodies with ## N.M subsections", () => {
  it("extractSection3Body includes §3.1 SQL and §3.2 ER, and stops before ## 4.", () => {
    const body = extractSection3Body(DOC_WITH_SUBSECTIONS);
    assert.ok(body, "§3 body must exist");
    assert.match(body, /CREATE TABLE orders/);
    assert.match(body, /erDiagram/);
    assert.match(body, /Modelo principal del dominio/);
    assert.doesNotMatch(body, /Contratos principales/);
    assert.doesNotMatch(body, /\| GET \| \/api\/v1\/orders/);
  });

  it("extractSection3Body does not cut at a ## 4. heading that lives inside a fence", () => {
    const doc = [
      "## 3. Modelo de datos",
      FENCE + "sql",
      "-- ejemplo",
      "## 4. Falso dentro de fence",
      FENCE,
      "CREATE TABLE x (id int);",
      "## 4. Contratos de API",
      "Contratos reales.",
    ].join("\n");
    const body = extractSection3Body(doc);
    assert.ok(body);
    assert.match(body, /CREATE TABLE x/);
    assert.doesNotMatch(body, /Contratos reales/);
  });

  it("extractSection3Body stops at an unnumbered ## Seguridad", () => {
    const doc = ["## 3. Modelo de datos", "CREATE TABLE y (id int);", "## Seguridad", "SEC_MARKER"].join("\n");
    const body = extractSection3Body(doc);
    assert.ok(body);
    assert.match(body, /CREATE TABLE y/);
    assert.doesNotMatch(body, /SEC_MARKER/);
  });

  it("extractSection4Body includes §4.1 endpoints and stops before ## 5. / ## 6.", () => {
    const body = extractSection4Body(DOC_WITH_SUBSECTIONS);
    assert.ok(body, "§4 body must exist");
    assert.match(body, /\| GET \| \/api\/v1\/orders/);
    assert.match(body, /```json/);
    assert.match(body, /Contratos principales/);
    assert.doesNotMatch(body, /Lógica y Edge Cases/);
    assert.doesNotMatch(body, /SEC_MARKER_6/);
  });

  it("isContratosSubstantial is true when the endpoints only live in §4.1", () => {
    assert.equal(isContratosSubstantial(extractSection4Body(DOC_WITH_SUBSECTIONS)), true);
  });

  it("validateMddStructure sees §3 payloads through §3.1/§4.1 subsections", () => {
    const result = validateMddStructure(DOC_WITH_SUBSECTIONS);
    assert.equal(result.section3HasPayloads, true);
    assert.deepEqual(result.missingSections, []);
    assert.equal(result.sectionOrderCorrect, true);
  });

  it("validateMddStructure keeps section order when §3 has only ## 3.x subsections (no intro)", () => {
    const doc = [
      "# Master Design Document",
      "## 1. Contexto y alcance",
      LONG,
      "## 2. Arquitectura y Stack",
      "Backend NestJS con PostgreSQL para el dominio de pedidos y su despliegue en contenedores.",
      "## 3. Modelo de datos",
      "## 3.1 Esquema SQL",
      FENCE + "sql",
      "CREATE TABLE orders (id uuid PRIMARY KEY);",
      FENCE,
      "## 4. Contratos de API",
      "Contratos de la API de pedidos con su detalle completo en la tabla siguiente.",
      "## 5. Lógica y Edge Cases",
      LONG,
      "## 6. Seguridad",
      LONG,
      "## 7. Infraestructura",
      LONG,
    ].join("\n");
    const result = validateMddStructure(doc);
    assert.equal(result.sectionOrderCorrect, true);
  });
});

describe("ensureContratosSection with ## N.M subsections", () => {
  it("replaces only the Pendiente stub and keeps §4.1 endpoints and §5 intact", () => {
    const doc = [
      "## 3. Modelo de datos",
      LONG,
      "## 4. Contratos de API",
      "(Pendiente: definir endpoints con request/response)",
      "",
      "## 4.1 Endpoints",
      "| GET | /api/v1/orders | Lista pedidos |",
      "",
      "## 5. Lógica y Edge Cases",
      LONG,
    ].join("\n");
    const out = ensureContratosSection(doc);
    assert.doesNotMatch(out, /Pendiente: definir endpoints/);
    assert.match(out, /\(Falta: definir endpoints/);
    assert.match(out, /## 4\.1 Endpoints/);
    assert.match(out, /\| GET \| \/api\/v1\/orders \| Lista pedidos \|/);
    assert.match(out, /## 5\. Lógica y Edge Cases/);
  });

  it("does not cut §4 at an unnumbered ## Seguridad when §4 has subsections", () => {
    const doc = [
      "## 4. Contratos de API",
      "(Pendiente: definir endpoints)",
      "## 4.1 Endpoints",
      "| POST | /api/v1/orders | Crea pedido |",
      "## Seguridad",
      "SEC_MARKER_STUB",
    ].join("\n");
    const out = ensureContratosSection(doc);
    assert.match(out, /\| POST \| \/api\/v1\/orders/);
    assert.match(out, /SEC_MARKER_STUB/);
  });

  it("returns the draft unchanged when §4 with subsections already has real content", () => {
    assert.equal(ensureContratosSection(DOC_WITH_SUBSECTIONS), DOC_WITH_SUBSECTIONS);
  });
});

describe("formatAllContratosSectionsInDraft with ## N.M subsections", () => {
  it("keeps §4.1 endpoints inside the formatted section and does not swallow §5", () => {
    const out = formatAllContratosSectionsInDraft(DOC_WITH_SUBSECTIONS);
    assert.match(out, /## 4\.1 Endpoints/);
    assert.match(out, /\/api\/v1\/orders/);
    assert.match(out, /## 5\. Lógica y Edge Cases/);
    assert.match(out, /SEC_MARKER_6/);
  });
});
