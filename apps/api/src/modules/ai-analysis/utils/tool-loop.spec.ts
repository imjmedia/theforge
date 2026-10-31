import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FINAL_ANSWER_INSTRUCTION, forceFinalAnswer, hasToolCalls, messageText } from "./tool-loop.js";

function stubLlm(reply: unknown | Error): BaseChatModel & { calls: number } {
  const stub = {
    calls: 0,
    async invoke() {
      stub.calls += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return stub as unknown as BaseChatModel & { calls: number };
}

function stubWithTools(reply: unknown | Error) {
  const stub = {
    calls: 0,
    lastOptions: undefined as Record<string, unknown> | undefined,
    async invoke(_m: BaseMessage[], options?: Record<string, unknown>) {
      stub.calls += 1;
      stub.lastOptions = options;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return stub;
}

describe("forceFinalAnswer", () => {
  it("añade la instrucción final y devuelve el texto con tool_choice none", async () => {
    const messages: BaseMessage[] = [new HumanMessage("hola")];
    const withTools = stubWithTools(new AIMessage({ content: '{"ok":true}' }));
    const base = stubLlm(new AIMessage({ content: "base" }));
    const text = await forceFinalAnswer(base, withTools, messages);
    assert.equal(text, '{"ok":true}');
    assert.equal(withTools.lastOptions?.tool_choice, "none");
    assert.equal(base.calls, 0);
    assert.equal(messageText(messages[messages.length - 1]), FINAL_ANSWER_INSTRUCTION);
  });

  it("cae al LLM base si tool_choice none lanza", async () => {
    const withTools = stubWithTools(new Error("tool_choice no soportado"));
    const base = stubLlm(new AIMessage({ content: "respuesta base" }));
    const text = await forceFinalAnswer(base, withTools, [new HumanMessage("hola")]);
    assert.equal(text, "respuesta base");
    assert.equal(base.calls, 1);
  });

  it("cae al LLM base si la respuesta sigue pidiendo tools", async () => {
    const withTools = stubWithTools(
      new AIMessage({ content: "", tool_calls: [{ name: "search", args: {}, id: "1" }] }),
    );
    const base = stubLlm(new AIMessage({ content: "final" }));
    const text = await forceFinalAnswer(base, withTools, [new HumanMessage("hola")]);
    assert.equal(text, "final");
  });

  it("nunca lanza: devuelve cadena vacía si ambos fallan", async () => {
    const withTools = stubWithTools(new Error("boom"));
    const base = stubLlm(new Error("boom base"));
    const text = await forceFinalAnswer(base, withTools, [new HumanMessage("hola")]);
    assert.equal(text, "");
  });

  it("descarta tool_calls del LLM base", async () => {
    const withTools = stubWithTools(new Error("boom"));
    const base = stubLlm(new AIMessage({ content: "x", tool_calls: [{ name: "t", args: {}, id: "1" }] }));
    const text = await forceFinalAnswer(base, withTools, [new HumanMessage("hola")]);
    assert.equal(text, "");
  });
});

describe("messageText / hasToolCalls", () => {
  it("concatena partes de texto", () => {
    assert.equal(messageText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
    assert.equal(messageText(null), "");
  });
  it("detecta tool_calls", () => {
    assert.equal(hasToolCalls(new AIMessage({ content: "", tool_calls: [{ name: "t", args: {}, id: "1" }] })), true);
    assert.equal(hasToolCalls(new AIMessage({ content: "x" })), false);
  });
});
