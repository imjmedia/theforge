import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairGluedMarkdownHeadings } from "@theforge/shared-types";
import {
  demoteCanonicalSectionHeadingsInSection1Body,
  isContextSynthesizerBodySubstantial,
  MIN_SECTION1_REGEN_BODY_LENGTH,
  normalizeContextSynthesizerBody,
  peelContextSynthesizerLlmOutput,
  resolveUpstreamSyncSection1Body,
} from "./mdd-section1-regen.util.js";
import {
  extractContextSectionBody,
  replaceSection1BodyFromAnyHeading,
  deduplicateAndReorderMddSections,
} from "./mdd-sanitize/section-merge.js";

const LONG_CONTEXTO =
  "El sistema gestiona rotación de certificados X.509 para cuentas de servicio corporativas. " +
  "Audiencia: operadores de seguridad e integración. Alcance: API NestJS + LDAP/JWT, colas BullMQ " +
  "para renovación y alertas; fuera de alcance: portal web de autoservicio y emisión de CA raíz.";

describe("normalizeContextSynthesizerBody", () => {
  it("acepta prosa sola (salida canónica del sintetizador)", () => {
    const r = normalizeContextSynthesizerBody(LONG_CONTEXTO);
    assert.equal(r.fromFullMddDump, false);
    assert.ok(r.body.length >= MIN_SECTION1_REGEN_BODY_LENGTH);
    assert.equal(r.body, LONG_CONTEXTO);
    assert.equal(isContextSynthesizerBodySubstantial(r.body), true);
  });

  it("trunca volcado con §1 corto + ## 2 (bug deepseek)", () => {
    const dump =
      "Resumen breve.\n\n## 2. Arquitectura y Stack\n\n| Runtime | Node |\n\n## 3. Modelo de Datos\n\nSQL";
    const r = normalizeContextSynthesizerBody(dump);
    assert.equal(r.truncatedAtOtherSection, true);
    assert.ok(r.body.length < 40, `body=${JSON.stringify(r.body)}`);
    assert.equal(isContextSynthesizerBodySubstantial(r.body), false);
  });

  it("extrae §1 sustancial de MDD completo volcado", () => {
    const dump = `# Master Design Document

## 1. Contexto

${LONG_CONTEXTO}

## 2. Arquitectura y Stack

| Runtime | Node |
`;
    const r = normalizeContextSynthesizerBody(dump);
    assert.equal(r.fromFullMddDump, true);
    assert.ok(isContextSynthesizerBodySubstantial(r.body));
    assert.match(r.body, /certificados X\.509/);
    assert.doesNotMatch(r.body, /## 2/);
  });

  it("rechaza solo HR / fragmento de título", () => {
    assert.equal(isContextSynthesizerBodySubstantial("---"), false);
    assert.equal(isContextSynthesizerBodySubstantial("y Alcance del MDD."), false);
    const r = normalizeContextSynthesizerBody("---\n\ny Alcance del MDD.\n");
    assert.equal(isContextSynthesizerBodySubstantial(r.body), false);
  });

  it("peel ligero no destruye prosa sin stamp", () => {
    const out = peelContextSynthesizerLlmOutput(LONG_CONTEXTO);
    assert.equal(out, LONG_CONTEXTO);
  });

  it("demote línea bare 2. Arquitectura para que prepare no parta §1", () => {
    const raw =
      LONG_CONTEXTO.slice(0, 80) +
      "\n\n2. Arquitectura y Stack\n\n" +
      "Más prosa del contexto que debe sobrevivir al dedupe del prepare-output.";
    const r = normalizeContextSynthesizerBody(raw);
    assert.doesNotMatch(r.body, /^2\. Arquitectura/m);
    assert.match(r.body, /\*\*2\. Arquitectura y Stack\*\*/);
    assert.match(r.body, /Más prosa del contexto/);
  });
});

describe("demoteCanonicalSectionHeadingsInSection1Body + dedupe", () => {
  it("dedupe no corta §1 si el cuerpo tenía bare 2. Arquitectura (caso regen)", () => {
    const prefix =
      "KMS Agente: plataforma de agentes conversacionales para soporte interno.";
    const suffix =
      " Audiencia operadores y desarrolladores. Alcance: API NestJS, colas, RAG y herramientas MCP; fuera: portal público.";
    const polluted = `${prefix}\n\n2. Arquitectura y Stack\n\n${suffix.trim()}`;
    assert.ok(prefix.length < 100, "prefix corto simula wipe a ~62 chars");

    const brokenDraft = `# Master Design Document

## 1. Contexto y Alcance

${polluted}

## 2. Arquitectura y Stack

| Runtime | Node 20 |

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE t (id uuid);
\`\`\`

## 4. Contratos de API

| Método | Path |
| GET | /health |

## 5. Lógica y Edge Cases

Reglas de negocio y validaciones del dominio con suficiente detalle.

## 6. Seguridad

Auth JWT y RBAC con detalle de roles.

## 7. Infraestructura

Docker + Dokploy en un solo nodo.
`;
    const promoted = repairGluedMarkdownHeadings(brokenDraft);
    const brokenBody = extractContextSectionBody(deduplicateAndReorderMddSections(promoted)) ?? "";
    assert.ok(
      brokenBody.length < 200,
      `sin demote debería partir §1; got ${brokenBody.length}`,
    );

    const safe = demoteCanonicalSectionHeadingsInSection1Body(polluted);
    const draft = brokenDraft.replace(polluted, safe);
    const out = deduplicateAndReorderMddSections(draft);
    const body = extractContextSectionBody(out) ?? "";
    assert.ok(body.length >= 150, `§1 bodyLen=${body.length}`);
    assert.match(body, /Audiencia operadores/);
    assert.match(out, /## 2\. Arquitectura/);
  });
});

describe("resolveUpstreamSyncSection1Body", () => {
  it("prioriza §1 sustancial del mddDraft Clarifier", () => {
    const draft = `## 1. Contexto y alcance\n\n${LONG_CONTEXTO}\n\n## 2. Arquitectura y Stack\n\nNode`;
    const body = resolveUpstreamSyncSection1Body({
      clarifierMddDraft: draft,
      clarifiedScope: "# DBGA\n\nBasura corta.",
    });
    assert.equal(body, LONG_CONTEXTO);
  });

  it("rechaza dump DBGA (#) sin §1 MDD (evita wipe 9–17 chars)", () => {
    const body = resolveUpstreamSyncSection1Body({
      clarifierMddDraft: undefined,
      clarifiedScope: "# Domain Benchmark\n\n## 1. Overview\n\nCorto.\n\n## 2. Gaps\n\nx",
    });
    assert.equal(body, null);
  });

  it("acepta prosa clarifiedScope sin headings", () => {
    const body = resolveUpstreamSyncSection1Body({
      clarifierMddDraft: "",
      clarifiedScope: LONG_CONTEXTO,
    });
    assert.equal(body, LONG_CONTEXTO);
  });
});

describe("replaceSection1BodyFromAnyHeading (heading case / no prefix)", () => {
  it("no rompe título Contexto y Alcance al reemplazar cuerpo", () => {
    const draft = `## 1. Contexto y Alcance\n\nViejo contexto sustancial que debe desaparecer por completo del documento.\n\n## 2. Arquitectura y Stack\n\nNode 20`;
    const out = replaceSection1BodyFromAnyHeading(draft, LONG_CONTEXTO);
    assert.match(out, /## 1\. Contexto y Alcance/);
    assert.equal(extractContextSectionBody(out), LONG_CONTEXTO);
    assert.match(out, /## 2\. Arquitectura y Stack/);
    assert.doesNotMatch(out, /Viejo contexto/);
  });
});
