import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesignFirstPhaseGates } from "@theforge/shared-types";
import {
  countProposalDiffChanges,
  formatDesignApiError,
  groupProposalDiff,
  summarizeDesignPhaseGate,
} from "./design-panels.util.js";

describe("design-panels.util", () => {
  it("agrupa diff add/update/remove", () => {
    const grouped = groupProposalDiff({
      add: {
        screens: [{ id: "s1", name: "Inicio", route: "/inicio", origin: { kind: "manual" }, components: [] }],
        navigation: [],
      },
      update: { screens: [], navigation: [] },
      remove: { screenIds: ["old"], navigationIds: [] },
    });
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0]?.section, "add");
    assert.equal(grouped[1]?.section, "remove");
    assert.equal(
      countProposalDiffChanges({
        add: {
          screens: [{ id: "s1", name: "Inicio", route: "/inicio", origin: { kind: "manual" }, components: [] }],
          navigation: [],
        },
        update: { screens: [], navigation: [] },
        remove: { screenIds: ["old"], navigationIds: [] },
      }),
      2,
    );
  });

  it("mensajes en español por código de error", () => {
    assert.match(
      formatDesignApiError("ERR_DESIGN_REVISION_CONFLICT", "fallback"),
      /revisión/i,
    );
    assert.match(formatDesignApiError("ERR_FIGMA_NOT_CONNECTED", "x"), /Ajustes/i);
    assert.match(formatDesignApiError(undefined, "Error custom"), /Error custom/);
  });

  it("resume puertas de fase", () => {
    const gates: DesignFirstPhaseGates = {
      phase1: { ok: true, issues: [] },
      phase2: { ok: false, issues: [{ path: "dataNeeds", message: "Faltan necesidades" }] },
      phase3: { ok: false, issues: [] },
    };
    assert.equal(summarizeDesignPhaseGate("phase1", gates).ok, true);
    assert.match(summarizeDesignPhaseGate("phase2", gates).detail, /Faltan/);
  });
});
