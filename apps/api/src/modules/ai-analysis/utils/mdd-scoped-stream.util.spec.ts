import { describe, it } from "node:test";
import assert from "node:assert";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import {
  hasSecondCanonicalMddHeading,
  invokeScopedArchitectLlmWithHeadingCap,
  trimBeforeSecondCanonicalMddHeading,
} from "./mdd-scoped-stream.util.js";
import { extractLlmText } from "./mdd-llm-retry.util.js";

describe("mdd-scoped-stream.util", () => {
  it("hasSecondCanonicalMddHeading false con un solo heading", () => {
    assert.strictEqual(hasSecondCanonicalMddHeading("## 3. Modelo de Datos\n\nSQL aquí"), false);
  });

  it("detecta y recorta al 2º heading canónico", () => {
    const raw = `## 4. Contratos de API

GET /health

## 5. Lógica y Edge Cases

no debe quedar`;
    assert.strictEqual(hasSecondCanonicalMddHeading(raw), true);
    assert.strictEqual(
      trimBeforeSecondCanonicalMddHeading(raw),
      `## 4. Contratos de API

GET /health`,
    );
  });
});

describe("invokeScopedArchitectLlmWithHeadingCap", () => {
  const msgs = [new HumanMessage("hola")];

  it("aborta por inactividad un stream colgado y cae a invoke", async () => {
    let sawSignal: AbortSignal | undefined;
    let invoked = 0;
    const llm = {
      stream: (_m: unknown, opts?: { signal?: AbortSignal }) => {
        sawSignal = opts?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<unknown>>(() => undefined), // se cuelga
              return: () => new Promise<IteratorResult<unknown>>(() => undefined),
            };
          },
        };
      },
      invoke: async () => {
        invoked += 1;
        return { content: "## 4. Contratos de API\n\nrespuesta por invoke" };
      },
    };
    const t0 = Date.now();
    const res = await invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, {
      tag: "T",
      idleTimeoutMs: 40,
      hardTimeoutMs: 5_000,
    });
    assert.ok(Date.now() - t0 < 2_000, "no debe esperar al tope duro");
    assert.strictEqual(invoked, 1);
    assert.ok(sawSignal?.aborted, "el AbortSignal debe haberse abortado");
    assert.match(extractLlmText(res), /respuesta por invoke/);
  });

  it("corta al 2º heading, devuelve usage_metadata acumulado", async () => {
    async function* gen() {
      yield new AIMessageChunk({ content: "## 4. Contratos de API\n\nGET /x\n", usage_metadata: { input_tokens: 10, output_tokens: 0, total_tokens: 10 } });
      yield new AIMessageChunk({ content: "\n## 5. Lógica\n\nno", usage_metadata: { input_tokens: 0, output_tokens: 7, total_tokens: 7 } });
      yield new AIMessageChunk({ content: "nunca llega" });
    }
    const llm = { stream: async () => gen(), invoke: async () => ({ content: "NO" }) };
    const res = (await invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" })) as {
      content: string;
      usage_metadata?: { input_tokens: number; output_tokens: number; total_tokens: number };
    };
    assert.strictEqual(res.content, "## 4. Contratos de API\n\nGET /x");
    assert.deepStrictEqual(res.usage_metadata, { input_tokens: 10, output_tokens: 7, total_tokens: 17 });
  });

  it("abort externo durante un stream colgado: rechaza, cierra el iterador (return) y no cae a invoke", async () => {
    let returned = 0;
    let invoked = 0;
    const llm = {
      stream: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => undefined), // se cuelga
            return: () => {
              returned += 1;
              return Promise.resolve({ done: true, value: undefined } as IteratorResult<unknown>);
            },
          };
        },
      }),
      invoke: async () => {
        invoked += 1;
        return { content: "no debe llegar" };
      },
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(
      invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, {
        tag: "T",
        signal: controller.signal,
        idleTimeoutMs: 5_000,
        hardTimeoutMs: 5_000,
      }),
    );
    assert.strictEqual(returned, 1, "iterator.return() debe llamarse con abort externo");
    assert.strictEqual(invoked, 0);
  });

  it("el fallback por timeout recibe la señal externa: un abort durante el invoke del fallback lo corta", async () => {
    let invokeStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      invokeStarted = resolve;
    });
    const llm = {
      stream: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => undefined),
            return: () => new Promise<IteratorResult<unknown>>(() => undefined),
          };
        },
      }),
      // El fallback se cuelga hasta que se aborta la señal que recibe.
      invoke: (_m: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          invokeStarted?.();
          opts?.signal?.addEventListener("abort", () => reject(new Error("invoke abortado")), { once: true });
        }),
    };
    const controller = new AbortController();
    const run = invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, {
      tag: "T",
      signal: controller.signal,
      idleTimeoutMs: 30,
      hardTimeoutMs: 5_000,
    });
    void started.then(() => controller.abort());
    const t0 = Date.now();
    await assert.rejects(run);
    assert.ok(Date.now() - t0 < 2_000, "el abort externo debe cortar el fallback");
  });

  it("sin .stream usa invoke", async () => {
    const llm = { invoke: async () => ({ content: "ok directo" }) };
    const res = await invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" });
    assert.strictEqual(extractLlmText(res), "ok directo");
  });
});
