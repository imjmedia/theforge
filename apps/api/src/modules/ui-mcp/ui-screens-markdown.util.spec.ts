import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUiScreensMarkdown } from "./ui-screens-markdown.util.js";
import type { PantallaPlanItem } from "./ui-screens-plan.util.js";

const PLAN: PantallaPlanItem[] = [
  {
    name: "orders",
    screenName: "Tablero de Órdenes",
    purpose: "Gestión visual del flujo de órdenes.",
    source: "entity+hu",
    role: "Inversor",
    route: "/orders",
    pageName: "OrdersPage",
    uiStates: "loading, empty, error",
    primaryApi: "GET /api/orders",
    userStoryId: "US-001",
    classification: "WorkflowProcess",
  },
];

describe("buildUiScreensMarkdown", () => {
  it("devuelve null sin plan", () => {
    assert.equal(buildUiScreensMarkdown([], []), null);
  });

  it("genera tablas por rol con ruta, componentes y API (sin TSX)", () => {
    const md = buildUiScreensMarkdown(
      [
        {
          name: "Tablero de Órdenes",
          purpose: "Gestión visual del flujo de órdenes.",
          components: [
            {
              component: "KanbanBoardPro",
              package: "@acme/ui",
              version: "2.1.0",
              entity: "orders",
              props: { columns: "orders.status" },
            },
          ],
          endpoints: ["GET /api/orders"],
        },
      ],
      PLAN,
      { projectName: "Demo", libraryName: "Acme UI", libraryVersion: "2.1.0" },
    );
    assert.ok(md);
    assert.match(md!, /# Pantallas — Demo/);
    assert.match(md!, /## Inversor/);
    assert.match(md!, /\| \/orders \| OrdersPage \| US-001 \|/);
    assert.match(md!, /KanbanBoardPro/);
    assert.match(md!, /Layout transversal/);
    assert.ok(!md!.includes("```tsx"));
  });

  it("anexo catálogo solo lista rutas v1 en tablas (sin ghost /gestion-*)", () => {
    const plan: PantallaPlanItem[] = [
      {
        name: "orders",
        screenName: "Órdenes",
        purpose: "Listado",
        source: "entity",
        role: "Admin",
        route: "/admin/orders",
        pageName: "OrdersPage",
        v1InScope: true,
        primaryApi: "GET /api/v1/orders",
        keyFields: ["id"],
        classification: "DataRegistry",
        uiHint: "table",
      },
      {
        name: "zombie",
        screenName: "Gestión de legacy",
        purpose: "Fuera",
        source: "entity",
        role: "Admin",
        route: "/gestion-legacy",
        v1InScope: false,
        keyFields: ["id"],
        classification: "DataRegistry",
      },
    ];
    const md = buildUiScreensMarkdown(
      [
        {
          name: "Órdenes",
          purpose: "Listado",
          components: [{ component: "DataTable", package: "@scope/ui", entity: "orders" }],
          endpoints: ["GET /api/v1/orders"],
        },
      ],
      plan,
      { projectName: "Demo", libraryName: "Acme UI" },
    );
    assert.ok(md);
    assert.match(md!, /\/admin\/orders/);
    assert.ok(!md!.includes("/gestion-legacy"));
  });
});
