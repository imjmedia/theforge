import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyIntentPersistGate,
  buildEditModeUserPrompt,
  sanitizeLlmResponse,
  shouldAllowDocumentPersist,
  validateMddStructure,
} from "./workshop-document-turn.util.js";

describe("workshop-document-turn.util", () => {
  it("shouldAllowDocumentPersist solo en edit_document y tabs permitidos", () => {
    assert.equal(shouldAllowDocumentPersist("edit_document", "mdd"), true);
    assert.equal(shouldAllowDocumentPersist("edit_document", "ux-ui-guide"), true);
    assert.equal(shouldAllowDocumentPersist("edit_document", "spec"), false);
    assert.equal(shouldAllowDocumentPersist("chat_only", "mdd"), false);
    assert.equal(shouldAllowDocumentPersist("confirm_then_edit", "mdd"), false);
  });

  it("applyIntentPersistGate anula flags en chat_only y tabs congelados", () => {
    const gatedChat = applyIntentPersistGate("chat_only", { hasMdd: true, hasSpec: true }, "mdd");
    assert.equal(gatedChat.hasMdd, false);
    assert.equal(gatedChat.hasSpec, false);
    const gatedFrozen = applyIntentPersistGate("edit_document", { hasSpec: true }, "spec");
    assert.equal(gatedFrozen.hasSpec, false);
  });

  it("sanitizeLlmResponse elimina bloques thinking", () => {
    const out = sanitizeLlmResponse("Hola\n<thinking>secret</thinking>\n\n# MDD");
    assert.ok(!out.includes("secret"));
    assert.match(out, /# MDD/);
  });

  it("buildEditModeUserPrompt antepone modo edición", () => {
    const out = buildEditModeUserPrompt("Agrega Redis");
    assert.match(out, /MODO EDICIÓN/);
    assert.match(out, /Agrega Redis/);
  });

  it("validateMddStructure exige secciones 1-7", () => {
    const incomplete = "# MDD\n\n## 1. Contexto\n\n## 2. Arquitectura";
    assert.equal(validateMddStructure(incomplete).ok, false);
    const complete = [
      "# MDD",
      "## 1. Contexto",
      "Producto de prueba con suficiente contenido para validación estructural.",
      "## 2. Arquitectura y Stack",
      "NestJS + Postgres.",
      "## 3. Modelo de Datos",
      "Entidad User.",
      "## 4. Contratos de API",
      "GET /health",
      "## 5. Lógica y Edge Cases",
      "Validación de entrada.",
      "## 6. Seguridad",
      "JWT.",
      "## 7. Infraestructura",
      "Docker.",
    ].join("\n\n");
    assert.equal(validateMddStructure(complete).ok, true);
  });
});
