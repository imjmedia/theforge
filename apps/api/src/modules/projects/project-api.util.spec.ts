import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePluginDataPresence } from "./project-api.util.js";

describe("summarizePluginDataPresence", () => {
  it("returns null for empty or non-object input", () => {
    assert.equal(summarizePluginDataPresence(null), null);
    assert.equal(summarizePluginDataPresence(undefined), null);
    assert.equal(summarizePluginDataPresence({}), null);
  });

  it("maps plugin ids to true without payload", () => {
    assert.deepEqual(
      summarizePluginDataPresence({
        "com.kreodevs.evd": { slides: [{ id: "1", title: "T" }] },
        "com.example.other": "ok",
      }),
      { "com.kreodevs.evd": true, "com.example.other": true },
    );
  });

  it("skips null and empty object entries", () => {
    assert.deepEqual(
      summarizePluginDataPresence({
        empty: {},
        missing: null,
        present: { x: 1 },
      }),
      { present: true },
    );
  });
});
