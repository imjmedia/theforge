import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectTruncatedMddTail,
  mergeConsecutiveTextDiagramFences,
  repairBrokenJsonArrayElements,
  repairBulletPrefixedAsciiInTextFences,
  repairGluedHrBeforeApiHeading,
  repairInvalidJsonKeysWithSpaces,
  repairJsonPaginationListMarkers,
  repairMddFormatIssues,
  repairMddSection5BddFormat,
  repairNestedJsonFenceInContratos,
} from "./repair-mdd-format.js";

describe("repairJsonPaginationListMarkers", () => {
  it("quita viñetas en claves JSON de paginación", () => {
    const raw = "```json\n{\n  \"pagination\": {\n    - \"page\": 1,\n    - \"limit\": 20\n  }\n}\n```";
    const out = repairJsonPaginationListMarkers(raw);
    assert.doesNotMatch(out, /-\s+"page"/);
    assert.match(out, /"page": 1/);
  });
});

describe("repairInvalidJsonKeysWithSpaces", () => {
  it("normaliza is default a is_default", () => {
    const raw = '```json\n{ "is default": true }\n```';
    const out = repairInvalidJsonKeysWithSpaces(raw);
    assert.match(out, /"is_default": true/);
  });
});

describe("repairBrokenJsonArrayElements", () => {
  it("inserta comas entre objetos hermanos", () => {
    const raw = "```json\n[\n  { \"a\": 1 }\n  { \"b\": 2 }\n]\n```";
    const out = repairBrokenJsonArrayElements(raw);
    assert.match(out, /\}\s*,\s*\n\s*\{/);
  });
});

describe("repairNestedJsonFenceInContratos", () => {
  it("desanida fences json internos", () => {
    const raw = "```json\n{\n```json\n\"x\": 1\n```\n}\n```";
    const out = repairNestedJsonFenceInContratos(raw);
    assert.doesNotMatch(out, /```json[\s\S]*```json/);
    assert.match(out, /"x": 1/);
  });
});

describe("repairGluedHrBeforeApiHeading", () => {
  it("separa --- pegado a ### GET", () => {
    const raw = "### POST /foo\n```json\n{}\n```---### GET /bar";
    const out = repairGluedHrBeforeApiHeading(raw);
    assert.match(out, /---\n\n### GET/);
  });
});

describe("repairBulletPrefixedAsciiInTextFences", () => {
  it("quita prefijo - en líneas de diagrama ASCII", () => {
    const raw = "```text\n- │ foo\n- ▼ bar\n```";
    const out = repairBulletPrefixedAsciiInTextFences(raw);
    assert.match(out, /│ foo/);
    assert.match(out, /▼ bar/);
    assert.doesNotMatch(out, /^-\s+│/m);
  });
});

describe("mergeConsecutiveTextDiagramFences", () => {
  it("fusiona bloques text consecutivos", () => {
    const raw = "```text\nline1\n```\n\n```text\nline2\n```";
    const out = mergeConsecutiveTextDiagramFences(raw);
    assert.match(out, /```text\nline1\nline2[\s\n]*```/);
    assert.strictEqual((out.match(/```text/gi) ?? []).length, 1);
  });
});

describe("repairMddSection5BddFormat", () => {
  it("une ### 1. con título en línea siguiente", () => {
    const raw = "## 5. Lógica y Edge Cases\n\n### 1.\n\n**Login fallido**\n\n- dado usuario\n";
    const out = repairMddSection5BddFormat(raw);
    assert.match(out, /### 1\. Login fallido/);
    assert.match(out, /\*\*Dado\*\*/i);
  });
});

describe("detectTruncatedMddTail", () => {
  it("detecta fence sin cerrar", () => {
    const issue = detectTruncatedMddTail("# MDD\n\n```text\nlinea");
    assert.match(issue ?? "", /truncado|sin cerrar/i);
  });

  it("detecta json abierto al final", () => {
    const issue = detectTruncatedMddTail("## 4. Contratos\n\n```json\n{ \"a\": 1");
    assert.match(issue ?? "", /json abierto/i);
  });

  it("retorna null en documento bien cerrado", () => {
    assert.strictEqual(detectTruncatedMddTail("# OK\n\n```json\n{}\n```\n"), null);
  });
});

describe("repairMddFormatIssues", () => {
  it("aplica pipeline P0-P2 sin romper markdown válido", () => {
    const raw = "# MDD\n\n## 4. Contratos\n\n---### GET /x\n";
    const out = repairMddFormatIssues(raw);
    assert.match(out, /---\n\n### GET/);
  });
});
