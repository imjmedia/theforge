import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { probeMddLlmModel } from "./mdd-llm-preflight.util.js";

describe("probeMddLlmModel", () => {
  it("acepta JSON válido tras invoke con retry", async () => {
    const llm = {
      invoke: async () => ({ content: '{"ok":true,"probe":"mdd"}' }),
    } as unknown as BaseChatModel;
    const result = await probeMddLlmModel(llm, "test/model");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "content");
  });

  it("reintenta cuando la primera respuesta está vacía", async () => {
    let calls = 0;
    const llm = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) return { content: "" };
        return { content: '{"ok":true,"probe":"mdd"}' };
      },
    } as unknown as BaseChatModel;
    const result = await probeMddLlmModel(llm, "test/model-retry");
    assert.equal(result.ok, true);
    assert.ok(calls >= 2);
  });

  it("acepta tool_calls sin texto", async () => {
    const llm = {
      invoke: async () => ({
        content: "",
        tool_calls: [{ id: "1", name: "noop", args: {} }],
      }),
    } as unknown as BaseChatModel;
    const result = await probeMddLlmModel(llm, "test/tools");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "tool_calls");
  });
});
