/**
 * Fronteras de sección en `section-fence.util.ts`: `getSectionBody` debe incluir los subencabezados
 * `## N.M` de la sección N y cortar sólo en otra sección, en `## Título` sin número o en H1.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSectionBody,
  indexOfNextH2OutsideFenced,
  indexOfNextSectionBoundaryOutsideFenced,
} from "./section-fence.util.js";

const RE_SECTION3 = /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i;
const RE_SECTION5 = /##\s*5\.\s*L[oó]gica\s+y\s*Edge\s*Cases/i;

describe("getSectionBody con subencabezados ## N.M", () => {
  it("§3 con ## 3.1 y ## 3.2 devuelve el cuerpo completo incluido el SQL", () => {
    const doc = [
      "# Master Design Document",
      "## 1. Contexto",
      "Contexto del dominio.",
      "## 2. Arquitectura",
      "Stack NestJS.",
      "## 3. Modelo de datos",
      "Intro del modelo.",
      "## 3.1 Esquema SQL",
      "```sql",
      "CREATE TABLE orders (id uuid PRIMARY KEY);",
      "```",
      "## 3.2 Diagrama ER",
      "```mermaid",
      "erDiagram",
      "```",
      "## 4. Contratos de API",
      "Endpoints de la API.",
    ].join("\n");

    const body = getSectionBody(doc, RE_SECTION3);
    assert.ok(body);
    assert.ok(body.includes("Intro del modelo."));
    assert.ok(body.includes("## 3.1 Esquema SQL"));
    assert.ok(body.includes("CREATE TABLE orders"));
    assert.ok(body.includes("## 3.2 Diagrama ER"));
    assert.ok(body.includes("erDiagram"));
    assert.ok(!body.includes("Endpoints de la API."));
  });

  it("## 4. termina §3", () => {
    const doc = ["## 3. Modelo de datos", "tablas", "## 4. Contratos de API", "endpoints"].join("\n");
    assert.equal(getSectionBody(doc, RE_SECTION3), "tablas");
  });

  it("un ## 4.1 también termina §3 (es otra sección)", () => {
    const doc = ["## 3. Modelo de datos", "tablas", "## 4.1 Endpoints", "endpoints"].join("\n");
    assert.equal(getSectionBody(doc, RE_SECTION3), "tablas");
  });

  it("## Seguridad (sin número) termina §5 y ## 5.1 queda dentro de §5", () => {
    const doc = [
      "## 5. Lógica y Edge Cases",
      "Regla principal.",
      "## 5.1 Reglas de negocio",
      "Regla detallada.",
      "## Seguridad",
      "Texto de seguridad.",
    ].join("\n");

    const body = getSectionBody(doc, RE_SECTION5);
    assert.ok(body);
    assert.ok(body.includes("Regla detallada."));
    assert.ok(!body.includes("Texto de seguridad."));
  });

  it("un ## 4. dentro de un fence ```sql no corta §3", () => {
    const doc = [
      "## 3. Modelo de datos",
      "```sql",
      "CREATE TABLE a (id int);",
      "## 4. Dentro del fence",
      "CREATE TABLE b (id int);",
      "```",
      "Texto después del fence.",
      "## 4. Contratos de API",
      "endpoints",
    ].join("\n");

    const body = getSectionBody(doc, RE_SECTION3);
    assert.ok(body);
    assert.ok(body.includes("## 4. Dentro del fence"));
    assert.ok(body.includes("Texto después del fence."));
    assert.ok(!body.includes("endpoints"));
  });

  it("un ## 3. repetido termina la primera §3", () => {
    const doc = [
      "## 3. Modelo de datos",
      "primero",
      "## 3. Modelo de datos (repetido)",
      "segundo",
    ].join("\n");
    assert.equal(getSectionBody(doc, RE_SECTION3), "primero");
  });

  it("heading sin número conserva el comportamiento anterior (corta en cualquier ##)", () => {
    const doc = ["## Seguridad", "seguridad texto", "## 3.1 Algo", "sub"].join("\n");
    assert.equal(getSectionBody(doc, /##\s*Seguridad/i), "seguridad texto");
  });

  it("devuelve null si el heading no aparece o el cuerpo está vacío", () => {
    assert.equal(getSectionBody("## 1. Contexto\ntexto", RE_SECTION3), null);
    assert.equal(getSectionBody("## 3. Modelo de datos\n## 4. Contratos", RE_SECTION3), null);
  });
});

describe("indexOfNextSectionBoundaryOutsideFenced", () => {
  it("devuelve -1 si no hay frontera, y el índice del \\n previo a la frontera si la hay", () => {
    const text = "## 3. A\nx\n## 3.1 B\ny\n# Otro\nz";
    const from = text.indexOf("x");
    assert.equal(indexOfNextSectionBoundaryOutsideFenced(text, from, 3), text.indexOf("\n# Otro"));
    assert.equal(indexOfNextSectionBoundaryOutsideFenced("## 3. A\nx\n## 3.1 B\ny", 0, 3), -1);
  });

  it("con n = null coincide con indexOfNextH2OutsideFenced", () => {
    const text = "## 3. A\n```sql\n## 4. dentro\n```\nx\n## 3.1 B\ny";
    const from = text.indexOf("A") + 1;
    assert.equal(
      indexOfNextSectionBoundaryOutsideFenced(text, from, null),
      indexOfNextH2OutsideFenced(text, from),
    );
  });
});

describe("indexOfNextH2OutsideFenced (sin cambios)", () => {
  it("sigue cortando en cualquier ## fuera de fences, incluido ## 3.1", () => {
    const text = "## 3. A\nx\n## 3.1 B\ny";
    assert.equal(indexOfNextH2OutsideFenced(text, 0), text.indexOf("\n## 3.1"));
  });
});
