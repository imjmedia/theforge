import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import {
  compilePagToMddSection3,
  compilePagToMddSection4,
  listPagEndpointsForMddCompare,
} from "@theforge/shared-types";
import { extractMddSection4Endpoints } from "../../engine/conformance.service.js";
import { extractSectionByNumber, parseMarkdownMdd } from "../../engine/mdd-markdown-parser.js";
import { validateApiTablesSyntax } from "../../engine/mdd-pre-render.js";
import {
  designFirstSealedDraftStableUnderErRegeneration,
  designFirstSection3StableUnderDiagramInjection,
  sealDesignFirstMddSection3,
  sealDesignFirstMddSection4,
  wrapDesignFirstMddSectionsForHarness,
} from "./design-first-mdd-sections.util.js";

const sharedFixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../packages/shared-types/src/design-first/__fixtures__",
);

function loadPag(): ProjectArchitectureGraph {
  return JSON.parse(readFileSync(join(sharedFixtures, "three-screens.pag.json"), "utf8")) as ProjectArchitectureGraph;
}

describe("design-first MDD sections harness", () => {
  const pag = loadPag();
  const s3 = sealDesignFirstMddSection3(pag);
  const s4 = sealDesignFirstMddSection4(pag);
  const draft = wrapDesignFirstMddSectionsForHarness(s3, s4);

  it("parseMarkdownMdd reconoce entidades y endpoints", () => {
    const parsed = parseMarkdownMdd(draft);
    assert.ok(parsed.db_entities.length >= 2);
    assert.ok((parsed.extra_endpoints ?? 0) >= pag.endpoints.length);
  });

  it("validateApiTablesSyntax acepta §4 compilada", () => {
    const section4 = extractSectionByNumber(draft, 4).replace(/^##[^\n]*\n*/i, "").trim();
    const v = validateApiTablesSyntax(section4);
    assert.equal(v.ok, true, v.error);
  });

  it("extractMddSection4Endpoints coincide con el PAG", () => {
    const extracted = extractMddSection4Endpoints(draft);
    const expected = listPagEndpointsForMddCompare(pag);
    assert.equal(extracted.length, expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      assert.equal(extracted[i]!.method, expected[i]!.method);
      assert.equal(extracted[i]!.path, expected[i]!.path);
    }
  });

  it("regenerateErDiagramFromSql idempotente sobre borrador sellado", () => {
    assert.equal(designFirstSealedDraftStableUnderErRegeneration(draft), true);
  });

  it("injectMddDiagrams no altera §3 sellada", () => {
    assert.equal(designFirstSection3StableUnderDiagramInjection(draft), true);
  });

  it("goldens shared-types + ER sellado estable", () => {
    const base3 = readFileSync(join(sharedFixtures, "three-screens.mdd-section3.txt"), "utf8");
    const base4 = readFileSync(join(sharedFixtures, "three-screens.mdd-section4.txt"), "utf8");
    assert.equal(compilePagToMddSection3(pag), base3);
    assert.equal(compilePagToMddSection4(pag), base4);
    assert.ok(s3.includes("### Diagrama entidad-relación"));
    assert.ok(s3.startsWith(base3.trimEnd()));
  });
});
