import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectReferenceSections } from "../mdd-section-detectors.util.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/semaphore",
);

function load(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

describe("mdd-section-detectors (anclados)", () => {
  it("CL-09: postgres-sin-post → endpointsWithPayloads=false", () => {
    const s = detectReferenceSections(load("postgres-sin-post.md"));
    assert.equal(s.endpoints > 0, true);
    assert.equal(s.endpointsWithPayloads, false);
  });

  it("CL-10: endpoints-en-contexto-sin-s4 → endpoints=0", () => {
    const s = detectReferenceSections(load("endpoints-en-contexto-sin-s4.md"));
    assert.equal(s.endpoints, 0);
  });
});
