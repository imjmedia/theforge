import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectCloneCreateInput,
  defaultCloneProjectName,
  resolveCloneProjectOptions,
} from "./project-clone.util.js";

describe("project-clone.util", () => {
  const baseSource = {
    id: "source-id",
    userId: "owner-id",
    name: "Proyecto base",
    visibility: "PRIVATE" as const,
    complexity: "HIGH" as const,
    complexityPending: null,
    projectType: "NEW" as const,
    theforgeProjectId: null,
    hasUxTeam: false,
    uxGuideDesignRef: null,
    figmaMapping: null,
    dbgaContent: "dbga",
    specContent: "spec",
    architectureContent: null,
    useCasesContent: null,
    userStoriesContent: null,
    blueprintContent: null,
    tasksContent: null,
    apiContractsContent: null,
    logicFlowsContent: null,
    infraContent: null,
    agentGovernanceContent: null,
    uxUiGuideContent: null,
    phase0SummaryContent: null,
    phase0Status: "done",
    phase0Gaps: null,
    phase0Questions: 2,
    aemContent: null,
    convergeWebhookUrl: "https://example.com/hook",
    convergeWebhookSecret: "secret",
    archivedAt: null,
    mergedFrom: null,
    parentProjectId: null,
    linkedLegacyProjectId: null,
    linkedNewProjectId: null,
    integrationHandoff: null,
    integrationHandoffUpdatedAt: null,
    groupId: "00000000-0000-4000-8000-000000000001",
    createdAt: new Date("2026-01-01"),
    stages: [
      {
        id: "stage-1",
        projectId: "source-id",
        ordinal: 1,
        key: "main",
        name: "Etapa principal",
        workflowStatus: "ACTIVE" as const,
        mddContent: "# MDD",
        brdContent: "# BRD",
        status: "AMARILLO" as const,
        precisionScore: 42,
        legacyChangeState: null,
        linkedNewProjectId: "other-project",
        handoffSnapshot: { items: [] },
        handoffImportedAt: new Date("2026-01-02"),
        deliverableSnapshot: { specContent: "snap" },
        specContent: "stage-spec",
        architectureContent: null,
        useCasesContent: null,
        userStoriesContent: null,
        blueprintContent: null,
        tasksContent: null,
        apiContractsContent: null,
        logicFlowsContent: null,
        infraContent: null,
        agentGovernanceContent: null,
        uxUiGuideContent: null,
        phase0SummaryContent: null,
        aemContent: null,
        changeSpecContent: null,
        isLegacy: false,
        theforgeProjectId: null,
        shortTermContext: { scratch: true },
        designSpec: { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] },
        designSpecRevision: 2,
        architectureGraph: { version: "1.0.0", entities: [], endpoints: [] },
        architectureGraphSourceHash: "hash-1",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        estimation: {
          id: "est-1",
          stageId: "stage-1",
          totalHours: 10,
          totalMxn: 5000,
          teamStructure: { dev: 1 },
        },
      },
    ],
  };

  it("defaultCloneProjectName prefixes once", () => {
    assert.equal(defaultCloneProjectName("Alpha"), "Copia de Alpha");
    assert.equal(defaultCloneProjectName("Copia de Alpha"), "Copia de Alpha");
  });

  it("resolveCloneProjectOptions defaults to PRIVATE copy name", () => {
    assert.deepEqual(resolveCloneProjectOptions(baseSource, {}), {
      name: "Copia de Proyecto base",
      visibility: "PRIVATE",
    });
  });

  it("buildProjectCloneCreateInput copies documents and stages without integration links", () => {
    const input = buildProjectCloneCreateInput(baseSource, {
      userId: "cloner-id",
      name: "Sandbox",
      visibility: "PRIVATE",
    });

    assert.deepEqual(input.user, { connect: { id: "cloner-id" } });
    assert.equal(input.name, "Sandbox");
    assert.equal(input.dbgaContent, "dbga");
    assert.equal(input.specContent, "spec");
    assert.equal("convergeWebhookUrl" in input, false);
    assert.equal("linkedLegacyProjectId" in input, false);

    const stageCreate = input.stages?.create;
    assert.ok(Array.isArray(stageCreate));
    assert.equal(stageCreate!.length, 1);
    const stage = stageCreate![0] as Record<string, unknown>;
    assert.equal(stage.mddContent, "# MDD");
    assert.equal(stage.designSpecRevision, 2);
    assert.equal(stage.architectureGraphSourceHash, "hash-1");
    assert.equal(stage.linkedNewProjectId, undefined);
    assert.deepEqual(stage.estimation, {
      create: {
        totalHours: 10,
        totalMxn: 5000,
        teamStructure: { dev: 1 },
      },
    });
  });
});
