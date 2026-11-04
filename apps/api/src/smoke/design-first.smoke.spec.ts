/**
 * Smoke e2e Design-First (paso 26 / RF-16): fixture golden → compile-contract → MDD simulado
 * → pasos de cascada deterministas → artefactos de repo-handoff.
 *
 * No levanta Nest ni BD; enciende el flag solo vía mock de ConfigService en la spec.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ConfigService } from "@nestjs/config";
import {
  DELIVERABLE_DESIGN_SCREENS_RENDER_STEP,
  EMPTY_DESIGN_SPEC,
  compileDataNeedsToPag,
  evaluateDesignFirstPhaseGates,
  exportPagToOpenApiSpec,
  exportPagToOpenApiYaml,
  parseDesignSpec,
  renderDesignPantallasMarkdown,
  resolveDeliverableWaves,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";
import {
  sealDesignFirstMddSection3,
  sealDesignFirstMddSection4,
  wrapDesignFirstMddSectionsForHarness,
} from "../modules/ai-analysis/utils/design-first-mdd-sections.util.js";
import { buildDesignFirstHandoffArtifacts } from "../modules/design-first/design-artifacts.service.js";
import { isDesignFirstEnabled } from "../modules/design-first/design-first.config.js";
import { validateOpenApi31 } from "../modules/design-first/openapi-validate.util.js";
import { designFirstRepoHandoffFiles } from "../modules/projects/handoff-export.util.js";
import { ProjectDeliverableGeneratorsService } from "../modules/projects/project-deliverable-generators.service.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/shared-types/src/design-first/__fixtures__",
);

function configWithDesignFirstFlag(enabled: boolean): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => {
      if (key === "DESIGN_FIRST_ENABLED") return enabled;
      return defaultValue;
    },
  } as ConfigService;
}

function loadGoldenDesignSpec() {
  return parseDesignSpec(JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")));
}

function loadGoldenPag(): ProjectArchitectureGraph {
  return JSON.parse(readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8")) as ProjectArchitectureGraph;
}

async function simulateApiContractsCascade(project: unknown): Promise<string> {
  const svc = Object.create(ProjectDeliverableGeneratorsService.prototype) as ProjectDeliverableGeneratorsService;
  (svc as unknown as { throwIfAborted: () => void }).throwIfAborted = () => undefined;
  (svc as unknown as { logger: { log: () => void } }).logger = { log: () => undefined };
  (svc as unknown as { notifyPluginAfterDocumentPersist: () => void }).notifyPluginAfterDocumentPersist =
    () => undefined;
  let persisted = "";
  (svc as unknown as { projects: { update: (_id: string, data: { apiContractsContent: string }) => Promise<unknown> } }).projects =
    {
      update: async (_id, data) => {
        persisted = data.apiContractsContent;
        return { apiContractsContent: data.apiContractsContent };
      },
    };

  await (
    svc as unknown as {
      generateApiContractsFromPag: (p: unknown, s?: AbortSignal) => Promise<unknown>;
    }
  ).generateApiContractsFromPag(project, undefined);

  return persisted;
}

describe("smoke Design-First e2e", () => {
  it("RF-01: creación bloqueada con flag apagado y estado inicial con flag simulado", () => {
    assert.equal(isDesignFirstEnabled(configWithDesignFirstFlag(false)), false);
    assert.equal(isDesignFirstEnabled(configWithDesignFirstFlag(true)), true);
    assert.deepEqual(EMPTY_DESIGN_SPEC, {
      schemaVersion: 1,
      entities: [],
      screens: [],
      navigation: [],
      dataNeeds: [],
    });
  });

  it("RF-16: three-screens → compile-contract → MDD simulado → cascada → handoff", async () => {
    assert.equal(isDesignFirstEnabled(configWithDesignFirstFlag(true)), true);

    const designSpec = loadGoldenDesignSpec();
    const gates = evaluateDesignFirstPhaseGates({ designSpec });
    assert.equal(gates.phase2.ok, true, JSON.stringify(gates.phase2.issues));

    const compiled = compileDataNeedsToPag({ designSpec, projectName: "ThreeScreensGolden" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const goldenPag = loadGoldenPag();
    assert.deepEqual(compiled.pag, goldenPag);

    const openApiCheck = validateOpenApi31(exportPagToOpenApiSpec(compiled.pag));
    assert.equal(openApiCheck.ok, true, JSON.stringify(openApiCheck));

    const section3 = sealDesignFirstMddSection3(compiled.pag);
    const section4 = sealDesignFirstMddSection4(compiled.pag);
    const mddDraft = wrapDesignFirstMddSectionsForHarness(section3, section4);
    assert.match(mddDraft, /## 3\. Modelo de Datos/);
    assert.match(mddDraft, /## 4\. Contratos de API/);

    const waves = resolveDeliverableWaves("HIGH", { projectType: "DESIGN_FIRST" }).flat();
    assert.ok(waves.indexOf("api_contracts") < waves.indexOf(DELIVERABLE_DESIGN_SCREENS_RENDER_STEP));

    const project = {
      id: "smoke-df-1",
      name: "ThreeScreensGolden",
      projectType: "DESIGN_FIRST" as const,
      userId: "u-smoke",
      visibility: "PRIVATE" as const,
      complexity: "HIGH" as const,
      hasUxTeam: false,
      specContent: "",
      blueprintContent: "",
      tasksContent: "",
      agentGovernanceContent: null,
      stages: [
        {
          id: "s-smoke",
          projectId: "smoke-df-1",
          ordinal: 1,
          status: "ROJO",
          designSpec,
          designSpecRevision: 1,
          architectureGraph: compiled.pag,
          mddContent: mddDraft,
        },
      ],
    };

    const apiContractsMd = await simulateApiContractsCascade(project);
    assert.match(apiContractsMd, /Contratos de API/);

    const pantallasMd = renderDesignPantallasMarkdown(designSpec);
    assert.ok(pantallasMd.trim().length > 0);

    const handoffFiles = designFirstRepoHandoffFiles(project as never, project.stages[0] as never);
    assert.ok(handoffFiles.some((f) => f.path === "openapi.yaml"));
    assert.ok(handoffFiles.some((f) => f.path === "mocks/handlers.ts"));

    const openapiYaml = handoffFiles.find((f) => f.path === "openapi.yaml")!.content;
    assert.equal(openapiYaml, exportPagToOpenApiYaml(compiled.pag));

    const directArtifacts = buildDesignFirstHandoffArtifacts({ designSpec, pag: compiled.pag });
    for (const file of directArtifacts) {
      if (file.path.startsWith("mocks/fixtures/") && file.path.endsWith(".json")) {
        assert.doesNotThrow(() => JSON.parse(file.content), file.path);
      }
    }

    for (const file of handoffFiles) {
      if (file.path.startsWith("mocks/fixtures/") && file.path.endsWith(".json")) {
        assert.doesNotThrow(() => JSON.parse(file.content), file.path);
      }
    }

    assert.equal(validateOpenApi31(exportPagToOpenApiSpec(compiled.pag)).ok, true);
  });
});
