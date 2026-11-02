import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSsotPatternsNotice,
  isWorkshopConnectionError,
  SSOT_PATTERNS_RESTORED_NOTICE,
} from "./workshopSyncStatus.js";

describe("workshopSyncStatus", () => {
  it("SSOT notice is not a connection error", () => {
    assert.equal(isSsotPatternsNotice(SSOT_PATTERNS_RESTORED_NOTICE), true);
    assert.equal(isWorkshopConnectionError(SSOT_PATTERNS_RESTORED_NOTICE), false);
  });

  it("detects offline persist messages", () => {
    assert.equal(
      isWorkshopConnectionError("Sin conexión: Failed to fetch. Cambio guardado localmente."),
      true,
    );
    assert.equal(isWorkshopConnectionError("Error de red al guardar"), true);
  });

  it("ignores generic operation errors", () => {
    assert.equal(isWorkshopConnectionError("Error al generar MDD"), false);
  });
});
