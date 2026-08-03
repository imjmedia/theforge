import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ariadneChangePackV1Schema,
  isAriadneMigrationTasksPack,
} from "./ariadne-change-pack.js";

describe("ariadneChangePackV1Schema", () => {
  it("accepts cursor_tasks_markdown snake_case alias", () => {
    const parsed = ariadneChangePackV1Schema.parse({
      version: "1",
      changeDescription: "Batch",
      cursor_tasks_markdown: "# Tasks\n- [ ] A",
      handoff_plan_type: "migration_tasks",
    });
    assert.equal(parsed.cursorTasksMarkdown, "# Tasks\n- [ ] A");
    assert.equal(parsed.handoffPlanType, "migration_tasks");
  });
});

describe("isAriadneMigrationTasksPack", () => {
  it("detects migration_tasks plan type", () => {
    assert.equal(
      isAriadneMigrationTasksPack({
        handoffPlanType: "migration_tasks",
        changeDescription: "x",
        version: "1",
      } as never),
      true,
    );
  });

  it("respects full_cascade override", () => {
    assert.equal(
      isAriadneMigrationTasksPack({
        handoffPlanType: "full_cascade",
        cursorTasksMarkdown: "# Tasks",
        version: "1",
        changeDescription: "x",
      } as never),
      false,
    );
  });
});
