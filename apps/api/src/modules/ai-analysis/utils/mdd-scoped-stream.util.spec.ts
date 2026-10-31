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

  it("sin .stream usa invoke", async () => {
    const llm = { invoke: async () => ({ content: "ok directo" }) };
    const res = await invokeScopedArchitectLlmWithHeadingCap(llm as never, msgs, { tag: "T" });
    assert.strictEqual(extractLlmText(res), "ok directo");
  });
});
