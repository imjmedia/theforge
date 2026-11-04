import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "../project-architecture-graph.js";
import { buildPagFixtures } from "./build-pag-fixtures.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("buildPagFixtures (I8)", () => {
  const pag = JSON.parse(
    readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
  ) as ProjectArchitectureGraph;

  it("coincide con golden determinista", () => {
    const golden = JSON.parse(readFileSync(join(fixtureDir, "three-screens.fixtures.json"), "utf8"));
    assert.deepEqual(buildPagFixtures(pag), golden);
  });

  it("FK resuelven filas existentes cuando hay foreign_key", () => {
    const pagWithFk: ProjectArchitectureGraph = {
      ...pag,
      entities: [
        {
          name: "Parent",
          tableName: "parent",
          description: "p",
          primaryKey: "id",
          fields: [{ name: "id", type: "UUID", required: true, constraints: [{ type: "unique" }] }],
          indexes: [],
        },
        {
          name: "Child",
          tableName: "child",
          description: "c",
          primaryKey: "id",
          fields: [
            { name: "id", type: "UUID", required: true, constraints: [{ type: "unique" }] },
            {
              name: "parentId",
              type: "UUID",
              required: true,
              constraints: [
                { type: "foreign_key", reference: { entity: "Parent", field: "id", onDelete: "RESTRICT" } },
              ],
            },
          ],
          indexes: [],
        },
      ],
      endpoints: pag.endpoints,
      services: pag.services,
    };
    const fixtures = buildPagFixtures(pagWithFk, { rowsPerEntity: 1 });
    const parents = fixtures["parent.json"] as Record<string, unknown>[];
    const children = fixtures["child.json"] as Record<string, unknown>[];
    assert.equal(children[0]?.parentId, parents[0]?.id);
  });
});
