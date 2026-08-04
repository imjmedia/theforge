import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntegrationHandoffItem } from "./project-integration.js";
import {
  buildTasksPreviewMarkdownFromTasksJson,
  hydrateTasksFromAriadnePack,
  normalizeAriadneTasksJsonSeedToStore,
  validateTasksJsonV2,
} from "./hydrate-tasks-from-ariadne-pack.util.js";

const SEED_PAYLOAD = {
  schemaVersion: "2",
  source: "ariadne",
  projectId: "11111111-1111-1111-1111-111111111111",
  changeDescription: "Integración costos",
  ariadneChangeId: "INT_COSTOS_V1",
  promotionScope: "integration_handoff",
  tasks: [
    {
      id: "T-001",
      title: "Wire costos API",
      files: ["src/pages/Catalogo.tsx"],
      symbols: ["CatalogoPage"],
      phase: "1-core",
      criterion: "Endpoint responde 200",
      status: "pending",
      source: "ariadne_change_plan_seed",
    },
  ],
};

describe("validateTasksJsonV2", () => {
  it("accepts valid seed payload", () => {
    const r = validateTasksJsonV2(SEED_PAYLOAD);
    assert.equal(r.ok, true);
  });

  it("rejects empty tasks", () => {
    const r = validateTasksJsonV2({ schemaVersion: "2", tasks: [] });
    assert.equal(r.ok, false);
  });

  it("rejects task without files", () => {
    const r = validateTasksJsonV2({
      schemaVersion: "2",
      source: "ariadne",
      projectId: "11111111-1111-1111-1111-111111111111",
      tasks: [{ id: "T-001", title: "X" }],
    });
    assert.equal(r.ok, false);
  });

  it("rejects missing source and projectId", () => {
    const r = validateTasksJsonV2({
      schemaVersion: "2",
      tasks: [{ id: "T-001", title: "X", files: ["a.ts"] }],
    });
    assert.equal(r.ok, false);
  });
});

describe("hydrateTasksFromAriadnePack", () => {
  const scopeItem: IntegrationHandoffItem = {
    id: "NEW-LEG-01",
    kind: "integration_scope",
    title: "Integration scope",
    description: JSON.stringify({
      mode: "integration_handoff",
      taskSource: "tasks_json_seed",
      taskSourceFallback: "cursor_tasks_markdown",
      skipBaselineDeliverables: ["migration_tasks", "change_spec"],
    }),
  };

  const seedItem: IntegrationHandoffItem = {
    id: "NEW-LEG-05",
    kind: "tasks_json_seed",
    title: "Tasks JSON seed",
    description: JSON.stringify(SEED_PAYLOAD),
  };

  it("hydrates tasks_json_seed via integration_scope", () => {
    const r = hydrateTasksFromAriadnePack({ handoffItems: [scopeItem, seedItem] });
    assert.ok(r);
    assert.equal(r!.source, "ariadne_tasks_json_seed");
    assert.ok(r!.tasksJson?.tasks?.length);
    assert.match(r!.tasksContent, /T-001/);
    assert.match(r!.tasksContent, /Catalogo\.tsx/);
    assert.deepEqual(r!.skipBaselineDeliverables, ["migration_tasks", "change_spec"]);
  });

  it("fallback to cursor_tasks_markdown when seed invalid", () => {
    const badSeed: IntegrationHandoffItem = {
      ...seedItem,
      description: JSON.stringify({ schemaVersion: "2", source: "ariadne", projectId: SEED_PAYLOAD.projectId, tasks: [] }),
    };
    const cursorItem: IntegrationHandoffItem = {
      id: "NEW-LEG-06",
      kind: "cursor_tasks_markdown",
      title: "Cursor tasks",
      description: `# Tasks\n\n---\nid: T-002\ntitle: Fallback\nfiles:\n  - src/a.ts\n---\n`,
    };
    const r = hydrateTasksFromAriadnePack({ handoffItems: [scopeItem, badSeed, cursorItem] });
    assert.ok(r);
    assert.equal(r!.source, "ariadne_cursor_tasks_markdown");
    assert.ok(r!.tasksJson?.tasks?.length);
    assert.equal((r!.tasksJson!.tasks[0] as { id: string }).id, "T-002");
  });
});

describe("buildTasksPreviewMarkdownFromTasksJson", () => {
  it("renders checkboxes and file paths", () => {
    const store = normalizeAriadneTasksJsonSeedToStore(SEED_PAYLOAD);
    const md = buildTasksPreviewMarkdownFromTasksJson(store);
    assert.match(md, /- \[ \] T-001: Wire costos API/);
    assert.match(md, /Catalogo\.tsx/);
  });
});
