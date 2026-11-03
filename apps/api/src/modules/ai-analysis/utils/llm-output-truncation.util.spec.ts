import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractLlmFinishReason,
  isLlmOutputTruncated,
  LlmOutputTruncatedError,
} from "./llm-output-truncation.util.js";

describe("isLlmOutputTruncated", () => {
  it("detecta finish_reason length en response_metadata (OpenRouter/OpenAI)", () => {
    const response = {
      content: "parcial…",
      response_metadata: { finish_reason: "length" },
    };
    assert.equal(extractLlmFinishReason(response), "length");
    assert.equal(isLlmOutputTruncated(response), true);
  });

  it("detecta stop_reason max_tokens en response_metadata (Anthropic)", () => {
    const response = {
      content: "x",
      response_metadata: { stop_reason: "max_tokens" },
    };
    assert.equal(isLlmOutputTruncated(response), true);
  });

  it("lee finish_reason anidado en usage_metadata", () => {
    const response = {
      content: "x",
      usage_metadata: { finish_reason: "length" },
    };
    assert.equal(isLlmOutputTruncated(response), true);
  });

  it("no marca stop normal como truncado", () => {
    const response = {
      content: "completo",
      response_metadata: { finish_reason: "stop" },
    };
    assert.equal(isLlmOutputTruncated(response), false);
  });

  it("desenvuelve withStructuredOutput includeRaw", () => {
    const response = {
      parsed: {},
      raw: { content: "y", response_metadata: { finish_reason: "length" } },
    };
    assert.equal(isLlmOutputTruncated(response), true);
  });
});

describe("LlmOutputTruncatedError", () => {
  it("expone finishReason en el mensaje", () => {
    const err = new LlmOutputTruncatedError("Architect", "length");
    assert.equal(err.name, "LlmOutputTruncatedError");
    assert.equal(err.finishReason, "length");
    assert.match(err.message, /Architect/);
  });
});
