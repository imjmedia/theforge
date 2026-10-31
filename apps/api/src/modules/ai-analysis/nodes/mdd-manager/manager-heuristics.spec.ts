import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPlanResponse,
  getPlanApprovalExtra,
  inferSectionsFromMessage,
  isPlanApproval,
} from "./manager-heuristics.js";
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
      "Me parece bien",
      "Claro",
      "Está bien",
      "Esta bien",
      "Por supuesto",
      "Procedan",
      "Continúa",
      "Continua",
      "claro que sí, procede",
      "me parece bien, adelante",
    ]) {
      assert.equal(isPlanApproval(msg), true, `debería aprobar: ${msg}`);
    }
  });

  it("rechaza mensajes con señales de modificación o que no empiezan afirmando", () => {
    for (const msg of [
      "no",
      "no, mejor modifica el plan",
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

  it("aprueba aunque añada una nota ('sí, pero agrega X'); la nota se expone como extra", () => {
    assert.equal(isPlanApproval("sí, pero agrega MFA obligatorio"), true);
    assert.equal(getPlanApprovalExtra("sí, pero agrega MFA obligatorio"), "agrega MFA obligatorio");
    assert.equal(isPlanApproval("sí, procede, no olvides §6"), true);
    assert.match(getPlanApprovalExtra("sí, procede, no olvides §6") ?? "", /no olvides §6/);
    assert.equal(isPlanApproval("sí, quita Kubernetes"), true);
    assert.equal(getPlanApprovalExtra("sí, quita Kubernetes"), "quita Kubernetes");
    assert.equal(isPlanApproval("ok, antes agrega MFA"), true);
    assert.equal(getPlanApprovalExtra("ok, antes agrega MFA"), "antes agrega MFA");
    assert.equal(getPlanApprovalExtra("sí, adelante"), undefined);
    assert.equal(getPlanApprovalExtra("Me parece bien"), undefined);
  });

  it("una aprobación larga sin verbo de modificación se aprueba y conserva el texto como extra", () => {
    const msg = "sí, " + "x".repeat(100);
    assert.equal(isPlanApproval(msg), true);
    assert.ok(getPlanApprovalExtra(msg));
  });

  it("freno explícito tras la afirmación NO aprueba", () => {
    assert.equal(isPlanApproval("sí pero espera, no ejecutes todavía"), false);
    assert.equal(classifyPlanResponse("ok, no lo ejecutes aún").kind, "modify");
  });
});

describe("classifyPlanResponse", () => {
  it("modify: rechazo claro o instrucción sin afirmación", () => {
    for (const msg of ["no", "No, mejor modifica el plan", "cambia el stack a Dokploy", "agrega una tabla de auditoría", "quiero otro stack"]) {
      assert.equal(classifyPlanResponse(msg).kind, "modify", msg);
    }
  });

  it("ambiguous: duda o pregunta sin verbo de cambio ni rechazo", () => {
    for (const msg of ["hmm", "¿qué hace el paso 3?", "no sé", "no sé, déjame pensarlo", "", "   "]) {
      assert.equal(classifyPlanResponse(msg).kind, "ambiguous", msg);
    }
  });
});

describe("inferSectionsFromMessage", () => {
  it("mapea lógica / edge cases / §5 a section5", () => {
    assert.ok(inferSectionsFromMessage("revisa la lógica de reintentos").includes("section5"));
    assert.ok(inferSectionsFromMessage("faltan edge cases de pagos").includes("section5"));
    assert.ok(inferSectionsFromMessage("cubre los casos borde").includes("section5"));
    assert.ok(inferSectionsFromMessage("regenera la sección 5").includes("section5"));
    assert.ok(inferSectionsFromMessage("completa §5 por favor").includes("section5"));
  });

  it("§N con espacios previos mapea como 'sección N' (antes no había frontera \\b antes de §)", () => {
    assert.ok(inferSectionsFromMessage("ajusta §3 y §6").includes("software_architect"));
    assert.ok(inferSectionsFromMessage("ajusta §3 y §6").includes("security"));
    assert.ok(inferSectionsFromMessage("actualiza §7").includes("integration"));
  });

  it("no contiene tokens específicos de cliente (DENUE/INEGI)", () => {
    assert.deepEqual(inferSectionsFromMessage("consulta al directorio estadístico DENUE del INEGI"), []);
  });

  it("section5 se expande a un nodo válido del plan", async () => {
    const { expandSectionsToRun } = await import("./manager-plan.js");
    const nodes = expandSectionsToRun(inferSectionsFromMessage("revisa edge cases"));
    assert.ok(nodes.includes("section5"));
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
