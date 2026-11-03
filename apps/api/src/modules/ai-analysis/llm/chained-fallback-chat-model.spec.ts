import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { ChainedFallbackChatModel, chunkHasContent } from "./chained-fallback-chat-model.js";

const MESSAGES = [new HumanMessage("hola")];

function quotaError(): Error {
  return Object.assign(new Error("You exceeded your current quota"), { status: 402 });
}

function chunk(text: string): ChatGenerationChunk {
  return new ChatGenerationChunk({ text, message: new AIMessageChunk({ content: text }) });
}

type FakeBehavior = {
  /** Chunks a emitir antes de fallar (o de terminar si no hay `error`); "" = chunk sin contenido (solo rol/metadatos). */
  chunks?: string[];
  /** Error a lanzar: al abrir (sin chunks) o tras emitir los chunks. */
  error?: Error;
  generateText?: string;
};

/** Modelos cuyo iterador de stream se cerró (`return()`/fin), para verificar que no quedan abiertos. */
const closed: string[] = [];

function fakeModel(b: FakeBehavior, log: string[], name: string): BaseChatModel {
  return {
    async *_streamResponseChunks() {
      log.push(`${name}:open`);
      try {
        for (const text of b.chunks ?? []) {
          yield chunk(text);
        }
        if (b.error) throw b.error;
      } finally {
        closed.push(name);
      }
    },
    async _generate(): Promise<ChatResult> {
      log.push(`${name}:generate`);
      if (b.error) throw b.error;
      const text = b.generateText ?? "";
      return { generations: [{ text, message: new AIMessage({ content: text }) }] };
    },
  } as unknown as BaseChatModel;
}

function build(behaviors: Record<string, FakeBehavior>, log: string[]) {
  const models = Object.keys(behaviors);
  return new ChainedFallbackChatModel(
    (m) => fakeModel(behaviors[m]!, log, m),
    models,
    undefined,
    undefined,
    "openrouter",
    models[0],
  );
}

async function collect(
  gen: AsyncGenerator<ChatGenerationChunk>,
): Promise<{ chunks: ChatGenerationChunk[]; error?: unknown }> {
  const chunks: ChatGenerationChunk[] = [];
  try {
    for await (const c of gen) chunks.push(c);
  } catch (error) {
    return { chunks, error };
  }
  return { chunks };
}

describe("ChainedFallbackChatModel._streamResponseChunks", () => {
  it("(a) falla al abrir el modelo 1 → responde el modelo 2 sin duplicar y etiqueta chained_model", async () => {
    const log: string[] = [];
    const llm = build(
      { "m/uno": { error: quotaError() }, "m/dos": { chunks: ["A", "B", "C"] } },
      log,
    );
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.equal(error, undefined);
    assert.equal(chunks.map((c) => c.text).join(""), "ABC");
    assert.equal(chunks[0]!.message.response_metadata.chained_model, "m/dos");
    assert.equal(chunks[0]!.message.response_metadata.chained_model_index, 1);
    // Fusionado como lo hace LangChain: el nombre no se concatena entre chunks.
    let merged = chunks[0]!.message as AIMessageChunk;
    for (const c of chunks.slice(1)) merged = merged.concat(c.message as AIMessageChunk);
    assert.equal(merged.response_metadata.chained_model, "m/dos");
    assert.equal(merged.response_metadata.chained_model_index, 1);
    assert.deepEqual(log, ["m/uno:open", "m/dos:open"]);
  });

  it("(b) error de cuota tras emitir 2 chunks → se propaga y NO se re-streamea con el modelo 2", async () => {
    const log: string[] = [];
    const llm = build(
      {
        "m/uno": { chunks: ["A", "B"], error: quotaError() },
        "m/dos": { chunks: ["X", "Y", "Z"] },
      },
      log,
    );
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.ok(error instanceof Error);
    assert.match((error as Error).message, /quota/);
    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map((c) => c.text),
      ["A", "B"],
    );
    assert.deepEqual(log, ["m/uno:open"]);
  });

  it("(d) abort durante el stream se propaga sin fallback", async () => {
    const log: string[] = [];
    const abortErr = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const llm = build(
      { "m/uno": { chunks: ["A"], error: abortErr }, "m/dos": { chunks: ["X"] } },
      log,
    );
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.equal((error as Error).name, "AbortError");
    assert.equal(chunks.length, 1);
    assert.deepEqual(log, ["m/uno:open"]);
  });

  it("(d) abort antes del primer chunk no pasa al modelo 2 aunque el error parezca de agotamiento", async () => {
    const log: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const llm = build(
      { "m/uno": { error: quotaError() }, "m/dos": { chunks: ["X"] } },
      log,
    );
    const { chunks, error } = await collect(
      llm._streamResponseChunks(MESSAGES, { signal: controller.signal } as never),
    );
    assert.ok(error);
    assert.equal(chunks.length, 0);
    assert.deepEqual(log, ["m/uno:open"]);
  });
});

