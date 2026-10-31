import { describe, it } from "node:test";
import assert from "node:assert";
import type { Command } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";
import { createMddExecutorNode, MAX_MESH_JUMPS_PER_PLAN } from "./mdd-executor.node.js";

type CmdShape = { goto?: unknown; update?: Record<string, unknown> };

function asCmd(cmd: Command): CmdShape {
  return cmd as unknown as CmdShape;
}

const plan = [
  { step_id: "1", node: "software_architect", task_description: "SQL y contratos" },
  { step_id: "2", node: "format_after_architect", task_description: "Formatear" },
  { step_id: "3", node: "security", task_description: "Seguridad" },
];

function stateAfterSecurity(extra: Partial<MDDStateType>): MDDStateType {
  return {
    mddPlan: plan,
    mddPlanCurrentStep: 2,
    executorControlled: true,
    internalDirectives: [
      { from: "security", to: "software_architect", message: "Quita jwt_token de la tabla sessions." },
    ],
    ...extra,
  } as unknown as MDDStateType;
}

describe("mdd-executor mesh jump cap", () => {
  const executor = createMddExecutorNode();

  it("primera directiva → salta atrás al Arquitecto y cuenta el salto", async () => {
    const cmd = asCmd(await executor(stateAfterSecurity({ meshJumpCount: 0 })));
    assert.equal(cmd.goto, "software_architect");
    assert.equal(cmd.update?.mddPlanCurrentStep, 0);
    assert.equal(cmd.update?.meshJumpCount, 1);
    assert.deepEqual(cmd.update?.internalDirectives, []);
    assert.ok(String(cmd.update?.currentStepGoal).includes("[DIRECTIVA DE SECURITY]"));
  });

  it("con el tope alcanzado → ignora la directiva y completa el plan", async () => {
    const cmd = asCmd(await executor(stateAfterSecurity({ meshJumpCount: MAX_MESH_JUMPS_PER_PLAN })));
    assert.equal(cmd.goto, "manager");
    assert.equal(cmd.update?.executorControlled, false);
    assert.equal(cmd.update?.meshJumpCount, undefined);
  });

  it("plan nuevo arranca el contador en 0", async () => {
    const cmd = asCmd(
      await executor({ mddPlan: plan, mddPlanCurrentStep: undefined, executorControlled: true } as unknown as MDDStateType),
    );
    assert.equal(cmd.goto, "software_architect");
    assert.equal(cmd.update?.meshJumpCount, 0);
  });

  it("directiva hacia un nodo posterior no es salto atrás → avanza normal", async () => {
    const state = {
      mddPlan: plan,
      mddPlanCurrentStep: 0,
      executorControlled: true,
      meshJumpCount: 0,
      internalDirectives: [{ from: "software_architect", to: "security", message: "Define MFA." }],
    } as unknown as MDDStateType;
    const cmd = asCmd(await executor(state));
    assert.equal(cmd.goto, "format_after_architect");
    assert.equal(cmd.update?.mddPlanCurrentStep, 1);
  });
});
