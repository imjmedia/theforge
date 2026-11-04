import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StageStatus, Status, type Project, type Stage } from "@theforge/database";
import { buildNotionExportEntries } from "./project-notion-export.util.js";

function minimalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    userId: "user-1",
    groupId: "group-1",
    name: "Demo Forge",
    visibility: "PRIVATE",
    complexity: "HIGH",
    complexityPending: null,
    projectType: "NEW",
    theforgeProjectId: null,
    hasUxTeam: false,
    uxGuideDesignRef: null,
    figmaMapping: null,
    dbgaContent: "# Benchmark",
    specContent: null,
    architectureContent: null,
    useCasesContent: null,
    userStoriesContent: null,
    blueprintContent: null,
    tasksContent: null,
    tasksJson: null,
    apiContractsContent: null,
    logicFlowsContent: null,
    infraContent: null,
    agentGovernanceContent: null,
    uxUiGuideContent: null,
    phase0SummaryContent: null,
    uiScreensContent: null,
    phase0Status: "idle",
    phase0Gaps: null,
    phase0Questions: 0,
    aemContent: null,
    pluginData: null,
    convergeWebhookUrl: null,
    convergeWebhookSecret: null,
    archivedAt: null,
    mergedFrom: null,
    parentProjectId: null,
    linkedLegacyProjectId: null,
    linkedNewProjectId: null,
    integrationHandoff: {
      items: [
        {
          id: "NEW-LEG-01",
          title: "Login SSO",
          description: "Integrar SSO",
          status: "sent",
        },
      ],
    },
    integrationHandoffUpdatedAt: new Date("2026-07-17T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  } as Project;
}

function minimalStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    ordinal: 1,
    key: "main",
    name: "Etapa principal",
    workflowStatus: StageStatus.ACTIVE,
    mddContent: "# MDD\n\n## 1. Contexto",
    brdContent: null,
    domainInventory: null,
    status: Status.ROJO,
    precisionScore: 10,
    legacyChangeState: null,
    linkedNewProjectId: null,
    handoffSnapshot: null,
    handoffImportedAt: null,
    deliverableSnapshot: null,
    specContent: "# Spec",
    architectureContent: null,
    useCasesContent: null,
    userStoriesContent: null,
    blueprintContent: null,
    tasksContent: null,
    tasksJson: null,
    documentAst: null,
    documentVersion: 0,
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
    shortTermContext: null,
    mddUpstreamBaseline: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  } as Stage;
}

describe("buildNotionExportEntries", () => {
  it("includes manifest, index, stage docs and integration CSV", () => {
    const entries = buildNotionExportEntries({
      ...minimalProject(),
      stages: [{ ...minimalStage(), estimation: null }],
      integrationTracesAsNew: [],
      integrationTracesAsLegacy: [],
    });

    const paths = entries.map((entry) => entry.path);
    assert.ok(paths.some((p) => p.endsWith("_theforge/manifest.json")));
    assert.ok(paths.some((p) => p.endsWith("index.html")));
    assert.ok(paths.some((p) => p.includes("Integración/Handoff items.csv")));
    assert.ok(paths.some((p) => p.includes("Etapas.csv")));
    assert.ok(paths.some((p) => p.includes("MDD") && p.endsWith(".md")));
    assert.ok(paths.some((p) => p.includes("Benchmark") && p.endsWith(".md")));

    const manifest = entries.find((e) => e.path.endsWith("manifest.json"));
    assert.ok(manifest);
    const parsed = JSON.parse(String(manifest!.content)) as { format: string; projectName: string };
    assert.equal(parsed.format, "theforge-notion-portability");
    assert.equal(parsed.projectName, "Demo Forge");
  });

  it("includes Pantallas from Project.uiScreensContent on active stage", () => {
    const entries = buildNotionExportEntries({
      ...minimalProject({
        uiScreensContent:
          "# Pantallas\n\n| Ruta |\n|------|\n| / |\n\n---UI_PROJECT_JSON---\n\n```json\n{\"version\":\"1.0.0\"}\n```\n",
      }),
      stages: [{ ...minimalStage(), estimation: null }],
      integrationTracesAsNew: [],
      integrationTracesAsLegacy: [],
    });

    const paths = entries.map((entry) => entry.path);
    assert.ok(paths.some((p) => p.includes("Pantallas") && p.endsWith(".md")));
    assert.ok(paths.some((p) => p.endsWith("_assets/ui-project.json")));
  });

  it("exporta designSpec y architectureGraph en _assets", () => {
    const entries = buildNotionExportEntries({
      ...minimalProject({ projectType: "DESIGN_FIRST" }),
      stages: [
        {
          ...minimalStage(),
          designSpec: { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] },
          designSpecRevision: 1,
          architectureGraph: { version: "1.0.0", entities: [], endpoints: [] },
          architectureGraphSourceHash: "abc",
          estimation: null,
        },
      ],
      integrationTracesAsNew: [],
      integrationTracesAsLegacy: [],
    });
    const paths = entries.map((e) => e.path);
    assert.ok(paths.some((p) => p.endsWith("_assets/design-spec.json")));
    assert.ok(paths.some((p) => p.endsWith("_assets/architecture-graph.json")));
    assert.ok(paths.some((p) => p.endsWith("_assets/design-spec-revision.json")));
  });
});
