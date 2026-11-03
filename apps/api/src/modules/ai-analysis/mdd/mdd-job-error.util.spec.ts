import assert from "node:assert/strict";
import { test } from "node:test";
import { UnrecoverableError } from "bullmq";
import {
  ThreadBusyError,
  ThreadLeaseLostError,
  ThreadLockUnavailableError,
} from "../checkpoint/thread-run-lock.service.js";
import {
  isMddLeaseLostError,
  isMddLockUnavailableError,
  isMddNonRetryableJobError,
  isMddUserCancellationError,
  toMddJobError,
} from "./mdd-job-error.util.js";

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

test("toMddJobError: LOCK_UNAVAILABLE es reintentable (lo acota MAX_ATTEMPTS de la cola)", () => {
  const err = new ThreadLockUnavailableError("p:_", new Error("Stream isn't writeable"));
  assert.equal(isMddLockUnavailableError(err), true);
  assert.equal(isMddNonRetryableJobError(err), false);
  assert.equal(toMddJobError(err), err);
  assert.equal(toMddJobError(err) instanceof UnrecoverableError, false);
});

test("toMddJobError: LOCK_UNAVAILABLE sigue reintentable aunque la causa de Redis parezca timeout o abort", () => {
  for (const cause of ["Command timed out", "connect ETIMEDOUT 10.0.0.1:6379", "Connection aborted"]) {
    const err = new ThreadLockUnavailableError("p:_", new Error(cause));
    assert.equal(toMddJobError(err) instanceof UnrecoverableError, false, cause);
  }
  // también cuando solo llega el mensaje serializado (sin la clase ni `code`)
  assert.equal(
    toMddJobError(new Error("LOCK_UNAVAILABLE: No se pudo tomar el bloqueo (timed out)")) instanceof UnrecoverableError,
    false,
  );
});

test("toMddJobError: LEASE_LOST y THREAD_BUSY son UnrecoverableError (por clase y por mensaje)", () => {
  const lost = new ThreadLeaseLostError("p:_");
  assert.equal(isMddLeaseLostError(lost), true);
  assert.ok(toMddJobError(lost) instanceof UnrecoverableError);
  assert.ok(toMddJobError(new Error("LEASE_LOST: se perdió el bloqueo")) instanceof UnrecoverableError);
  assert.ok(toMddJobError(new ThreadBusyError("p:_")) instanceof UnrecoverableError);
});
