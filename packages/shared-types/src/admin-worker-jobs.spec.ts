import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_WORKER_JOB_QUEUE_LABELS } from "@theforge/shared-types";

test("ADMIN_WORKER_JOB_QUEUE_LABELS — cubre las tres colas", () => {
  assert.equal(ADMIN_WORKER_JOB_QUEUE_LABELS.mdd, "MDD (LangGraph)");
  assert.equal(ADMIN_WORKER_JOB_QUEUE_LABELS.deliverables, "Entregables");
  assert.equal(ADMIN_WORKER_JOB_QUEUE_LABELS["legacy-deliverables"], "Legacy entregables");
});
