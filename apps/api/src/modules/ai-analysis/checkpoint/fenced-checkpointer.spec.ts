import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  FencedCheckpointSaver,
  buildMddGraphConfigurable,
  discardStaleMddCheckpointIfNeeded,
  isCheckpointWriteStale,
  parseConfigFence,
} from "./fenced-checkpointer.js";

describe("fenced-checkpointer", () => {
  it("parseConfigFence lee número o string numérico", () => {
    assert.equal(parseConfigFence({ mddLeaseFence: "42" }), 42);
    assert.equal(parseConfigFence({ mddLeaseFence: 99 }), 99);
    assert.equal(parseConfigFence({}), undefined);
  });

  it("buildMddGraphConfigurable incluye thread_id, stage y fence", () => {
    assert.deepEqual(buildMddGraphConfigurable("t-1", { stageId: "s-1", fence: 7 }), {
      thread_id: "t-1",
      mddStageId: "s-1",
      mddLeaseFence: "7",
    });
  });

  it("isCheckpointWriteStale cuando el fence de la etapa es mayor", async () => {
    const prisma = {
      stage: {
        findUnique: async () => ({ mddLeaseFence: 100n }),
      },
    };
    assert.equal(await isCheckpointWriteStale(prisma, "stage-1", 50), true);
    assert.equal(await isCheckpointWriteStale(prisma, "stage-1", 100), false);
    assert.equal(await isCheckpointWriteStale(prisma, "stage-1", undefined), false);
  });

  it("FencedCheckpointSaver.put omite escritura si la etapa tiene fence mayor", async () => {
    const putCalls: unknown[] = [];
    const inner = {
      serde: {},
      getTuple: async () => ({ config: { configurable: { thread_id: "t1", checkpoint_id: "prev" } } }),
      put: async (...args: unknown[]) => {
        putCalls.push(args);
        return { configurable: { thread_id: "t1", checkpoint_id: "new" } };
      },
      putWrites: async () => assert.fail("no debe escribir writes"),
    };
    const prisma = {
      stage: { findUnique: async () => ({ mddLeaseFence: 200n }) },
    };
    const saver = new FencedCheckpointSaver(inner as never, prisma);
    const config: RunnableConfig = {
      configurable: buildMddGraphConfigurable("t1", { stageId: "s1", fence: 100 }),
    };
    const out = await saver.put(config, {} as never, {} as never, {});
    assert.equal(putCalls.length, 0);
    assert.equal(out.configurable?.checkpoint_id, "prev");
  });

  it("FencedCheckpointSaver.put delega cuando el fence del turno sigue vigente", async () => {
    let putCalled = false;
    const inner = {
      serde: {},
      getTuple: async () => undefined,
      put: async () => {
        putCalled = true;
        return { configurable: { thread_id: "t1", checkpoint_id: "new" } };
      },
      putWrites: async () => undefined,
    };
    const prisma = {
      stage: { findUnique: async () => ({ mddLeaseFence: 50n }) },
    };
    const saver = new FencedCheckpointSaver(inner as never, prisma);
    await saver.put(
      { configurable: buildMddGraphConfigurable("t1", { stageId: "s1", fence: 100 }) },
      {} as never,
      {} as never,
      {},
    );
    assert.equal(putCalled, true);
  });

  it("discardStaleMddCheckpointIfNeeded borra el hilo cuando el fence quedó obsoleto", async () => {
    const deleted: string[] = [];
    const prisma = {
      stage: { findUnique: async () => ({ mddLeaseFence: 300n }) },
    };
    const checkpointer = { deleteThread: async (id: string) => deleted.push(id) };
    const log = new Logger("test");
    const discarded = await discardStaleMddCheckpointIfNeeded(
      checkpointer,
      prisma,
      { configurable: buildMddGraphConfigurable("thread-z", { stageId: "s1", fence: 100 }) },
      log,
    );
    assert.equal(discarded, true);
    assert.deepEqual(deleted, ["thread-z"]);
  });
});
