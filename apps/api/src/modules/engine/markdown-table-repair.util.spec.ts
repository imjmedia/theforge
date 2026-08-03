import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentHasMarkdownTableSeparator,
  isMarkdownTableSeparatorLine,
  repairMarkdownTableSeparators,
} from "./markdown-table-repair.util.js";

describe("markdown-table-repair.util", () => {
  it("detecta separadores GFM con alineación y espacios", () => {
    assert.equal(isMarkdownTableSeparatorLine("| --- | --- |"), true);
    assert.equal(isMarkdownTableSeparatorLine("| :----- | :--- | :---------- | :--- | :---- |"), true);
    assert.equal(isMarkdownTableSeparatorLine("| GET | /api/v1/health |"), false);
  });

  it("contentHasMarkdownTableSeparator encuentra separador en cualquier línea", () => {
    const doc =
      "# Blueprint\n\n| Método | Ruta |\n| :----- | :--- |\n| GET | /health |\n";
    assert.equal(contentHasMarkdownTableSeparator(doc), true);
  });

  it("repairMarkdownTableSeparators inserta separador faltante", () => {
    const input = "| Método | Ruta | Auth |\n| GET | /api/v1/health | no |\n";
    const out = repairMarkdownTableSeparators(input);
    assert.match(out, /\| --- \| --- \| --- \|\n\| GET \|/);
    assert.equal(contentHasMarkdownTableSeparator(out), true);
  });

  it("no duplica separador existente", () => {
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    assert.equal(repairMarkdownTableSeparators(input), input);
  });
});
