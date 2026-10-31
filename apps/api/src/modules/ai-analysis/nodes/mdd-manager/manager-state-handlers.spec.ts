import { describe, it } from "node:test";
import assert from "node:assert";
import { Command, END } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { MDDStateType } from "../../state/index.js";
import type { MddPlanStep } from "../../state/mdd-state.schema.js";
import { runDeterministicManagerHandlers } from "./manager-state-handlers.js";
import { handleManagerDelegateOutcome } from "./manager-delegate.js";
import { runManagerLlmTurn } from "./manager-llm-turn.js";
import { createMddManagerNode } from "../mdd-manager.node.js";
import { TURN_TRANSIENT_RESET, withTurnReset } from "./manager-context.util.js";

type CmdShape = { goto?: unknown; update?: Record<string, unknown> };
const asCmd = (c: Command | null): CmdShape => c as unknown as CmdShape;
const st = (p: Partial<MDDStateType>) => p as unknown as MDDStateType;

const plan: MddPlanStep[] = [
  { step_id: "1", node: "clarifier", task_description: "Clarificar" },
  { step_id: "2", node: "software_architect", task_description: "Arquitectura" },
  { step_id: "3", node: "auditor", task_description: "Auditar" },
];
const LONG_DRAFT = "# MDD\n\n" + "contenido del documento ".repeat(20);

/** LLM mínimo: invoke devuelve texto fijo (sin structured output → parse de JSON). */
function fakeLlm(content: string): BaseChatModel {
  return { invoke: async () => ({ content }) } as unknown as BaseChatModel;
}

function pendingState(extra: Partial<MDDStateType>): MDDStateType {
  return st({
    mddDraft: LONG_DRAFT,
    userInputAccumulated: "Petición: Sistema de inventarios con almacenes y reportes semanales",
    planUserIntent: "Requisitos del usuario (conversación reciente):\nSistema de inventarios con almacenes",
    pendingPlanApproval: { mddPlan: plan, delegateTarget: "full_pipeline", goto: "clarifier" },
    ...extra,
  });
}

async function run(state: MDDStateType, userMessage: string) {
  return runDeterministicManagerHandlers({
    state,
    llm: fakeLlm(""),
    userMessage,
    score: state.auditorScore ?? 0,
  });
}

describe("handlers deterministas: aprobación del plan", () => {
  it("variantes de aprobación ejecutan el plan (goto executor)", async () => {
    for (const msg of ["sí", "Me parece bien", "Claro", "Está bien", "Por supuesto", "Procedan", "Continúa"]) {
      const cmd = asCmd(await run(pendingState({ lastUserMessage: msg }), msg));
      assert.equal(cmd.goto, "executor", msg);
      assert.equal(cmd.update?.pendingPlanApproval, undefined, msg);
      assert.equal(cmd.update?.executorControlled, true, msg);
    }
  });

  it("'sí, pero agrega X' aprueba Y arrastra X al acumulado y a la directiva aceptada", async () => {
    const msg = "sí, pero agrega la tabla de auditoría de movimientos";
    const cmd = asCmd(await run(pendingState({ lastUserMessage: msg }), msg));
    assert.equal(cmd.goto, "executor");
    assert.match(String(cmd.update?.userInputAccumulated), /agrega la tabla de auditoría de movimientos/);
    assert.match(String(cmd.update?.acceptedProposalDirective), /agrega la tabla de auditoría de movimientos/);
    assert.match(String(cmd.update?.acceptedProposalDirective), /Sistema de inventarios/);
  });

  it("'sí, procede, no olvides §6' ya no se rechaza por contener 'no'", async () => {
    const msg = "sí, procede, no olvides §6";
    const cmd = asCmd(await run(pendingState({ lastUserMessage: msg }), msg));
    assert.equal(cmd.goto, "executor");
    assert.match(String(cmd.update?.userInputAccumulated), /no olvides §6/);
  });

  it("aprobación de clarifier_only no activa requestQuestionsOnly", async () => {
    const msg = "sí";
    const state = pendingState({
      lastUserMessage: msg,
      pendingPlanApproval: { mddPlan: plan.slice(0, 2), delegateTarget: "clarifier_only", goto: "clarifier" },
    });
    const cmd = asCmd(await run(state, msg));
    assert.equal(cmd.update?.requestQuestionsOnly, false);
  });

  it("cambio claro descarta el plan y re-entra al Manager con el mensaje intacto", async () => {
    const msg = "cambia el stack a Dokploy";
    const cmd = asCmd(await run(pendingState({ lastUserMessage: msg }), msg));
    assert.equal(cmd.goto, "manager");
    assert.equal(cmd.update?.pendingPlanApproval, undefined);
    assert.equal("lastUserMessage" in (cmd.update ?? {}), false);
  });
});

