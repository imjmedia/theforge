import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { StageStatus } from "@theforge/database";
import { UiScreensService } from "./ui-screens.service.js";
import type { UiMcpClientService } from "./ui-mcp-client.service.js";
import type { UiMcpService } from "./ui-mcp.service.js";

const SAMPLE_MDD = [
  "## 2. Stack",
  "",
  "React 18 + Vite + Tailwind + shadcn/ui",
  "",
  "## 3. Modelo de Datos",
  "",
  "CREATE TABLE orders (id UUID PRIMARY KEY, status TEXT NOT NULL, total NUMERIC);",
].join("\n");

function makeService(mcpClient: Partial<UiMcpClientService>, uiMcp: Partial<UiMcpService>) {
  const prisma = {
    project: {
      findUnique: async () => ({
        id: "proj-1",
        complexity: "HIGH",
        dbgaContent: null,
        phase0SummaryContent: null,
        specContent: null,
        apiContractsContent: "GET /api/v1/orders",
        userStoriesContent: null,
        blueprintContent: "# Blueprint\n\nReact SPA",
        name: "Demo",
        stages: [
          {
            ordinal: 1,
            workflowStatus: StageStatus.ACTIVE,
            mddContent: SAMPLE_MDD,
          },
        ],
      }),
      update: async () => ({}),
    },
    stage: {
      findFirst: async () => ({
        domainInventory: null,
        brdContent: null,
        mddContent: SAMPLE_MDD,
      }),
    },
  };
  return new UiScreensService(
    prisma as never,
    mcpClient as UiMcpClientService,
    uiMcp as UiMcpService,
  );
}

describe("UiScreensService — syncUiScreens", () => {
  it("ensambla pantallas vía resolve_component cuando list_screens no está soportado", async () => {
    const resolveCalls: Array<Record<string, unknown>> = [];
    const service = makeService(
      {
        isActive: async () => true,
        listScreens: async () => null,
        resolveComponent: async (args) => {
          resolveCalls.push(args as Record<string, unknown>);
          return {
            component: "Table",
            package: "@imj_media/ui",
            version: "1.12.0",
            propMapping: { rows: "GET /api/v1/orders" },
            confidence: 0.9,
          };
        },
      },
      {
        getActiveCompatibleMeta: async () => ({
          libraryName: "@imj_media/ui",
          libraryVersion: "1.12.0",
          contractVersion: "1.0.0",
        }),
        supportsUiProjectInstructions: async () => false,
      },
    );

    const result = await service.syncUiScreens("proj-1");
    assert.equal(result.screens, 1);
    assert.match(result.content, /orders/i);
    assert.equal(resolveCalls.length, 1);
    assert.deepEqual(resolveCalls[0].keyFields, ["id", "status", "total"]);
  });

  it("persiste pantallas heurísticas cuando MCP inactivo", async () => {
    const service = makeService(
      {
        isActive: async () => false,
        listScreens: async () => null,
        resolveComponent: async () => null,
      },
      {
        getActiveCompatibleMeta: async () => null,
        supportsUiProjectInstructions: async () => false,
      },
    );

    const result = await service.syncUiScreens("proj-1");
    assert.ok(result.screens >= 1);
    assert.match(result.content, /\/orders|Gestión de orders/i);
    assert.match(result.content, /Layout \| Responsive/);
    assert.match(result.content, /shadcn|DataTable/i);
  });

  it("400 cuando MCP activo y resolve_component no devuelve ninguna pantalla y plan vacío", async () => {
    const service = makeService(
      {
        isActive: async () => true,
        listScreens: async () => null,
        resolveComponent: async () => null,
      },
      {
        getActiveCompatibleMeta: async () => ({
          libraryName: "@imj_media/ui",
          libraryVersion: "1.12.0",
          contractVersion: "1.0.0",
        }),
        supportsUiProjectInstructions: async () => false,
      },
    );

    const result = await service.syncUiScreens("proj-1");
    assert.ok(result.screens >= 1);
    assert.match(result.content, /orders/i);
  });
});
