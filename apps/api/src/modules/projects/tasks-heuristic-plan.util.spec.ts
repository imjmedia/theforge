import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHeuristicTasksPlan } from "./tasks-heuristic-plan.util.js";

describe("tasks-heuristic-plan", () => {
  it("builds plan from API endpoints and pantalla routes", () => {
    const plan = buildHeuristicTasksPlan({
      mddMarkdown: "## 1. Contexto\nCopiloto\n## 7. Infra\nDocker Redis",
      apiContractsMarkdown: `
| POST | /api/v1/tenants | Crear |
| GET | /api/v1/tenants | Listar |
| POST | /api/v1/messages/process | Procesar |
`,
      uiScreensMarkdown: `
| /admin/tenants | Page | — | Table | GET /api/v1/tenants | ok |
| /admin/proc-cap-foo | Page | — | Table | — | junk |
| /chat | Page | — | ChatShell | — | ok |
`,
      hasUxTeam: false,
    });

    assert.ok(plan.items.length >= 5);
    assert.ok(plan.items.some((i) => i.layer === "Backend" && /POST.*tenants/i.test(i.title)));
    assert.ok(plan.items.some((i) => i.layer === "Backend" && /GET.*tenants/i.test(i.title)));
    assert.ok(plan.items.some((i) => i.layer === "Frontend" && i.title.includes("/admin/tenants")));
    assert.ok(!plan.items.some((i) => i.title.includes("proc-cap")));
    assert.ok(plan.items.some((i) => i.layer === "Infra"));
    assert.ok(plan.items.some((i) => i.layer === "QA"));
    assert.equal(plan.items[0]!.id, "T-001");
  });
});
