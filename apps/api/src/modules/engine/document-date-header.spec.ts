import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prependDocumentTimestamps,
  extractDocumentTimestamps,
  stampMarkdownIfBodyChanged,
  documentMarkdownBodiesEqual,
  stripDocumentStampHeader,
} from "./document-date-header.util.js";
import {
  compilePagToInfraMarkdown,
  compilePagToLogicFlowsMarkdown,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";

describe("document-date-header", () => {
  const fixed = new Date("2026-07-15T10:30:45.000Z");
  const later = new Date("2026-07-16T14:45:30.000Z");

  it("prepends header on fresh content", () => {
    const out = prependDocumentTimestamps("# My Doc\n\nBody", fixed);
    assert.ok(out.startsWith("<!-- theforge-doc:created=2026-07-15"));
    assert.ok(out.includes("Creado:"));
    assert.ok(out.includes("Última modificación:"));
    assert.ok(out.includes("10:30:45"));
    assert.ok(out.includes("# My Doc"));
  });

  it("preserves original created date on re-stamp", () => {
    const first = prependDocumentTimestamps("# Doc", fixed);
    const second = prependDocumentTimestamps(first, later);

    const ts = extractDocumentTimestamps(second);
    assert.equal(ts.created?.toISOString(), fixed.toISOString());
    assert.equal(ts.updated?.toISOString(), later.toISOString());
    assert.ok(second.includes("14:45:30"));
  });

  it("strips legacy Generado/Actualizado header on re-stamp", () => {
    const legacy =
      "<!-- theforge-doc:created=2026-07-01T08:00:00.000Z|updated=2026-07-01T08:00:00.000Z -->\n" +
      "> 📅 Generado: 1 jul 2026, 08:00 UTC · Actualizado: 1 jul 2026, 08:00 UTC\n\n" +
      "---\n\n" +
      "# Doc";
    const out = prependDocumentTimestamps(legacy, later);
    assert.ok(out.includes("Creado:"));
    assert.ok(out.includes("Última modificación:"));
    assert.ok(!out.includes("Generado:"));
    assert.equal(extractDocumentTimestamps(out).created?.toISOString(), "2026-07-01T08:00:00.000Z");
  });

  it("returns empty object for content without header", () => {
    const ts = extractDocumentTimestamps("just plain text");
    assert.equal(ts.created, undefined);
    assert.equal(ts.updated, undefined);
  });

  it("body is preserved after header", () => {
    const body = "# Title\n\nSome body text.";
    const out = prependDocumentTimestamps(body, fixed);
    const afterHeader = out.replace(/^.*?---\n\n/s, "");
    assert.equal(afterHeader, body);
  });

  it("stampMarkdownIfBodyChanged preserves existing when body unchanged", () => {
    const body = "# Doc\n\nSame.";
    const stamped = prependDocumentTimestamps(body, fixed);
    const again = stampMarkdownIfBodyChanged(stamped, body, later);
    assert.equal(again, stamped);
    assert.equal(extractDocumentTimestamps(again).updated?.toISOString(), fixed.toISOString());
  });

  it("stampMarkdownIfBodyChanged re-stamps when body changes", () => {
    const body = "# Doc\n\nOld.";
    const stamped = prependDocumentTimestamps(body, fixed);
    const next = stampMarkdownIfBodyChanged(stamped, "# Doc\n\nNew.", later);
    assert.notEqual(next, stamped);
    assert.equal(extractDocumentTimestamps(next).updated?.toISOString(), later.toISOString());
  });

  it("documentMarkdownBodiesEqual ignores stamp metadata", () => {
    const body = "# X\n";
    assert.equal(
      documentMarkdownBodiesEqual(prependDocumentTimestamps(body, fixed), body),
      true,
    );
  });

  it("re-stamp cleans corrupted glued stamp before H1", () => {
    const corrupted =
      "Última modificación: 2026-07-18T06:25:57.540Z --> 📅 Creado: 18 de julio de 2026, 06:25:57 UTC · Última modificación: 18 de julio de 2026, 06:25:57 UTC --- # Master Design Document --- ## 1. Contexto\n\nTexto.";
    const out = prependDocumentTimestamps(corrupted, later);
    assert.ok(out.startsWith("<!-- theforge-doc:created="));
    assert.ok(out.includes("> 📅 Creado:"));
    assert.match(out, /---\n\n# Master Design Document\n\n---\n\n## 1\. Contexto/);
    assert.doesNotMatch(out, /Última modificación: 2026-07-18T06:25:57/);
  });

  it("re-stamp no pierde patrones SSOT [X] si el peel del stamp falla", async () => {
    const { updateMddGovernancePatterns, selectedPatternIdsFromMdd, listGovernancePatternOptions } =
      await import("@theforge/shared-types/mdd-governance-patterns");
    const id = listGovernancePatternOptions().find((o) => o.label.includes("Singleton"))!.id;
    const govBody = updateMddGovernancePatterns("", new Set([id])).replace(
      /^# Master Design Document\n\n---\n\n/,
      "",
    );
    const corrupted =
      "<!-- theforge-doc:created=2026-07-18T20:07:32.000Z|updated=2026-07-18T20:07:32.000Z -->\n" +
      "> 📅 Creado: 18 de julio de 2026, 14:07:32 UTC · Última modificación: 18 de julio de 2026, 14:07:32 UTC\n\n" +
      govBody +
      "\n\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    const out = prependDocumentTimestamps(corrupted, later);
    assert.equal(selectedPatternIdsFromMdd(out).size, 1);
    assert.match(out, /\[ARQUITECTURA - SECCIÓN INMUTABLE\]/);
  });
});

/** PAG mínimo (sin endpoints) para compilar documentos con flechas Mermaid. */
const MINIMAL_PAG = {
  version: "1.0.0",
  projectName: "Demo Stamp",
  description: "Proyecto de prueba",
  stack: {
    runtime: "Node.js 20",
    backendFramework: "NestJS",
    frontendFramework: "React 18 + Vite",
    database: "PostgreSQL 16",
    orm: "Prisma",
  },
  entities: [],
  endpoints: [],
  services: [],
} as unknown as ProjectArchitectureGraph;

describe("document-date-header: documentos compilados con flechas Mermaid", () => {
  const t0 = new Date("2026-07-15T10:30:45.000Z");
  const t1 = new Date("2026-07-16T14:45:30.000Z");

  it("Flujos: stamp + re-stamp conserva H1, mermaid `-->>` y created", () => {
    const compiled = compilePagToLogicFlowsMarkdown(MINIMAL_PAG);
    const first = prependDocumentTimestamps(compiled, t0);
    const second = prependDocumentTimestamps(first, t1);
    assert.equal(extractDocumentTimestamps(second).created?.toISOString(), t0.toISOString());
    assert.equal(extractDocumentTimestamps(second).updated?.toISOString(), t1.toISOString());
    assert.equal(stripDocumentStampHeader(second), compiled.trim());
    assert.ok(second.includes("API-->>User: 200 OK"));
  });

  it("Infra: el cuerpo empieza en `# ` y conserva el YAML tras dos stamps", () => {
    const compiled = compilePagToInfraMarkdown(MINIMAL_PAG);
    const twice = prependDocumentTimestamps(prependDocumentTimestamps(compiled, t0), t1);
    const body = stripDocumentStampHeader(twice);
    assert.ok(body.startsWith("# Especificación de Infraestructura y Despliegue — Demo Stamp"));
    assert.ok(body.includes("```yaml"));
    assert.equal(body, compiled.trim());
  });

  it("prependDocumentTimestamps dos veces conserva created y el cuerpo íntegro", () => {
    const first = prependDocumentTimestamps("# Doc\n\nA --> B\n", t0);
    const second = prependDocumentTimestamps(first, t1);
    assert.equal(extractDocumentTimestamps(second).created?.toISOString(), t0.toISOString());
    assert.equal(stripDocumentStampHeader(second), "# Doc\n\nA --> B");
  });
});

describe("stampMarkdownIfBodyChanged — force", () => {
  const t0 = new Date("2026-07-15T10:30:45.000Z");
  const t1 = new Date("2026-07-16T14:45:30.000Z");

  it("sin force conserva el documento si el cuerpo no cambió", () => {
    const first = prependDocumentTimestamps("# Doc\n\nCuerpo", t0);
    assert.equal(stampMarkdownIfBodyChanged(first, "# Doc\n\nCuerpo", t1), first.trim());
  });

  it("con force actualiza updated, conserva created y el cuerpo", () => {
    const first = prependDocumentTimestamps("# Doc\n\nCuerpo", t0);
    const out = stampMarkdownIfBodyChanged(first, "# Doc\n\nCuerpo", t1, { force: true });
    const ts = extractDocumentTimestamps(out);
    assert.equal(ts.created?.toISOString(), t0.toISOString());
    assert.equal(ts.updated?.toISOString(), t1.toISOString());
    assert.equal(stripDocumentStampHeader(out), "# Doc\n\nCuerpo");
  });

  it("con force y cuerpo distinto sigue estampando el contenido nuevo", () => {
    const first = prependDocumentTimestamps("# Doc\n\nA", t0);
    const out = stampMarkdownIfBodyChanged(first, "# Doc\n\nB", t1, { force: true });
    assert.equal(stripDocumentStampHeader(out), "# Doc\n\nB");
  });
});
