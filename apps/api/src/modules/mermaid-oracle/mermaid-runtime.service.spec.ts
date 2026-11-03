import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ConfigService } from "@nestjs/config";
import { MermaidRuntimeService } from "./mermaid-runtime.service.js";

class FakeWorker extends EventEmitter {
  postMessage(_msg: unknown): void {
    // sobreescrito en cada test
  }

  terminate(): Promise<number> {
    return Promise.resolve(0);
  }
}

function mockConfig(): ConfigService {
  return { get: () => undefined } as ConfigService;
}

test("MermaidRuntimeService: timeout devuelve unavailable", async () => {
  const svc = new MermaidRuntimeService(mockConfig());
  svc.parseTimeoutMs = 35;
  svc.spawnWorkerFn = () => new FakeWorker() as unknown as import("node:worker_threads").Worker;

  const result = await svc.parse("flowchart TD\n  A --> B");
  assert.equal(result.status, "unavailable");
  assert.match(result.error ?? "", /timeout/i);
});

test("MermaidRuntimeService: reenvía resultado del worker", async () => {
  const svc = new MermaidRuntimeService(mockConfig());
  svc.parseTimeoutMs = 2_000;
  svc.spawnWorkerFn = () => {
    const worker = new FakeWorker();
    worker.postMessage = (msg: unknown) => {
      const { id } = msg as { id: number };
      setImmediate(() => {
        worker.emit("message", {
          id,
          result: { status: "ok", diagramType: "flowchart-v2" },
        });
      });
    };
    return worker as unknown as import("node:worker_threads").Worker;
  };

  const result = await svc.parse("flowchart TD\n  A --> B");
  assert.equal(result.status, "ok");
  assert.equal(result.diagramType, "flowchart-v2");
});

test("MermaidRuntimeService: onModuleDestroy cancela pendientes", async () => {
  const svc = new MermaidRuntimeService(mockConfig());
  svc.parseTimeoutMs = 60_000;
  svc.spawnWorkerFn = () => new FakeWorker() as unknown as import("node:worker_threads").Worker;

  const pending = svc.parse("sequenceDiagram\n  A->>B: hi");
  await svc.onModuleDestroy();
  const result = await pending;
  assert.equal(result.status, "unavailable");
  assert.match(result.error ?? "", /detenido/i);
});
