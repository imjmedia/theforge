import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLangGraphCheckpointSetupRaceError,
  purgeStaleLangGraphThreads,
  resolveCheckpointTtlMs,
  type CheckpointQueryable,
} from "./langgraph-checkpoint-setup.util.js";

describe("langgraph-checkpoint-setup", () => {
  it("detecta race pg_type_typname_nsp_index", () => {
    assert.equal(
      isLangGraphCheckpointSetupRaceError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "pg_type_typname_nsp_index"',
      }),
      true,
    );
    assert.equal(isLangGraphCheckpointSetupRaceError(new Error("other")), false);
  });
});

describe("resolveCheckpointTtlMs", () => {
  it("default 14 días y respeta LANGGRAPH_CHECKPOINT_TTL_DAYS", () => {
    assert.equal(resolveCheckpointTtlMs({} as NodeJS.ProcessEnv), 14 * 86_400_000);
    assert.equal(resolveCheckpointTtlMs({ LANGGRAPH_CHECKPOINT_TTL_DAYS: "7" } as NodeJS.ProcessEnv), 7 * 86_400_000);
    assert.equal(resolveCheckpointTtlMs({ LANGGRAPH_CHECKPOINT_TTL_DAYS: "0" } as NodeJS.ProcessEnv), 14 * 86_400_000);
  });
});

describe("purgeStaleLangGraphThreads", () => {
  function fakeClient(staleIds: string[], failOn?: string) {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client: CheckpointQueryable = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (failOn && text.includes(failOn)) throw new Error("db error");
        if (text.includes("SELECT l.thread_id")) return { rows: staleIds.map((thread_id) => ({ thread_id })) };
        return { rows: [] };
      },
    };
    return { client, calls };
  }

  it("borra writes, blobs y checkpoints de los hilos inactivos en una transacción", async () => {
    const { client, calls } = fakeClient(["t1", "t2"]);
    const res = await purgeStaleLangGraphThreads(client, { olderThanMs: 14 * 86_400_000 });
    assert.deepEqual(res.threadIds, ["t1", "t2"]);
    const select = calls[0]!;
    assert.match(select.text, /AgentStateCheckpoint/);
    assert.match(select.text, /"langgraph"\.checkpoints/);
    assert.equal(select.params?.[0], 14 * 86_400);
    const texts = calls.map((c) => c.text);
    assert.equal(texts[1], "BEGIN");
    assert.match(texts[2]!, /DELETE FROM "langgraph"\.checkpoint_writes/);
    assert.match(texts[3]!, /DELETE FROM "langgraph"\.checkpoint_blobs/);
    assert.match(texts[4]!, /DELETE FROM "langgraph"\.checkpoints/);
    assert.equal(texts[5], "COMMIT");
    assert.deepEqual(calls[2]!.params, [["t1", "t2"]]);
  });

  it("no hace nada si no hay hilos inactivos", async () => {
    const { client, calls } = fakeClient([]);
    const res = await purgeStaleLangGraphThreads(client, { olderThanMs: 86_400_000 });
    assert.deepEqual(res.threadIds, []);
    assert.equal(calls.length, 1);
  });

  it("hace ROLLBACK y propaga el error si falla un DELETE", async () => {
    const { client, calls } = fakeClient(["t1"], "checkpoint_blobs");
    await assert.rejects(purgeStaleLangGraphThreads(client, { olderThanMs: 86_400_000 }), /db error/);
    assert.equal(calls.at(-1)?.text, "ROLLBACK");
  });
});
