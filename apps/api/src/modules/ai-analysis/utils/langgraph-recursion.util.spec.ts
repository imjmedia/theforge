import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLangGraphRecursionLimit } from "./langgraph-recursion.util.js";

describe("resolveLangGraphRecursionLimit", () => {
  it("devuelve el default del catálogo (50) por defecto", () => {
    assert.equal(resolveLangGraphRecursionLimit({}), 50);
    assert.equal(resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "" }), 50);
  });

  it("parsea LANGGRAPH_RECURSION_LIMIT entre 10 y 500", () => {
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "150" }),
      150,
    );
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: " 42 " }),
      42,
    );
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "10.9" }),
      10,
    );
  });

  it("ignora valores fuera de rango o no numéricos", () => {
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "9" }),
      50,
    );
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "501" }),
      50,
    );
    assert.equal(
      resolveLangGraphRecursionLimit({ LANGGRAPH_RECURSION_LIMIT: "abc" }),
      50,
    );
  });
});
