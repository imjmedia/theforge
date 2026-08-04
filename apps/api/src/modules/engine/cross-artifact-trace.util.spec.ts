import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCrossArtifactTraceReport } from "./cross-artifact-trace.util.js";

describe("cross-artifact-trace", () => {
  it("detects admin route without AdminShell doc", () => {
    const ui = [
      "| /admin/users | UsersPage | US-1 | DataTable | GET /api/v1/users | loading | AppShell | sm stack |",
    ].join("\n");
    const report = buildCrossArtifactTraceReport({ uiScreensMarkdown: ui });
    assert.ok(report.gaps.some((g) => g.kind === "surface_without_shell"));
  });

  it("detects Frontend task missing Responsive line", () => {
    const tasks = [
      "# Tasks",
      "## Frontend tasks",
      "---",
      "id: T-010",
      "section: Frontend",
      "title: UI /dashboard",
      "target_files: [apps/web/src/views/Dashboard.tsx]",
      "change_type: create",
      "---",
      "- [ ] build dashboard",
    ].join("\n");
    const report = buildCrossArtifactTraceReport({ tasksMarkdown: tasks });
    assert.ok(report.gaps.some((g) => g.kind === "task_ui_missing_responsive"));
  });

  it("passes when Frontend task includes Responsive", () => {
    const tasks = [
      "# Tasks",
      "## Frontend tasks",
      "---",
      "id: T-010",
      "section: Frontend",
      "title: UI /dashboard",
      "target_files: [apps/web/src/views/Dashboard.tsx]",
      "change_type: create",
      "---",
      "- [ ] build dashboard\n  Responsive: sm cards md table",
    ].join("\n");
    const report = buildCrossArtifactTraceReport({ tasksMarkdown: tasks });
    assert.ok(!report.gaps.some((g) => g.kind === "task_ui_missing_responsive"));
  });
});
