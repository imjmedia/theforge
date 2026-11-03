/**
 * `executeJob` clasifica los errores del job para BullMQ: un persist final bloqueado (suelo anti-wipe /
 * resultado demasiado corto) NO se reintenta (`UnrecoverableError`), porque reintentar daría el mismo resultado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnrecoverableError } from "bullmq";
import {
  MDD_PERSIST_FLOOR_CODE,
  MDD_PERSIST_FLOOR_MESSAGE,
  MDD_PERSIST_TOO_SHORT_CODE,
  MDD_PERSIST_TOO_SHORT_MESSAGE,
  MddPersistBlockedError,
} from "../ai-analysis.service.js";
import { MddQueueService, type MddJobData } from "./mdd-queue.service.js";

function makeService(runMddGenerationJob: () => Promise<unknown>): { svc: MddQueueService; unregistered: string[] } {
  const unregistered: string[] = [];
  const guard = { registerMddStream: () => undefined, unregisterMddStream: (p: string) => unregistered.push(p) };
  const svc = new MddQueueService(
    { runMddGenerationJob } as never,
    {} as never,
    guard as never,
    {} as never,
  );
  return { svc, unregistered };
}

function runJob(svc: MddQueueService, data: MddJobData): Promise<unknown> {
  return (
    svc as unknown as { executeJob: (id: string, d: MddJobData, p: () => void) => Promise<unknown> }
  ).executeJob("job-1", data, () => undefined);
}

describe("MddQueueService.executeJob: persist bloqueado no es reintentable", () => {
  for (const [code, message] of [
    [MDD_PERSIST_FLOOR_CODE, MDD_PERSIST_FLOOR_MESSAGE],
    [MDD_PERSIST_TOO_SHORT_CODE, MDD_PERSIST_TOO_SHORT_MESSAGE],
  ] as const) {
    it(`MddPersistBlockedError (${code}) se convierte en UnrecoverableError y libera el registro del proyecto`, async () => {
      const { svc, unregistered } = makeService(async () => {
        throw new MddPersistBlockedError(code, message);
      });
      await assert.rejects(runJob(svc, { mode: "pipeline", projectId: "p1" }), (err: unknown) => {
        assert.ok(err instanceof UnrecoverableError, "debe ser UnrecoverableError (BullMQ no reintenta)");
        assert.match((err as Error).message, new RegExp(code));
        return true;
      });
      assert.deepEqual(unregistered, ["p1"], "el finally libera el stream registrado");
    });
  }

  it("un error genérico NO se marca como irrecuperable (sigue el criterio de toMddJobError)", async () => {
    const { svc } = makeService(async () => {
      throw new Error("ECONNRESET");
    });
    await assert.rejects(runJob(svc, { mode: "pipeline", projectId: "p1" }), (err: unknown) => {
      assert.ok(!(err instanceof UnrecoverableError));
      return true;
    });
  });
});
