import { test } from "node:test";
import assert from "node:assert/strict";
import { ComplexityLevel } from "@theforge/database";
import { CascadeCircuitBreaker, DeliverablesCascadeService } from "./deliverables-cascade.service.js";
import { ConformanceService } from "../engine/conformance.service.js";
import { computeCrossDocumentConsistency } from "../ai-analysis/estimation/consistency.util.js";
import { runWithRequestUserAsync } from "../../common/request-user.store.js";
import { collectConformanceGaps } from "./conformance-gaps.util.js";

const BRD_WITH_TRACE_GAP = `# BRD — Demo

## 1. Contexto
Sistema de videoconsulta con WebSocket Gateway y RabbitMQ para eventos clínicos en tiempo real.

## 2. Capacidades Funcionales del Producto

### 9 Continuidad de sesión y gestión de incidencias
- Continuidad de sesión ante reconexión y gestión de incidencias operativas con bitácora.

### Decision log
Por validar tarifas exactas.
`;

const MDD_BASE = `# MDD — Demo

## 1. Contexto y Alcance
Sistema de sesiones de videoconsulta con WebSocket Gateway y RabbitMQ.

## 2. Arquitectura y Stack
- NestJS + PostgreSQL + RabbitMQ (broker primario) + WebSocket Gateway.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY
);
\`\`\`

## 4. Contratos de API
| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | /api/v1/sessions | Listar sesiones |

## 5. Lógica de Negocio
- El sistema registra cada sesión iniciada por un paciente.
`;

function createHarness(overrides?: {
  blueprintContent?: string;
  apiContractsContent?: string;
  logicFlowsContent?: string;
  architectureContent?: string;
  infraContent?: string;
  tasksContent?: string;
  mddContent?: string;
  brdContent?: string;
  dbgaContent?: string | null;
  /** Hook tras cada `generateDocument` (puede mutar `state.overrides` para simular una regeneración). */
  onGenerate?: (kind: string, state: { overrides: Record<string, unknown> }) => void;
  /** Si se define, `generateDocument` rechaza con este mensaje. */
  rejectGenerateWith?: string;
  /** `shortTermContext` inicial de la etapa (ruta delta). */
  shortTermContext?: Record<string, unknown>;
}) {
  const state = {
    overrides: { ...(overrides ?? {}) } as Record<string, unknown>,
    stageMdd: overrides?.mddContent ?? MDD_BASE,
    generatedDocs: [] as Array<{
      kind: string;
      gapsFeedback?: string | null;
      acknowledgeGaps?: boolean;
    }>,
    stageUpdates: [] as string[],
    uiScreensSynced: 0,
    semaphoreSynced: 0,
    /** Contexto persistido de la etapa (lo que vería `findUnique`/`update`). */
    dbContext: (overrides?.shortTermContext ?? null) as Record<string, unknown> | null,
  };

  const live = () => state.overrides as NonNullable<typeof overrides>;
  const makeProject = () => ({
    id: "proj-1",
    ownerId: "user-1",
    visibility: "SHARED",
    name: "Demo",
    complexity: ComplexityLevel.HIGH,
    projectType: "NEW",
    dbgaContent:
      "dbgaContent" in live()
        ? live().dbgaContent
        : "Plataforma con WebSocket Gateway en tiempo real y mensajería RabbitMQ para eventos de sesión y notificaciones clínicas.",
    blueprintContent:
      live().blueprintContent ??
      "### 2. Persistencia y datos\n- sessions\n\nArquitectura event-driven con RabbitMQ.\n" +
        "x".repeat(120),
    apiContractsContent:
      live().apiContractsContent ??
      "| Método | Ruta | Descripción |\n| --- | --- | --- |\n| GET | /api/v1/sessions | Listar sesiones |\n" +
        "x".repeat(120),
    logicFlowsContent:
      live().logicFlowsContent ??
      "### Flujo de sesiones\nEl usuario lista sesiones mediante GET /api/v1/sessions.\n" +
        "x".repeat(120),
    architectureContent:
      live().architectureContent ??
      "# Arquitectura\n- modules/sessions\n" + "x".repeat(120),
    infraContent:
      live().infraContent ??
      "# Infra\nDocker Compose con PostgreSQL y NestJS.\n" + "x".repeat(120),
    tasksContent:
      live().tasksContent ??
      "# Tasks\n- Migración Prisma para tabla sessions.id\n- Configurar publisher y consumer RabbitMQ\n" +
        "x".repeat(120),
    useCasesContent: null,
    userStoriesContent: null,
    uiScreensContent: null,
    phase0SummaryContent: null,
    specContent: null,
    uxUiGuideContent: null,
    stages: [
      {
        id: "stage-1",
        ordinal: 1,
        workflowStatus: "ACTIVE",
        mddContent: state.stageMdd,
        brdContent: live().brdContent ?? BRD_WITH_TRACE_GAP,
        domainInventory: null,
        legacyChangeState: null,
        shortTermContext: overrides?.shortTermContext ?? null,
      },
    ],
  });

  const prisma = {
    project: {
      findFirst: async () => makeProject(),
      findUnique: async () => makeProject(),
    },
    stage: {
      findUnique: async () => ({ shortTermContext: state.dbContext }),
      update: async ({
        data,
      }: {
        data: { mddContent?: string; shortTermContext?: Record<string, unknown> };
      }) => {
        if (typeof data.mddContent === "string") {
          state.stageMdd = data.mddContent;
          state.stageUpdates.push(data.mddContent);
        }
        if (data.shortTermContext) state.dbContext = data.shortTermContext;
        return {};
      },
    },
  };

  const projects = {
    findOne: async () => makeProject(),
    assertDeliverablesAllowed: async () => undefined,
    update: async () => makeProject(),
    generateDocument: async (
      kind: string,
      _projectId: string,
      options?: { gapsFeedback?: string | null; acknowledgeGaps?: boolean },
    ) => {
      if (overrides?.rejectGenerateWith) throw new Error(overrides.rejectGenerateWith);
      state.generatedDocs.push({
        kind,
        gapsFeedback: options?.gapsFeedback,
        acknowledgeGaps: options?.acknowledgeGaps,
      });
      overrides?.onGenerate?.(kind, state);
    },
  };

  const uiScreens = {
    syncUiScreens: async () => {
      state.uiScreensSynced++;
    },
  };

  const stageSemaphoreSync = {
    syncFromPersisted: async () => {
      state.semaphoreSynced++;
    },
  };

  const conformance = new ConformanceService();
  const service = new DeliverablesCascadeService(
    prisma as never,
    projects as never,
    uiScreens as never,
    conformance,
    stageSemaphoreSync as never,
  );

  return { service, state };
}

