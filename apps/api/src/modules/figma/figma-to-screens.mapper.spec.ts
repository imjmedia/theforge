import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { mapFigmaFileToScreens, type FigmaFileDocument } from "./figma-to-screens.mapper.js";
import { parseFigmaFileUrl } from "./figma-url.util.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const file = JSON.parse(readFileSync(join(fixtureDir, "file-response.json"), "utf8")) as FigmaFileDocument;

describe("figma-to-screens.mapper", () => {
  it("CL-02: URL inválida", () => {
    assert.equal(parseFigmaFileUrl("https://example.com/nope"), null);
    assert.equal(parseFigmaFileUrl("http://www.figma.com/file/abc"), null);
  });

  it("CL-03: sin frames → lista vacía", () => {
    const empty = mapFigmaFileToScreens({
      fileKey: "abcdefghijkl",
      file: { document: { id: "0:0", name: "Doc", type: "DOCUMENT", children: [] } },
    });
    assert.equal(empty.screens.length, 0);
  });

  it("CL-06: transición rota genera warning", () => {
    const mapped = mapFigmaFileToScreens({ fileKey: "abcdefghijkl", file });
    assert.ok(mapped.issues.some((i) => i.includes("9:99")));
    assert.ok(mapped.screens.length >= 3);
    assert.equal(mapped.screens[0]?.origin.kind, "figma");
    assert.equal(mapped.screens[0]?.origin.fileKey, "abcdefghijkl");
  });

  it("reimport idempotente: mismas pantallas por nodeId", () => {
    const first = mapFigmaFileToScreens({ fileKey: "abcdefghijkl", file });
    const second = mapFigmaFileToScreens({ fileKey: "abcdefghijkl", file });
    assert.deepEqual(first.screens.map((s) => s.origin.nodeId), second.screens.map((s) => s.origin.nodeId));
  });
});
