import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MDD_CHAT_JOB_MAX_AGE_MS,
  chatEventsReconnectDelayMs,
  clearMddChatJob,
  consumeMddChatEvents,
  isMddChatTerminalEvent,
  loadMddChatJob,
  mddChatJobStorageKey,
  nextMddChatCursor,
  readNdjsonObjects,
  saveMddChatJob,
  shouldResubscribeToChatJob,
  type StorageLike,
} from "./mddChatJob.js";

function memoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

function ndjsonBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const noSleep = async () => undefined;

describe("mddChatJob: estado persistido (jobId + cursor)", () => {
  it("la clave es por proyecto + etapa (`_` sin etapa)", () => {
    assert.equal(mddChatJobStorageKey("p1", "s1"), "theforge:mdd-chat-job:p1:s1");
    assert.equal(mddChatJobStorageKey(" p1 ", null), "theforge:mdd-chat-job:p1:_");
  });

  it("save → load → clear", () => {
    const st = memoryStorage();
    assert.equal(loadMddChatJob("p1", "s1", st), null);
    saveMddChatJob("p1", "s1", { jobId: "42", cursor: 5 }, st, 1_000);
    assert.deepEqual(loadMddChatJob("p1", "s1", st, 2_000), { jobId: "42", cursor: 5, savedAt: 1_000 });
    // otra etapa / otro proyecto no se mezclan
    assert.equal(loadMddChatJob("p1", "s2", st, 2_000), null);
    assert.equal(loadMddChatJob("p2", "s1", st, 2_000), null);
    clearMddChatJob("p1", "s1", st);
    assert.equal(loadMddChatJob("p1", "s1", st, 2_000), null);
  });

  it("ignora y borra entradas caducadas (>24 h) o corruptas", () => {
    const st = memoryStorage();
    saveMddChatJob("p1", "s1", { jobId: "42", cursor: 1 }, st, 0);
    assert.equal(loadMddChatJob("p1", "s1", st, MDD_CHAT_JOB_MAX_AGE_MS + 1), null);
    assert.deepEqual(st.dump(), {});
    st.setItem(mddChatJobStorageKey("p1", "s1"), "{no es json");
    assert.equal(loadMddChatJob("p1", "s1", st), null);
    st.setItem(mddChatJobStorageKey("p1", "s1"), JSON.stringify({ cursor: 3 }));
    assert.equal(loadMddChatJob("p1", "s1", st), null);
  });

  it("sin storage (SSR / bloqueado) no falla", () => {
    saveMddChatJob("p1", "s1", { jobId: "1", cursor: 0 }, null);
    assert.equal(loadMddChatJob("p1", "s1", null), null);
    clearMddChatJob("p1", "s1", null);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    saveMddChatJob("p1", "s1", { jobId: "1", cursor: 0 }, throwing);
    assert.equal(loadMddChatJob("p1", "s1", throwing), null);
    clearMddChatJob("p1", "s1", throwing);
  });
});

describe("mddChatJob: cursor y reanudación", () => {
  it("nextMddChatCursor avanza y nunca retrocede", () => {
    assert.equal(nextMddChatCursor(0, { cursor: 3 }), 3);
    assert.equal(nextMddChatCursor(5, { cursor: 3 }), 5);
    assert.equal(nextMddChatCursor(5, {}), 5);
    assert.equal(nextMddChatCursor(5, { cursor: "x" }), 5);
  });

  it("isMddChatTerminalEvent", () => {
    for (const type of ["done", "error", "interrupt", "blocked"]) {
      assert.equal(isMddChatTerminalEvent({ type }), true, type);
    }
    assert.equal(isMddChatTerminalEvent({ type: "progress" }), false);
    assert.equal(isMddChatTerminalEvent({ type: "heartbeat" }), false);
  });

  it("shouldResubscribeToChatJob: activo, en cola o terminado con eventos; no si no existe o es de otro proyecto", () => {
    assert.equal(shouldResubscribeToChatJob({ status: "active", projectId: "p1" }, "p1"), true);
    assert.equal(shouldResubscribeToChatJob({ status: "queued", projectId: "p1" }, "p1"), true);
    assert.equal(shouldResubscribeToChatJob({ status: "completed", projectId: "p1" }, "p1"), true);
    assert.equal(shouldResubscribeToChatJob({ status: "failed", projectId: "p1" }, "p1"), true);
    assert.equal(shouldResubscribeToChatJob({ status: "unknown" }, "p1"), false);
    assert.equal(shouldResubscribeToChatJob(null, "p1"), false);
    assert.equal(shouldResubscribeToChatJob({ status: "active", projectId: "otro" }, "p1"), false);
  });

  it("backoff de reconexión acotado", () => {
    assert.equal(chatEventsReconnectDelayMs(1), 1_000);
    assert.equal(chatEventsReconnectDelayMs(3), 4_000);
    assert.equal(chatEventsReconnectDelayMs(20), 15_000);
  });
});

