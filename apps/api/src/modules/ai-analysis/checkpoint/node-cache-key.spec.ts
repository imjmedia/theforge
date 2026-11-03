import { describe, it } from "node:test";
import assert from "node:assert";
import { buildNodeCacheKey } from "./node-cache-key.js";

const base = {
  node: "section5",
  input: { projectId: "p1", draft: "abc" },
  models: "openrouter:modelo-a>modelo-b",
  promptVersion: "2026-11-03",
};

describe("buildNodeCacheKey", () => {
  it("misma entrada, modelos y versión dan la misma clave (estable ante el orden de claves)", () => {
    assert.strictEqual(buildNodeCacheKey(base), buildNodeCacheKey({ ...base }));
    assert.strictEqual(
      buildNodeCacheKey(base),
      buildNodeCacheKey({ ...base, input: { draft: "abc", projectId: "p1" } }),
    );
  });
  it("conserva el prefijo node:<nodo>: para invalidateNode", () => {
    assert.match(buildNodeCacheKey(base), /^node:section5:[0-9a-f]{12}$/);
  });
  it("otro modelo o distinto orden de fallbacks cambia la clave", () => {
    const k = buildNodeCacheKey(base);
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, models: "openrouter:modelo-c>modelo-b" }));
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, models: "openrouter:modelo-b>modelo-a" }));
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, models: "anthropic:modelo-a>modelo-b" }));
  });
  it("otra promptVersion cambia la clave", () => {
    assert.notStrictEqual(buildNodeCacheKey(base), buildNodeCacheKey({ ...base, promptVersion: "2026-11-04" }));
  });
  it("otro nodo o entrada cambia la clave", () => {
    const k = buildNodeCacheKey(base);
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, node: "security" }));
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, input: { projectId: "p1", draft: "abd" } }));
    assert.notStrictEqual(k, buildNodeCacheKey({ ...base, input: { projectId: "p2", draft: "abc" } }));
  });
});
