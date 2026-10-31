import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectGenerationGuardService } from "./project-generation-guard.service.js";

function makeGuard(): ProjectGenerationGuardService {
  return new ProjectGenerationGuardService({} as never, {} as never, {} as never, {} as never, {} as never);
}

describe("ProjectGenerationGuardService MDD stream registry", () => {
  it("cuenta referencias: cerrar un stream no deja inactivo a otro del mismo proyecto", () => {
    const guard = makeGuard();
    guard.registerMddStream("p1");
    guard.registerMddStream("p1");
    guard.unregisterMddStream("p1");
    assert.equal(guard.isMddStreamActive("p1"), true);
    guard.unregisterMddStream("p1");
    assert.equal(guard.isMddStreamActive("p1"), false);
  });

  it("unregister sin registro previo no deja contadores negativos", () => {
    const guard = makeGuard();
    guard.unregisterMddStream("p1");
    guard.registerMddStream("p1");
    assert.equal(guard.isMddStreamActive("p1"), true);
  });

  it("forceUnregister libera todas las referencias y listActive refleja el estado", () => {
    const guard = makeGuard();
    guard.registerMddStream("p1");
    guard.registerMddStream("p1");
    guard.registerMddStream("p2");
    assert.deepEqual(guard.listActiveMddStreamProjectIds().sort(), ["p1", "p2"]);
    guard.forceUnregisterMddStream("p1");
    assert.equal(guard.isMddStreamActive("p1"), false);
    assert.deepEqual(guard.listActiveMddStreamProjectIds(), ["p2"]);
  });
});
