import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDesignSpec } from "@theforge/shared-types";
import {
  buildHeuristicDataNeeds,
  listDataNeedsGaps,
  mergeDataNeedsByScreen,
} from "./data-needs-heuristic.util.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/shared-types/src/design-first/__fixtures__/three-screens.json",
);

describe("data-needs-heuristic.util", () => {
  const spec = parseDesignSpec(JSON.parse(readFileSync(fixturePath, "utf8")));

  it("genera needs heuristic para DataGrid y Form", () => {
    const patch = buildHeuristicDataNeeds(spec);
    assert.ok(patch.some((e) => e.screenId === "order-list"));
    const list = patch.find((e) => e.screenId === "order-list")!;
    const tableNeed = list.components.find((c) => c.componentId === "orders-table")!.needs[0]!;
    assert.equal(tableNeed.provenance, "heuristic");
    assert.equal(tableNeed.many, true);
    assert.match(tableNeed.type, /Order\[\]/);

    const detail = patch.find((e) => e.screenId === "order-detail")!;
    const formNeed = detail.components.find((c) => c.componentId === "order-form")!.needs[0]!;
    assert.equal(formNeed.provenance, "heuristic");
    assert.equal(formNeed.origin, "entity");
  });

  it("no genera needs para pantalla static sin componentes", () => {
    const patch = buildHeuristicDataNeeds(spec);
    assert.ok(!patch.some((e) => e.screenId === "home"));
  });

  it("listDataNeedsGaps excluye componentes cubiertos por heurística", () => {
    const bare = { ...spec, dataNeeds: [] as typeof spec.dataNeeds };
    const patch = buildHeuristicDataNeeds(bare);
    const merged = mergeDataNeedsByScreen([], patch);
    const gaps = listDataNeedsGaps(bare, merged);
    assert.ok(!gaps.some((g) => g.componentId === "orders-table"));
    assert.ok(!gaps.some((g) => g.componentId === "order-form"));
    assert.ok(gaps.some((g) => g.componentId === "btn-new-order"));
  });

  it("marca provenance heuristic en todos los needs generados", () => {
    for (const entry of buildHeuristicDataNeeds(spec)) {
      for (const block of entry.components) {
        for (const need of block.needs) {
          assert.equal(need.provenance, "heuristic");
        }
      }
    }
  });
});