test("repairReadinessGaps rutea [Events] y [Integración] multi-artefacto, propaga acknowledgeGaps y parcha trazabilidad BRD→MDD", async () => {
  const { service, state } = createHarness();

  await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );

  // 1) Trazabilidad BRD → MDD parcheada y persistida en Stage.mddContent
  assert.ok(state.stageUpdates.length >= 1, "debe actualizar Stage.mddContent con el parche BRD→MDD");
  const afterTrace = computeCrossDocumentConsistency({
    brdContent: BRD_WITH_TRACE_GAP,
    mddContent: state.stageMdd,
  });
  assert.equal(afterTrace.gaps.length, 0, "el parche BRD→MDD debe cerrar las brechas de trazabilidad");

  // 2) Rutea [Events] logic-flows → logic_flows y [Integración websocket_gateway] → api_contracts + architecture + infra
  const kinds = state.generatedDocs.map((d) => d.kind);
  assert.ok(kinds.includes("logic_flows"), `debe regenerar logic_flows, regeneró: ${kinds.join(", ")}`);
  assert.ok(kinds.includes("api_contracts"), `debe regenerar api_contracts, regeneró: ${kinds.join(", ")}`);
  assert.ok(kinds.includes("architecture"), `debe regenerar architecture, regeneró: ${kinds.join(", ")}`);
  assert.ok(kinds.includes("infra"), `debe regenerar infra, regeneró: ${kinds.join(", ")}`);

  // 3) Propaga acknowledgeGaps: true a cada generateDocument para no ser bloqueado por HUMAN [BRD decision log]
  for (const call of state.generatedDocs) {
    assert.equal(
      call.acknowledgeGaps,
      true,
      `generateDocument(${call.kind}) debe recibir acknowledgeGaps=true`,
    );
  }

  // 4) Feedback dirigido a cada entregable correcto
  const lfCall = state.generatedDocs.find((d) => d.kind === "logic_flows");
  assert.ok(lfCall?.gapsFeedback?.includes("[Events]"), "logic_flows debe recibir el feedback [Events]");
  const archCall = state.generatedDocs.find((d) => d.kind === "architecture");
  assert.ok(
    archCall?.gapsFeedback?.includes("websocket_gateway"),
    "architecture debe recibir el feedback [Integración websocket_gateway]",
  );
  const infraCall = state.generatedDocs.find((d) => d.kind === "infra");
  assert.ok(
    infraCall?.gapsFeedback?.includes("websocket_gateway"),
    "infra debe recibir el feedback [Integración websocket_gateway]",
  );

  assert.equal(state.semaphoreSynced, 1);
});

