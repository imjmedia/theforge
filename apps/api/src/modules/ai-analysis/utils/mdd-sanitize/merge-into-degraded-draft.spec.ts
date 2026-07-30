import { describe, it } from "node:test";
import assert from "node:assert";
import {
  replaceArquitecturaSectionBody,
  replaceMddSection3Body,
  replaceMddSection4Body,
  extractArquitecturaSectionBody,
  extractSection3Body,
} from "./section-merge.js";
import { extractContratosSectionBody } from "./contratos-format.js";

/**
 * Job 81: el Clarificador devolvió JSON inválido, así que el borrador quedó sin headings
 * canónicos (solo el bloque de gobernanza). Cada merge del Arquitecto devolvía el draft
 * intacto —logueando `merged=true`— y 7k/14k/23k chars de §2/§3/§4 se evaporaban: el draft
 * seguía en ~3.2k. La sección ausente debe insertarse, no descartarse.
 */
const DEGRADED_DRAFT = `# Master Design Document

---

## [ARQUITECTURA - SECCIÓN INMUTABLE] CONFIGURACIÓN DE PATRONES DE DESARROLLO

> ### 🚨 NOTA DE SISTEMA PARA AGENTES DE IA (PROHIBIDO ELIMINAR O MODIFICAR)
> Esta sección define patrones obligatorios.
`;

describe("merge sobre borrador degradado sin headings canónicos", () => {
  it("§2 se inserta cuando el heading no existe", () => {
    const body = `### 2.1 Estrategia general\n\n${"El KMS se despliega como monolito modular. ".repeat(20)}`;
    const out = replaceArquitecturaSectionBody(DEGRADED_DRAFT, body);

    assert.notEqual(out, DEGRADED_DRAFT, "el merge no puede ser un no-op silencioso");
    assert.match(out, /^## 2\. Arquitectura y Stack/m);
    const extracted = extractArquitecturaSectionBody(out);
    assert.ok(extracted != null && extracted.length > 200, "§2 debe quedar sustancial");
    assert.match(extracted!, /Estrategia general/);
    // El bloque inmutable de gobernanza sobrevive.
    assert.match(out, /SECCIÓN INMUTABLE/);
  });

  it("§3 y §4 también se insertan y quedan en orden canónico", () => {
    const s3 = `\`\`\`sql\nCREATE TABLE keys (id UUID PRIMARY KEY);\n\`\`\`\n\n${"Detalle del modelo. ".repeat(20)}`;
    const s4 = `### GET /api/v1/keys\n\n${"Contrato del endpoint. ".repeat(20)}`;

    let out = replaceMddSection4Body(DEGRADED_DRAFT, s4);
    out = replaceMddSection3Body(out, s3);

    const s3Body = extractSection3Body(out);
    const s4Body = extractContratosSectionBody(out);
    assert.ok(s3Body != null && s3Body.length > 200, "§3 debe quedar sustancial");
    assert.ok(s4Body != null && s4Body.length > 200, "§4 debe quedar sustancial");
    assert.match(s3Body!, /CREATE TABLE keys/);
    assert.match(s4Body!, /GET \/api\/v1\/keys/);

    // §3 debe preceder a §4 aunque se insertaran en orden inverso.
    const i3 = out.search(/^## 3\. Modelo de Datos/m);
    const i4 = out.search(/^## 4\. Contratos de API/m);
    assert.ok(i3 !== -1 && i4 !== -1);
    assert.ok(i3 < i4, `§3 debe ir antes que §4 (i3=${i3} i4=${i4})`);
  });

  it("con el heading presente sigue reemplazando, no duplicando", () => {
    const draft = `# Master Design Document

## 2. Arquitectura y Stack

(Pendiente: Arquitecto de Software)

## 3. Modelo de Datos

Contenido previo.
`;
    const body = `### 2.1 Stack\n\n${"Node.js 20 LTS con NestJS. ".repeat(20)}`;
    const out = replaceArquitecturaSectionBody(draft, body);

    assert.equal(
      (out.match(/^## 2\. Arquitectura y Stack/gm) ?? []).length,
      1,
      "no debe duplicar el heading §2",
    );
    assert.doesNotMatch(out, /Pendiente: Arquitecto de Software/);
    assert.match(out, /## 3\. Modelo de Datos/);
    assert.match(out, /Contenido previo/);
  });
});
