import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseDesignSpec } from "./design-spec.js";
import { renderDesignMarkdown } from "./render-design-markdown.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("renderDesignMarkdown", () => {
  const spec = parseDesignSpec(JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")));

  it("pantallas.md y datos.md estables (golden)", () => {
    const out = renderDesignMarkdown(spec);
    assert.equal(out.pantallasMd, readFileSync(join(fixtureDir, "three-screens.pantallas.md"), "utf8"));
    assert.equal(out.datosMd, readFileSync(join(fixtureDir, "three-screens.datos.md"), "utf8"));
  });
});
