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

test("toMddJobError: LLM idle / hard timeouts are UnrecoverableError", () => {
  for (const msg of [
    "[Clarifier] stream abortado por inactividad 90000ms (chunks=3, elapsed=91000ms)",
    "[Auditor] stream abortado por tope duro 600000ms (chunks=900, elapsed=600100ms)",
    "Request timed out.",
    "connect ETIMEDOUT 1.2.3.4:443",
  ]) {
    assert.ok(toMddJobError(new Error(msg)) instanceof UnrecoverableError, msg);
  }
});

test("toMddJobError: GraphRecursionError is UnrecoverableError", () => {
  const named = new Error("boom");
  named.name = "GraphRecursionError";
  assert.ok(toMddJobError(named) instanceof UnrecoverableError);
  assert.ok(
    toMddJobError(new Error("Recursion limit of 80 reached without hitting a stop condition")) instanceof
      UnrecoverableError,
  );
});

test("toMddJobError: provider auth / quota errors are UnrecoverableError", () => {
  assert.ok(toMddJobError(new Error("401 Unauthorized")) instanceof UnrecoverableError);
  assert.ok(toMddJobError(new Error("You exceeded your current quota (insufficient_quota)")) instanceof UnrecoverableError);
  assert.ok(toMddJobError(new Error("Provider error: status 429 rate limited")) instanceof UnrecoverableError);
  const withStatus = Object.assign(new Error("Forbidden request"), { status: 403 });
  assert.ok(toMddJobError(withStatus) instanceof UnrecoverableError);
});

test("toMddJobError: thread busy is UnrecoverableError", () => {
  assert.ok(
    toMddJobError(new Error("THREAD_BUSY: Ya hay un turno en curso para este hilo.")) instanceof UnrecoverableError,
  );
});

test("toMddJobError keeps transient network errors retryable", () => {
  for (const msg of ["read ECONNRESET", "502 Bad Gateway", "503 Service Unavailable", "socket hang up"]) {
    const wrapped = toMddJobError(new Error(msg));
    assert.equal(wrapped instanceof UnrecoverableError, false, msg);
  }
  const plain = new Error("boom");
  assert.equal(toMddJobError(plain), plain);
});
