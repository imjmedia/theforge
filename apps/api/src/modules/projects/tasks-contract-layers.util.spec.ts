import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTasksContractManifest,
  matchBusinessRulesForStory,
  matchEndpointsForStory,
} from "./tasks-contract-layers.util.js";
import {
  buildTasksContextAnchors,
  buildTasksRedactorSlices,
  normalizeTasksRedactorSliceMarkdown,
  partitionPlanItemsByGenerationLayer,
} from "./tasks-context-anchor.util.js";
import { buildTasksLayerPromptContext } from "./tasks-layer-context.util.js";
import { TasksGenerationPipelineService } from "./tasks-generation-pipeline.service.js";
import type { DomainInventory, TasksGenerationPlan, TasksPlanItem } from "@theforge/shared-types";
import type { AiService } from "../ai/ai.service.js";

const SAMPLE_MDD = `
## 1. Contexto

### Glosario de dominio (Ubiquitous Language)
- **Usuario:** persona autenticada del sistema.
- **Token:** credencial JWT de sesión.

### Bloqueantes de negocio
- El token expira en 15 minutos
- Requiere validación de dominio según MDD v2

## 2. Stack
**Frontend:** React **Backend:** NestJS

## 3. Modelo de datos
- users (email UNIQUE)

## 4. Contratos API
POST /api/v1/auth/login

## 5. Lógica y Edge Cases
- Dado credenciales válidas Cuando login Entonces emite JWT
`;

const SAMPLE_HU = `
### Historia de usuario: [US-102] Autenticación de Usuarios
**Como:** usuario
**Quiero:** iniciar sesión con email
**Para:** acceder al dashboard

**Criterios de aceptación**
- El token expira en 15 minutos
- Validar dominio corporativo
`;

const SAMPLE_API = `
| POST | \`/api/v1/auth/login\` | Login |
`;

const SAMPLE_UI = `
| Ruta | Pantalla | HU | Componente | API | Estados |
| /login | LoginPage | US-102 | LoginForm | POST /api/v1/auth/login | loading, error |
`;

function anchorsFromManifest(manifest: ReturnType<typeof extractTasksContractManifest>) {
  return buildTasksContextAnchors(manifest);
}

