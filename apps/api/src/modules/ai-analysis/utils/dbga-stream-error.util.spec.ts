import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ModelsUnavailableError } from "../../ai/config/llm-model-fallback.js";
import { formatDbgaStreamError } from "./dbga-stream-error.util.js";

describe("formatDbgaStreamError", () => {
  it("devuelve mensaje en español cuando el error menciona Recursion limit", () => {
    const { message } = formatDbgaStreamError(
      new Error("Recursion limit of 100 reached"),
    );
    assert.match(message, /competidores directos/i);
    assert.match(message, /B2B/i);
    assert.doesNotMatch(message, /Recursion limit/i);
  });

  it("devuelve mensaje en español para GRAPH_RECURSION", () => {
    const { message } = formatDbgaStreamError(new Error("GRAPH_RECURSION_LIMIT"));
    assert.match(message, /competidores directos/i);
  });

  it("incluye código MODELS_UNAVAILABLE para ModelsUnavailableError", () => {
    const payload = formatDbgaStreamError(new ModelsUnavailableError());
    assert.equal(payload.code, "MODELS_UNAVAILABLE");
    assert.match(payload.message, /No hay un modelo disponible/i);
  });

  it("pasa el mensaje original para otros errores", () => {
    assert.equal(
      formatDbgaStreamError(new Error("timeout de red")).message,
      "timeout de red",
    );
    assert.equal(formatDbgaStreamError("fallo genérico").message, "Error en el análisis");
  });

  it("traduce errores de parseo JSON del LLM", () => {
    const { message } = formatDbgaStreamError(
      new SyntaxError("Unexpected non-whitespace character after JSON at position 105"),
    );
    assert.match(message, /formato inesperado/i);
  });

  it("traduce SyntaxError con token inesperado (saludo del modelo)", () => {
    const { message } = formatDbgaStreamError(
      new SyntaxError('Unexpected token \'¡\', "¡Hola! 👋\\n"... is not valid JSON'),
    );
    assert.match(message, /formato inesperado/i);
    assert.doesNotMatch(message, /Unexpected token/i);
  });

  it("flow mdd: mensaje y código propios para el límite de recursión", () => {
    const payload = formatDbgaStreamError(new Error("Recursion limit of 100 reached"), "mdd");
    assert.equal(payload.code, "MDD_RECURSION_LIMIT");
    assert.match(payload.message, /flujo MDD/i);
    assert.doesNotMatch(payload.message, /competidores/i);
  });

  it("flow mdd no altera otros errores", () => {
    assert.equal(formatDbgaStreamError(new Error("timeout de red"), "mdd").message, "timeout de red");
  });
});