describe("handlers deterministas: código muerto / alcanzabilidad", () => {
  it("vuelta del executor sin mensaje con borrador → END", async () => {
    const cmd = asCmd(await run(st({ mddDraft: LONG_DRAFT, auditorScore: 60 }), ""));
    assert.equal(cmd.goto, END);
  });

  it("score >= 85 sin mensaje → END", async () => {
    const cmd = asCmd(await run(st({ mddDraft: LONG_DRAFT, auditorScore: 90 }), ""));
    assert.equal(cmd.goto, END);
  });

  it("preguntas del Clarifier se muestran antes del END de 'vuelta del executor' (no END)", async () => {
    // Fuera de un grafo, interrupt() lanza: llegar a él prueba que el bloque ya no es inalcanzable.
    await assert.rejects(
      run(
        st({
          mddDraft: LONG_DRAFT,
          auditorScore: 60,
          clarifierJustGeneratedQuestions: true,
          managerQuestions: ["¿Cuántos almacenes?", "¿Hay multi-moneda?"],
        }),
        "",
      ),
    );
  });

  it("sin preguntas pendientes el flag solo no impide el END", async () => {
    const cmd = asCmd(
      await run(st({ mddDraft: LONG_DRAFT, auditorScore: 60, clarifierJustGeneratedQuestions: true, managerQuestions: [] }), ""),
    );
    assert.equal(cmd.goto, END);
  });
});

describe("handlers deterministas: la petición no se pierde", () => {
  it("REGENERATE_SECTION_N acumula la petición en userInputAccumulated", async () => {
    const msg = "regenera la sección 6 incluyendo política de rotación de claves cada 90 días";
    const cmd = asCmd(
      await run(st({ mddDraft: LONG_DRAFT, auditorScore: 60, userInputAccumulated: "Petición: Sistema de inventarios", lastUserMessage: msg }), msg),
    );
    assert.equal(cmd.goto, "executor");
    assert.match(String(cmd.update?.userInputAccumulated), /rotación de claves cada 90 días/);
  });

  it("Caso 3 (Benchmark sin borrador) acumula el primer mensaje", async () => {
    const msg = "Necesito el MDD de un sistema de reservas con pagos";
    const cmd = asCmd(
      await run(st({ dbgaContent: "# Benchmark\n\nCompetidores A y B", lastUserMessage: msg }), msg),
    );
    assert.equal(cmd.goto, "clarifier");
    assert.match(String(cmd.update?.userInputAccumulated), /sistema de reservas con pagos/);
  });

  it("'seguir refinando' calcula la directiva con el mensaje ya acumulado", async () => {
    const msg = "sigamos mejorando el documento con el módulo de notificaciones por correo";
    const cmd = asCmd(
      await run(
        st({
          mddDraft: LONG_DRAFT,
          auditorScore: 60,
          userInputAccumulated: "Petición: Sistema de inventarios con almacenes y reportes semanales",
          clarifiedScope: "Alcance clarificado del sistema de inventarios con varios almacenes y reportes semanales.",
          lastUserMessage: msg,
        }),
        msg,
      ),
    );
    assert.equal(cmd.goto, "plan_approval");
    assert.match(String(cmd.update?.planUserIntent), /módulo de notificaciones por correo/);
    assert.match(String(cmd.update?.userInputAccumulated), /módulo de notificaciones por correo/);
  });
});

