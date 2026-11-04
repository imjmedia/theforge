import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DEFAULT_DESIGN_FIRST_FIGMA_TIMEOUT_MS,
  DEFAULT_FIGMA_API_BASE_URL,
} from "../../config/env.schema.js";
import { FIGMA_FILE_KEY_REGEX } from "./figma-url.util.js";
import { throwFigmaRateLimit, throwFigmaTokenInvalid } from "./figma.errors.js";

export type FigmaHttpClient = (
  url: string,
  init: RequestInit & { signal?: AbortSignal },
) => Promise<Response>;

export type FigmaClientOptions = {
  fetchImpl?: FigmaHttpClient;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

const userSemaphores = new Map<string, Promise<void>>();

async function withUserConcurrency<T>(userKey: string, fn: () => Promise<T>): Promise<T> {
  const prior = userSemaphores.get(userKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prior.then(() => gate);
  userSemaphores.set(userKey, chain);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (userSemaphores.get(userKey) === chain) userSemaphores.delete(userKey);
  }
}

function parseRetryAfterSec(header: string | null): number {
  if (!header?.trim()) return 60;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class FigmaClient {
  private readonly logger = new Logger(FigmaClient.name);
  /** Sustituible en tests vía {@link FigmaClient.createForTest}. */
  private fetchImpl: FigmaHttpClient;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  /** Sustituible en tests vía {@link FigmaClient.createForTest}. */
  private maxRetries: number;

  constructor(private readonly config: ConfigService) {
    this.fetchImpl = (url, init) => fetch(url, init);
    this.baseUrl = this.config
      .get<string>("FIGMA_API_BASE_URL", DEFAULT_FIGMA_API_BASE_URL)
      .replace(/\/+$/, "");
    this.timeoutMs = this.config.get<number>(
      "DESIGN_FIRST_FIGMA_TIMEOUT_MS",
      DEFAULT_DESIGN_FIRST_FIGMA_TIMEOUT_MS,
    );
    this.maxRetries = 2;
  }

  static createForTest(config: ConfigService, options: FigmaClientOptions = {}): FigmaClient {
    const client = new FigmaClient(config);
    if (options.fetchImpl) client.fetchImpl = options.fetchImpl;
    if (options.maxRetries !== undefined) client.maxRetries = options.maxRetries;
    return client;
  }

  assertFileKey(fileKey: string): void {
    if (!FIGMA_FILE_KEY_REGEX.test(fileKey)) {
      throw new Error("fileKey inválido");
    }
  }

  async getFile(userKey: string, token: string, fileKey: string): Promise<unknown> {
    this.assertFileKey(fileKey);
    const url = `${this.baseUrl}/v1/files/${encodeURIComponent(fileKey)}`;
    return this.requestJson(userKey, token, url);
  }

  async getFileNodes(userKey: string, token: string, fileKey: string, ids: string): Promise<unknown> {
    this.assertFileKey(fileKey);
    const url = `${this.baseUrl}/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`;
    return this.requestJson(userKey, token, url);
  }

  async validateToken(userKey: string, token: string): Promise<{ handle: string | null }> {
    const url = `${this.baseUrl}/v1/me`;
    const data = (await this.requestJson(userKey, token, url)) as { handle?: string; email?: string };
    const handle = typeof data.handle === "string" && data.handle.trim() ? data.handle.trim() : null;
    return { handle: handle ?? (typeof data.email === "string" ? data.email : null) };
  }

  private async requestJson(userKey: string, token: string, url: string): Promise<unknown> {
    return withUserConcurrency(userKey, async () => {
      let attempt = 0;
      while (true) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await this.fetchImpl(url, {
            method: "GET",
            headers: { "X-Figma-Token": token },
            signal: controller.signal,
          });
          if (res.status === 401 || res.status === 403) {
            throwFigmaTokenInvalid();
          }
          if (res.status === 429) {
            const retryAfterSec = parseRetryAfterSec(res.headers.get("Retry-After"));
            if (attempt >= this.maxRetries) {
              throwFigmaRateLimit(retryAfterSec);
            }
            const backoffMs = Math.min(retryAfterSec * 1000, 30_000) * 2 ** attempt;
            this.logger.warn(`Figma 429; reintento ${attempt + 1}/${this.maxRetries} en ${backoffMs}ms`);
            attempt += 1;
            await sleep(backoffMs);
            continue;
          }
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Figma respondió ${res.status}: ${text.slice(0, 200)}`);
          }
          return (await res.json()) as unknown;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error("Timeout al contactar Figma");
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      }
    });
  }
}
