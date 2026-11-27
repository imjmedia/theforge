import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyGap } from "@theforge/shared-types";
import { getGapLocationChips } from "./gapLocation.js";

describe("getGapLocationChips", () => {
  it("[Integración websocket_gateway] apunta a API, Arquitectura e Infra con panel", () => {
    const gap = classifyGap(
      "[Integración] websocket_gateway sin API contracts, Architecture ni Infra",
    );
    assert.deepEqual(getGapLocationChips(gap), [
      { deliverable: "api_contracts", label: "API", panelId: "api-contracts" },
      { deliverable: "architecture", label: "Arquitectura", panelId: "architecture" },
      { deliverable: "infra", label: "Infra", panelId: "infra" },
    ]);
  });

  it("[Events] apunta a Flujos", () => {
    const gap = classifyGap("[Events] evento sin logic-flows");
    assert.deepEqual(getGapLocationChips(gap), [
      { deliverable: "logic_flows", label: "Flujos", panelId: "logic-flows" },
    ]);
  });

  it("brecha humana apunta al BRD", () => {
    const chips = getGapLocationChips({ targetDeliverables: ["brd"] });
    assert.deepEqual(chips, [{ deliverable: "brd", label: "BRD", panelId: "brd" }]);
  });

  it("id desconocido queda sin clic y sin destinos devuelve vacío", () => {
    assert.deepEqual(getGapLocationChips({ targetDeliverables: ["xyz", "xyz"] }), [
      { deliverable: "xyz", label: "xyz", panelId: null },
    ]);
    assert.deepEqual(getGapLocationChips({}), []);
  });
});
