import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRepairSummary, parseRepairSummary, type RepairSummary } from "./repairSummary.js";

const base: RepairSummary = {
  fixed: [],
  remaining: { auto: 0, llm: 0, human: 0 },
  errors: [],
  stoppedReason: "converged",
};

describe("formatRepairSummary", () => {
  it("combina corregidas, pendientes y errores", () => {
    assert.equal(
      formatRepairSummary({
        ...base,
        fixed: ["a", "b"],
        remaining: { auto: 0, llm: 1, human: 2 },
        errors: [{ step: "logic_flows", message: "x" }],
      }),
      "Corregidas 2 · Quedan 1 LLM, 2 humanas (requieren editar el BRD) · 1 error al regenerar Flujos",
    );
  });

  it("sin nada pendiente ni errores", () => {
    assert.equal(
      formatRepairSummary({ ...base, fixed: ["a"] }),
      "Corregida 1 · Sin brechas pendientes",
    );
  });

  it("solo humanas: ninguna corregida", () => {
    assert.equal(
      formatRepairSummary({ ...base, remaining: { auto: 0, llm: 0, human: 1 }, stoppedReason: "human_only" }),
      "No se corrigió ninguna brecha · Quedan 1 humana (requieren editar el BRD)",
    );
  });

  it("no_mdd: mensaje propio sin «Sin brechas pendientes»", () => {
    const out = formatRepairSummary({ ...base, stoppedReason: "no_mdd" });
    assert.equal(out, "No se pudo reparar: falta el MDD");
  });

  it("agrupa pasos con error sin duplicar y avisa del límite", () => {
    const out = formatRepairSummary({
      ...base,
      errors: [
        { step: "api_contracts", message: "x" },
        { step: "api_contracts", message: "y" },
        { step: "otro", message: "z" },
      ],
      stoppedReason: "budget",
    });
    assert.ok(out.includes("3 errores al regenerar API, otro"));
    assert.ok(out.includes("límite de reintentos alcanzado"));
  });
});

describe("parseRepairSummary", () => {
  it("extrae repair de result y normaliza", () => {
    const r = parseRepairSummary({
      project: {},
      repair: { fixed: ["g"], remaining: { auto: 1, llm: "x" }, errors: [{ step: "infra", message: "m" }], stoppedReason: "human_only" },
    });
    assert.deepEqual(r, {
      fixed: ["g"],
      remaining: { auto: 1, llm: 0, human: 0 },
      errors: [{ step: "infra", message: "m" }],
      stoppedReason: "human_only",
    });
  });

  it("stoppedReason fuera de la unión cae a converged", () => {
    assert.equal(parseRepairSummary({ repair: { stoppedReason: "raro" } })?.stoppedReason, "converged");
    assert.equal(parseRepairSummary({ repair: { stoppedReason: "no_mdd" } })?.stoppedReason, "no_mdd");
    assert.equal(parseRepairSummary({ repair: { stoppedReason: 3 } })?.stoppedReason, "converged");
  });

  it("devuelve null si no hay repair", () => {
    assert.equal(parseRepairSummary(null), null);
    assert.equal(parseRepairSummary({ id: "p" }), null);
  });
});
