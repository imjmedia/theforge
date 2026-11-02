import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHARED_NON_OWNER_LEVELS,
  canAccessProject,
  type ProjectAccessLevel,
} from "./project-access.policy.js";

const OWNER_ID = "owner-1";
const LEVELS: ProjectAccessLevel[] = ["read", "contribute", "spend", "manage"];
const VISIBILITIES = ["PRIVATE", "SHARED"] as const;

const ACTORS = {
  owner: { userId: OWNER_ID, role: "developer" },
  ownerAdmin: { userId: OWNER_ID, role: "admin" },
  developer: { userId: "dev-2", role: "developer" },
  admin: { userId: "admin-3", role: "admin" },
  superAdmin: { userId: "sa-4", role: "super_admin" },
} as const;

function expected(
  actor: keyof typeof ACTORS,
  visibility: (typeof VISIBILITIES)[number],
  level: ProjectAccessLevel,
  allowAdmin: boolean,
): boolean {
  if (actor === "owner" || actor === "ownerAdmin") return true;
  if (visibility === "PRIVATE") return false;
  if ((SHARED_NON_OWNER_LEVELS as readonly string[]).includes(level)) return true;
  if (level === "manage") return allowAdmin && (actor === "admin" || actor === "superAdmin");
  return false;
}

describe("canAccessProject", () => {
  it("SHARED_NON_OWNER_LEVELS es read + contribute", () => {
    assert.deepEqual([...SHARED_NON_OWNER_LEVELS], ["read", "contribute"]);
  });

  for (const actor of Object.keys(ACTORS) as (keyof typeof ACTORS)[]) {
    for (const visibility of VISIBILITIES) {
      for (const level of LEVELS) {
        for (const allowAdmin of [false, true]) {
          const want = expected(actor, visibility, level, allowAdmin);
          it(`${actor} / ${visibility} / ${level} / allowAdmin=${allowAdmin} => ${want}`, () => {
            const got = canAccessProject(
              ACTORS[actor],
              { userId: OWNER_ID, visibility },
              level,
              { allowAdmin },
            );
            assert.equal(got, want);
          });
        }
      }
    }
  }

  it("sin options equivale a allowAdmin=false", () => {
    assert.equal(
      canAccessProject(ACTORS.admin, { userId: OWNER_ID, visibility: "SHARED" }, "manage"),
      false,
    );
  });

  it("admin con allowAdmin no ve ni gestiona un PRIVATE ajeno", () => {
    for (const level of LEVELS) {
      assert.equal(
        canAccessProject(ACTORS.superAdmin, { userId: OWNER_ID, visibility: "PRIVATE" }, level, {
          allowAdmin: true,
        }),
        false,
      );
    }
  });

  it("un developer no obtiene manage con allowAdmin", () => {
    assert.equal(
      canAccessProject(ACTORS.developer, { userId: OWNER_ID, visibility: "SHARED" }, "manage", {
        allowAdmin: true,
      }),
      false,
    );
  });

  it("actor sin userId nunca accede", () => {
    assert.equal(
      canAccessProject({ userId: "", role: "admin" }, { userId: "", visibility: "SHARED" }, "read"),
      false,
    );
  });

  it("visibilidad desconocida se trata como no compartida", () => {
    assert.equal(
      canAccessProject(ACTORS.developer, { userId: OWNER_ID, visibility: "OTHER" }, "read"),
      false,
    );
  });
});
