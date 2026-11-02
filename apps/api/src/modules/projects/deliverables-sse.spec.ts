import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { streamDeliverablesJob, type SseJobStatusLike } from "./deliverables-sse.util.js";

class FakeRes extends EventEmitter {
  writes: string[] = [];
  ended = 0;
  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.ended += 1;
  }
  events(): string[] {
    return this.writes.map((w) => /^event: (\S+)/.exec(w)?.[1] ?? "?");
  }
}

/** Timers falsos: guardan el callback pendiente y registran las cancelaciones. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  const cleared: number[] = [];
  let next = 1;
  return {
    pending,
    cleared,
    setTimeoutFn: (fn: () => void) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeoutFn: (h: unknown) => {
      cleared.push(h as number);
      pending.delete(h as number);
    },
    /** Ejecuta (y consume) el timer de sondeo más antiguo, es decir el segundo creado en adelante. */
    fire(id: number) {
      const fn = pending.get(id);
      pending.delete(id);
      fn?.();
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function statusQueue(seq: Array<SseJobStatusLike | Error>) {
  let i = 0;
  return {
    calls: () => i,
    get: async (): Promise<SseJobStatusLike> => {
      const item = seq[Math.min(i, seq.length - 1)]!;
      i += 1;
      if (item instanceof Error) throw item;
      return item;
    },
  };
}

describe("streamDeliverablesJob", () => {
  it("emite progress y completed y cierra", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    const q = statusQueue([{ status: "completed", progress: 100, result: { ok: true } }]);
    streamDeliverablesJob(res, q.get, timers);
    await flush();
    assert.deepEqual(res.events(), ["progress", "completed"]);
    assert.equal(res.ended, 1);
    assert.equal(timers.pending.size, 0, "no deben quedar timers pendientes");
  });

  it("failed cierra con el mensaje de error", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    streamDeliverablesJob(res, statusQueue([{ status: "failed", error: "boom" }]).get, timers);
    await flush();
    assert.deepEqual(res.events(), ["progress", "failed"]);
    assert.match(res.writes[1]!, /boom/);
    assert.equal(res.ended, 1);
    assert.equal(timers.pending.size, 0);
  });

  it("unknown es terminal: emite 'unknown' y cierra sin reprogramar", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    streamDeliverablesJob(res, statusQueue([{ status: "unknown" }]).get, timers);
    await flush();
    assert.deepEqual(res.events(), ["unknown"]);
    assert.equal(res.ended, 1);
    assert.equal(timers.pending.size, 0);
  });

  it("retrying sigue sondeando y luego termina", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    const q = statusQueue([{ status: "retrying", error: "reintento" }, { status: "completed", result: null }]);
    streamDeliverablesJob(res, q.get, timers);
    await flush();
    assert.deepEqual(res.events(), ["progress", "retrying"]);
    assert.equal(res.ended, 0);
    // timer 1 = tope de duración, timer 2 = sondeo
    timers.fire(2);
    await flush();
    assert.deepEqual(res.events(), ["progress", "retrying", "progress", "completed"]);
    assert.equal(res.ended, 1);
  });

  it("al emitir close no se escribe más y se limpian los timers", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    const q = statusQueue([{ status: "active", progress: 10 }]);
    streamDeliverablesJob(res, q.get, timers);
    await flush();
    assert.deepEqual(res.events(), ["progress"]);
    assert.equal(timers.pending.size, 2, "tope de duración y sondeo pendientes");

    res.emit("close");
    assert.equal(timers.pending.size, 0, "close cancela ambos timers");
    assert.deepEqual(timers.cleared.sort(), [1, 2]);

    // Aunque el callback ya agendado se ejecute, no debe escribir ni consultar de nuevo
    const callsBefore = q.calls();
    const writesBefore = res.writes.length;
    await flush();
    assert.equal(res.writes.length, writesBefore);
    assert.equal(q.calls(), callsBefore);
    assert.equal(res.ended, 0, "no se llama end() sobre una conexión ya cerrada");
  });

  it("close durante una lectura en vuelo descarta el resultado", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    let release!: (s: SseJobStatusLike) => void;
    const pendingStatus = new Promise<SseJobStatusLike>((resolve) => {
      release = resolve;
    });
    streamDeliverablesJob(res, () => pendingStatus, timers);
    res.emit("close");
    release({ status: "completed", result: 1 });
    await flush();
    assert.deepEqual(res.writes, []);
    assert.equal(timers.pending.size, 0, "no se reprograma el sondeo");
  });

  it("un error al leer el estado emite 'error' y cierra", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    streamDeliverablesJob(res, statusQueue([new Error("redis caído")]).get, timers);
    await flush();
    assert.deepEqual(res.events(), ["error"]);
    assert.match(res.writes[0]!, /redis caído/);
    assert.equal(res.ended, 1);
    assert.equal(timers.pending.size, 0);
  });

  it("el tope de duración cierra con 'timeout' y cancela el sondeo", async () => {
    const res = new FakeRes();
    const timers = fakeTimers();
    streamDeliverablesJob(res, statusQueue([{ status: "active", progress: 1 }]).get, timers);
    await flush();
    timers.fire(1);
    assert.deepEqual(res.events(), ["progress", "timeout"]);
    assert.equal(res.ended, 1);
    assert.equal(timers.pending.size, 0);
  });

  it("si res.write lanza (socket destruido) se limpia sin propagar", async () => {
    const res = new FakeRes();
    res.write = () => {
      throw new Error("EPIPE");
    };
    const timers = fakeTimers();
    streamDeliverablesJob(res, statusQueue([{ status: "active" }]).get, timers);
    await flush();
    assert.equal(timers.pending.size, 0);
  });
});
