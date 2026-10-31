import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  InProcessMddJobEventStore,
  MDD_JOB_EVENT_NOOP,
  MddJobEventRelay,
  isTerminalMddJobEvent,
  mddJobEventsKey,
  parseMddJobEventsCursor,
  tailMddJobEvents,
  type MddJobEventStore,
  type MddJobRelayEvent,
  type MddJobTailLine,
} from "./mdd-job-events.util.js";
import { MddJobEventsService } from "./mdd-job-events.service.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function collect(gen: AsyncGenerator<MddJobTailLine>): Promise<MddJobTailLine[]> {
  const out: MddJobTailLine[] = [];
  for await (const line of gen) out.push(line);
  return out;
}

describe("mdd job-events: helpers", () => {
  it("la clave y el canal siguen el formato mdd:job-events:<jobId>", () => {
    assert.equal(mddJobEventsKey("42"), "mdd:job-events:42");
  });

  it("parseMddJobEventsCursor normaliza valores inválidos a 0", () => {
    assert.equal(parseMddJobEventsCursor(undefined), 0);
    assert.equal(parseMddJobEventsCursor("abc"), 0);
    assert.equal(parseMddJobEventsCursor("-4"), 0);
    assert.equal(parseMddJobEventsCursor("7"), 7);
    assert.equal(parseMddJobEventsCursor(3), 3);
  });

  it("done, error, interrupt y blocked son terminales; progress y draft no", () => {
    for (const type of ["done", "error", "interrupt", "blocked"]) {
      assert.equal(isTerminalMddJobEvent({ type }), true, type);
    }
    for (const type of ["progress", "draft", "heartbeat"]) {
      assert.equal(isTerminalMddJobEvent({ type }), false, type);
    }
  });
});

describe("mdd job-events: relay + store en proceso", () => {
  it("append asigna índices consecutivos y read reproduce desde el cursor", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "j1");
    assert.equal(await relay.emit({ type: "progress", agent: "A", message: "m1" }), 0);
    assert.equal(await relay.emit({ type: "progress", agent: "B", message: "m2" }), 1);
    assert.equal(await relay.emit({ type: "done", markdown: "# x" }), 2);

    const all = await store.read("j1", 0);
    assert.deepEqual(all.map((e) => e.index), [0, 1, 2]);
    const fromOne = await store.read("j1", 1);
    assert.deepEqual(fromOne.map((e) => e.event.type), ["progress", "done"]);
    assert.deepEqual(await store.read("j1", 3), []);
    assert.deepEqual(await store.read("otro", 0), []);
  });

  it("conserva solo los últimos 3 borradores (los demás pasan a noop sin mover cursores)", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "j2");
    for (let i = 0; i < 6; i++) {
      await relay.emit({ type: "draft", markdown: `# draft ${i}` });
      await relay.emit({ type: "progress", agent: "A", message: `p${i}` });
    }
    const entries = await store.read("j2", 0);
    assert.equal(entries.length, 12);
    const drafts = entries.filter((e) => e.event.type === "draft");
    assert.equal(drafts.length, 3);
    assert.deepEqual(
      drafts.map((e) => e.event.markdown),
      ["# draft 3", "# draft 4", "# draft 5"],
    );
    const noops = entries.filter((e) => e.event.type === MDD_JOB_EVENT_NOOP);
    assert.equal(noops.length, 3);
    // Los índices de los progress no cambian.
    assert.deepEqual(
      entries.filter((e) => e.event.type === "progress").map((e) => e.index),
      [1, 3, 5, 7, 9, 11],
    );
  });

  it("hasTerminal / emitTerminalIfMissing: no duplica el cierre", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "j3");
    assert.equal(relay.hasTerminal(), false);
    await relay.emit({ type: "interrupt", threadId: "t1", questions: ["¿q?"] });
    assert.equal(relay.hasTerminal(), true);
    await relay.emitTerminalIfMissing({ type: "error", message: "no debe agregarse" });
    assert.equal((await store.read("j3", 0)).length, 1);

    const relay2 = new MddJobEventRelay(store, "j4");
    await relay2.emitTerminalIfMissing({ type: "error", message: "Cancelado", code: "CANCELLED" });
    assert.equal((await store.read("j4", 0))[0]?.event.code, "CANCELLED");
  });

  it("un fallo del store no tumba el turno: se reporta por onError y emit devuelve -1", async () => {
    const failing: MddJobEventStore = {
      append: async () => {
        throw new Error("redis caído");
      },
      replace: async () => undefined,
      read: async () => [],
      subscribe: async () => () => undefined,
    };
    const errors: unknown[] = [];
    const relay = new MddJobEventRelay(failing, "j5", { onError: (e) => errors.push(e) });
    assert.equal(await relay.emit({ type: "progress", agent: "A", message: "m" }), -1);
    assert.equal(errors.length, 1);
    assert.equal(relay.hasTerminal(), false);
  });

  it("el store en proceso expira jobs pasado el TTL", async () => {
    let now = 1_000;
    const store = new InProcessMddJobEventStore(100, () => now);
    await store.append("j6", { type: "progress" });
    assert.equal((await store.read("j6", 0)).length, 1);
    now += 101;
    assert.equal((await store.read("j6", 0)).length, 0);
  });
});