describe("ChainedFallbackChatModel._streamResponseChunks — chunks sin contenido", () => {
  it("primer chunk vacío seguido de error de cuota => SÍ hay fallback; el chunk vacío SÍ se reenvió y no se filtra el modelo fallido", async () => {
    const log: string[] = [];
    const llm = build(
      { "m/uno": { chunks: [""], error: quotaError() }, "m/dos": { chunks: ["A", "B"] } },
      log,
    );
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.equal(error, undefined);
    assert.deepEqual(log, ["m/uno:open", "m/dos:open"]);
    // El vacío del modelo 1 se emitió de inmediato (latido) y sin sellar.
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]!.text, "");
    assert.equal(chunks[0]!.message.response_metadata.chained_model, undefined);
    assert.equal(chunks[0]!.message.response_metadata.chained_model_index, undefined);
    assert.equal(chunks.map((c) => c.text).join(""), "AB");
    let merged = chunks[0]!.message as AIMessageChunk;
    for (const c of chunks.slice(1)) merged = merged.concat(c.message as AIMessageChunk);
    assert.equal(merged.response_metadata.chained_model, "m/dos", "sin 'm/unom/dos'");
    assert.equal(merged.response_metadata.chained_model_index, 1);
  });

  it("chunk con texto seguido de error => NO hay fallback (se propaga)", async () => {
    const log: string[] = [];
    const llm = build(
      { "m/uno": { chunks: ["A"], error: quotaError() }, "m/dos": { chunks: ["X"] } },
      log,
    );
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.ok(error instanceof Error);
    assert.deepEqual(chunks.map((c) => c.text), ["A"]);
    assert.deepEqual(log, ["m/uno:open"]);
  });

  it("chunks vacíos iniciales se reenvían sin retenerlos; chained_model solo en el primer chunk con contenido", async () => {
    const log: string[] = [];
    const llm = build({ "m/uno": { chunks: ["", "", "A", "B"] } }, log);
    const gen = llm._streamResponseChunks(MESSAGES, {} as never);
    // Latido: el primer chunk vacío llega antes de que el modelo produzca contenido.
    const first = await gen.next();
    assert.equal(first.done, false);
    assert.equal(first.value.text, "");
    const rest: ChatGenerationChunk[] = [];
    for await (const c of gen) rest.push(c);
    const chunks = [first.value as ChatGenerationChunk, ...rest];
    assert.equal(chunks.length, 4);
    assert.equal(chunks.map((c) => c.text).join(""), "AB");
    assert.equal(chunks[0]!.message.response_metadata.chained_model, undefined);
    assert.equal(chunks[1]!.message.response_metadata.chained_model, undefined);
    assert.equal(chunks[2]!.message.response_metadata.chained_model, "m/uno");
    assert.equal(chunks[3]!.message.response_metadata.chained_model, undefined);
    assert.equal(chunks[3]!.message.response_metadata.chained_model_index, 0);
  });

  it("stream que termina solo con chunks vacíos: se emiten (uso/metadatos) sin fallback", async () => {
    const log: string[] = [];
    const llm = build({ "m/uno": { chunks: [""] }, "m/dos": { chunks: ["X"] } }, log);
    const { chunks, error } = await collect(llm._streamResponseChunks(MESSAGES, {} as never));
    assert.equal(error, undefined);
    assert.equal(chunks.length, 1);
    assert.deepEqual(log, ["m/uno:open"]);
  });

  it("si el consumidor abandona el stream se cierra el iterador del modelo (return)", async () => {
    closed.length = 0;
    const log: string[] = [];
    const llm = build({ "m/uno": { chunks: ["A", "B", "C"] } }, log);
    for await (const c of llm._streamResponseChunks(MESSAGES, {} as never)) {
      assert.equal(c.text, "A");
      break;
    }
    assert.deepEqual(closed, ["m/uno"]);
  });

  it("chunkHasContent: texto o tool call cuentan; rol/metadatos/uso no", () => {
    assert.equal(chunkHasContent(chunk("")), false);
    assert.equal(chunkHasContent(chunk("hola")), true);
    const usageOnly = new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({ content: "", usage_metadata: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } }),
    });
    assert.equal(chunkHasContent(usageOnly), false);
    const emptyParts = new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({ content: [{ type: "text", text: "" }] }),
    });
    assert.equal(chunkHasContent(emptyParts), false);
    const textParts = new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({ content: [{ type: "text", text: "x" }] }),
    });
    assert.equal(chunkHasContent(textParts), true);
    const toolCall = new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({ content: "", tool_call_chunks: [{ name: "f", args: "{", id: "1", index: 0 }] }),
    });
    assert.equal(chunkHasContent(toolCall), true);
  });
});

describe("ChainedFallbackChatModel._generate", () => {
  it("(c) con fallback anota chained_model del modelo que respondió", async () => {
    const log: string[] = [];
    const llm = build(
      { "m/uno": { error: quotaError() }, "m/dos": { generateText: "listo" } },
      log,
    );
    const result = await llm._generate(MESSAGES, {} as never);
    assert.equal(result.generations[0]!.text, "listo");
    assert.equal(result.generations[0]!.message.response_metadata.chained_model, "m/dos");
    assert.equal(result.generations[0]!.message.response_metadata.chained_model_index, 1);
    assert.deepEqual(log, ["m/uno:generate", "m/dos:generate"]);
  });

  it("sin fallback anota el modelo primario", async () => {
    const log: string[] = [];
    const llm = build({ "m/uno": { generateText: "ok" }, "m/dos": {} }, log);
    const result = await llm._generate(MESSAGES, {} as never);
    assert.equal(result.generations[0]!.message.response_metadata.chained_model, "m/uno");
    assert.equal(result.generations[0]!.message.response_metadata.chained_model_index, 0);
  });
});
