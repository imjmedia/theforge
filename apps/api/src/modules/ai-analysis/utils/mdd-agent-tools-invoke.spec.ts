import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { runAgentToolsRound } from "./mdd-agent-tools-invoke.js";

type BoundCall = { messages: unknown[]; options?: Record<string, unknown> };

/** Herramienta mock: `onInvoke` permite simular que consume tiempo del turno. */
function tool(name: string, onInvoke: () => void = () => undefined): StructuredToolInterface {
  return {
    name,
    invoke: async () => {
      onInvoke();
      return "resultado de herramienta";
    },
  } as unknown as StructuredToolInterface;
}

/**
 * LLM mock: `bindTools` devuelve el runnable con tools; cada `invoke` consume la siguiente entrada de la cola
 * (un valor, o una función que puede avanzar el reloj antes de responder).
 */
function llmWith(queue: Array<unknown | (() => unknown)>) {
  const calls: BoundCall[] = [];
  let bindCalls = 0;
  const bound = {
    invoke: async (messages: unknown[], options?: Record<string, unknown>) => {
      calls.push({ messages, options });
      const next = queue.shift();
      if (next === undefined) throw new Error("sin respuesta programada");
      return typeof next === "function" ? (next as () => unknown)() : next;
    },
  };
  const llm = {
    bindTools: () => {
      bindCalls += 1;
      return bound;
    },
  } as unknown as BaseChatModel;
  return { llm, calls, bindCalls: () => bindCalls };
}

describe("runAgentToolsRound — presupuesto del turno", () => {
  it("con presupuesto menor de 15 s no invoca al LLM y reporta budgetExhausted", async () => {
    const { llm, calls, bindCalls } = llmWith([{ content: "no debe usarse" }]);
    const out = await runAgentToolsRound(llm, [tool("buscar")], "auth con MFA", {
      deadlineAt: 10_000,
      now: () => 0,
    });
    assert.equal(calls.length, 0, "ninguna llamada al LLM");
    assert.equal(bindCalls(), 0, "ni siquiera liga las tools");
    assert.equal(out.budgetExhausted, true);
    assert.equal(out.text, "");
  });

  it("con presupuesto amplio sí invoca y devuelve el resumen", async () => {
    const { llm, calls } = llmWith([{ content: "hallazgo: MFA ya existe" }]);
    const out = await runAgentToolsRound(llm, [tool("buscar")], "auth con MFA", {
      deadlineAt: 180_000,
      now: () => 0,
    });
    assert.equal(calls.length, 1);
    assert.equal(out.budgetExhausted, false);
    assert.equal(out.text, "hallazgo: MFA ya existe");
  });

  it("sin presupuesto (uso fuera del Manager) también invoca", async () => {
    const { llm, calls } = llmWith([{ content: "ok" }]);
    const out = await runAgentToolsRound(llm, [tool("buscar")], "consulta");
    assert.equal(calls.length, 1);
    assert.equal(out.text, "ok");
    assert.equal(out.budgetExhausted, false);
  });

  it("si una herramienta consume el resto del presupuesto, no vuelve a invocar al LLM", async () => {
    let clock = 0;
    const { llm, calls } = llmWith([
      { content: "", tool_calls: [{ name: "buscar", args: {}, id: "c1" }] },
      "no debe usarse",
    ]);
    const out = await runAgentToolsRound(
      llm,
      [tool("buscar", () => {
        clock = 170_000;
      })],
      "auth con MFA",
      { deadlineAt: 180_000, now: () => clock },
    );
    assert.equal(calls.length, 1, "solo la primera invocación; la segunda quedaría sin holgura");
    assert.equal(out.budgetExhausted, true);
    assert.equal(out.text, "");
  });

  it("tras agotar las rondas, la respuesta final se pide sin tools (tool_choice none) y también acotada", async () => {
    const toolCall = { content: "", tool_calls: [{ name: "buscar", args: {}, id: "c" }] };
    const { llm, calls } = llmWith([toolCall, toolCall, toolCall, toolCall, { content: "resumen final" }]);
    const out = await runAgentToolsRound(llm, [tool("buscar")], "auth con MFA", {
      deadlineAt: 180_000,
      now: () => 0,
    });
    assert.equal(calls.length, 5, "primera llamada + una por ronda (3) + la respuesta final");
    assert.equal(calls[4]!.options?.tool_choice, "none");
    assert.equal(out.budgetExhausted, false);
    assert.equal(out.text, "resumen final");
  });
});
