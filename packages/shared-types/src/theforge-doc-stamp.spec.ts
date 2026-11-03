import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import {
  formatTheforgeDocTimestampsForDisplay,
  mddMarkdownNeedsStructuralRepair,
  parseTheforgeDocTimestamps,
  peelDocumentBodyForPersist,
  peelTheforgeDocStamp,
  reattachTheforgeDocStamp,
} from "./theforge-doc-stamp.js";

const STAMPED = `<!-- theforge-doc:created=2026-07-15T10:30:45.000Z|updated=2026-07-16T14:45:30.000Z -->
> 📅 Creado: 15 de julio de 2026, 10:30:45 UTC · Última regeneración: 16 de julio de 2026, 14:45:30 UTC

---

# Título

## 1. Sección

Hola
`;

describe("theforge-doc-stamp", () => {
  it("peels meta + human header", () => {
    const { stamp, body } = peelTheforgeDocStamp(STAMPED);
    assert.ok(stamp.includes("theforge-doc:created="));
    assert.ok(stamp.includes("Creado:"));
    assert.ok(stamp.includes("10:30:45"));
    assert.ok(body.startsWith("# Título"));
  });

  it("reattach restores stamp before body", () => {
    const { stamp, body } = peelTheforgeDocStamp(STAMPED);
    const out = reattachTheforgeDocStamp(stamp, body);
    assert.ok(out.startsWith("<!-- theforge-doc:created="));
    assert.ok(out.includes("# Título"));
  });

  it("parseTheforgeDocTimestamps reads ISO from HTML comment", () => {
    const ts = parseTheforgeDocTimestamps(STAMPED);
    assert.equal(ts.created, "2026-07-15T10:30:45.000Z");
    assert.equal(ts.updated, "2026-07-16T14:45:30.000Z");
  });

  it("formatTheforgeDocTimestampsForDisplay includes seconds", () => {
    const display = formatTheforgeDocTimestampsForDisplay(parseTheforgeDocTimestamps(STAMPED));
    assert.ok(display);
    assert.ok(display!.created.includes("10:30:45"));
    assert.ok(display!.updated.includes("14:45:30"));
  });

  it("peels blockquote stamp without --- before H1", () => {
    const raw =
      "<!-- theforge-doc:created=2026-07-16T03:28:39.226Z|updated=2026-07-16T03:28:39.226Z -->\n" +
      "> 📅 Creado: 16 de julio de 2026, 03:28:39 UTC · Última regeneración: 16 de julio de 2026, 03:28:39 UTC\n\n" +
      "# Specs\n";
    const { stamp, body } = peelTheforgeDocStamp(raw);
    assert.ok(stamp.includes("theforge-doc:created="));
    assert.ok(stamp.includes("Creado:"));
    assert.ok(body.startsWith("# Specs"));
  });

  it("peels glued blockquote stamp before --- and H1", () => {
    const raw =
      "<!-- theforge-doc:created=2026-07-16T03:28:39.226Z|updated=2026-07-16T03:28:39.226Z -->\n" +
      "> 📅 Creado: 16 de julio de 2026, 03:28:39 UTC · Última regeneración: 16 de julio de 2026, 03:28:39 UTC --- # Specs\n";
    const { stamp, body } = peelTheforgeDocStamp(raw);
    assert.ok(stamp.includes("Creado:"));
    assert.ok(body.startsWith("# Specs"));
  });

  it("peels orphan --> before blockquote stamp", () => {
    const raw =
      "--> > 📅 Creado: 16 de julio de 2026, 03:28:39 UTC · Última regeneración: 16 de julio de 2026, 03:28:39 UTC\n\n# Specs\n";
    const { stamp, body } = peelTheforgeDocStamp(raw);
    assert.ok(stamp.includes("📅"));
    assert.ok(body.startsWith("# Specs"));
  });

  it("peels truncated ISO close and glued stamp before H1", () => {
    const raw =
      "Última modificación: 2026-07-18T05:06:06.701Z --> 📅 Creado: 18 de julio de 2026, 05:06:06 UTC · Última modificación: 18 de julio de 2026, 05:06:06 UTC --- # Master Design Document\n\n## 1. Contexto\n";
    const { stamp, body } = peelTheforgeDocStamp(raw);
    assert.ok(stamp.includes("📅"));
    assert.ok(body.startsWith("# Master Design Document"));
    assert.doesNotMatch(body, /Última modificación:/);
  });

  it("repairInlineHorizontalRuleSectionBreaks splits glued section headings", () => {
    const raw =
      "# Master Design Document --- ## 1. Contexto --- ## 2. Arquitectura y Stack\n\nTexto.";
    const { body } = peelTheforgeDocStamp(raw);
    assert.match(body, /^# Master Design Document\n\n---\n\n## 1\. Contexto/);
    assert.match(body, /## 2\. Arquitectura y Stack/);
  });

  it("peels current API stamp with Última modificación label", () => {
    const raw =
      "<!-- theforge-doc:created=2026-07-18T05:06:06.701Z|updated=2026-07-18T05:06:06.701Z -->\n" +
      "> 📅 Creado: 18 de julio de 2026, 05:06:06 UTC · Última modificación: 18 de julio de 2026, 05:06:06 UTC\n\n" +
      "---\n\n# Master Design Document\n";
    const { body } = peelTheforgeDocStamp(raw);
    assert.equal(body.trim(), "# Master Design Document");
  });

  it("formatTheforgeDocTimestampsForDisplay accepts custom timezone", () => {
    const display = formatTheforgeDocTimestampsForDisplay(parseTheforgeDocTimestamps(STAMPED), {
      timeZone: "America/Mexico_City",
    });
    assert.ok(display);
    assert.doesNotMatch(display!.created, / UTC$/);
  });

  it("peelDocumentBodyForPersist strips >> 📅 residue after orphan ISO prefix", () => {
    const raw =
      "Última modificación: 2026-07-19T16:50:37.075Z --> >> 📅 Creado: 19 de julio de 2026, 16:50:37 UTC · Última modificación: 19 de julio de 2026, 16:50:37 UTC --- # Master Design Document --- ## 1. Contexto";
    const body = peelDocumentBodyForPersist(raw);
    assert.match(body, /^#\s*Master Design Document/);
    assert.doesNotMatch(body, /📅|Última modificación:/);
  });

  it("peelDocumentBodyForPersist splits glued §1 and §2 from stamp residue", () => {
    const raw =
      "Última modificación: 2026-07-18T06:25:57.540Z --> 📅 Creado: 18 de julio de 2026, 06:25:57 UTC · Última modificación: 18 de julio de 2026, 06:25:57 UTC --- # Master Design Document --- ## 1. Contexto y alcance --- ## 2. Arquitectura y Stack ### 2.1 Visión";
    const body = peelDocumentBodyForPersist(raw);
    assert.match(body, /^# Master Design Document\n\n---\n\n## 1\. Contexto y alcance/);
    assert.match(body, /## 2\. Arquitectura y Stack/);
    assert.doesNotMatch(body, /📅|Última modificación:/);
  });

  it("peelDocumentBodyForPersist strips double-stamped blockquote with inline sections", () => {
    const raw =
      "<!-- theforge-doc:created=2026-07-18T06:25:57.540Z|updated=2026-07-18T06:25:57.540Z -->\n" +
      "> 📅 Creado: 18 de julio de 2026, 06:25:57 UTC · Última modificación: 18 de julio de 2026, 06:25:57 UTC --- # Master Design Document --- ## 1. Contexto --- ## 2. Stack\n\n## 3. Modelo";
    const body = peelDocumentBodyForPersist(raw);
    assert.match(body, /^# Master Design Document/);
    assert.match(body, /## 3\. Modelo/);
    assert.doesNotMatch(body, /📅/);
  });

  it("peelDocumentBodyForPersist trims stamp residue before §2–§7 when §1 is absent", () => {
    // Caso típico al regenerar §2–§7: el borrador puede no tener §1 pero sí §2,
    // y el stamp de BD queda pegado antes del primer heading.
    const raw =
      "Última modificación: 2026-07-19T06:00:00.000Z --> 📅 Creado: 19 de julio de 2026, 06:00:00 UTC · Última modificación: 19 de julio de 2026, 06:00:00 UTC --- ## 2. Arquitectura y Stack ### 2.1 Visión";
    const body = peelDocumentBodyForPersist(raw);
    assert.match(body, /^## 2\. Arquitectura y Stack/);
    assert.doesNotMatch(body, /📅|Última modificación:/);
  });

  it("mddMarkdownNeedsStructuralRepair detects inline sections in stamp zone", () => {
    const raw =
      "Última modificación: 2026-07-18T06:43:07.391Z --> 📅 Creado: 18 de julio de 2026, 06:43:07 UTC --- # Master Design Document --- ## 1. Contexto --- ## 2. Stack\n\n## 3. Modelo";
    assert.equal(mddMarkdownNeedsStructuralRepair(raw), true);
    assert.equal(
      mddMarkdownNeedsStructuralRepair(
        "# Master Design Document\n\n---\n\n## 1. Contexto\n\n## 3. Modelo",
      ),
      false,
    );
  });

  it("mddMarkdownHasKnownFormatCorruption detecta §4 sin cierre y H1 _prosa_", async () => {
    const { mddMarkdownHasKnownFormatCorruption } = await import("./theforge-doc-stamp.js");
    const corrupt = `## 4. Contratos de API

### POST /api/v1/chat/message
Recibe el mensaje.
\`\`\`json
{ "x": 1 }

### POST /api/v1/chat/switch-company
Texto.
`;
    const fixed = `## 4. Contratos de API

### POST /api/v1/chat/message
\`\`\`json
{ "x": 1 }
\`\`\`

### POST /api/v1/chat/switch-company
`;
    assert.equal(mddMarkdownHasKnownFormatCorruption(corrupt), true);
    assert.equal(mddMarkdownHasKnownFormatCorruption(fixed), false);
    assert.equal(mddMarkdownHasKnownFormatCorruption("# _Prosa en cursiva que no es heading._\n"), true);
  });

  it("formatDocumentMarkdown preserves stamp ISO and human header", () => {
    const out = formatDocumentMarkdown(STAMPED);
    assert.ok(out.includes("<!-- theforge-doc:created=2026-07-15T10:30:45.000Z|updated="));
    assert.ok(out.includes("Creado:"));
    assert.ok(out.includes("# Título"));
  });

  it("peelDocumentBodyForPersist no promueve viñetas SSOT - [X] a H1", async () => {
    const { updateMddGovernancePatterns, selectedPatternIdsFromMdd, listGovernancePatternOptions } =
      await import("./mdd-governance-patterns.js");
    const base =
      "# Master Design Document\n\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    const id = listGovernancePatternOptions().find((o) => o.label.includes("Singleton"))!.id;
    const md = updateMddGovernancePatterns(base, new Set([id]));
    const peeled = peelDocumentBodyForPersist(md);
    assert.equal(selectedPatternIdsFromMdd(peeled).size, 1);
    assert.doesNotMatch(peeled, /^# - \[[xX]\]/m);
  });

  it("peelDocumentBodyForPersist conserva patrones [X] si falta --- del stamp antes del cuerpo", async () => {
    const { updateMddGovernancePatterns, selectedPatternIdsFromMdd, listGovernancePatternOptions } =
      await import("./mdd-governance-patterns.js");
    const id = listGovernancePatternOptions().find((o) => o.label.includes("Singleton"))!.id;
    const govBody = updateMddGovernancePatterns("", new Set([id])).replace(
      /^# Master Design Document\n\n---\n\n/,
      "",
    );
    const raw =
      "<!-- theforge-doc:created=2026-07-18T20:07:32.000Z|updated=2026-07-18T20:07:32.000Z -->\n" +
      "> 📅 Creado: 18 de julio de 2026, 14:07:32 UTC · Última modificación: 18 de julio de 2026, 14:07:32 UTC\n\n" +
      govBody +
      "\n\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    const body = peelDocumentBodyForPersist(raw);
    assert.equal(selectedPatternIdsFromMdd(body).size, 1);
    assert.match(body, /\[ARQUITECTURA - SECCIÓN INMUTABLE\]/);
    assert.match(body, /## 1\. Contexto/);
  });

  it("extractCanonicalMddBody prefiere gobernanza SSOT antes que §1", async () => {
    const { selectedPatternIdsFromMdd } = await import("./mdd-governance-patterns.js");
    const { extractCanonicalMddBody } = await import("./theforge-doc-stamp.js");
    const raw =
      "📅 Creado: corrupto\n\n" +
      "## [ARQUITECTURA - SECCIÓN INMUTABLE] CONFIGURACIÓN\n\n- [X] **Singleton:** test\n\n---\n\n" +
      "## 1. Contexto\n\nTexto.\n";
    const out = extractCanonicalMddBody(raw);
    assert.match(out, /\[ARQUITECTURA - SECCIÓN INMUTABLE\]/);
    assert.equal(selectedPatternIdsFromMdd(out).size, 1);
  });

  it("extractCanonicalMddBody no salta a §3 cuando falta §1/§2 (evita gate §1+§2 missing)", async () => {
    const { extractCanonicalMddBody } = await import("./theforge-doc-stamp.js");
    const raw =
      "Última modificación: 2026-07-19T06:00:00.000Z --> 📅 Creado: 19 de julio de 2026, 06:00:00 UTC --- ## 3. Modelo de Datos\n\nCREATE TABLE x (id int);\n";
    const out = extractCanonicalMddBody(raw);
    assert.match(out, /## 3\. Modelo de Datos/);
    assert.doesNotMatch(out, /^## 3\./);
    assert.match(out, /📅|Última modificación:/);
  });

  it("peelDocumentBodyForPersist: un título suelto en la primera línea se promueve a H1, un párrafo intermedio no", () => {
    const titulo = peelDocumentBodyForPersist("Master Design Document\n\n---\n\n## 1. Contexto\n\nTexto.");
    assert.match(titulo, /^# Master Design Document\n\n---\n\n## 1\. Contexto/);

    const parrafo = peelDocumentBodyForPersist(
      "# Doc\n\n## 1. Contexto\n\nSistema de reservas de salas.\n\n---\n\n## 2. Arquitectura y Stack\n\nTexto.",
    );
    assert.match(parrafo, /^Sistema de reservas de salas\.$/m);
    assert.doesNotMatch(parrafo, /^# Sistema/m);
  });
});