describe("mdd job-events: tail", () => {
  it("reproduce desde el cursor, incluye cursor por línea y corta en el evento terminal", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "t1");
    await relay.emit({ type: "progress", agent: "A", message: "m0" });
    await relay.emit({ type: "progress", agent: "B", message: "m1" });
    await relay.emit({ type: "done", markdown: "# fin", persistedOnServer: true });
    await relay.emit({ type: "progress", agent: "C", message: "posterior" });

    const full = await collect(tailMddJobEvents(store, "t1", 0));
    assert.deepEqual(full.map((l) => l.type), ["progress", "progress", "done"]);
    assert.deepEqual(full.map((l) => l.cursor), [1, 2, 3]);

    const resumed = await collect(tailMddJobEvents(store, "t1", 2));
    assert.deepEqual(resumed.map((l) => l.type), ["done"]);
    assert.equal(resumed[0]?.cursor, 3);
    assert.equal(resumed[0]?.persistedOnServer, true);
  });

  it("omite los noop pero avanza el cursor", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "t2", { maxDrafts: 1 });
    await relay.emit({ type: "draft", markdown: "a" });
    await relay.emit({ type: "draft", markdown: "b" });
    await relay.emit({ type: "interrupt", threadId: "th" });
    const lines = await collect(tailMddJobEvents(store, "t2", 0));
    assert.deepEqual(lines.map((l) => l.type), ["draft", "interrupt"]);
    assert.deepEqual(lines.map((l) => l.cursor), [2, 3]);
    assert.equal(lines[0]?.markdown, "b");
  });

  it("sigue en vivo: recibe eventos emitidos después de suscribirse y termina en el terminal", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "t3");
    const pending = collect(tailMddJobEvents(store, "t3", 0, { heartbeatMs: 1_000, idleCheckMs: 1_000 }));
    await sleep(20);
    await relay.emit({ type: "progress", agent: "A", message: "vivo" });
    await sleep(20);
    await relay.emit({ type: "interrupt", threadId: "th", questions: ["¿?"] });
    const lines = await pending;
    assert.deepEqual(lines.map((l) => l.type), ["progress", "interrupt"]);
    assert.equal(lines[1]?.threadId, "th");
  });

  it("emite heartbeat con cursor mientras no hay eventos", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "t4");
    await relay.emit({ type: "progress", agent: "A", message: "m" });
    const abort = new AbortController();
    const lines: MddJobTailLine[] = [];
    const run = (async () => {
      for await (const line of tailMddJobEvents(store, "t4", 0, {
        signal: abort.signal,
        heartbeatMs: 20,
        idleCheckMs: 10,
      })) {
        lines.push(line);
        if (lines.filter((l) => l.type === "heartbeat").length >= 2) abort.abort();
      }
    })();
    await run;
    const beats = lines.filter((l) => l.type === "heartbeat");
    assert.ok(beats.length >= 2);
    assert.ok(beats.every((b) => b.cursor === 1));
  });

  it("onIdle puede cerrar el tail con un evento sintético (job muerto sin terminal)", async () => {
    const store = new InProcessMddJobEventStore();
    const relay = new MddJobEventRelay(store, "t5");
    await relay.emit({ type: "progress", agent: "A", message: "m" });
    let calls = 0;
    const lines = await collect(
      tailMddJobEvents(store, "t5", 0, {
        heartbeatMs: 1_000,
        idleCheckMs: 10,
        onIdle: async () => {
          calls += 1;
          return calls >= 2 ? ({ type: "error", message: "job fallido", code: "JOB_FAILED" } as MddJobRelayEvent) : null;
        },
      }),
    );
    assert.deepEqual(lines.map((l) => l.type), ["progress", "error"]);
    assert.equal(lines[1]?.code, "JOB_FAILED");
    assert.equal(lines[1]?.cursor, 1);
  });

  it("el aborto del cliente corta el tail sin evento terminal y se da de baja del store", async () => {
    const store = new InProcessMddJobEventStore();
    const abort = new AbortController();
    const pending = collect(tailMddJobEvents(store, "t6", 0, { signal: abort.signal, heartbeatMs: 1_000, idleCheckMs: 1_000 }));
    await sleep(15);
    abort.abort();
    assert.deepEqual(await pending, []);
    // Tras la baja, emitir ya no encuentra oyentes (no lanza).
    await store.append("t6", { type: "progress" });
  });
});

describe("MddJobEventsService (fallback en proceso, sin REDIS_URL)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  });

  it("relayFor + tail: el consumidor reanuda con el cursor recibido", async () => {
    const svc = new MddJobEventsService();
    const relay = await svc.relayFor("svc-1");
    await relay.emit({ type: "progress", agent: "Manager", message: "planificando" });
    await relay.emit({ type: "draft", markdown: "# borrador" });
    const first = await collect(svc.tail("svc-1", 0, { heartbeatMs: 20, idleCheckMs: 10, signal: AbortSignal.timeout(60) }));
    const lastCursor = first.at(-1)?.cursor ?? 0;
    assert.equal(lastCursor, 2);

    await relay.emit({ type: "done", markdown: "# final", persistedOnServer: true });
    const rest = await collect(svc.tail("svc-1", lastCursor));
    assert.deepEqual(rest.map((l) => l.type), ["done"]);
    assert.equal(rest[0]?.cursor, 3);
  });
});
