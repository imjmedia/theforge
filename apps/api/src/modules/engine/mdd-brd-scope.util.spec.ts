import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  corpusExcludesDashboardWeb,
  corpusExcludesMultiTenantSaaS,
} from "./mdd-brd-scope.util.js";

describe("mdd-brd-scope.util", () => {
  it("detecta dashboard web fuera de alcance", () => {
    const brd = `
**Fuera de alcance:** dashboard web de administración, facturación SaaS.
MVP: API REST + CLI.`;
    assert.ok(corpusExcludesDashboardWeb(brd));
    assert.ok(corpusExcludesMultiTenantSaaS(brd));
  });

  it("no marca multi-tenant si no hay señal fuera de alcance", () => {
    const text = "Sistema multi-tenant con aislamiento por org_id.";
    assert.ok(!corpusExcludesMultiTenantSaaS(text));
  });

  it("no marca dashboard si solo describe CLI", () => {
    const text = "Operadores usan CLI; no hay panel web en el MVP.";
    assert.ok(!corpusExcludesDashboardWeb(text));
  });
});
