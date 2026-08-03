import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStageFromAriadneChangePackInputSchema } from "./ariadne-change-pack.js";
import {
  extractHandoffItemSequenceHint,
  normalizeAriadneHandoffItemsRaw,
  toForgeNewLegId,
} from "./ariadne-handoff-normalize.util.js";

describe("extractHandoffItemSequenceHint", () => {
  it("parses NEW-LEG, LEG and suffixed ids", () => {
    assert.equal(extractHandoffItemSequenceHint("NEW-LEG-01"), 1);
    assert.equal(extractHandoffItemSequenceHint("NEW-LEG-1"), 1);
    assert.equal(extractHandoffItemSequenceHint("LEG-03"), 3);
    assert.equal(extractHandoffItemSequenceHint("CHG-7"), 7);
  });

  it("returns null for ids without digits", () => {
    assert.equal(extractHandoffItemSequenceHint("uuid-no-digits"), null);
    assert.equal(extractHandoffItemSequenceHint(""), null);
  });
});

describe("normalizeAriadneHandoffItemsRaw", () => {
  it("maps LEG-01 and NEW-LEG-1 to canonical NEW-LEG-NN", () => {
    const { items, remapped } = normalizeAriadneHandoffItemsRaw([
      { id: "LEG-01", title: "A", description: "Desc A" },
      { id: "NEW-LEG-1", title: "B", description: "Desc B" },
    ]);
    assert.deepEqual(
      items.map((i) => i.id),
      ["NEW-LEG-01", "NEW-LEG-02"],
    );
    assert.equal(remapped.length, 2);
    assert.deepEqual(remapped[0], { from: "LEG-01", to: "NEW-LEG-01" });
    assert.deepEqual(remapped[1], { from: "NEW-LEG-1", to: "NEW-LEG-02" });
  });

  it("assigns sequential ids for opaque ids and resolves collisions", () => {
    const { items } = normalizeAriadneHandoffItemsRaw([
      { id: "550e8400-e29b-41d4-a716-446655440000", title: "A", description: "x" },
      { id: "550e8400-e29b-41d4-a716-446655440001", title: "B", description: "y" },
    ]);
    assert.deepEqual(items.map((i) => i.id), ["NEW-LEG-01", "NEW-LEG-02"]);
  });

  it("keeps valid NEW-LEG ids unchanged", () => {
    const { items, remapped } = normalizeAriadneHandoffItemsRaw([
      { id: "NEW-LEG-01", title: "A", description: "x" },
      { id: "NEW-LEG-12", title: "B", description: "y" },
    ]);
    assert.deepEqual(items.map((i) => i.id), ["NEW-LEG-01", "NEW-LEG-12"]);
    assert.equal(remapped.length, 0);
  });
});

describe("createStageFromAriadneChangePackInputSchema + handoff normalize", () => {
  const forgeProjectId = "550e8400-e29b-41d4-a716-446655440099";

  it("accepts Ariadne-style handoff ids after preprocess", () => {
    const parsed = createStageFromAriadneChangePackInputSchema.parse({
      forgeProjectId,
      pack: {
        version: "1",
        changeDescription: "Batch from Ariadne",
        handoffItems: Array.from({ length: 12 }, (_, i) => ({
          id: `LEG-${String(i + 1).padStart(2, "0")}`,
          title: `Item ${i + 1}`,
          description: `Description ${i + 1}`,
        })),
      },
    });
    assert.equal(parsed.pack.handoffItems?.length, 12);
    assert.ok(parsed.pack.handoffItems?.every((it) => /^NEW-LEG-\d{2,}$/.test(it.id)));
    assert.equal(parsed.pack.handoffItems?.[0]?.id, "NEW-LEG-01");
    assert.equal(parsed.pack.handoffItems?.[11]?.id, "NEW-LEG-12");
  });
});

describe("toForgeNewLegId", () => {
  it("pads to two digits minimum", () => {
    assert.equal(toForgeNewLegId(1), "NEW-LEG-01");
    assert.equal(toForgeNewLegId(12), "NEW-LEG-12");
  });
});
