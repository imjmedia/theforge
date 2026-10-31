import { describe, it } from "node:test";
import assert from "node:assert";
import { Command, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { MDDStateAnnotation } from "../state/index.js";
import type { MddPlanStep } from "../state/mdd-state.schema.js";
import { createMddPlanApprovalNode, PLAN_REASK_QUESTION } from "./mdd-plan-approval.node.js";

const plan: MddPlanStep[] = [
  { step_id: "1", node: "clarifier", task_description: "Clarificar" },
  { step_id: "2", node: "software_architect", task_description: "Arquitectura" },
  { step_id: "3", node: "auditor", task_description: "Auditar" },
];

function buildGraph() {
  const seen: { managerLastUserMessage?: string } = {};
  const graph = new StateGraph(MDDStateAnnotation)
    .addNode("plan_approval", createMddPlanApprovalNode(), { ends: ["manager", "executor"] })
    .addNode("manager", (s) => {
      seen.managerLastUserMessage = s.lastUserMessage;
      return {};
    })
    .addNode("executor", () => ({}))
    .addEdge(START, "plan_approval")
    .addEdge("manager", END)
    .addEdge("executor", END)
    .compile({ checkpointer: new MemorySaver() });
  return { graph, seen };
}

const initial = {
  pendingPlanApproval: { mddPlan: plan, delegateTarget: "full_pipeline" as const, goto: "clarifier" },
  impactSummary: "Impacto mínimo",
};

type Interrupts = { value?: { type?: string; message?: string; plan?: unknown } }[];

async function interruptsOf(graph: ReturnType<typeof buildGraph>["graph"], cfg: object): Promise<Interrupts> {
  const snap = await graph.getState(cfg);
  return snap.tasks.flatMap((t) => (t.interrupts ?? []) as Interrupts);
}

describe("plan_approval: re-pregunta única ante respuesta ambigua", () => {
  it("respuesta ambigua → segunda interrupción con el mismo plan y la pregunta de confirmación", async () => {
    const { graph, seen } = buildGraph();
    const cfg = { configurable: { thread_id: "ambiguous-1" } };
    await graph.invoke(initial, cfg);
    let ints = await interruptsOf(graph, cfg);
    assert.equal(ints.length, 1);
    assert.equal(ints[0]!.value?.type, "plan_approval");
    assert.equal((ints[0]!.value?.message ?? "").includes(PLAN_REASK_QUESTION), false);

    await graph.invoke(new Command({ resume: "hmm" }), cfg);
    ints = await interruptsOf(graph, cfg);
    assert.equal(ints.length, 1, "debe re-interrumpir (no descartar el plan)");
    assert.equal(ints[0]!.value?.type, "plan_approval");
    assert.ok((ints[0]!.value?.message ?? "").includes(PLAN_REASK_QUESTION));
    assert.deepEqual(ints[0]!.value?.plan, plan);

    await graph.invoke(new Command({ resume: "sí, adelante" }), cfg);
    assert.equal(seen.managerLastUserMessage, "sí, adelante");
    const snap = await graph.getState(cfg);
    assert.ok(snap.values.pendingPlanApproval, "el plan sigue pendiente para que el Manager lo ejecute");
  });

  it("segunda respuesta aún ambigua → pasa al Manager sin más re-preguntas (máx. 1)", async () => {
    const { graph, seen } = buildGraph();
    const cfg = { configurable: { thread_id: "ambiguous-2" } };
    await graph.invoke(initial, cfg);
    await graph.invoke(new Command({ resume: "hmm" }), cfg);
    await graph.invoke(new Command({ resume: "no sé" }), cfg);
    assert.equal(seen.managerLastUserMessage, "no sé");
    assert.equal((await interruptsOf(graph, cfg)).length, 0);
  });

  it("aprobación clara o cambio claro pasan directo al Manager sin re-preguntar", async () => {
    for (const [i, msg] of ["Me parece bien", "cambia el stack a Dokploy"].entries()) {
      const { graph, seen } = buildGraph();
      const cfg = { configurable: { thread_id: `clear-${i}` } };
      await graph.invoke(initial, cfg);
      await graph.invoke(new Command({ resume: msg }), cfg);
      assert.equal(seen.managerLastUserMessage, msg);
      assert.equal((await interruptsOf(graph, cfg)).length, 0);
    }
  });

  it("plan de 1 paso se auto-aprueba y clarifier_only no pide solo preguntas", async () => {
    const { graph } = buildGraph();
    const cfg = { configurable: { thread_id: "auto-1" } };
    const res = (await graph.invoke(
      {
        pendingPlanApproval: {
          mddPlan: [plan[0]!],
          delegateTarget: "clarifier_only" as const,
          goto: "clarifier",
        },
      },
      cfg,
    )) as { requestQuestionsOnly?: boolean; executorControlled?: boolean };
    assert.equal(res.executorControlled, true);
    assert.equal(res.requestQuestionsOnly, false);
  });
});