describe("delegate LLM → plan_approval conserva el mensaje del usuario", () => {
  it("el update trae userInputAccumulated con el mensaje y planUserIntent lo incluye aunque haya acumulado/alcance", async () => {
    const msg = "agrega soporte para devoluciones parciales con nota de crédito";
    const state = st({
      mddDraft: LONG_DRAFT,
      userInputAccumulated: "Petición: Sistema de inventarios con almacenes y reportes semanales\n\n---\n\nUsuario: usa PostgreSQL",
      clarifiedScope: "Alcance clarificado del sistema de inventarios con varios almacenes y reportes semanales.",
      lastUserMessage: msg,
    });
    const cmd = asCmd(
      await handleManagerDelegateOutcome({
        state,
        llm: fakeLlm(""),
        userMessage: msg,
        hasDraft: true,
        turn: { action: "delegate", replyContent: "", delegateTarget: "full_pipeline" },
      }),
    );
    assert.equal(cmd.goto, "plan_approval");
    assert.match(String(cmd.update?.userInputAccumulated), /devoluciones parciales con nota de crédito/);
    assert.match(String(cmd.update?.planUserIntent), /devoluciones parciales con nota de crédito/);
    // y sobrevive a la aprobación ("sí" ya no es el lastUserMessage)
    const approved = asCmd(
      await run({ ...state, ...(cmd.update as object), lastUserMessage: "sí" } as MDDStateType, "sí"),
    );
    assert.equal(approved.goto, "executor");
    assert.match(String(approved.update?.acceptedProposalDirective), /devoluciones parciales con nota de crédito/);
    assert.match(String(approved.update?.userInputAccumulated), /devoluciones parciales con nota de crédito/);
  });
});

describe("runManagerLlmTurn: reply vacío", () => {
  it("reply sin texto con borrador → delegate sections inferidas, nunca el reply genérico", async () => {
    const llm = fakeLlm(JSON.stringify({ action: "reply", reply: "" }));
    const turn = await runManagerLlmTurn({
      llm,
      state: st({ mddDraft: LONG_DRAFT }),
      userMessage: "faltan los edge cases de pagos",
      hasBench: false,
      hasDraft: true,
    });
    assert.equal(turn.action, "delegate");
    assert.equal(turn.delegateTarget, "sections");
    assert.ok(turn.sectionsToRun?.includes("section5"));
  });

  it("reply sin texto sin borrador → full_pipeline", async () => {
    const llm = fakeLlm(JSON.stringify({ action: "reply", reply: "" }));
    const turn = await runManagerLlmTurn({ llm, state: st({}), userMessage: "hola", hasBench: false, hasDraft: false });
    assert.equal(turn.action, "delegate");
    assert.equal(turn.delegateTarget, "full_pipeline");
  });

  it("reply con texto se conserva", async () => {
    const llm = fakeLlm(JSON.stringify({ action: "reply", reply: "El MDD es el documento maestro." }));
    const turn = await runManagerLlmTurn({
      llm,
      state: st({ mddDraft: LONG_DRAFT }),
      userMessage: "¿qué es el MDD?",
      hasBench: false,
      hasDraft: true,
    });
    assert.equal(turn.action, "reply");
    assert.equal(turn.replyContent, "El MDD es el documento maestro.");
  });
});

describe("reset de flags transitorios al llegar un mensaje nuevo", () => {
  it("withTurnReset añade el reset al update sin pisar el update explícito", () => {
    const base = new Command({ update: { lastUserMessage: undefined, auditorFeedback: "x", meshJumpCount: 2 }, goto: "executor" });
    const out = asCmd(withTurnReset(base, "hola"));
    assert.equal(out.goto, "executor");
    assert.equal(out.update?.deliveryGateAttempt, 0);
    assert.equal(out.update?.deliveryGateLoopActive, false);
    assert.equal(out.update?.auditorFeedback, "x");
    assert.equal(out.update?.meshJumpCount, 2, "el update explícito tiene prioridad");
    for (const k of Object.keys(TURN_TRANSIENT_RESET)) assert.ok(k in (out.update ?? {}), k);
  });

  it("no resetea memoria (auditorScore/auditorFeedback/userInputAccumulated)", () => {
    for (const k of ["auditorScore", "auditorFeedback", "userInputAccumulated"]) {
      assert.equal(k in TURN_TRANSIENT_RESET, false, k);
    }
  });

  it("sin mensaje nuevo no toca el Command", () => {
    const base = new Command({ goto: END });
    assert.equal(withTurnReset(base, ""), base);
  });

  it("el nodo Manager incluye el reset en el primer Command cuando hay mensaje", async () => {
    const node = createMddManagerNode(fakeLlm(""));
    const out = asCmd(
      (await node(
        pendingState({
          lastUserMessage: "sí",
          deliveryGateAttempt: 3,
          deliveryGateLoopActive: true,
          meshJumpCount: 4,
          auditorRan: true,
        }),
      )) as Command,
    );
    assert.equal(out.goto, "executor");
    assert.equal(out.update?.deliveryGateAttempt, 0);
    assert.equal(out.update?.deliveryGateLoopActive, false);
    assert.equal(out.update?.auditorRan, undefined);
    assert.ok("auditorRan" in (out.update ?? {}));
    assert.ok("meshJumpCount" in (out.update ?? {}));
  });
});
