import { describe, expect, it } from "vitest";
import {
  extractLlmText,
  extractLlmToolCalls,
  invokeLlmWithRetry,
  llmResponseHasUsableToolCalls,
} from "./mdd-llm-retry.util.js";

class FakeLlm {
  /** Cola de respuestas a devolver en orden; si se agota, repite la última. */
  constructor(public responses: unknown[]) {}
  callCount = 0;
  async invoke(_messages: unknown[]): Promise<unknown> {
    this.callCount += 1;
    const idx = Math.min(this.callCount - 1, this.responses.length - 1);
    return this.responses[idx];
  }
}

describe("extractLlmText", () => {
  it("string content", () => {
    expect(extractLlmText({ content: "hola" })).toBe("hola");
  });
  it("array of content blocks (text + ignore)", () => {
    expect(extractLlmText({ content: [{ text: "a" }, { text: "b" }, { ignore: true }] })).toBe("ab");
  });
  it("empty / null / undefined", () => {
    expect(extractLlmText(null)).toBe("");
    expect(extractLlmText(undefined)).toBe("");
    expect(extractLlmText({ content: "" })).toBe("");
    expect(extractLlmText({ content: [] })).toBe("");
  });
  it("plain string passes through", () => {
    expect(extractLlmText("foo")).toBe("foo");
  });

  it("content blocks with type text", () => {
    expect(extractLlmText({ content: [{ type: "text", text: "hola" }] })).toBe("hola");
  });
});

describe("extractLlmToolCalls", () => {
  it("lee tool_calls en raíz AIMessage", () => {
    const calls = extractLlmToolCalls({
      content: "",
      tool_calls: [{ id: "tc1", name: "validate_mdd_structure", args: { draft: "x" } }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("validate_mdd_structure");
  });

  it("lee tool_calls en additional_kwargs (OpenAI-compat)", () => {
    const calls = extractLlmToolCalls({
      content: "",
      additional_kwargs: {
        tool_calls: [
          {
            id: "tc2",
            function: { name: "validate_sql_syntax", arguments: "{}" },
          },
        ],
      },
    });
    expect(calls[0]?.name).toBe("validate_sql_syntax");
  });

  it("llmResponseHasUsableToolCalls con content vacío", () => {
    expect(
      llmResponseHasUsableToolCalls({
        content: "",
        tool_calls: [{ name: "x", args: {} }],
      }),
    ).toBe(true);
  });
});

describe("invokeLlmWithRetry", () => {
  it("devuelve la respuesta en el primer intento si es válida", async () => {
    const llm = new FakeLlm([{ content: "primera válida" }]);
    const r = await invokeLlmWithRetry(llm as never, [], { tag: "test" });
    expect(extractLlmText(r)).toBe("primera válida");
    expect(llm.callCount).toBe(1);
  });

  it("reintenta cuando la respuesta está vacía y termina con la válida", async () => {
    const llm = new FakeLlm([
      { content: "" },
      { content: "" },
      { content: "recuperada en 3" },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 0, 0],
    });
    expect(extractLlmText(r)).toBe("recuperada en 3");
    expect(llm.callCount).toBe(3);
  });

  it("devuelve null si todos los intentos fallan", async () => {
    const llm = new FakeLlm([{ content: "" }, { content: "   " }, { content: "" }]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 3,
      backoffMs: [0, 0, 0],
    });
    expect(r).toBeNull();
    expect(llm.callCount).toBe(3);
  });

  it("atrapa excepciones y reintenta", async () => {
    const llm = new FakeLlm([
      { invoke: () => Promise.reject(new Error("429 rate limit")) },
      { content: "ok en retry" },
    ]);
    // override invoke to throw on first call
    llm.invoke = (async () => {
      llm.callCount += 1;
      if (llm.callCount === 1) throw new Error("429 rate limit");
      return { content: "ok en retry" };
    }) as never;
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 2,
      backoffMs: [0, 0],
    });
    expect(extractLlmText(r)).toBe("ok en retry");
  });

  it("respeta el validador personalizado", async () => {
    const llm = new FakeLlm([
      { content: "placeholder" },
      { content: "sustancial con substance > 50 chars" },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      maxAttempts: 2,
      backoffMs: [0, 0],
      isResponseValid: (t) => t.length > 20,
    });
    expect(extractLlmText(r)).toContain("sustancial");
    expect(llm.callCount).toBe(2);
  });

  it("acepta tool_calls sin content cuando acceptToolCallsWithoutContent", async () => {
    const llm = new FakeLlm([
      { content: "", tool_calls: [{ name: "probe", args: {} }] },
    ]);
    const r = await invokeLlmWithRetry(llm as never, [], {
      tag: "test",
      acceptToolCallsWithoutContent: true,
      isResponseValid: (t) => t.trim().length > 0,
    });
    expect(llmResponseHasUsableToolCalls(r)).toBe(true);
    expect(llm.callCount).toBe(1);
  });
});
