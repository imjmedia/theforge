import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSkipBaselineDeliverableKinds, shouldSkipLegacyGenerateDeliverables } from "./skip-baseline-deliverables.util.js";
import { mergeTasksJsonIdempotent } from "./merge-tasks-json-idempotent.util.js";
import { parseAriadneCursorTasksMarkdown } from "./parse-ariadne-cursor-tasks-markdown.util.js";

describe("skip-baseline-deliverables", () => {
  it("maps Ariadne keys to Forge deliverable kinds", () => {
    const kinds = resolveSkipBaselineDeliverableKinds(
      ["migration_tasks", "change_spec", "data_model", "mdd_full"],
      { skipTasksFromHandoff: false },
    );
    assert.ok(kinds.includes("tasks"));
    assert.ok(kinds.includes("spec"));
    assert.ok(kinds.includes("architecture"));
    assert.ok(kinds.includes("mdd_canonical"));
  });

  it("shouldSkipLegacyGenerateDeliverables when migration_tasks listed", () => {
    assert.equal(shouldSkipLegacyGenerateDeliverables(["migration_tasks"]), true);
    assert.equal(shouldSkipLegacyGenerateDeliverables(["change_spec"]), false);
  });
});

describe("mergeTasksJsonIdempotent", () => {
  const incoming = {
    version: "2.0",
    schemaVersion: "2",
    source: "ariadne",
    projectId: "11111111-1111-1111-1111-111111111111",
    generatedAt: "2026-08-03T12:00:00.000Z",
    tasks: [
      { id: "T-001", title: "New title", status: "pending", files: ["a.ts"] },
      { id: "T-002", title: "Added", status: "pending", files: ["b.ts"] },
    ],
  };

  it("merges by id preserving done tasks", () => {
    const existing = {
      version: "2.0",
      tasks: [
        { id: "T-001", title: "Old", status: "done", files: ["a.ts"] },
      ],
    };
    const merged = mergeTasksJsonIdempotent(existing, incoming);
    assert.equal(merged.tasks.length, 2);
    assert.equal((merged.tasks[0] as { title: string }).title, "Old");
  });

  it("replaces when forceRefresh", () => {
    const existing = { version: "2.0", tasks: [{ id: "T-001", title: "Old", status: "done", files: ["a.ts"] }] };
    const merged = mergeTasksJsonIdempotent(existing, incoming, { forceRefresh: true });
    assert.equal((merged.tasks[0] as { title: string }).title, "New title");
  });
});

describe("parseAriadneCursorTasksMarkdown", () => {
  it("parses YAML blocks with files array", () => {
    const md = `# Tasks

## Backend tasks

---
id: T-001
title: Wire API
files:
  - src/api.ts
depends_on:
  - T-000
---

`;
    const r = parseAriadneCursorTasksMarkdown(md, {
      projectId: "11111111-1111-1111-1111-111111111111",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.payload.tasks.length, 1);
    assert.equal((r.payload.tasks[0] as { id: string }).id, "T-001");
  });
});
