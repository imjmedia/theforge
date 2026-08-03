import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLegacyChangeStateFromAriadnePack,
  buildRecommendedNextToolsAfterAriadnePack,
  defaultStageNameFromAriadnePack,
  preprocessCreateStageFromAriadneChangePackBody,
  shouldRunLegacyStartForAriadnePack,
} from "./apply-ariadne-change-pack.util.js";

describe("preprocessCreateStageFromAriadneChangePackBody", () => {
  it("remaps LEG-xx ids before parse", () => {
    const { bodyForParse, handoffIdRemaps } = preprocessCreateStageFromAriadneChangePackBody({
      forgeProjectId: "550e8400-e29b-41d4-a716-446655440099",
      pack: {
        version: "1",
        changeDescription: "Batch",
        handoffItems: [{ id: "LEG-04", title: "T", description: "D" }],
      },
    });
    assert.equal(handoffIdRemaps.length, 1);
    assert.equal(handoffIdRemaps[0]?.to, "NEW-LEG-04");
    const items = (bodyForParse as { pack: { handoffItems: { id: string }[] } }).pack.handoffItems;
    assert.equal(items[0]?.id, "NEW-LEG-04");
  });
});

describe("buildLegacyChangeStateFromAriadnePack", () => {
  it("maps files and questions from pack", () => {
    const state = buildLegacyChangeStateFromAriadnePack(
      {
        version: "1",
        changeDescription: "Add discount module",
        filesToModify: [{ path: "src/discount.ts" }],
        questionsToRefine: ["Max discount?"],
        ariadneChangeId: "CHG-42",
      },
      "repo-uuid",
    );
    assert.equal(state.description, "Add discount module");
    assert.deepEqual(state.filesToModify, [{ path: "src/discount.ts", repoId: "repo-uuid" }]);
    assert.deepEqual(state.questions, ["Max discount?"]);
    assert.equal((state.ariadneChangePack as { ariadneChangeId: string }).ariadneChangeId, "CHG-42");
  });
});

describe("shouldRunLegacyStartForAriadnePack", () => {
  it("skips legacy/start when pack already has files", () => {
    assert.equal(
      shouldRunLegacyStartForAriadnePack(
        { version: "1", changeDescription: "x", filesToModify: [{ path: "a.ts" }] },
        undefined,
        true,
      ),
      false,
    );
  });

  it("honours explicit runLegacyStart", () => {
    assert.equal(
      shouldRunLegacyStartForAriadnePack({ version: "1", changeDescription: "x" }, true, false),
      true,
    );
  });
});

describe("defaultStageNameFromAriadnePack", () => {
  it("prefers ariadneChangeId", () => {
    assert.match(
      defaultStageNameFromAriadnePack({
        version: "1",
        changeDescription: "long description",
        ariadneChangeId: "parity-2026-07",
      }),
      /parity-2026-07/,
    );
  });
});

describe("buildRecommendedNextToolsAfterAriadnePack", () => {
  it("includes legacy_answer when there are questions", () => {
    const tools = buildRecommendedNextToolsAfterAriadnePack({ questionsCount: 2, hasHandoffItems: false });
    assert.ok(tools.some((t) => t.tool === "legacy_answer"));
    assert.ok(tools.some((t) => t.tool === "legacy_generate_mdd"));
  });

  it("suggests get_next_implementation_task when migrationTasksMode", () => {
    const tools = buildRecommendedNextToolsAfterAriadnePack({
      questionsCount: 0,
      hasHandoffItems: true,
      migrationTasksMode: true,
    });
    const deliverables = tools.find((t) => t.tool === "legacy_generate_deliverables");
    assert.deepEqual(deliverables?.skipDeliverableKinds, ["tasks"]);
    assert.ok(tools.some((t) => t.tool === "get_next_implementation_task"));
  });
});
