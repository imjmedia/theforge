import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHandoffTasksMarkdown,
  resolveIntegrationHandoffTasksMarkdown,
  shouldSkipLegacyTasksGeneration,
} from "./integration-handoff-tasks.util.js";

describe("resolveIntegrationHandoffTasksMarkdown", () => {
  it("prefers Ariadne hydration over handoff checklist", () => {
    const r = resolveIntegrationHandoffTasksMarkdown({
      cursorTasksMarkdown: "# Tasks\n- [ ] T-001",
      handoffItems: [{ id: "NEW-LEG-01", title: "X", description: "Y" }],
    });
    assert.equal(r?.source, "ariadne_cursor_tasks_markdown");
    assert.match(r?.markdown ?? "", /T-001/);
  });

  it("builds from handoff items when no cursor markdown", () => {
    const r = resolveIntegrationHandoffTasksMarkdown({
      handoffItems: [{ id: "NEW-LEG-01", title: "Login", description: "OAuth flow" }],
    });
    assert.equal(r?.source, "handoff_items");
    assert.match(r?.markdown ?? "", /NEW-LEG-01/);
    assert.match(r?.markdown ?? "", /Login/);
  });
});

describe("shouldSkipLegacyTasksGeneration", () => {
  it("returns true when integrationHandoffTasks is set", () => {
    assert.equal(
      shouldSkipLegacyTasksGeneration({
        legacyChangeState: {
          integrationHandoffTasks: { source: "handoff_items", importedAt: "2026-01-01T00:00:00Z" },
        },
      }),
      true,
    );
  });

  it("returns false for baseline stage without handoff meta", () => {
    assert.equal(shouldSkipLegacyTasksGeneration({ legacyChangeState: {} }), false);
  });
});

describe("buildHandoffTasksMarkdown", () => {
  it("includes acceptance criteria as nested checkboxes", () => {
    const md = buildHandoffTasksMarkdown([
      {
        id: "NEW-LEG-01",
        title: "API",
        description: "Expose endpoint",
        acceptanceCriteria: ["Returns 200", "Validates input"],
      },
    ]);
    assert.match(md, /Returns 200/);
    assert.match(md, /Validates input/);
  });
});