describe("tasks-contract-layers", () => {
  it("extrae manifiesto con 4 capas", () => {
    const manifest = extractTasksContractManifest({
      mddMarkdown: SAMPLE_MDD,
      userStoriesMarkdown: SAMPLE_HU,
      apiContractsMarkdown: SAMPLE_API,
      uiScreensMarkdown: SAMPLE_UI,
      blueprintMarkdown: "## Fase 1\n- Clean Architecture",
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.layers.length, 4);
    const domain = manifest.layers.find((l) => l.layer === "domain");
    assert.ok(domain!.glossary.length >= 1);
    assert.ok(
      domain!.businessRules.length >= 1 ||
        anchorsFromManifest(manifest).some((a) => a.business_rules.length > 0),
    );
    const integration = manifest.layers.find((l) => l.layer === "integration");
    assert.equal(integration!.endpoints.length, 1);
    assert.equal(integration!.endpoints[0]!.path, "/api/v1/auth/login");
  });

  it("construye context anchor por HU", () => {
    const manifest = extractTasksContractManifest({
      mddMarkdown: SAMPLE_MDD,
      userStoriesMarkdown: SAMPLE_HU,
      apiContractsMarkdown: SAMPLE_API,
      uiScreensMarkdown: SAMPLE_UI,
    });
    const anchors = buildTasksContextAnchors(manifest);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0]!.story_id, "US-102");
    assert.equal(anchors[0]!.feature, "Autenticación de Usuarios");
    assert.ok(anchors[0]!.contracts.endpoints.includes("POST /api/v1/auth/login"));
    assert.ok(anchors[0]!.contracts.screens.includes("/login"));
  });

  it("matriz de contexto mínimo por capa Backend", () => {
    const manifest = extractTasksContractManifest({
      mddMarkdown: SAMPLE_MDD,
      userStoriesMarkdown: SAMPLE_HU,
      apiContractsMarkdown: SAMPLE_API,
      uiScreensMarkdown: SAMPLE_UI,
    });
    const ctx = buildTasksLayerPromptContext({
      manifest,
      layer: "Backend",
      anchors: buildTasksContextAnchors(manifest),
      mddMarkdown: SAMPLE_MDD,
      specMarkdown: "## Reglas\n- JWT obligatorio",
    });
    assert.match(ctx, /Manifiesto de contratos/);
    assert.match(ctx, /Context Anchors/);
    assert.doesNotMatch(ctx, /Design System \(fallback\)/);
  });

  it("particiona plan por capa de generación", () => {
    const map = partitionPlanItemsByGenerationLayer([
      {
        id: "T-001",
        title: "API login",
        layer: "Backend",
        mddRefs: [],
        storyRefs: [],
        upstreamRefs: [],
        dependsOn: [],
        targetFilesHint: [],
      },
      {
        id: "T-002",
        title: "UI login",
        layer: "Frontend",
        mddRefs: [],
        storyRefs: ["US-102"],
        upstreamRefs: [],
        dependsOn: [],
        targetFilesHint: [],
      },
    ]);
    assert.equal(map.get("Backend")?.length, 1);
    assert.equal(map.get("Frontend")?.length, 1);
  });

  it("match endpoints y reglas para story", () => {
    const manifest = extractTasksContractManifest({
      mddMarkdown: SAMPLE_MDD,
      userStoriesMarkdown: SAMPLE_HU,
      apiContractsMarkdown: SAMPLE_API,
      uiScreensMarkdown: SAMPLE_UI,
    });
    const story = manifest.layers.find((l) => l.layer === "domain")!.userStories[0]!;
    const endpoints = manifest.layers.find((l) => l.layer === "integration")!.endpoints;
    const screens = manifest.layers.find((l) => l.layer === "experience")!.screens;
    const matched = matchEndpointsForStory(story, screens, endpoints);
    assert.ok(matched.some((e) => e.path === "/api/v1/auth/login"));
    const rules = matchBusinessRulesForStory(
      story,
      manifest.layers.find((l) => l.layer === "domain")!.businessRules,
      manifest.layers.find((l) => l.layer === "domain")!.glossary,
    );
    assert.ok(rules.some((r) => r.includes("15 minutos")));
  });

  it("buildTasksRedactorSlices evita explosión journeys × capas y agrupa por capa + batchSize", () => {
    const items: TasksPlanItem[] = [];
    for (let i = 1; i <= 50; i += 1) {
      items.push({
        id: `T-${String(i).padStart(3, "0")}`,
        title: `Backend task ${i}`,
        layer: "Backend",
        mddRefs: ["§4"],
        storyRefs: i <= 10 ? [`US-JRN-CAP_${i}`] : [],
        upstreamRefs: i <= 10 ? [`journey:proc-cap-${i}`] : [],
        dependsOn: [],
        targetFilesHint: [],
      });
    }
    for (let i = 51; i <= 80; i += 1) {
      items.push({
        id: `T-${String(i).padStart(3, "0")}`,
        title: `Frontend task ${i}`,
        layer: "Frontend",
        mddRefs: ["§4"],
        storyRefs: [],
        upstreamRefs: [],
        dependsOn: [],
        targetFilesHint: [],
      });
    }
    for (let i = 81; i <= 90; i += 1) {
      items.push({
        id: `T-${String(i).padStart(3, "0")}`,
        title: `Infra task ${i}`,
        layer: "Infra",
        mddRefs: ["§7"],
        storyRefs: [],
        upstreamRefs: [],
        dependsOn: [],
        targetFilesHint: [],
      });
    }

    const inventory: DomainInventory = {
      capabilities: [],
      suggestedEntities: [],
      crudMatrix: [],
      adminSurfaces: [],
      processes: Array.from({ length: 10 }, (_, idx) => ({
        id: `proc-cap-${idx + 1}`,
        name: `Proceso ${idx + 1}`,
        steps: [],
        entities: [],
        critical: true,
        brdCapabilityIds: [`cap-${idx + 1}`],
        screenHints: [],
      })),
    };

    const plan: TasksGenerationPlan = { sections: ["Backend", "Frontend", "Infra"], items };
    const slices = buildTasksRedactorSlices(plan, 24, inventory);

    // 50 Backend -> 3 lotes (24, 24, 2); 30 Frontend -> 2 lotes (24, 6); 10 Infra -> 1 lote (10) = 6 lotes total
    assert.equal(slices.length, 6);
    assert.deepEqual(
      slices.map((s) => [s.layer, s.layerBatchIndex, s.layerBatchCount, s.items.length]),
      [
        ["Backend", 0, 3, 24],
        ["Backend", 1, 3, 24],
        ["Backend", 2, 3, 2],
        ["Frontend", 0, 2, 24],
        ["Frontend", 1, 2, 6],
        ["Infra", 0, 1, 10],
      ],
    );

    const flatIds = slices.flatMap((s) => s.items.map((i) => i.id));
    assert.equal(flatIds.length, 90);
    assert.equal(new Set(flatIds).size, 90);
  });

  it("normalizeTasksRedactorSliceMarkdown mantiene encabezados canónicos y evita duplicados", () => {
    const first = normalizeTasksRedactorSliceMarkdown(
      "---\nid: T-001\n---\n- [ ] T-001",
      { layer: "Backend", layerBatchIndex: 0 },
      0,
      true,
    );
    assert.match(first, /^# Tasks\n\n## Backend tasks\n\n---/);

    const cont = normalizeTasksRedactorSliceMarkdown(
      "# Tasks\n\n> Capa activa: Backend\n\n## Backend tasks\n\n---\nid: T-025\n---\n- [ ] T-025",
      { layer: "Backend", layerBatchIndex: 1 },
      1,
      true,
    );
    assert.doesNotMatch(cont, /^# Tasks/m);
    assert.doesNotMatch(cont, /^## Backend tasks/m);
    assert.match(cont, /^---\nid: T-025/);

    const infra = normalizeTasksRedactorSliceMarkdown(
      "# Tasks\n\n---\nid: T-081\n---\n- [ ] T-081",
      { layer: "Infra", layerBatchIndex: 0 },
      5,
      true,
    );
    assert.doesNotMatch(infra, /^# Tasks/m);
    assert.match(infra, /^## Infraestructura tasks\n\n---/);
  });

  it("TasksGenerationPipelineService usa map-reduce plano en paralelo con tasksSliceMode y prefetch de techDocs", async () => {
    const generateTasksCalls: Array<Record<string, unknown>> = [];
    let techDocsCalls = 0;

    const fakeAi = {
      resolveTechDocsContext: async () => {
        techDocsCalls += 1;
        return "FastAPI docs snippet";
      },
      generateAuditorResponse: async (_prompt: string, _history: unknown, opts?: { systemPrompt?: string }) => {
        if (opts?.systemPrompt?.includes("plan")) {
          // Return invalid JSON to exercise planner or simple valid JSON
          return JSON.stringify({
            sections: ["Backend tasks", "Frontend tasks", "Infraestructura tasks"],
            items: [
              ...Array.from({ length: 10 }, (_, idx) => ({
                id: `T-${String(idx + 1).padStart(3, "0")}`,
                title: `Journey ${idx + 1} backend`,
                layer: "Backend",
                mddRefs: ["§4"],
                storyRefs: [`US-JRN-CAP_${idx + 1}`],
                upstreamRefs: [`journey:proc-cap-${idx + 1}`, "api-contracts:POST /api/v1/auth/login"],
                dependsOn: [],
                targetFilesHint: ["apps/api/src/auth.ts"],
              })),
              {
                id: "T-011",
                title: "UI /login",
                layer: "Frontend",
                mddRefs: ["§4"],
                storyRefs: ["US-102"],
                upstreamRefs: ["pantallas:/login"],
                dependsOn: ["T-001"],
                targetFilesHint: ["apps/web/src/pages/LoginPage.tsx"],
              },
              {
                id: "T-012",
                title: "Docker compose",
                layer: "Infra",
                mddRefs: ["§7"],
                storyRefs: [],
                upstreamRefs: [],
                dependsOn: [],
                targetFilesHint: ["docker-compose.yml"],
              },
            ],
          });
        }
        return JSON.stringify({
          score: 96,
          passed: true,
          missing_coverage: [],
          conflicts: [],
          traceability_gaps: [],
          dependency_issues: [],
          executable_gaps: [],
          feedback: "OK",
        });
      },
      generateTasks: async (_mdd: string, _bp: string | null | undefined, opts: Record<string, unknown>) => {
        generateTasksCalls.push(opts);
        const layer = String(opts.tasksGenerationLayer ?? "Backend");
        const parsedPlan = JSON.parse(String(opts.tasksPlanJson ?? "{}")) as TasksGenerationPlan;
        const blocks = parsedPlan.items.map(
          (item) =>
            `---\nid: ${item.id}\nsection: ${layer}\ntitle: ${item.title}\nstatus: pending\nchange_type: create\nparallel: true\ndepends_on: []\ncontext:\n  mdd_ref: "§4"\n  story_ref: ${item.storyRefs[0] ?? "US-102"}\n  why: "test"\nscope:\n  include:\n    - ${item.targetFilesHint[0] ?? "apps/api/src/app.ts"}\n  exclude: []\nrequirements:\n  - Implementar ${item.title}\nverification:\n  - run: npm test\n    expect_exit: 0\ndone_when:\n  - OK\n---\n\n- [ ] ${item.id} — ${item.title}`,
        );
        return blocks.join("\n\n");
      },
    } as unknown as AiService;

    const svc = new TasksGenerationPipelineService(fakeAi);
    const inventory: DomainInventory = {
      capabilities: [],
      suggestedEntities: [],
      crudMatrix: [],
      adminSurfaces: [],
      processes: Array.from({ length: 10 }, (_, idx) => ({
        id: `proc-cap-${idx + 1}`,
        name: `Proceso ${idx + 1}`,
        steps: [],
        entities: [],
        critical: true,
        brdCapabilityIds: [`cap-${idx + 1}`],
        screenHints: [],
      })),
    };

    const plan: TasksGenerationPlan = {
      sections: ["Backend tasks", "Frontend tasks", "Infraestructura tasks"],
      items: [
        ...Array.from({ length: 10 }, (_, idx) => ({
          id: `T-${String(idx + 1).padStart(3, "0")}`,
          title: `Journey ${idx + 1} backend`,
          layer: "Backend" as const,
          mddRefs: ["§4"],
          storyRefs: [`US-JRN-CAP_${idx + 1}`],
          upstreamRefs: [`journey:proc-cap-${idx + 1}`],
          dependsOn: [],
          targetFilesHint: ["apps/api/src/auth.ts"],
        })),
        {
          id: "T-011",
          title: "UI /login",
          layer: "Frontend" as const,
          mddRefs: ["§4"],
          storyRefs: ["US-102"],
          upstreamRefs: ["pantallas:/login"],
          dependsOn: ["T-001"],
          targetFilesHint: ["apps/web/src/pages/LoginPage.tsx"],
        },
        {
          id: "T-012",
          title: "Docker compose",
          layer: "Infra" as const,
          mddRefs: ["§7"],
          storyRefs: [],
          upstreamRefs: [],
          dependsOn: [],
          targetFilesHint: ["docker-compose.yml"],
        },
      ],
    };

    const manifest = extractTasksContractManifest({
      mddMarkdown: SAMPLE_MDD,
      userStoriesMarkdown: SAMPLE_HU,
      apiContractsMarkdown: SAMPLE_API,
      uiScreensMarkdown: SAMPLE_UI,
    });
    const anchors = buildTasksContextAnchors(manifest);

    // Invoke internal redactor via private access to test exact slice fan-out (3 layers, NOT 10 journeys!)
    const md = await (svc as unknown as {
      runRedactor: (
        p: TasksGenerationPlan,
        inp: unknown,
        gaps: null,
        m: typeof manifest,
        a: typeof anchors,
      ) => Promise<string>;
    }).runRedactor(
      plan,
      {
        mddMarkdown: SAMPLE_MDD,
        inventory,
        taskOpts: {
          apiContractsContent: SAMPLE_API,
          uiScreensContent: SAMPLE_UI,
          userStoriesContent: SAMPLE_HU,
          techDocsContext: "FastAPI docs snippet",
        },
      },
      null,
      manifest,
      anchors,
    );

    // 3 layers (Backend, Frontend, Infra) = 3 calls total — NOT 10 sequential journey calls!
    assert.equal(generateTasksCalls.length, 3);
    assert.equal(techDocsCalls, 0);
    assert.ok(generateTasksCalls.every((c) => c.tasksSliceMode === true));
    assert.ok(generateTasksCalls.every((c) => c.techDocsContext === "FastAPI docs snippet"));
    assert.match(md, /^# Tasks\n\n## Backend tasks/m);
    assert.match(md, /^## Frontend tasks/m);
    assert.match(md, /^## Infraestructura tasks/m);
  });
});
