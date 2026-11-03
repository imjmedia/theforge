import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  addToOfflineQueue,
  clearAccessToken,
  clearOfflineQueue,
  getOfflineQueue,
  hashOfflineContent,
  queueKey,
  removeFromOfflineQueue,
  resolveApiUrl,
} from "./apiClient.js";

function memoryLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("apiClient: resolveApiUrl", () => {
  it("une API_BASE con rutas /api/… sin duplicar prefijo", () => {
    assert.equal(resolveApiUrl("/api/user-providers/catalog"), "/api/user-providers/catalog");
  });
});

describe("apiClient: cola offline", () => {
  let prev: Storage;

  beforeEach(() => {
    prev = globalThis.localStorage;
    // @ts-expect-error test double
    globalThis.localStorage = memoryLocalStorage();
    clearOfflineQueue();
  });

  afterEach(() => {
    globalThis.localStorage = prev;
  });

  it("queueKey distingue proyecto, etapa y campo", () => {
    assert.equal(queueKey({ projectId: "p1", stageId: "s1", field: "mddContent" }), "p1:s1:mddContent");
    assert.equal(queueKey({ projectId: "p1", stageId: null, field: "dbgaContent" }), "p1:_:dbgaContent");
  });

  it("addToOfflineQueue reemplaza la última versión del mismo key", () => {
    addToOfflineQueue({
      field: "mddContent",
      content: "v1",
      projectId: "p1",
      stageId: "s1",
      contentHash: hashOfflineContent("v1"),
    });
    addToOfflineQueue({
      field: "mddContent",
      content: "v2",
      projectId: "p1",
      stageId: "s1",
      contentHash: hashOfflineContent("v2"),
    });
    assert.equal(getOfflineQueue().length, 1);
    assert.equal(getOfflineQueue()[0]?.content, "v2");
  });

  it("removeFromOfflineQueue usa queueKey completo", () => {
    addToOfflineQueue({
      field: "specContent",
      content: "x",
      projectId: "p1",
      stageId: "s1",
    });
    removeFromOfflineQueue({ projectId: "p1", stageId: "s1", field: "specContent" });
    assert.equal(getOfflineQueue().length, 0);
  });

  it("clearAccessToken vacía la cola offline", () => {
    addToOfflineQueue({
      field: "dbgaContent",
      content: "x",
      projectId: "p1",
      stageId: null,
    });
    clearAccessToken();
    assert.equal(getOfflineQueue().length, 0);
  });
});
