import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMddDraftPersistFloor } from "./mdd-draft-persist-floor.util.js";

describe("evaluateMddDraftPersistFloor", () => {
  it("bloquea el escenario del job 92: esqueleto de 3084 sobre MDD de 70k", () => {
    const result = evaluateMddDraftPersistFloor({
      candidateLen: 3_084,
      storedBaselineLen: 70_579,
      finalize: false,
    });
    assert.equal(result.allowed, false);
    assert.match(String(result.reason), /3084 chars descartado/);
  });

  it("nunca bloquea la escritura final aunque encoja", () => {
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 3_084, storedBaselineLen: 70_579, finalize: true })
        .allowed,
      true,
    );
  });

  it("permite borradores intermedios que crecen con normalidad", () => {
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 45_000, storedBaselineLen: 70_579, finalize: false })
        .allowed,
      true,
    );
  });

  it("no aplica suelo cuando no hay MDD sustancial almacenado", () => {
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 3_084, storedBaselineLen: 0, finalize: false })
        .allowed,
      true,
    );
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 900, storedBaselineLen: 3_500, finalize: false })
        .allowed,
      true,
    );
  });

  it("acepta exactamente el 50% del baseline", () => {
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 5_000, storedBaselineLen: 10_000, finalize: false })
        .allowed,
      true,
    );
    assert.equal(
      evaluateMddDraftPersistFloor({ candidateLen: 4_999, storedBaselineLen: 10_000, finalize: false })
        .allowed,
      false,
    );
  });
});
