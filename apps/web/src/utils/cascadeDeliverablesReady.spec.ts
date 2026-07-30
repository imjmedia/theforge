import { describe, it } from "node:test";
import assert from "node:assert";
import { projectCascadeWaveDeliverablesReady } from "./cascadeDeliverablesReady.js";

describe("projectCascadeWaveDeliverablesReady", () => {
  it("false cuando falta algún entregable de oleada HIGH", () => {
    assert.equal(
      projectCascadeWaveDeliverablesReady({
        complexity: "HIGH",
        specContent: "# Spec",
        mddContent: "# MDD",
      }),
      false,
    );
  });

  it("true cuando todos los campos de oleada HIGH tienen contenido", () => {
    const ok = projectCascadeWaveDeliverablesReady({
      complexity: "HIGH",
      mddContent: "# MDD ".repeat(40),
      specContent: "# Spec ".repeat(40),
      architectureContent: "# Arq ".repeat(40),
      useCasesContent: "# UC ".repeat(40),
      blueprintContent: "# BP ".repeat(40),
      apiContractsContent: "# API ".repeat(40),
      logicFlowsContent: "# LF ".repeat(40),
      uxUiGuideContent: "# UX ".repeat(40),
      userStoriesContent: "# US ".repeat(40),
      agentGovernanceContent: "# AG ".repeat(40),
      tasksContent: "# Tasks ".repeat(40),
      infraContent: "# Infra ".repeat(40),
    });
    assert.equal(ok, true);
  });
});
