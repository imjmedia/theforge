import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHeuristicScreensFromPlan } from "./ui-screens-heuristic.util.js";
import type { PantallaPlanItem } from "./ui-screens-plan.util.js";

describe("buildHeuristicScreensFromPlan — login", () => {
  it("usa Form+Input+Button en /login, no DataTable", () => {
    const plan: PantallaPlanItem[] = [
      {
        name: "login",
        screenName: "Inicio de sesión",
        purpose: "Autenticación",
        source: "hu-only",
        route: "/login",
        uiHint: "form",
        keyFields: ["id"],
        classification: "Configuration",
        primaryApi: "POST /api/v1/auth/login",
      },
    ];
    const screens = buildHeuristicScreensFromPlan(plan, {
      adapterLabel: "Tailwind + Radix UI",
      packageScope: "@radix-ui/react",
      stackBase: "tailwind",
    });
    const components = screens[0]?.components.map((c) => c.component) ?? [];
    assert.ok(components.includes("Form"));
    assert.ok(components.includes("Input"));
    assert.ok(components.includes("Button"));
    assert.ok(!components.includes("DataTable"));
  });
});
