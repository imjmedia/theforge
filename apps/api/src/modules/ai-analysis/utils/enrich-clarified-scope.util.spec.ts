import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainInventory } from "@theforge/shared-types";
import { enrichClarifiedScopeFromInventory } from "./enrich-clarified-scope.util.js";

const inventory: DomainInventory = {
  capabilities: [
    { id: "cap-1", title: "Gestión de documentos", body: "Carga y versionado", isAuthRelated: false },
    { id: "cap-2", title: "Búsqueda semántica", body: "Embeddings", isAuthRelated: false },
    { id: "cap-3", title: "Autenticación MFA", body: "TOTP", isAuthRelated: true },
  ],
  suggestedEntities: ["documents", "taxonomies", "approval_workflows", "users"],
  processes: [],
  crudMatrix: [],
  adminSurfaces: [],
};

describe("enrichClarifiedScopeFromInventory", () => {
  it("injects Entidades and Capacidades when scope is short", () => {
    const out = enrichClarifiedScopeFromInventory("Alcance genérico del KMS.", inventory);
    assert.equal(out.enriched, true);
    assert.match(out.scope, /\*\*Entidades:\*\*/i);
    assert.match(out.scope, /documents/i);
    assert.match(out.scope, /\*\*Capacidades:\*\*/i);
    assert.match(out.scope, /Gestión de documentos/i);
  });

  it("does not enrich when entities are listed and coverage is adequate", () => {
    const scope =
      "**Entidades:** documents, taxonomies, approval_workflows, users. " +
      "**Capacidades:** Gestión de documentos; Búsqueda semántica. " +
      "Sistema KMS con gestión documental, taxonomías y flujos de aprobación.";
    const out = enrichClarifiedScopeFromInventory(scope, inventory);
    assert.equal(out.enriched, false);
    assert.equal(out.scope, scope);
  });

  it("adds missing Entidades line when coverage is low", () => {
    const scope =
      "**Capacidades:** auth. Sistema de conocimiento sin listar tablas.";
    const out = enrichClarifiedScopeFromInventory(scope, inventory);
    assert.equal(out.addedEntities, true);
    assert.match(out.scope, /\*\*Entidades:\*\*/i);
  });
});
