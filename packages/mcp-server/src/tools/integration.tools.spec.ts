import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { INTEGRATION_TOOLS, createIntegrationHandlers } from "./integration.tools.js";

const INTEGRATION_TOOL_NAMES = INTEGRATION_TOOLS.map((t) => t.name);

describe("integration MCP tools", () => {
  test("get_integration_status y get_integration_traces están registradas", () => {
    assert.ok(INTEGRATION_TOOL_NAMES.includes("get_integration_status"));
    assert.ok(INTEGRATION_TOOL_NAMES.includes("get_integration_traces"));
  });

  test("cada tool definida tiene handler", () => {
    const handlers = createIntegrationHandlers({
      get: async () => ({}),
      post: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
      fetchAllowStatuses: async () => ({ status: 200, data: {} }),
    });
    for (const name of INTEGRATION_TOOL_NAMES) {
      assert.ok(typeof handlers[name] === "function", `Falta handler para ${name}`);
    }
  });

  test("get_integration_status llama GET /projects/:id/integration", async () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    let calledPath = "";
    const handlers = createIntegrationHandlers({
      get: async (path) => {
        calledPath = path;
        return { handoff: { items: [] }, traces: [] };
      },
      post: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
      fetchAllowStatuses: async () => ({ status: 200, data: {} }),
    });
    const raw = await handlers.get_integration_status!({ projectId });
    assert.equal(calledPath, `/projects/${projectId}/integration`);
    assert.match(raw, /"traces"/);
  });

  test("get_integration_traces llama GET /projects/:id/integration/traces", async () => {
    const projectId = "00000000-0000-4000-8000-000000000002";
    let calledPath = "";
    const handlers = createIntegrationHandlers({
      get: async (path) => {
        calledPath = path;
        return [{ newLegId: "NEW-LEG-01", status: "SENT" }];
      },
      post: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
      fetchAllowStatuses: async () => ({ status: 200, data: {} }),
    });
    const raw = await handlers.get_integration_traces!({ projectId });
    assert.equal(calledPath, `/projects/${projectId}/integration/traces`);
    assert.match(raw, /NEW-LEG-01/);
  });

  test("get_integration_status exige projectId", async () => {
    const handlers = createIntegrationHandlers({
      get: async () => ({}),
      post: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
      fetchAllowStatuses: async () => ({ status: 200, data: {} }),
    });
    await assert.rejects(
      () => handlers.get_integration_status!({ projectId: "  " }),
      /projectId/,
    );
  });
});
