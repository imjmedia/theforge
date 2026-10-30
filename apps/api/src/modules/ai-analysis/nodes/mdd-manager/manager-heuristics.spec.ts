import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPlanApproval } from "./manager-heuristics.js";
import { USER_STOP_PATTERN } from "./manager-constants.js";
import { managerParseFallbackDecision } from "./manager-llm-turn.js";
import { dbgaContentWithUserText } from "./manager-context.util.js";

describe("isPlanApproval", () => {
  it("acepta afirmaciones cortas y compuestas", () => {
    for (const msg of [
      "sí",
      "Sí.",
      "si",
      "sí, adelante",
      "ok, procede",
      "ok",
      "dale",
      "va",
      "adelante con el plan",
      "ejecuta el plan",
      "ejecútalo",
      "listo",
      "listo, ejecuta",
      "de acuerdo, ejecuta",
      "perfecto!",
      "aprobado",
      "confirmo",
    ]) {
      assert.equal(isPlanApproval(msg), true, `debería aprobar: ${msg}`);
    }
  });

  it("rechaza mensajes con señales de modificación o que no empiezan afirmando", () => {
    for (const msg of [
      "sí, pero cambia la sección 6",
      "sí, quita Kubernetes",
      "no",
      "no, mejor modifica el plan",
      "ok, antes agrega MFA",
      "quiero cambiar el stack a Dokploy",
      "simplemente no",
      "",
      "   ",
    ]) {
      assert.equal(isPlanApproval(msg), false, `no debería aprobar: ${msg}`);
    }
  });

  it("no confunde prefijos: 'sincronizar', 'okupa', 'valentía'", () => {
    assert.equal(isPlanApproval("sincronizar el handoff"), false);
    assert.equal(isPlanApproval("valentía"), false);
  });

  it("rechaza mensajes largos aunque empiecen con sí", () => {
    assert.equal(isPlanApproval("sí, " + "x".repeat(100)), false);
  });
});

describe("USER_STOP_PATTERN", () => {
  it("'listo' ya no detiene el flujo (el usuario lo usa para confirmar)", () => {
    assert.equal(USER_STOP_PATTERN.test("listo"), false);
    assert.equal(USER_STOP_PATTERN.test("parar"), true);
    assert.equal(USER_STOP_PATTERN.test("basta"), true);
  });
});

describe("managerParseFallbackDecision", () => {
  it("sin borrador → full_pipeline", () => {
    const d = managerParseFallbackDecision({ hasDraft: false, userMessage: "lo que sea" });
    assert.equal(d.action, "delegate");
    assert.equal(d.delegateTarget, "full_pipeline");
  });

  it("con borrador → sections inferidas del mensaje", () => {
    const d = managerParseFallbackDecision({ hasDraft: true, userMessage: "agrega MFA y RBAC en seguridad" });
    assert.equal(d.action, "delegate");
    assert.equal(d.delegateTarget, "sections");
    assert.ok(d.sectionsToRun?.includes("security"));
  });

  it("con borrador y mensaje sin pistas → al menos software_architect", () => {
    const d = managerParseFallbackDecision({ hasDraft: true, userMessage: "hazlo" });
    assert.equal(d.delegateTarget, "sections");
    assert.ok(d.sectionsToRun?.includes("software_architect"));
  });
});

describe("dbgaContentWithUserText", () => {
  const base = { dbgaContent: "# Benchmark\n\nCompetidores: A, B" } as Parameters<typeof dbgaContentWithUserText>[0];
  it("con Benchmark real conserva dbgaContent intacto", () => {
    assert.equal(dbgaContentWithUserText(base, "Petición: agrega MFA"), base.dbgaContent);
  });
  it("sin Benchmark (placeholder o vacío) anexa el texto del usuario", () => {
    const placeholder = { dbgaContent: "(sin benchmark)" } as typeof base;
    assert.equal(dbgaContentWithUserText(placeholder, "Petición: agrega MFA"), "(sin benchmark)\n\nPetición: agrega MFA");
    const empty = { dbgaContent: undefined } as typeof base;
    assert.equal(dbgaContentWithUserText(empty, "sistema de auth"), "sistema de auth");
  });
  it("texto vacío devuelve dbgaContent tal cual", () => {
    assert.equal(dbgaContentWithUserText(base, ""), base.dbgaContent);
    assert.equal(dbgaContentWithUserText(base, undefined), base.dbgaContent);
  });
});
