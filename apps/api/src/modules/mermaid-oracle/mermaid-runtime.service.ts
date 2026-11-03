import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { MermaidParseResult, MermaidParser } from "@theforge/shared-types/mermaid-oracle";
import type {
  MermaidParseWorkerRequest,
  MermaidParseWorkerResponse,
} from "./mermaid-parse.worker.js";

const DEFAULT_PARSE_TIMEOUT_MS = 8_000;

type PendingParse = {
  resolve: (result: MermaidParseResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

function resolveParseTimeoutMs(config: ConfigService): number {
  const raw = config.get<string | number>("MERMAID_PARSE_TIMEOUT_MS");
  if (raw === undefined || raw === null || raw === "") return DEFAULT_PARSE_TIMEOUT_MS;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PARSE_TIMEOUT_MS;
}

@Injectable()
export class MermaidRuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(MermaidRuntimeService.name);
  protected parseTimeoutMs: number;
  protected workerScriptPath: string;
  protected spawnWorkerFn: () => Worker;
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingParse>();

  constructor(config: ConfigService) {
    this.parseTimeoutMs = resolveParseTimeoutMs(config);
    this.workerScriptPath = join(__dirname, "mermaid-parse.worker.js");
    this.spawnWorkerFn = () =>
      new Worker(this.workerScriptPath, {
        env: process.env,
      });
  }

  /** Parser inyectable para `resolveMermaidWithOracle` / `resolveMermaidBlocksInDocument`. */
  createParser(): MermaidParser {
    return (text: string) => this.parse(text);
  }

  async parse(text: string): Promise<MermaidParseResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<MermaidParseResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          status: "unavailable",
          error: `timeout de parser Mermaid (${this.parseTimeoutMs}ms)`,
        });
      }, this.parseTimeoutMs);
      this.pending.set(id, { resolve, timer });
      const req: MermaidParseWorkerRequest = { id, text: text ?? "" };
      worker.postMessage(req);
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        status: "unavailable",
        error: "servicio Mermaid detenido",
      });
      this.pending.delete(id);
    }
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.spawnWorkerFn();
    worker.on("message", (msg: MermaidParseWorkerResponse) => {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve(msg.result);
    });
    worker.on("error", (err) => {
      this.logger.warn(`Worker Mermaid error: ${err.message}`);
      this.recycleWorker();
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.logger.warn(`Worker Mermaid terminó con código ${code}`);
      }
      this.worker = null;
      this.failAllPending("worker Mermaid terminó inesperadamente");
    });
    this.worker = worker;
    return worker;
  }

  private recycleWorker(): void {
    void this.worker?.terminate();
    this.worker = null;
    this.failAllPending("worker Mermaid no disponible");
  }

  private failAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ status: "unavailable", error: reason });
      this.pending.delete(id);
    }
  }
}
