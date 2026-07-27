/**
 * Contract tests — forma de respuesta de `AiOrchestratorService.chat` (Fase 0).
 * Mocks de ports; sin HTTP ni LLM real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "@theforge/shared-types";
import { AiOrchestratorService } from "./ai-orchestrator.service.js";
import type { IOrchestratorProjectsPort } from "../projects/projects-service.port.js";
import type { IOrchestratorTheForgePort } from "../theforge/theforge-service.port.js";
import type { SessionsService } from "../sessions/sessions.service.js";
import type { AgentSupervisorService } from "../agent-supervisor/agent-supervisor.service.js";
import type { AgentEvaluatorService } from "../agent-supervisor/agent-evaluator.service.js";

const STAGE_ID = "stage-contract-1";
const PROJECT_ID = "proj-contract-1";
const SESSION_ID = "sess-contract-1";

const MDD_BODY = [
  "# Master Design Document",
  "",
  "## 1. Contexto",
  "",
  "Producto de prueba con contenido suficiente para contrato de chat del orquestador.",
  "",
  "## 2. Arquitectura y Stack",
  "",
  "NestJS + PostgreSQL.",
  "",
  "---FIN_MDD---",
  "",
  "MDD actualizado.",
].join("\n");

function mockProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    mddContent: null,
    dbgaContent: null,
    uxUiGuideContent: null,
    phase0SummaryContent: null,
    complexityPending: null,
    projectType: "NEW",
    uxGuideDesignRef: null,
    blueprintContent: null,
    stages: [{ id: STAGE_ID, mddContent: null, brdContent: null }],
    ...overrides,
  };
}

function mockSession(chatLog: ChatMessage[] = []) {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    chatLog,
    contextStep: "CONTEXT",
  };
}

function buildOrchestrator(mocks: {
  chatResult: Awaited<ReturnType<SessionsService["chat"]>>;
  project?: ReturnType<typeof mockProject>;
}) {
  const project = mocks.project ?? mockProject();
  let projectRef = { ...project };

  const projects = {
    findOne: async () => projectRef,
    update: async (_id: string, data: Record<string, unknown>) => {
      projectRef = { ...projectRef, ...data };
      return projectRef;
    },
    tryConfirmComplexityFromChatMessage: async () => ({ confirmed: false, rejected: false }),
    patchStage: async () => projectRef,
  } satisfies IOrchestratorProjectsPort;

  const sessions = {
    findOne: async () => mockSession(mocks.chatResult.session?.chatLog as ChatMessage[] ?? []),
    findByProject: async () => [mockSession()],
    create: async () => mockSession(),
    chat: async () => mocks.chatResult,
  } as unknown as SessionsService;

  const theforge = {
    askCodebase: async () => "",
  } satisfies IOrchestratorTheForgePort;

  const agentSupervisor = {
    resolveRouteFromProject: async () => ({
      flow: "NEW" as const,
      stageId: STAGE_ID,
    }),
    getRecentEpisodicMemory: async () => [],
  } as unknown as AgentSupervisorService;

  const agentEvaluator = {
    evaluateLegacyProposal: async () => ({ approved: true, critique: "" }),
  } as unknown as AgentEvaluatorService;

  const upstreamPropagate = {
    propagateFromChat: async () => ({ queued: false }),
  } as unknown as import("../projects/upstream-propagate.service.js").UpstreamPropagateService;

  return new AiOrchestratorService(
    sessions,
    projects,
    theforge,
    agentSupervisor,
    agentEvaluator,
    upstreamPropagate,
  );
}

const ORCHESTRATOR_RESPONSE_KEYS = [
  "session",
  "project",
] as const;

describe("AiOrchestratorService.chat contract (Fase 0)", () => {
  it("tab mdd: respuesta incluye session, project y campos opcionales conocidos", async () => {
    const session = mockSession([
      { role: "user", content: "Agrega Redis", tab: "mdd" },
      { role: "assistant", content: MDD_BODY, tab: "mdd" },
    ]);
    const orchestrator = buildOrchestrator({
      chatResult: {
        session,
        mddContent: MDD_BODY.split("---FIN_MDD---")[0]?.trim(),
        documentHadDelimiter: true,
        documentPersisted: true,
        documentAst: null,
        documentVersion: null,
      },
    });

    const result = await orchestrator.chat(
      PROJECT_ID,
      "Agrega Redis",
      SESSION_ID,
      undefined,
      "mdd",
    );

    for (const key of ORCHESTRATOR_RESPONSE_KEYS) {
      assert.ok(key in result, `missing key: ${key}`);
    }
    assert.ok(result.session);
    assert.ok(result.project);
    assert.equal(typeof result.session?.id, "string");
    assert.equal(result.project?.id, PROJECT_ID);
    if (result.documentPersist) {
      assert.equal(typeof result.documentPersist.saved, "boolean");
      assert.equal(typeof result.documentPersist.parsedFromResponse, "boolean");
    }
  });

  it("tab spec: delega en sessions.chat y devuelve project actualizado", async () => {
    const specDoc = "# Spec\n\n## Alcance\n\nDetalle.\n\n---FIN_SPEC---\n\nListo.";
    const session = mockSession([
      { role: "assistant", content: specDoc, tab: "spec" },
    ]);
    const orchestrator = buildOrchestrator({
      chatResult: {
        session,
        specContent: "# Spec\n\n## Alcance\n\nDetalle.",
        documentHadDelimiter: true,
        documentPersisted: true,
      },
      project: mockProject({ specContent: null }),
    });

    const result = await orchestrator.chat(
      PROJECT_ID,
      "Actualiza el spec",
      SESSION_ID,
      undefined,
      "spec",
    );

    assert.ok(result.session);
    assert.ok(result.project);
    assert.equal(result.evaluatorCritique, undefined);
  });
});