test("repairReadinessGaps NO se detiene cuando hay <= 5 brechas transversales (gapTolerance=0)", async () => {
  const mddClean = `# MDD — Demo

## 1. Contexto y Alcance
Sistema de sesiones de videoconsulta.

## 2. Arquitectura y Stack
- NestJS + PostgreSQL + RabbitMQ (broker primario).

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY
);
\`\`\`

## 4. Contratos de API
| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | /api/v1/sessions | Listar sesiones |
| POST | /api/v1/sessions | Crear sesión |

## 5. Lógica de Negocio
- Flujo de sesiones con creación y listado.
`;
  const blueprintClean =
    `### 2. Persistencia y datos\n### sessions\n\n### Arquitectura\nArquitectura event-driven con RabbitMQ.\n` +
    "Detalle técnico del blueprint de sesiones y servicios NestJS.\n".repeat(4);
  const apiClean =
    `| Método | Ruta | Descripción |\n| --- | --- | --- |\n| GET | /api/v1/sessions | Listar sesiones |\n| POST | /api/v1/sessions | Crear sesión |\n` +
    "Contratos HTTP de sesiones.\n".repeat(4);
  const logicFlowsMissingEvents =
    `### Flujo de sesiones\nEl usuario lista y crea sesiones mediante GET /api/v1/sessions y POST /api/v1/sessions.\n` +
    "Flujo únicamente síncrono vía HTTP REST sin colas asíncronas.\n".repeat(4);
  const archClean = `# Arquitectura\n- modules/sessions\n` + "Módulos del sistema.\n".repeat(4);
  const infraClean = `# Infra\nPostgreSQL, NestJS y RabbitMQ (amqp).\n` + "Infraestructura.\n".repeat(4);
  const tasksClean =
    `# Tasks\n- Migración Prisma sessions.id\n- Publisher y consumer RabbitMQ\n` + "Tareas.\n".repeat(4);

  const preGaps = collectConformanceGaps(new ConformanceService(), mddClean, {
    blueprintContent: blueprintClean,
    apiContractsContent: apiClean,
    logicFlowsContent: logicFlowsMissingEvents,
    architectureContent: archClean,
    infraContent: infraClean,
    tasksContent: tasksClean,
    mddContent: mddClean,
    brdContent: null,
    dbgaContent: null,
  });
  assert.ok(preGaps.length >= 1 && preGaps.length <= 5, `esperaba 1..5 gaps, obtuve ${preGaps.length}: ${preGaps.join(" | ")}`);

  const { service, state } = createHarness({
    mddContent: mddClean,
    brdContent: "",
    dbgaContent: null,
    blueprintContent: blueprintClean,
    apiContractsContent: apiClean,
    logicFlowsContent: logicFlowsMissingEvents,
    architectureContent: archClean,
    infraContent: infraClean,
    tasksContent: tasksClean,
  });

  await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );

  assert.ok(
    state.generatedDocs.some((d) => d.kind === "logic_flows"),
    `con <= 5 gaps debe regenerar logic_flows, regeneró: ${state.generatedDocs.map((d) => d.kind).join(", ")}`,
  );
});