describe("mddChatJob: lector NDJSON", () => {
  it("reensambla líneas partidas entre chunks y la última sin salto de línea", async () => {
    const body = ndjsonBody(['{"type":"progress","cursor":1}\n{"type":"dr', 'aft","cursor":2}\n{"type":"done","cursor":3}']);
    const out: Array<Record<string, unknown>> = [];
    for await (const o of readNdjsonObjects(body)) out.push(o);
    assert.deepEqual(out.map((o) => o.type), ["progress", "draft", "done"]);
  });
});

describe("mddChatJob: consumeMddChatEvents", () => {
  it("entrega eventos, avanza el cursor y termina en el evento terminal (interrupt)", async () => {
    const seen: string[] = [];
    const cursors: number[] = [];
    const outcome = await consumeMddChatEvents({
      jobId: "1",
      cursor: 0,
      openStream: async () => ({
        ok: true,
        status: 200,
        body: ndjsonBody([
          '{"type":"progress","agent":"A","message":"m","cursor":1}\n',
          '{"type":"heartbeat","cursor":1}\n{"type":"interrupt","threadId":"t","cursor":2}\n',
          '{"type":"progress","agent":"X","message":"posterior","cursor":3}\n',
        ]),
      }),
      onEvent: async (e) => {
        seen.push(String(e.type));
        return e.type === "interrupt" ? "terminal" : "continue";
      },
      onCursor: (c) => cursors.push(c),
      sleep: noSleep,
    });
    assert.equal(outcome, "terminal");
    assert.deepEqual(seen, ["progress", "interrupt"]);
    assert.deepEqual(cursors, [1, 2]);
  });

  it("si el stream se corta sin terminal, reabre desde el último cursor (sin duplicar eventos)", async () => {
    const opened: number[] = [];
    const seen: string[] = [];
    const outcome = await consumeMddChatEvents({
      jobId: "1",
      cursor: 0,
      openStream: async (cursor) => {
        opened.push(cursor);
        if (opened.length === 1) {
          return {
            ok: true,
            status: 200,
            body: ndjsonBody(['{"type":"progress","message":"a","agent":"A","cursor":1}\n{"type":"progress","message":"b","agent":"A","cursor":2}\n']),
          };
        }
        return { ok: true, status: 200, body: ndjsonBody(['{"type":"done","markdown":"# x","cursor":3}\n']) };
      },
      onEvent: async (e) => {
        seen.push(`${e.type}:${String(e.message ?? "")}`);
        return "continue";
      },
      sleep: noSleep,
    });
    assert.equal(outcome, "terminal");
    assert.deepEqual(opened, [0, 2]);
    assert.deepEqual(seen, ["progress:a", "progress:b", "done:"]);
  });

  it("reintenta tras un fallo de red y reanuda desde el cursor guardado", async () => {
    let calls = 0;
    const opened: number[] = [];
    const outcome = await consumeMddChatEvents({
      jobId: "1",
      cursor: 7,
      openStream: async (cursor) => {
        opened.push(cursor);
        calls += 1;
        if (calls === 1) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, body: ndjsonBody(['{"type":"done","markdown":"# x","cursor":8}\n']) };
      },
      onEvent: async () => "continue",
      sleep: noSleep,
    });
    assert.equal(outcome, "terminal");
    assert.deepEqual(opened, [7, 7]);
  });

  it("404 es fatal (job desaparecido) y se rinde tras demasiados fallos consecutivos", async () => {
    await assert.rejects(
      consumeMddChatEvents({
        jobId: "1",
        cursor: 0,
        openStream: async () => ({ ok: false, status: 404, body: null }),
        onEvent: async () => "continue",
        sleep: noSleep,
      }),
      /ya no existe/,
    );
    await assert.rejects(
      consumeMddChatEvents({
        jobId: "1",
        cursor: 0,
        openStream: async () => ({ ok: false, status: 503, body: null }),
        onEvent: async () => "continue",
        sleep: noSleep,
      }),
      /Error de conexión/,
    );
  });

  it("un error terminal sin mensaje también corta (evita bucle de reconexión)", async () => {
    let opens = 0;
    const outcome = await consumeMddChatEvents({
      jobId: "1",
      cursor: 0,
      openStream: async () => {
        opens += 1;
        return { ok: true, status: 200, body: ndjsonBody(['{"type":"error","cursor":1}\n']) };
      },
      onEvent: async () => "continue",
      sleep: noSleep,
    });
    assert.equal(outcome, "terminal");
    assert.equal(opens, 1);
  });

  it("el aborto devuelve aborted sin abrir el stream", async () => {
    const ac = new AbortController();
    ac.abort();
    let opened = false;
    const outcome = await consumeMddChatEvents({
      jobId: "1",
      cursor: 0,
      signal: ac.signal,
      openStream: async () => {
        opened = true;
        return { ok: true, status: 200, body: ndjsonBody([]) };
      },
      onEvent: async () => "continue",
      sleep: noSleep,
    });
    assert.equal(outcome, "aborted");
    assert.equal(opened, false);
  });
});
