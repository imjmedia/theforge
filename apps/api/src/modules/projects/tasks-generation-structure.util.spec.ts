import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTasksStructure,
  extractPantallaRoutes,
  isTasksDocumentTruncated,
} from "./tasks-generation-structure.util.js";

const API = [
  "| GET | `/api/v1/tenants` | list | JWT |",
  "| POST | `/api/v1/auth/login` | login | No |",
].join("\n");

describe("tasks-generation-structure", () => {
  it("detecta truncado con front-matter abierto", () => {
    const md = "# Tasks\n\n---\nid: T-020\ntitle: Incomplete\ntarget_files:\n  - apps/backend/src/application/\n";
    assert.equal(isTasksDocumentTruncated(md), true);
  });

  it("exige Frontend cuando hay pantallas", () => {
    const ui = [
      "| /dashboard | Dash | US-1 | Table | GET /api/v1/tenants | loading |",
      "| /login | Login | US-2 | Form | POST /api/v1/auth/login | loading |",
      "| /admin/mcp | MCP | US-3 | Wizard | GET /api/v1/mcp-plugins | loading |",
    ].join("\n");
    const tasks = [
      "# Tasks",
      "## Backend tasks",
      "---",
      "id: T-001",
      "section: Backend",
      "title: API",
      "target_files: [a.ts]",
      "change_type: create",
      "---",
      "- [ ] task",
      "## Infra tasks",
      "---",
      "id: T-002",
      "section: Infra",
      "title: Docker",
      "target_files: [docker-compose.yml]",
      "change_type: configure",
      "---",
      "- [ ] infra",
    ].join("\n");

    const report = evaluateTasksStructure({
      tasksMarkdown: tasks,
      uiScreensMarkdown: ui,
      apiContractsMarkdown: API,
      mddMarkdown: "## 1. Contexto\nApp\n## 7. Infra\nDocker",
    });
    assert.equal(report.ok, false);
    assert.ok(report.gaps.some((g) => /Frontend/i.test(g)));
  });

  it("extrae rutas de pantallas.md", () => {
    const routes = extractPantallaRoutes("| /admin/mcp | Page | — | Wizard | GET /api/v1/mcp-plugins | ok |");
    assert.deepEqual(routes, ["/admin/mcp"]);
  });

  it("exige Frontend cuando MDD declara superficie web sin pantallas", () => {
    const mdd = "## 2. Stack\n\nReact 18 + Vite + Tailwind\n## 7. Infra\nDocker";
    const tasks = [
      "# Tasks",
      "## Backend tasks",
      "---",
      "id: T-001",
      "section: Backend",
      "title: API",
      "target_files: [a.ts]",
      "change_type: create",
      "---",
      "- [ ] task",
      "## Infra tasks",
      "---",
      "id: T-002",
      "section: Infra",
      "title: Docker",
      "target_files: [docker-compose.yml]",
      "change_type: configure",
      "---",
      "- [ ] infra",
    ].join("\n");

    const report = evaluateTasksStructure({
      tasksMarkdown: tasks,
      mddMarkdown: mdd,
      blueprintMarkdown: "# Blueprint\n\nReact SPA",
    });
    assert.ok(report.gaps.some((g) => /Frontend|superficie web/i.test(g)));
  });
});