const CLEAN = (() => {
  const mdd = `# MDD — Demo

## 1. Contexto y Alcance
Sistema de sesiones de videoconsulta.

## 2. Arquitectura y Stack
- NestJS + PostgreSQL + RabbitMQ (broker primario).

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY
);
\`\`\`

## 4. Contratos de API
| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | /api/v1/sessions | Listar sesiones |
| POST | /api/v1/sessions | Crear sesión |

## 5. Lógica de Negocio
- Flujo de sesiones con creación y listado.
`;
  return {
    mddContent: mdd,
    brdContent: "",
    dbgaContent: null,
    blueprintContent:
      `### 2. Persistencia y datos\n### sessions\n\n### Arquitectura\nArquitectura event-driven con RabbitMQ.\n` +
      "Detalle técnico del blueprint de sesiones y servicios NestJS.\n".repeat(4),
    apiContractsContent:
      `| Método | Ruta | Descripción |\n| --- | --- | --- |\n| GET | /api/v1/sessions | Listar sesiones |\n| POST | /api/v1/sessions | Crear sesión |\n` +
      "Contratos HTTP de sesiones.\n".repeat(4),
    logicFlowsContent:
      `### Flujo de sesiones\nEl usuario lista y crea sesiones mediante GET /api/v1/sessions y POST /api/v1/sessions.\n` +
      "Flujo únicamente síncrono vía HTTP REST sin colas asíncronas.\n".repeat(4),
    architectureContent: `# Arquitectura\n- modules/sessions\n` + "Módulos del sistema.\n".repeat(4),
    infraContent: `# Infra\nPostgreSQL, NestJS y RabbitMQ (amqp).\n` + "Infraestructura.\n".repeat(4),
    tasksContent:
      `# Tasks\n- Migración Prisma sessions.id\n- Publisher y consumer RabbitMQ\n` + "Tareas.\n".repeat(4),
  };
})();

test("repairReadinessGaps informa errores de generateDocument (paso y mensaje)", async () => {
  const { service } = createHarness({ ...CLEAN, rejectGenerateWith: "LLM caído" });
  const res = await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );
  assert.ok(res.repair.errors.length >= 1, "debe registrar al menos un error");
  assert.equal(res.repair.errors[0]?.message, "LLM caído");
  assert.ok((res.repair.errors[0]?.step ?? "").length > 0);
  assert.equal(res.project.id, "proj-1");
});

test("repairReadinessGaps con solo brechas humanas devuelve stoppedReason human_only y fixed vacío", async () => {
  const { service, state } = createHarness({
    ...CLEAN,
    logicFlowsContent:
      `### Flujo de sesiones\nGET /api/v1/sessions y POST /api/v1/sessions.\n` +
      "Publica eventos de sesión en RabbitMQ (publisher) y los consume (consumer) por cola amqp.\n".repeat(4),
    blueprintContent: CLEAN.blueprintContent + "PostgreSQL como base relacional.\n",
    apiContractsContent: CLEAN.apiContractsContent + "Eventos vía RabbitMQ publisher/consumer.\n",
    architectureContent: CLEAN.architectureContent + "Arquitectura event-driven con RabbitMQ.\n",
    brdContent: "# BRD — Demo\n\n## Decision log\n| Tema | Estado | Dueño | Plazo |\n| --- | --- | --- | --- |\n| Tarifas exactas | Por validar | Negocio | Q1 |\n".padEnd(260, " "),
  });
  const res = await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );
  assert.equal(state.generatedDocs.length, 0, `no debe regenerar nada: ${state.generatedDocs.map((d) => `${d.kind}:${d.gapsFeedback}`).join(" || ")}`);
  assert.equal(res.repair.stoppedReason, "human_only", JSON.stringify(res.repair));
  assert.deepEqual(res.repair.fixed, []);
  assert.ok(res.repair.remaining.human >= 1, JSON.stringify(res.repair));
  assert.equal(res.repair.remaining.llm, 0);
});

test("repairReadinessGaps lista en fixed la brecha que desaparece tras regenerar", async () => {
  const { service } = createHarness({
    ...CLEAN,
    onGenerate: (kind, st) => {
      if (kind === "logic_flows") {
        st.overrides.logicFlowsContent =
          `### Flujo de sesiones\nEl usuario lista y crea sesiones mediante GET /api/v1/sessions y POST /api/v1/sessions.\n` +
          "Publica eventos de sesión en RabbitMQ (publisher) y los consume (consumer) por cola amqp.\n".repeat(4);
      }
    },
  });
  const res = await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );
  assert.ok(
    res.repair.fixed.some((g) => g.includes("[Events]")),
    `fixed debe incluir [Events], obtuvo: ${res.repair.fixed.join(" | ")} / remaining ${JSON.stringify(res.repair.remaining)}`,
  );
});

