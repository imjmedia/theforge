import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyLlmError, MAX_RETRY_AFTER_MS } from "./llm-error-classify.util.js";

/** Error con la forma de los SDK: `status`, `headers`, `error` (cuerpo) y mensaje. */
function sdkError(message: string, extra: Record<string, unknown> = {}, name = "Error"): Error {
  const e = new Error(message);
  e.name = name;
  return Object.assign(e, extra);
}

describe("classifyLlmError — abort", () => {
  it("AbortError por nombre", () => {
    const e = new Error("x");
    e.name = "AbortError";
    assert.deepEqual(classifyLlmError(e), { kind: "abort", reason: "abort" });
  });
  it("APIUserAbortError (SDK Anthropic/OpenAI)", () => {
    assert.equal(classifyLlmError(sdkError("Request was aborted.", {}, "APIUserAbortError")).kind, "abort");
  });
  it("señal ya abortada gana sobre cualquier otro error", () => {
    const ac = new AbortController();
    ac.abort();
    assert.equal(classifyLlmError(sdkError("500", { status: 500 }), { signal: ac.signal }).kind, "abort");
  });
});

describe("classifyLlmError — no_retry", () => {
  const rows: Array<[string, unknown, string]> = [
    ["400 contexto (OpenAI)", sdkError("400 This model's maximum context length is 8192 tokens", { status: 400, code: "context_length_exceeded" }), "contexto_excedido"],
    ["400 contexto (Anthropic)", sdkError('400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}', { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens" } } }), "contexto_excedido"],
    ["400 too many tokens", sdkError("Bad request: too many tokens", { status: 400 }), "contexto_excedido"],
    ["400 input is too long (sin status)", sdkError("input is too long for this model"), "contexto_excedido"],
    ["400 petición inválida", sdkError("400 invalid request", { status: 400 }), "http_400_peticion_invalida"],
    ["401 (Anthropic)", sdkError("401 invalid x-api-key", { status: 401, error: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }), "credenciales_o_modelo_invalido"],
    ["401 simple", sdkError("Unauthorized", { status: 401 }), "http_401_no_autenticado"],
    ["403", sdkError("Forbidden", { status: 403 }), "http_403_prohibido"],
    ["404 modelo (OpenAI)", sdkError("404 The model `gpt-9` does not exist", { status: 404, code: "model_not_found" }), "credenciales_o_modelo_invalido"],
    ["404 simple", sdkError("Not found", { status: 404 }), "http_404_modelo_o_recurso_no_encontrado"],
    ["422", sdkError("Unprocessable", { statusCode: 422 }), "http_422_no_procesable"],
    ["429 insufficient_quota (OpenAI)", sdkError("429 You exceeded your current quota, please check your plan and billing details.", { status: 429, code: "insufficient_quota", error: { code: "insufficient_quota", type: "insufficient_quota" } }), "cuota_o_billing"],
    ["400 credit balance (Anthropic)", sdkError("400 Your credit balance is too low to access the Anthropic API", { status: 400 }), "cuota_o_billing"],
    ["402 OpenRouter créditos", sdkError("Insufficient credits", { response: { status: 402 } }), "cuota_o_billing"],
    ["billing sin status", sdkError("Billing hard limit has been reached"), "cuota_o_billing"],
    ["validación zod del SDK", sdkError("invalid", {}, "ZodError"), "validacion_sdk_zod"],
    ["LangChain MODEL_AUTHENTICATION", sdkError("auth", { lc_error_code: "MODEL_AUTHENTICATION" }), "langchain_model_authentication"],
    ["LangChain INVALID_PROMPT_INPUT", sdkError("bad prompt", { lc_error_code: "INVALID_PROMPT_INPUT" }), "langchain_invalid_prompt_input"],
    ["status en response (axios/LangChain)", sdkError("Request failed", { response: { status: 401 } }), "http_401_no_autenticado"],
    ["status sólo en el mensaje", sdkError("401 Incorrect API key provided"), "credenciales_o_modelo_invalido"],
  ];
  for (const [label, err, reason] of rows) {
    it(label, () => {
      const r = classifyLlmError(err);
      assert.equal(r.kind, "no_retry", JSON.stringify(r));
      assert.equal(r.reason, reason);
      assert.equal(r.retryAfterMs, undefined);
    });
  }

  it("429 que menciona billing pero es rate limit normal NO es no_retry", () => {
    const r = classifyLlmError(
      sdkError("429 Rate limit reached for gpt-4o. You can add a payment method at platform.openai.com/account/billing", { status: 429 }),
    );
    assert.equal(r.kind, "retry_after");
  });
  it("429 'too many tokens' por minuto es rate limit, no contexto", () => {
    assert.equal(classifyLlmError(sdkError("429 too many tokens per minute", { status: 429 })).kind, "retry_after");
  });
});

describe("classifyLlmError — retry_after", () => {
  it("429 sin cabecera: retry_after sin retryAfterMs", () => {
    const r = classifyLlmError(sdkError("429 rate limit", { status: 429 }));
    assert.equal(r.kind, "retry_after");
    assert.equal(r.retryAfterMs, undefined);
  });
  it("retry-after en segundos (headers plain object, case-insensitive)", () => {
    const r = classifyLlmError(sdkError("429", { status: 429, headers: { "Retry-After": "2" } }));
    assert.equal(r.kind, "retry_after");
    assert.equal(r.retryAfterMs, 2000);
  });
  it("retry-after en segundos con decimales", () => {
    assert.equal(classifyLlmError(sdkError("429", { status: 429, headers: { "retry-after": "1.5" } })).retryAfterMs, 1500);
  });
  it("retry-after con objeto Headers (SDK Anthropic/OpenAI)", () => {
    const r = classifyLlmError(sdkError("429", { status: 429, headers: new Headers({ "retry-after": "3" }) }));
    assert.equal(r.retryAfterMs, 3000);
  });
  it("retry-after-ms tiene prioridad (OpenAI/Anthropic)", () => {
    const r = classifyLlmError(sdkError("429", { status: 429, headers: { "retry-after-ms": "750", "retry-after": "2" } }));
    assert.equal(r.retryAfterMs, 750);
  });
  it("retry-after como fecha HTTP (reloj inyectado)", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const r = classifyLlmError(
      sdkError("429", { status: 429, response: { status: 429, headers: { "retry-after": "Mon, 02 Nov 2026 10:00:05 GMT" } } }),
      { now },
    );
    assert.equal(r.retryAfterMs, 5000);
  });
  it("retry-after fecha en el pasado -> 0", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const r = classifyLlmError(sdkError("429", { status: 429, headers: { "retry-after": "Mon, 02 Nov 2026 09:00:00 GMT" } }), { now });
    assert.equal(r.retryAfterMs, 0);
  });
  it("retry_after del cuerpo (segundos)", () => {
    const r = classifyLlmError(sdkError("429", { status: 429, error: { retry_after: 4 } }));
    assert.equal(r.retryAfterMs, 4000);
  });
  it("tope de 30 s", () => {
    const r = classifyLlmError(sdkError("429", { status: 429, headers: { "retry-after": "600" } }));
    assert.equal(r.retryAfterMs, MAX_RETRY_AFTER_MS);
  });
  it("cabecera inválida -> sin retryAfterMs", () => {
    assert.equal(classifyLlmError(sdkError("429", { status: 429, headers: { "retry-after": "pronto" } })).retryAfterMs, undefined);
  });
  it("529 overloaded (Anthropic)", () => {
    const r = classifyLlmError(sdkError("529 overloaded", { status: 529, error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }));
    assert.equal(r.kind, "retry_after");
  });
  it("503 de sobrecarga", () => {
    assert.equal(classifyLlmError(sdkError("503 Service Unavailable", { status: 503 })).kind, "retry_after");
  });
  it("rate_limit_error sin status (cuerpo Anthropic)", () => {
    const r = classifyLlmError(sdkError("rate limited", { error: { type: "error", error: { type: "rate_limit_error" } } }));
    assert.equal(r.kind, "retry_after");
  });
  it("LangChain MODEL_RATE_LIMIT", () => {
    assert.equal(classifyLlmError(sdkError("limit", { lc_error_code: "MODEL_RATE_LIMIT" })).kind, "retry_after");
  });
  it("Gemini '[429 Too Many Requests]' en el mensaje", () => {
    assert.equal(classifyLlmError(sdkError("[GoogleGenerativeAI Error]: [429 Too Many Requests] quota")).kind, "retry_after");
  });
});

describe("classifyLlmError — retry", () => {
  const rows: Array<[string, unknown]> = [
    ["500", sdkError("500 Internal Server Error", { status: 500 })],
    ["502", sdkError("Bad Gateway", { status: 502 })],
    ["504", sdkError("Gateway Timeout", { response: { status: 504 } })],
    ["408", sdkError("Request Timeout", { status: 408 })],
    ["ECONNRESET (code)", sdkError("read ECONNRESET", { code: "ECONNRESET" })],
    ["ETIMEDOUT (mensaje)", sdkError("connect ETIMEDOUT 1.2.3.4:443")],
    ["fetch failed", new TypeError("fetch failed")],
    ["APIConnectionError", sdkError("Connection error.", {}, "APIConnectionError")],
    ["timeout propio del util (stream)", new Error("[Clarifier] stream abortado por inactividad 90000ms (chunks=0, elapsed=90001ms)")],
    ["stream vacío", new Error("[X] stream vacío")],
    ["desconocido", new Error("algo raro")],
    ["no-Error", "boom"],
    ["null", null],
  ];
  for (const [label, err] of rows) {
    it(label, () => {
      const r = classifyLlmError(err);
      assert.equal(r.kind, "retry", JSON.stringify(r));
      assert.ok(r.reason.length > 0);
      assert.equal(r.retryAfterMs, undefined);
    });
  }
});
