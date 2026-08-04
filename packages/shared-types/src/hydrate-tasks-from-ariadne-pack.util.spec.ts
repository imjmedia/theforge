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
  projectId: "11111111-1111-4111-8111-111111111111",
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
      projectId: "11111111-1111-4111-8111-111111111111",
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
    id: "ARIADNE-ART-01",
    kind: "integration_scope",
    title: "Integration scope",
    description: JSON.stringify({
      mode: "integration_handoff",
      taskSource: "cursor_tasks_markdown",
      taskSourceFallback: "tasks_json_seed",
      taskSourceGraph: "change_plan_seed",
      skipBaselineDeliverables: ["migration_tasks", "change_spec"],
    }),
  };

  const cursorMd = `# Tasks

## Frontend tasks
---
id: T-010
title: Wire costos UI
files:
  - src/pages/Catalogo.tsx
---
- [ ] T-010

## Backend tasks
_Sin tareas._

## Infraestructura tasks
_Sin tareas._

## Testing tasks
_Sin tareas._

## Deploy tasks
_Sin tareas._
`;

  const cursorItem: IntegrationHandoffItem = {
    id: "ARIADNE-ART-07",
    kind: "cursor_tasks_markdown",
    title: "Cursor tasks",
    description: cursorMd,
  };

  const seedItem: IntegrationHandoffItem = {
    id: "ARIADNE-ART-05",
    kind: "tasks_json_seed",
    title: "Tasks JSON seed",
    description: JSON.stringify(SEED_PAYLOAD),
  };

  it("hydrates cursor_tasks_markdown first via integration_scope", () => {
    const r = hydrateTasksFromAriadnePack({ handoffItems: [scopeItem, seedItem, cursorItem] });
    assert.ok(r);
    assert.equal(r!.source, "ariadne_cursor_tasks_markdown");
    assert.ok(r!.tasksJson?.tasks?.length);
    assert.equal((r!.tasksJson!.tasks[0] as { id: string }).id, "T-010");
    assert.deepEqual(r!.skipBaselineDeliverables, ["migration_tasks", "change_spec"]);
  });

  it("falls back to tasks_json_seed when markdown missing", () => {
    const scopeSeedFirst: IntegrationHandoffItem = {
      ...scopeItem,
      description: JSON.stringify({
        mode: "integration_handoff",
        taskSource: "tasks_json_seed",
        taskSourceFallback: "cursor_tasks_markdown",
      }),
    };
    const r = hydrateTasksFromAriadnePack({ handoffItems: [scopeSeedFirst, seedItem] });
    assert.ok(r);
    assert.equal(r!.source, "ariadne_tasks_json_seed");
    assert.equal((r!.tasksJson!.tasks[0] as { id: string }).id, "T-001");
  });

  it("fallback to cursor_tasks_markdown when seed invalid", () => {
    const badSeed: IntegrationHandoffItem = {
      ...seedItem,
      description: JSON.stringify({ schemaVersion: "2", source: "ariadne", projectId: SEED_PAYLOAD.projectId, tasks: [] }),
    };
    const cursorFallback: IntegrationHandoffItem = {
      id: "ARIADNE-ART-07",
      kind: "cursor_tasks_markdown",
      title: "Cursor tasks",
      description: `# Tasks\n\n---\nid: T-002\ntitle: Fallback\nfiles:\n  - src/a.ts\n---\n`,
    };
    const r = hydrateTasksFromAriadnePack({ handoffItems: [scopeItem, badSeed, cursorFallback] });
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
