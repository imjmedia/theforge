import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { assertCanManageUser } from "./roles.js";

const ROLES = ["developer", "admin", "super_admin"] as const;
const NUEVOS = [undefined, "developer", "admin", "super_admin"] as const;

/** Resultado esperado de la matriz: true = permitido. */
function esperado(actor: string, objetivo: string, nuevo: string | undefined): boolean {
  if (actor === "super_admin") return true;
  if (objetivo === "super_admin") return false;
  if (nuevo === "super_admin") return false;
  return true;
}

for (const actor of ["admin", "super_admin"]) {
  for (const objetivo of ROLES) {
    for (const nuevo of NUEVOS) {
      const permitido = esperado(actor, objetivo, nuevo);
      test(`assertCanManageUser — actor ${actor}, objetivo ${objetivo}, nuevo ${nuevo ?? "ninguno"} => ${permitido ? "permite" : "403"}`, () => {
        const fn = () => assertCanManageUser(actor, objetivo, nuevo);
        if (permitido) {
          assert.doesNotThrow(fn);
        } else {
          assert.throws(fn, ForbiddenException);
        }
      });
    }
  }
}

test("assertCanManageUser — alta (sin objetivo): admin no crea super_admin, super_admin sí", () => {
  assert.throws(() => assertCanManageUser("admin", null, "super_admin"), ForbiddenException);
  assert.doesNotThrow(() => assertCanManageUser("admin", null, "admin"));
  assert.doesNotThrow(() => assertCanManageUser("super_admin", undefined, "super_admin"));
});

test("assertCanManageUser — nadie cambia su propio rol (ni super_admin)", () => {
  for (const actor of ["admin", "super_admin"]) {
    for (const nuevo of ["developer", "admin", "super_admin"]) {
      assert.throws(
        () => assertCanManageUser(actor, actor, nuevo, { actorUserId: "u1", targetUserId: "u1" }),
        ForbiddenException,
      );
    }
  }
});

test("assertCanManageUser — el mismo usuario sin cambio de rol (perfil, secret) sí se permite", () => {
  assert.doesNotThrow(() =>
    assertCanManageUser("admin", "admin", undefined, { actorUserId: "u1", targetUserId: "u1" }),
  );
});

test("assertCanManageUser — usuarios distintos con ids en opts no activan la regla propia", () => {
  assert.doesNotThrow(() =>
    assertCanManageUser("super_admin", "admin", "developer", { actorUserId: "u1", targetUserId: "u2" }),
  );
});

test("assertCanManageUser — un developer no gestiona a nadie", () => {
  assert.throws(() => assertCanManageUser("developer", "developer"), ForbiddenException);
});
