import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { connectIoredisReady, type IoredisLikeClient } from "./connect-ioredis-ready.js";

class FakeClient extends EventEmitter {
  status = "connecting";
  disconnected = 0;
  disconnect() {
    this.disconnected++;
  }
}

function factory(client: FakeClient, seen?: { url?: string; options?: Record<string, unknown> }) {
  return (url: string, options: Record<string, unknown>) => {
    if (seen) {
      seen.url = url;
      seen.options = options;
    }
    return client as unknown as IoredisLikeClient;
  };
}

describe("connectIoredisReady", () => {
  it("resuelve cuando el cliente emite ready y fija offline queue off + reintentos acotados", async () => {
    const client = new FakeClient();
    const seen: { url?: string; options?: Record<string, unknown> } = {};
    const p = connectIoredisReady("redis://x", {
      name: "t",
      readyTimeoutMs: 500,
      maxRetriesPerRequest: 3,
      commandTimeoutMs: 1234,
      createClient: factory(client, seen),
    });
    setImmediate(() => client.emit("ready"));
    assert.equal(await p, client as unknown);
    assert.equal(seen.url, "redis://x");
    assert.deepEqual(seen.options, { maxRetriesPerRequest: 3, enableOfflineQueue: false, commandTimeout: 1234 });
    assert.equal(client.disconnected, 0);
    assert.equal(client.listenerCount("ready"), 0, "no deja listeners colgados");
  });

  it("usa defaults (2 reintentos) y no fija commandTimeout si no se pide", async () => {
    const client = new FakeClient();
    client.status = "ready";
    const seen: { options?: Record<string, unknown> } = {};
    await connectIoredisReady("redis://x", { name: "t", createClient: factory(client, seen) });
    assert.deepEqual(seen.options, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  });

  it("si ya está ready resuelve sin esperar eventos", async () => {
    const client = new FakeClient();
    client.status = "ready";
    assert.equal(await connectIoredisReady("redis://x", { name: "t", createClient: factory(client) }), client as unknown);
  });

  it("rechaza por timeout, desconecta el cliente y no deja listeners", async () => {
    const client = new FakeClient();
    client.on("error", () => undefined);
    await assert.rejects(
      connectIoredisReady("redis://x", { name: "t", readyTimeoutMs: 20, createClient: factory(client) }),
      /no llegó a "ready" en 20 ms/,
    );
    assert.equal(client.disconnected, 1);
    assert.equal(client.listenerCount("ready"), 0);
    assert.equal(client.listenerCount("end"), 0);
  });

  it("rechaza si la conexión se cierra antes de ready", async () => {
    const client = new FakeClient();
    const p = connectIoredisReady("redis://x", { name: "t", readyTimeoutMs: 500, createClient: factory(client) });
    setImmediate(() => client.emit("end"));
    await assert.rejects(p, /cerrada antes de estar lista/);
    assert.equal(client.disconnected, 1);
  });

  it("eventos error no tumban el proceso (se loguean) y no cuentan como ready", async () => {
    const client = new FakeClient();
    const p = connectIoredisReady("redis://x", { name: "t", readyTimeoutMs: 500, createClient: factory(client) });
    setImmediate(() => {
      client.emit("error", new Error("ECONNREFUSED"));
      client.emit("ready");
    });
    assert.equal(await p, client as unknown);
  });

  it("no cachea rechazos: un segundo intento abre una conexión nueva", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const clients = [first, second];
    const create = () => clients.shift() as unknown as IoredisLikeClient;
    await assert.rejects(connectIoredisReady("redis://x", { name: "t", readyTimeoutMs: 10, createClient: create }));
    const p = connectIoredisReady("redis://x", { name: "t", readyTimeoutMs: 500, createClient: create });
    setImmediate(() => second.emit("ready"));
    assert.equal(await p, second as unknown);
    assert.equal(first.disconnected, 1);
  });
});
