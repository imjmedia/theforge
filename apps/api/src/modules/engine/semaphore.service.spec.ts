import { test } from "node:test";
import assert from "node:assert/strict";
import { ComplexityLevel, Status } from "@theforge/database";
import { SemaphoreService, type SemaphoreEvaluationInput } from "./semaphore.service.js";

const emptyDeliverables: SemaphoreEvaluationInput["deliverables"] = {
  specContent: null,
  useCasesContent: null,
  userStoriesContent: null,
  tasksContent: null,
  apiContractsContent: null,
  uxUiGuideContent: null,
  logicFlowsContent: null,
  infraContent: null,
};

function highBase(over: Partial<SemaphoreEvaluationInput> = {}): SemaphoreEvaluationInput {
  return {
    complexity: ComplexityLevel.HIGH,
    hasUxTeam: false,
    mddJsonString: null,
    deliverables: emptyDeliverables,
    ...over,
  };
}

test("HIGH: gaps edge_cases/field_types → AMARILLO sin alivio de grafo", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "",
    field_types: "short",
  });
  const r = s.evaluate(
    highBase({
      mddJsonString: mdd,
      sddDomainGraphOk: false,
    }),
  );
  assert.equal(r.status, Status.AMARILLO);
});

test("HIGH: mismos gaps → VERDE con sddDomainGraphOk y precision 92", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "",
    field_types: "short",
  });
  const r = s.evaluate(
    highBase({
      mddJsonString: mdd,
      sddDomainGraphOk: true,
    }),
  );
  assert.equal(r.status, Status.VERDE);
  assert.equal(r.precisionScore, 92);
});

test("HIGH: checklist completo → VERDE precision 95 sin grafo", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "e1: lockout after N attempts",
    field_types:
      "Detailed field_types markdown with inferred types and enough length to pass the semaphore heuristic threshold.",
  });
  const r = s.evaluate(highBase({ mddJsonString: mdd }));
  assert.equal(r.status, Status.VERDE);
  assert.equal(r.precisionScore, 95);
});

const pad50 = "x".repeat(50);

test("MEDIUM: 5/5 entregables → VERDE", () => {
  const s = new SemaphoreService();
  const r = s.evaluate({
    complexity: ComplexityLevel.MEDIUM,
    hasUxTeam: false,
    mddJsonString: null,
    deliverables: {
      specContent: pad50,
      useCasesContent: null,
      userStoriesContent: pad50,
      tasksContent: pad50,
      apiContractsContent: pad50,
      uxUiGuideContent: pad50,
      logicFlowsContent: null,
      infraContent: null,
    },
  });
  assert.equal(r.status, Status.VERDE);
});

test("MEDIUM: 4/5 entregables → AMARILLO", () => {
  const s = new SemaphoreService();
  const r = s.evaluate({
    complexity: ComplexityLevel.MEDIUM,
    hasUxTeam: false,
    mddJsonString: null,
    deliverables: {
      specContent: pad50,
      useCasesContent: null,
      userStoriesContent: null,
      tasksContent: pad50,
      apiContractsContent: pad50,
      uxUiGuideContent: pad50,
      logicFlowsContent: null,
      infraContent: null,
    },
  });
  assert.equal(r.status, Status.AMARILLO);
});

test("HIGH: alivio grafo VERDE 92 + constitución incompleta → AMARILLO (constitución)", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "",
    field_types: "short",
    constitution: {
      template_detected: true,
      has_context_map: true,
      has_glossary: false,
      has_gherkin: true,
      has_open_blockers: false,
      has_stack_rationale: true,
    },
  });
  const r = s.evaluate(
    highBase({
      mddJsonString: mdd,
      sddDomainGraphOk: true,
    }),
  );
  assert.equal(r.status, Status.AMARILLO);
  assert.equal(r.precisionScore, 86);
});

test("HIGH: VERDE baja a AMARILLO si hay gaps cross-artifact SDD", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "e1: lockout after N attempts",
    field_types:
      "Detailed field_types markdown with inferred types and enough length to pass the semaphore heuristic threshold.",
  });
  const r = s.evaluate(
    highBase({
      mddJsonString: mdd,
      sddCrossArtifactGapCount: 3,
    }),
  );
  assert.equal(r.status, Status.AMARILLO);
  assert.equal(r.precisionScore, 82);
});

test("UX_FIRST: exige pantallas / figmaMapping y contratos API substanciales para VERDE", () => {
  const s = new SemaphoreService();
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    business_core: "core flows",
    edge_cases: "e1: lockout after N attempts",
    field_types:
      "Detailed field_types markdown with inferred types and enough length to pass the semaphore heuristic threshold.",
  });

  // Caso 1: UX_FIRST sin pantallas ni figma
  const rSinPantallas = s.evaluate(
    highBase({
      mddJsonString: mdd,
      approach: "UX_FIRST" as never,
      hasUxTeam: true,
      figmaMapping: null,
      uiScreensContent: null,
      deliverables: { ...emptyDeliverables, apiContractsContent: "A substantial api contracts markdown content with openapi schemas." },
    }),
  );
  assert.equal(rSinPantallas.status, Status.AMARILLO);
  assert.equal(rSinPantallas.precisionScore, 82);

  // Caso 2: UX_FIRST con pantallas pero sin contratos API (falta capa de traducción técnica)
  const rSinApi = s.evaluate(
    highBase({
      mddJsonString: mdd,
      approach: "UX_FIRST" as never,
      hasUxTeam: true,
      uiScreensContent: "# Pantallas\n## Vista Dashboard\nTabla de usuarios y formulario de alta.",
      deliverables: emptyDeliverables,
    }),
  );
  assert.equal(rSinApi.status, Status.AMARILLO);
  assert.equal(rSinApi.precisionScore, 80);

  // Caso 3: UX_FIRST con pantallas y contratos API -> VERDE
  const rCompleto = s.evaluate(
    highBase({
      mddJsonString: mdd,
      approach: "UX_FIRST" as never,
      hasUxTeam: true,
      uiScreensContent: "# Pantallas\n## Vista Dashboard\nTabla de usuarios y formulario de alta.",
      deliverables: {
        ...emptyDeliverables,
        apiContractsContent: "A substantial api contracts markdown content with openapi schemas and endpoints.",
      },
    }),
  );
  assert.equal(rCompleto.status, Status.VERDE);
  assert.equal(rCompleto.precisionScore, 95);
});
