import assert from "node:assert/strict";
import { test } from "node:test";
import { UnrecoverableError } from "bullmq";
import { isMddUserCancellationError, toMddJobError } from "./mdd-job-error.util.js";

test("isMddUserCancellationError detects cancel message", () => {
  assert.equal(isMddUserCancellationError(new Error("Cancelado por el usuario")), true);
  assert.equal(isMddUserCancellationError(new Error("timeout")), false);
});

test("toMddJobError wraps cancel as UnrecoverableError", () => {
  const wrapped = toMddJobError(new Error("Cancelado por el usuario"));
  assert.ok(wrapped instanceof UnrecoverableError);
});
