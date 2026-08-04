import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "sdd-ui-ux-actionable-rules.md");

const REQUIRED_SECTIONS = [
  "Multi-superficie",
  "Adapter `packages/ui`",
  "Stack fallback",
  "colorSource: system-default",
  "primitivos + semánticos",
  "Responsive (obligatorio web)",
  "Layout",
  "Layout | Responsive",
  "Surface:",
  "Responsive:",
];

describe("sdd-ui-ux-actionable-rules.md", () => {
  it("includes mandatory SSOT sections", () => {
    const content = readFileSync(RULES_PATH, "utf-8");
    for (const section of REQUIRED_SECTIONS) {
      assert.match(content, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), section);
    }
  });
});