test("repairReadinessGaps: corrección parcial de [Integración] no cuenta como corregida y sigue pendiente", async () => {
  const { service } = createHarness({
    onGenerate: (kind, st) => {
      // Solo API contracts menciona websocket: el gap agregado pasa de «API, Architecture, Infra» a «Architecture, Infra».
      if (kind === "api_contracts") {
        st.overrides.apiContractsContent =
          "| Método | Ruta | Descripción |\n| --- | --- | --- |\n| GET | /api/v1/sessions | Listar sesiones |\n" +
          "Eventos en tiempo real por websocket en /ws.\n" +
          "x".repeat(120);
      }
    },
  });
  const res = await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );
  assert.ok(
    !res.repair.fixed.some((g) => g.startsWith("[Integración websocket_gateway]")),
    `no debe contar la integración parcial como corregida: ${res.repair.fixed.join(" | ")}`,
  );
  assert.ok(res.repair.remaining.llm >= 1, JSON.stringify(res.repair));
});

test("repairReadinessGaps sin MDD (alta complejidad) devuelve stoppedReason no_mdd sin regenerar", async () => {
  const { service, state } = createHarness({ ...CLEAN, mddContent: "" });
  const res = await runWithRequestUserAsync("user-1", () =>
    service.repairReadinessGaps("proj-1", { acknowledgeGaps: true }),
  );
  assert.equal(res.repair.stoppedReason, "no_mdd", JSON.stringify(res.repair));
  assert.deepEqual(res.repair.fixed, []);
  assert.deepEqual(res.repair.remaining, { auto: 0, llm: 0, human: 0 });
  assert.equal(state.generatedDocs.length, 0);
});

test("el bucle de convergencia devuelve stoppedReason budget cuando el circuit breaker se agota", async () => {
  const { service, state } = createHarness();
  const loop = await runWithRequestUserAsync("user-1", () =>
    (
      service as unknown as {
        runCascadeConvergenceLoop: (
          projectId: string,
          cb: CascadeCircuitBreaker,
          opts: { gapTolerance: number; includeBrdTraceabilityRepair: boolean; acknowledgeGaps: boolean },
        ) => Promise<{ stoppedReason: string }>;
      }
    ).runCascadeConvergenceLoop("proj-1", new CascadeCircuitBreaker(1), {
      gapTolerance: 0,
      includeBrdTraceabilityRepair: true,
      acknowledgeGaps: true,
    }),
  );
  assert.equal(loop.stoppedReason, "budget");
  assert.equal(state.generatedDocs.length, 1, "solo alcanza el presupuesto para una regeneración");
});

test("generateDeliverablesDelta limpia pendingCascadeDelta sin pisar el semaphoreSync refrescado tras el sync", async () => {
  const { service, state } = createHarness({
    ...CLEAN,
    shortTermContext: {
      otro: 1,
      semaphoreSync: { version: 1, inputsHash: "viejo" },
      pendingCascadeDelta: { affectedDeliverables: ["tasks"] },
    },
  });
  const priv = service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  priv.runDeliverableWaveStep = async () => undefined;
  priv.runCascadePostPassRetry = async () => undefined;
  priv.runCascadeDeterministicConformancePass = async () => undefined;
  priv.runCascadeConformanceRetry = async () => undefined;
  priv.runCascadeConvergenceLoop = async () => undefined;
  // Simula al sync: refresca el hash directamente en la BD (el snapshot inicial queda obsoleto).
  priv.syncSemaphoreAfterCascade = async () => {
    state.dbContext = {
      ...(state.dbContext ?? {}),
      semaphoreSync: { version: 1, inputsHash: "nuevo" },
    };
  };
  await runWithRequestUserAsync("user-1", () => service.generateDeliverablesDelta("proj-1"));
  assert.equal(state.dbContext?.pendingCascadeDelta, null);
  assert.deepEqual(state.dbContext?.semaphoreSync, { version: 1, inputsHash: "nuevo" });
  assert.equal(state.dbContext?.otro, 1);
});
