import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMinimalLogicFlowsFromBusinessLogic,
  extractAriadneBusinessLogicRows,
  isLogicFlowsInsufficientContent,
  resolveLegacyAsIsLogicFlowsDeterministic,
} from "./legacy-as-is-logic-flows-ariadne.util.js";

describe("legacy-as-is-logic-flows-ariadne.util", () => {
  it("extractAriadneBusinessLogicRows lee business_logic JSON del envelope", () => {
    const envelope = {
      format: "legacy_mdd_v1",
      mddDocument: {
        business_logic: [
          { service: "nest:AuthService", dependencies: ["src/auth/auth.service.ts"] },
          { service: "strapi:campania", dependencies: ["api/campania/services/campania.js"] },
        ],
      },
    };
    const rows = extractAriadneBusinessLogicRows({
      codebaseDoc: JSON.stringify(envelope),
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.service, "nest:AuthService");
  });

  it("buildMinimalLogicFlowsFromBusinessLogic produce cuerpo válido con changelog", () => {
    const md = buildMinimalLogicFlowsFromBusinessLogic([
      { service: "strapi:foo", dependencies: "api/foo.js" },
    ]);
    assert.match(md, /^# Flujos de lógica/);
    assert.match(md, /```mermaid/);
    assert.match(md, /Registro de cambios del documento/);
    assert.equal(isLogicFlowsInsufficientContent(md), false);
  });

  it("isLogicFlowsInsufficientContent detecta shell solo-changelog", () => {
    const shell = `# Flujos de lógica

## Registro de cambios del documento

| Versión | Fecha | Descripción del cambio |
| --- | --- | --- |
| 1.0 | Mayo 2026 | Creación inicial de Flujos de lógica |
`;
    assert.equal(isLogicFlowsInsufficientContent(shell), true);
  });

  it("resolveLegacyAsIsLogicFlowsDeterministic usa MDD §5 como fallback", () => {
    const mdd = `# MDD

## 5. Lógica y Edge Cases

| Servicio | Dependencias (paths) |
| --- | --- |
| strapi:bar | api/bar/services/bar.js |
`;
    const doc = resolveLegacyAsIsLogicFlowsDeterministic({ mddMarkdown: mdd });
    assert.ok(doc);
    assert.match(doc!, /strapi:bar/);
  });
});
