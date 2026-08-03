import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fillSemanticTokens,
  resolveStackPreset,
  shadcnZincPreset,
  findLooseHexColors,
} from "./design-system-defaults.js";
import { detectWebSurfaces } from "./web-surfaces.util.js";

describe("design-system-defaults", () => {
  it("detectWebSurfaces true for React SPA MDD", () => {
    const mdd = "## 2. Stack\n\nReact 18 + Vite + Tailwind";
    assert.equal(detectWebSurfaces(mdd, null), true);
  });

  it("detectWebSurfaces false for API-only", () => {
    assert.equal(detectWebSurfaces("## 2. Stack\n\nNestJS API only", null), false);
  });

  it("resolveStackPreset picks imj when declared", () => {
    const preset = resolveStackPreset("## 2\n@imj_media/ui", null);
    assert.equal(preset.stackBase, "imj");
    assert.equal(preset.adapterLabel, "@imj_media/ui");
  });

  it("fillSemanticTokens sets colorSource system-default", () => {
    const filled = fillSemanticTokens({}, shadcnZincPreset);
    assert.equal(filled.colorSource, "system-default");
    assert.ok(filled.colors?.primary);
    assert.ok(filled.colors?.destructive);
  });

  it("findLooseHexColors flags unknown hex", () => {
    const loose = findLooseHexColors("color: #ABCDEF", shadcnZincPreset);
    assert.ok(loose.includes("#abcdef") || loose.includes("#ABCDEF"));
  });
});
