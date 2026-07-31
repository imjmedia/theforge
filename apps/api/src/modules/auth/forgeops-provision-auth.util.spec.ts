import test from "node:test";
import assert from "node:assert/strict";
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { assertForgeOpsProvisionAuthorized } from "./forgeops-provision-auth.util.js";

test("assertForgeOpsProvisionAuthorized — rechaza sin secreto configurado", () => {
  assert.throws(
    () => assertForgeOpsProvisionAuthorized("Bearer abc", undefined),
    ServiceUnavailableException,
  );
});

test("assertForgeOpsProvisionAuthorized — rechaza bearer inválido", () => {
  assert.throws(
    () => assertForgeOpsProvisionAuthorized("Bearer wrong", "expected-secret"),
    UnauthorizedException,
  );
});

test("assertForgeOpsProvisionAuthorized — acepta bearer válido", () => {
  assert.doesNotThrow(() =>
    assertForgeOpsProvisionAuthorized("Bearer expected-secret", "expected-secret"),
  );
});
