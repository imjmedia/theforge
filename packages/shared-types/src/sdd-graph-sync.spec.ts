import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMddCoherenceState, resolveSddGraphSyncState } from "./sdd-graph-sync.js";

describe("resolveMddCoherenceState", () => {
  it("marca empty cuando no hay §3/§4 indexables", () => {
    const status = resolveMddCoherenceState({
      expectedEntities: 0,
      expectedEndpoints: 0,
      entityCount: 0,
      endpointCount: 0,
      isCoherent: false,
    });
    assert.equal(status.state, "empty");
  });

  it("marca synced cuando coherencia OK", () => {
    const status = resolveMddCoherenceState({
      expectedEntities: 4,
      expectedEndpoints: 8,
      entityCount: 4,
      endpointCount: 8,
      isCoherent: true,
    });
    assert.equal(status.state, "synced");
    assert.equal(status.isCoherent, true);
  });

  it("marca stale cuando el MDD cambió tras evaluación previa", () => {
    const status = resolveMddCoherenceState({
      expectedEntities: 4,
      expectedEndpoints: 8,
      entityCount: 4,
      endpointCount: 8,
      isCoherent: true,
      mddChangedSinceSync: true,
    });
    assert.equal(status.state, "stale");
  });

  it("marca stale con huérfanos", () => {
    const status = resolveMddCoherenceState({
      expectedEntities: 2,
      expectedEndpoints: 3,
      entityCount: 2,
      endpointCount: 3,
      isCoherent: false,
      orphanEntityCount: 1,
      orphanEndpointCount: 1,
    });
    assert.equal(status.state, "stale");
    assert.match(status.message, /huérfano/i);
  });
});

describe("resolveSddGraphSyncState (legacy alias)", () => {
  it("delega en resolveMddCoherenceState", () => {
    const status = resolveSddGraphSyncState({
      falkorAvailable: true,
      expectedEntities: 2,
      expectedEndpoints: 2,
      graphEntities: 2,
      graphEndpoints: 2,
      isCoherent: true,
    });
    assert.equal(status.state, "synced");
  });
});
