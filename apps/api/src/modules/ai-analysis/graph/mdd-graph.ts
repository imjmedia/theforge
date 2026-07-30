import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph/web";
import type { LivePrecisionCalculator } from "../estimation/estimation.types.js";
import { createMddAskInitialTopicNode } from "../nodes/mdd-ask-initial-topic.node.js";
import { createMddClarifierNode } from "../nodes/mdd-clarifier.node.js";
import { createMddSoftwareArchitectNode } from "../nodes/mdd-software-architect.node.js";
import { createMddArchitectCriticNode } from "../nodes/mdd-architect-critic.node.js";
import { createMddFormatterNode } from "../nodes/mdd-formatter.node.js";
import { createMddDiagramInjectorNode } from "../nodes/mdd-diagram-injector.node.js";
import { createMddSecurityNode } from "../nodes/mdd-security.node.js";
import { createMddIntegrationNode } from "../nodes/mdd-integration.node.js";
import { createMddSection5Node } from "../nodes/mdd-section5.node.js";
import { createMddTailParallelNode } from "../nodes/mdd-tail-parallel.node.js";
import { createMddPostCriticParallelNode } from "../nodes/mdd-post-critic-parallel.node.js";
import { createMddDataModelPatchNode } from "../nodes/mdd-data-model-patch.node.js";
import { isTableOnlyCriticGap } from "../utils/mdd-data-model-patch.util.js";
import { isMddTailParallelEnabled } from "../utils/mdd-tail-parallel.config.js";
import { createMddSecurityIntegrationNode } from "../nodes/mdd-security-integration.node.js";
// `createMddLlmFormatterNode` import ELIMINADO: el nodo llm_formatter fue
// removido del grafo por ser destructivo. El factory se conserva en
// mdd-llm-formatter.node.ts (marcado @deprecated) por si alguien lo quiere
// reintroducir con un skip heurístico más estricto.
import { createMddAuditorNode } from "../nodes/mdd-auditor.node.js";
import { createMddManagerNode, type MddManagerToolDeps } from "../nodes/mdd-manager.node.js";
import { createMddPlanApprovalNode } from "../nodes/mdd-plan-approval.node.js";
import { createMddExecutorNode } from "../nodes/mdd-executor.node.js";
import { createMddMergeSection1Node } from "../nodes/mdd-merge-section1.node.js";
import { createMddStructuredHydratorNode } from "../nodes/mdd-structured-hydrator.node.js";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import { createMddCrossConsistencyNode } from "../nodes/mdd-cross-consistency.node.js";
import { createMddFormatSecIntNode } from "../nodes/mdd-format-sec-int.node.js";
import { createMddPrepareOutputNode } from "../nodes/mdd-prepare-output.node.js";
import { createMddBlackboardNode } from "../nodes/mdd-blackboard.node.js";
import { draftHasSubstantialSections6And7 } from "../utils/mdd-delivery-gate-loop.util.js";
import { draftHasSubstantialSection2 } from "../utils/mdd-section-preserve.util.js";
import { draftIsSubstantialForScopedRepair, isScopedSectionSealed } from "../utils/mdd-section-preserve.util.js";
import { mddStateHasDomainAuthSkew } from "../utils/mdd-domain-prompt.util.js";
import { detectSection3CompositionBlockers } from "../utils/schema-owner.util.js";
import type { UserLLMRuntime } from "../../ai/providers/llm-runtime.types.js";
import { createDbgaLLM, createDbgaLLMFromRuntime, createMddApiContractsChunkLlmFromRuntime, createMddAuditorLLM, createMddHighComplexityLLM, resolveMddArchitectScopeMaxTokens } from "../llm/create-dbga-llm.js";
import type { AIFactory } from "../../ai/ai.factory.js";
import { getMddAuditorTools, getMddArchitectTools } from "../tools/tool-registry.js";
import type { TheForgeService } from "../../theforge/theforge.service.js";
import { MDDStateAnnotation, type MDDStateType } from "../state/index.js";
import type { NodeCacheService } from "../checkpoint/node-cache.service.js";
import {
  clarifierInput,
  softwareArchitectInput,
  securityInput,
  integrationInput,
  securityIntegrationInput,
  crossConsistencyInput,
} from "../checkpoint/node-input-hash.js";
import { isHighSplitArchitectPipeline } from "../utils/mdd-architect-pipeline.util.js";

const MAX_MDD_ITERATIONS = 2;

/** Auditor score-only: no re-enrutar tras primera pasada. */
function shouldSkipAuditor(state: MDDStateType): boolean {
  return state.auditorRan === true;
}

/** Gate loop: tras fix del nodo dueño, volver a prepare_output sin re-pipeline completo. */
function shouldShortCircuitGateLoopFix(state: MDDStateType): boolean {
  return state.deliveryGateLoopActive === true;
}

function routeAuditorOrPrepareOutput(state: MDDStateType): string {
  return shouldSkipAuditor(state) ? "prepare_output" : "auditor";
}

/** Temperatura baja para nodos estructurales (architect/security/integration): reproducibilidad de diseño. */
const STRUCTURAL_TEMPERATURE = 0.2;

async function resolveStructuralRuntime(
  aiFactory: AIFactory,
  userId: string,
  preflight?: UserLLMRuntime | null,
): Promise<UserLLMRuntime> {
  return preflight ?? aiFactory.resolveRuntime(userId);
}

function createTailStructuralLlm(runtime: UserLLMRuntime): ReturnType<typeof createDbgaLLMFromRuntime> {
  return createDbgaLLMFromRuntime(runtime, {
    temperature: STRUCTURAL_TEMPERATURE,
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("security"),
  });
}

// ---------------------------------------------------------------------------
// Cache wrapper — wraps an LLM node function so it checks the in-memory
// cache before executing.  On a cache hit the LLM call is skipped entirely.
// ---------------------------------------------------------------------------

type NodeFn = (state: MDDStateType) => Partial<MDDStateType> | Promise<Partial<MDDStateType>>;
type InputHashFn = (state: MDDStateType) => Record<string, unknown>;

function createScopedArchitectNode(
  nodeName: "stack_architect" | "data_model" | "api_contracts",
  scope: "stack" | "data_model" | "api_contracts",
  structuralLlm: Awaited<ReturnType<typeof createDbgaLLM>>,
  architectTools: ReturnType<typeof getMddArchitectTools>,
  compileOptions: MddGraphCompileOptions | undefined,
  nodeCache: NodeCacheService | null,
  onNodeStart?: (nodeName: string) => void,
): NodeFn {
  return wrapNodeStart(
    nodeName,
    wrapCache(
      nodeCache,
      nodeName,
      softwareArchitectInput,
      createMddSoftwareArchitectNode(structuralLlm, architectTools, {
        theforge: compileOptions?.theforge ?? null,
        uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
        scope,
      }),
    ),
    onNodeStart,
  );
}

function wrapNodeStart(
  nodeName: string,
  nodeFn: NodeFn,
  onNodeStart?: (nodeName: string) => void,
): NodeFn {
  if (!onNodeStart) return nodeFn;
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    onNodeStart(nodeName);
    return Promise.resolve(nodeFn(state));
  };
}

function wrapCache(
  cache: NodeCacheService | null,
  nodeName: string,
  getInput: InputHashFn,
  nodeFn: NodeFn,
): NodeFn {
  if (!cache) return nodeFn;
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const projectId = state.projectId;
    const key = cache.key(nodeName, projectId, getInput(state));
    const cached = cache.get(key);
    if (cached !== undefined) {
      console.log(`[MDD:Cache] HIT ${nodeName} (key=${key})`);
      return cached;
    }
    const result = await nodeFn(state);
    cache.set(key, result);
    return result;
  };
}

/** Opciones al compilar el grafo MDD (p. ej. TheForge MCP para herramientas del Arquitecto en legacy). */
export type MddGraphCompileOptions = {
  theforge?: TheForgeService | null;
  /** Cache por nodo para evitar re-ejecutar LLM si el input no cambió. */
  nodeCache?: NodeCacheService | null;
  /** Librería del MCP gráfico activo (§2 Frontend → UI Library). */
  uiMcpFrontendLibraryLabel?: string | null;
  /** Emite progreso «activo» al iniciar cada nodo (polling MDD). */
  onNodeStart?: (nodeName: string) => void;
  /** Runtime tras sonda MDD (modelo reordenado si el principal falló). */
  preflightRuntime?: UserLLMRuntime | null;
  /** Prisma para persistir ADRs extraídos al hidratar mddStructured. */
  prisma?: PrismaService | null;
};

/**
 * Builds and compiles the MDD StateGraph (one-shot, no Manager).
 * Flow: … → Auditor → (score < 85 && iteration < MAX ? Manager asigna gaps a agentes : END).
 * Los agentes generan contenido; el formateador (sin LLM) normaliza mddDraft; Redactor eliminado (documento unificado por merge + render).
 */
export async function createMddGraph(
  aiFactory: AIFactory,
  userId: string,
  options?: MddGraphCompileOptions,
) {
  const structuralRuntime = await resolveStructuralRuntime(aiFactory, userId, options?.preflightRuntime);
  const llm = options?.preflightRuntime
    ? createDbgaLLMFromRuntime(options.preflightRuntime)
    : await createDbgaLLM(aiFactory, userId);
  const section5Llm = createDbgaLLMFromRuntime(structuralRuntime, {
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("section5"),
  });
  const structuralLlm = createTailStructuralLlm(structuralRuntime);
  const stackLlm = createDbgaLLMFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("stack"),
  });
  const apiContractsLlm = createDbgaLLMFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("api_contracts"),
  });
  const apiContractsChunkLlm = createMddApiContractsChunkLlmFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
  });
  const highComplexityLlm = await createMddHighComplexityLLM(aiFactory, userId, {
    temperature: STRUCTURAL_TEMPERATURE,
  });
  const auditorLlm = await createMddAuditorLLM(aiFactory, userId);
  const nodeCache = options?.nodeCache ?? null;
  const onNodeStart = options?.onNodeStart;

  const clarifierNode = wrapNodeStart(
    "clarifier",
    wrapCache(nodeCache, "clarifier", clarifierInput, createMddClarifierNode(llm)),
    onNodeStart,
  );
  const softwareArchitectNode = wrapNodeStart(
    "software_architect",
    wrapCache(
      nodeCache,
      "software_architect",
      softwareArchitectInput,
      createMddSoftwareArchitectNode(structuralLlm, getMddArchitectTools(), {
        theforge: options?.theforge ?? null,
        uiMcpFrontendLibraryLabel: options?.uiMcpFrontendLibraryLabel ?? null,
        scope: "full",
      }),
    ),
    onNodeStart,
  );
  const stackArchitectNode = createScopedArchitectNode(
    "stack_architect",
    "stack",
    stackLlm,
    getMddArchitectTools(),
    options,
    nodeCache,
    onNodeStart,
  );
  const dataModelNode = createScopedArchitectNode(
    "data_model",
    "data_model",
    highComplexityLlm,
    getMddArchitectTools(),
    options,
    nodeCache,
    onNodeStart,
  );
  const apiContractsNode = createScopedArchitectNode(
    "api_contracts",
    "api_contracts",
    apiContractsLlm,
    getMddArchitectTools(),
    options,
    nodeCache,
    onNodeStart,
  );
  const architectCriticNode = wrapNodeStart(
    "architect_critic",
    createMddArchitectCriticNode(llm),
    onNodeStart,
  );
  const formatterNode = (nodeName: string) =>
    wrapNodeStart(nodeName, createMddFormatterNode(), onNodeStart);
  // Primera pasada: Security + Integration en un solo nodo con Promise.all (paralelo real,
  // ahorra ~60s vs secuencial). Los nodos individuales se conservan solo para el auto-loop
  // del delivery gate (prepare_output → integration) y regeneración por sección.
  const securityIntegrationNode = wrapNodeStart(
    "security_integration",
    wrapCache(
      nodeCache,
      "security_integration",
      securityIntegrationInput,
      createMddSecurityIntegrationNode(structuralLlm),
    ),
    onNodeStart,
  );
  const integrationNode = wrapNodeStart(
    "integration",
    wrapCache(nodeCache, "integration", integrationInput, createMddIntegrationNode(structuralLlm)),
    onNodeStart,
  );
  const formatSecIntNode = wrapNodeStart("format_sec_int", createMddFormatSecIntNode(), onNodeStart);
  const diagramInjectorNode = wrapNodeStart(
    "diagram_injector",
    createMddDiagramInjectorNode(),
    onNodeStart,
  );
  const consistencyNode = wrapNodeStart(
    "cross_consistency_checker",
    wrapCache(
      nodeCache,
      "cross_consistency",
      crossConsistencyInput,
      createMddCrossConsistencyNode(auditorLlm),
    ),
    onNodeStart,
  );
  // `llm_formatter` (mdd-llm-formatter.node.ts) ELIMINADO del grafo: era destructivo.
  // Re-generaba el markdown desde mddStructured via LLM, perdiendo el formato
  // que los formatters deterministas (format_after_architect, format_sec_int,
  // format_after_redactor) ya habían producido. En pasadas posteriores (ej. tras
  // section5 regen) el skip heurístico podía fallar y el LLM re-formateaba
  // con resultado peor que el original. Confiamos en los 3 formatters
  // deterministas + el substance check del delivery gate. Ver CHANGELOG
  // [Unreleased] → Fixed → "Eliminación del LLM formatter destructivo".
  const auditorNode = wrapNodeStart(
    "auditor",
    createMddAuditorNode(auditorLlm, getMddAuditorTools(), null),
    onNodeStart,
  );
  const structuredHydratorNode = wrapNodeStart(
    "structured_hydrator",
    createMddStructuredHydratorNode(llm, options?.prisma ?? null),
    onNodeStart,
  );
  const prepareOutputNode = wrapNodeStart(
    "prepare_output",
    createMddPrepareOutputNode({
      uiMcpLibraryLabel: options?.uiMcpFrontendLibraryLabel ?? null,
    }),
    onNodeStart,
  );
  // Dedicated §5 pass: regenera SOLO §5 cuando el substance check falla
  // únicamente en §5. CHANGELOG [Unreleased] → Added → "Dedicated §5 pass".
  const section5Input = (s: MDDStateType): Record<string, unknown> => ({
    mddDraft: s.mddDraft ?? "",
    clarifiedScope: s.clarifiedScope ?? "",
    dbgaContent: s.dbgaContent ?? "",
  });
  const section5Node = wrapNodeStart(
    "section5",
    wrapCache(nodeCache, "section5", section5Input, createMddSection5Node(section5Llm)),
    onNodeStart,
  );
  const tailParallelNode = wrapNodeStart(
    "tail_parallel",
    wrapCache(
      nodeCache,
      "tail_parallel",
      (s) => ({ mddDraft: s.mddDraft ?? "", dbgaContent: s.dbgaContent ?? "" }),
      createMddTailParallelNode(llm, structuralLlm),
    ),
    onNodeStart,
  );
  const apiContractsFastArchitectNode = apiContractsChunkLlm
    ? createScopedArchitectNode(
        "api_contracts",
        "api_contracts",
        apiContractsChunkLlm,
        getMddArchitectTools(),
        options,
        nodeCache,
        onNodeStart,
      )
    : null;
  const postCriticParallelNode = wrapNodeStart(
    "post_critic_parallel",
    wrapCache(
      nodeCache,
      "post_critic_parallel",
      softwareArchitectInput,
      createMddPostCriticParallelNode(structuralLlm, {
        apiContractsFn: async (state) => apiContractsNode(state),
        ...(apiContractsFastArchitectNode
          ? {
              apiContractsChunkFn: async (chunkIndex, state) =>
                chunkIndex === 0 ? apiContractsNode(state) : apiContractsFastArchitectNode(state),
            }
          : {}),
      }),
    ),
    onNodeStart,
  );
  const dataModelPatchNode = wrapNodeStart(
    "data_model_patch",
    wrapCache(
      nodeCache,
      "data_model_patch",
      softwareArchitectInput,
      createMddDataModelPatchNode(highComplexityLlm),
    ),
    onNodeStart,
  );

  function routeAfterSection5OneShot(state: MDDStateType): string {
    if (state.deliveryGateLoopActive === true && state.deliveryGateFixTarget === "section5") {
      return "prepare_output";
    }
    if (state.section5FormatSkipped === true) {
      return "format_after_redactor";
    }
    return "format_after_architect";
  }

  function shouldUsePostCriticParallel(state: MDDStateType): boolean {
    return isMddTailParallelEnabled() && isHighSplitArchitectPipeline(state);
  }

  function routeAfterPrepareOutput(state: MDDStateType): string {
    if (state.deliveryGateLoopActive === true) {
      if (state.deliveryGateFixTarget === "integration") return "integration";
      if (state.deliveryGateFixTarget === "clarifier") return "clarifier";
      if (state.deliveryGateFixTarget === "section5") return "section5";
      if (state.deliveryGateFixTarget === "stack_architect") return "stack_architect";
      if (state.deliveryGateFixTarget === "data_model") return "data_model";
      if (state.deliveryGateFixTarget === "api_contracts") return "api_contracts";
      return "software_architect";
    }
    return "structured_hydrator";
  }

  function routeAfterFormatArchitectGateLoop(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    if (state.postCriticParallelDone === true) {
      return "format_after_redactor";
    }
    if (
      (state.deliveryGateAttempt ?? 0) > 0 &&
      draftHasSubstantialSections6And7(state.mddDraft ?? "")
    ) {
      return "format_after_redactor";
    }
    if (isMddTailParallelEnabled()) return "tail_parallel";
    return "security_integration";
  }

  function routeAuditor(state: MDDStateType): string {
    if (
      state.auditorDecision === "clarifier" &&
      (state.mddIteration ?? 0) < MAX_MDD_ITERATIONS &&
      !draftIsSubstantialForScopedRepair(state.mddDraft ?? "")
    ) {
      return "clarifier";
    }
    return "prepare_output";
  }

  /** One-shot: critic when directive, SQL blockers, or BRD domain auth-skew. */
  function routeAfterSoftwareArchitectOneShot(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    const hasDirective = !!(state.acceptedProposalDirective?.trim());
    const draft = (state.mddDraft ?? "").trim();
    const hasSection3 = /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i.test(draft) && /\bCREATE\s+TABLE\b/i.test(draft);
    const hasSection4 = /##\s*4\.\s*Contratos\s+de\s+API/i.test(draft);
    const attempts = state.architectCriticAttempts ?? 0;
    const section3SqlBlockers = detectSection3CompositionBlockers(draft);
    if (section3SqlBlockers.length > 0 && hasSection3 && attempts < 1) return "architect_critic";
    if (mddStateHasDomainAuthSkew(state) && hasSection3 && attempts < 1) return "architect_critic";
    if (hasDirective && hasSection3 && hasSection4 && attempts < 1) return "architect_critic";
    return "format_after_architect";
  }

  function routeAfterStackArchitectOneShot(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    const attempt = state.stackArchitectAttempt ?? 0;
    if (!draftHasSubstantialSection2(state.mddDraft ?? "") && attempt < 2) {
      return "stack_architect";
    }
    return "data_model";
  }

  function routeAfterDataModelOneShot(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return "architect_critic";
  }

  function routeAfterApiContractsOneShot(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return "format_after_architect";
  }

  function routeAfterIntegrationOneShot(state: MDDStateType): string {
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return "format_sec_int";
  }

  /** One-shot: HIGH → pipeline dividido; LOW/MEDIUM → arquitecto monolítico. */
  function routeAfterClarifierOneShot(state: MDDStateType): string {
    return isHighSplitArchitectPipeline(state) ? "stack_architect" : "software_architect";
  }

  /** One-shot: critic entre §3 y §4 (HIGH) o revisión §3+§4 (monolítico). */
  function routeAfterArchitectCriticOneShot(state: MDDStateType): string {
    const hasFeedback = !!(state.architectCriticFeedback?.trim());
    const attempts = state.architectCriticAttempts ?? 0;
    if (state.architectCriticPhase === "after_section3") {
      if (hasFeedback && attempts <= 1 && !isScopedSectionSealed(3, state)) {
        if (isTableOnlyCriticGap(state.architectCriticFeedback ?? "")) return "data_model_patch";
        return "data_model";
      }
      if (shouldUsePostCriticParallel(state)) return "post_critic_parallel";
      return "api_contracts";
    }
    if (hasFeedback && attempts <= 1) return "software_architect";
    return "format_after_architect";
  }

  const builder = new StateGraph(MDDStateAnnotation)
    .addNode("clarifier", clarifierNode)
    .addNode("software_architect", softwareArchitectNode)
    .addNode("stack_architect", stackArchitectNode)
    .addNode("data_model", dataModelNode)
    .addNode("api_contracts", apiContractsNode)
    .addNode("architect_critic", architectCriticNode)
    .addNode("format_after_architect", formatterNode("format_after_architect"))
    // Nodo combinado (Promise.all §6+§7) para la primera pasada; integration/format_sec_int
    // se mantienen para el auto-loop del delivery gate.
    .addNode("security_integration", securityIntegrationNode)
    .addNode("integration", integrationNode)
    .addNode("format_sec_int", formatSecIntNode)
    .addNode("format_after_redactor", formatterNode("format_after_redactor"))
    // [PARALELO] CrossConsistency (skip si draft completo) + DiagramInjector (code-only, <3s)
    .addNode("cross_consistency_checker", consistencyNode)
    .addNode("diagram_injector", diagramInjectorNode)
    .addNode("auditor", auditorNode)
    .addNode("prepare_output", prepareOutputNode)
    .addNode("structured_hydrator", structuredHydratorNode)
    // Dedicated §5 pass: regenera SOLO §5 cuando el substance check falla
    // únicamente en §5. CHANGELOG [Unreleased] → Added → "Dedicated §5 pass".
    .addNode("section5", section5Node)
    .addNode("tail_parallel", tailParallelNode)
    .addNode("post_critic_parallel", postCriticParallelNode)
    .addNode("data_model_patch", dataModelPatchNode)
    .addEdge(START, "clarifier")
    .addConditionalEdges("clarifier", routeAfterClarifierOneShot, {
      stack_architect: "stack_architect",
      software_architect: "software_architect",
    })
    .addConditionalEdges("stack_architect", routeAfterStackArchitectOneShot, {
      data_model: "data_model",
      prepare_output: "prepare_output",
      stack_architect: "stack_architect",
    })
    .addConditionalEdges("data_model", routeAfterDataModelOneShot, {
      architect_critic: "architect_critic",
      prepare_output: "prepare_output",
    })
    .addEdge("data_model_patch", "architect_critic")
    .addEdge("post_critic_parallel", "section5")
    .addConditionalEdges("api_contracts", routeAfterApiContractsOneShot, {
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("software_architect", routeAfterSoftwareArchitectOneShot, {
      architect_critic: "architect_critic",
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("architect_critic", routeAfterArchitectCriticOneShot, {
      data_model: "data_model",
      data_model_patch: "data_model_patch",
      api_contracts: "api_contracts",
      post_critic_parallel: "post_critic_parallel",
      software_architect: "software_architect",
      format_after_architect: "format_after_architect",
    })
    .addConditionalEdges("format_after_architect", routeAfterFormatArchitectGateLoop, {
      format_after_redactor: "format_after_redactor",
      security_integration: "security_integration",
      tail_parallel: "tail_parallel",
      prepare_output: "prepare_output",
    })
    .addEdge("security_integration", "format_after_redactor")
    .addEdge("tail_parallel", "format_after_redactor")
    .addConditionalEdges("integration", routeAfterIntegrationOneShot, {
      format_sec_int: "format_sec_int",
      prepare_output: "prepare_output",
    })
    .addEdge("format_sec_int", "format_after_redactor")
    // format_after_redactor → cross_consistency_checker + diagram_injector en paralelo.
    // (Antes pasaba por llm_formatter destructivo; ver CHANGELOG [Unreleased].)
    .addEdge("format_after_redactor", "cross_consistency_checker")
    .addEdge("format_after_redactor", "diagram_injector")
    .addConditionalEdges("cross_consistency_checker", routeAuditorOrPrepareOutput, {
      auditor: "auditor",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("diagram_injector", routeAuditorOrPrepareOutput, {
      auditor: "auditor",
      prepare_output: "prepare_output",
    })
    // section5: pipeline F3 → format; gate loop → prepare_output.
    .addConditionalEdges("section5", routeAfterSection5OneShot, {
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("auditor", routeAuditor, {
      clarifier: "clarifier",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("prepare_output", routeAfterPrepareOutput, {
      software_architect: "software_architect",
      stack_architect: "stack_architect",
      data_model: "data_model",
      api_contracts: "api_contracts",
      integration: "integration",
      clarifier: "clarifier",
      section5: "section5",
      structured_hydrator: "structured_hydrator",
    })
    .addEdge("structured_hydrator", END);

  return builder.compile();
}

/**
 * Builds and compiles the MDD StateGraph with Manager as Entrevistador de Estados.
 * Caso 1 (Inicio): sin Bench ni MDD → Manager NO delega; ask_initial_topic; al responder → Clarifier → … → Auditor → Manager; si score < 85 → Manager asigna gaps a agentes.
 * Caso 2 (Refinamiento): score < 85% → Manager toma critical_gaps y asigna tareas a agentes para corregir.
 * Caso 3 (Benchmark): existe dbgaContent → delegar de inmediato a especialistas para v1; luego bucle refinamiento.
 * Done cuando Auditor >= 85% (cede intervención al usuario) o usuario pide detenerse. Requiere checkpointer para interrupt/resume.
 */
export async function createMddGraphWithManager(
  aiFactory: AIFactory,
  userId: string,
  checkpointer: BaseCheckpointSaver | null,
  precisionCalculator?: LivePrecisionCalculator | null,
  managerToolDeps?: MddManagerToolDeps | null,
  compileOptions?: MddGraphCompileOptions,
) {
  const structuralRuntime = await resolveStructuralRuntime(aiFactory, userId, compileOptions?.preflightRuntime);
  const llm = compileOptions?.preflightRuntime
    ? createDbgaLLMFromRuntime(compileOptions.preflightRuntime)
    : await createDbgaLLM(aiFactory, userId);
  const section5Llm = createDbgaLLMFromRuntime(structuralRuntime, {
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("section5"),
  });
  const structuralLlm = createTailStructuralLlm(structuralRuntime);
  const stackLlm = createDbgaLLMFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("stack"),
  });
  const apiContractsLlm = createDbgaLLMFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
    maxTokensOverride: resolveMddArchitectScopeMaxTokens("api_contracts"),
  });
  const apiContractsChunkLlm = createMddApiContractsChunkLlmFromRuntime(structuralRuntime, {
    temperature: STRUCTURAL_TEMPERATURE,
  });
  const highComplexityLlm = await createMddHighComplexityLLM(aiFactory, userId, {
    temperature: STRUCTURAL_TEMPERATURE,
  });
  const auditorLlm = await createMddAuditorLLM(aiFactory, userId);
  const nodeCache = compileOptions?.nodeCache ?? null;
  const managerNode = createMddManagerNode(llm, precisionCalculator, managerToolDeps ?? null);
  const askInitialTopicNode = createMddAskInitialTopicNode();
  const clarifierNode = wrapCache(nodeCache, "clarifier", clarifierInput, createMddClarifierNode(llm));
  const theForgeForArchitect = compileOptions?.theforge ?? managerToolDeps?.theforge ?? null;
  const softwareArchitectNode = wrapCache(
    nodeCache,
    "software_architect",
    softwareArchitectInput,
    createMddSoftwareArchitectNode(structuralLlm, getMddArchitectTools(), {
      theforge: theForgeForArchitect,
      uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
      scope: "full",
    }),
  );
  const stackArchitectNode = wrapCache(
    nodeCache,
    "stack_architect",
    softwareArchitectInput,
    createMddSoftwareArchitectNode(stackLlm, getMddArchitectTools(), {
      theforge: theForgeForArchitect,
      uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
      scope: "stack",
    }),
  );
  const dataModelNode = wrapCache(
    nodeCache,
    "data_model",
    softwareArchitectInput,
    createMddSoftwareArchitectNode(highComplexityLlm, getMddArchitectTools(), {
      theforge: theForgeForArchitect,
      uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
      scope: "data_model",
    }),
  );
  const apiContractsNode = wrapCache(
    nodeCache,
    "api_contracts",
    softwareArchitectInput,
    createMddSoftwareArchitectNode(apiContractsLlm, getMddArchitectTools(), {
      theforge: theForgeForArchitect,
      uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
      scope: "api_contracts",
    }),
  );
  const architectCriticNode = createMddArchitectCriticNode(llm);
  const formatterNode = createMddFormatterNode();
  const securityNode = wrapCache(nodeCache, "security", securityInput, createMddSecurityNode(structuralLlm));
  const integrationNode = wrapCache(nodeCache, "integration", integrationInput, createMddIntegrationNode(structuralLlm));
  // Nodo combinado Security+Integration (Promise.all §6+§7) para la pasada completa; los nodos
  // individuales quedan para regeneración por sección (sectionsToRun) y auto-loop del delivery gate.
  const securityIntegrationNode = wrapCache(
    nodeCache,
    "security_integration",
    securityIntegrationInput,
    createMddSecurityIntegrationNode(structuralLlm),
  );
  // `llm_formatter` ELIMINADO del grafo manager: destructivo.
  // (mdd-llm-formatter.node.ts se conserva en el repo, marcado @deprecated,
  // por si en el futuro alguien lo quiere reintroducir con un skip heurístico
  // más estricto.)
  const diagramInjectorNode = createMddDiagramInjectorNode();
  const consistencyNode = wrapCache(
    nodeCache,
    "cross_consistency",
    crossConsistencyInput,
    createMddCrossConsistencyNode(auditorLlm),
  );
  const auditorNode = createMddAuditorNode(
    auditorLlm,
    getMddAuditorTools(),
    precisionCalculator ?? null,
  );
  const blackboardNode = createMddBlackboardNode(llm);
  const structuredHydratorNode = createMddStructuredHydratorNode(llm, compileOptions?.prisma ?? null);
  const prepareOutputNode = createMddPrepareOutputNode({
    uiMcpLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
  });
  // Dedicated §5 pass: regenera SOLO §5 cuando el substance check falla
  // únicamente en §5. CHANGELOG [Unreleased] → Added → "Dedicated §5 pass".
  const section5Node = wrapCache(
    nodeCache,
    "section5",
    (s) => ({
      mddDraft: s.mddDraft ?? "",
      clarifiedScope: s.clarifiedScope ?? "",
      dbgaContent: s.dbgaContent ?? "",
    }),
    createMddSection5Node(section5Llm),
  );
  const tailParallelNode = wrapCache(
    nodeCache,
    "tail_parallel",
    (s) => ({ mddDraft: s.mddDraft ?? "", dbgaContent: s.dbgaContent ?? "" }),
    createMddTailParallelNode(llm, structuralLlm),
  );
  const apiContractsFastArchitectNodeManager = apiContractsChunkLlm
    ? wrapCache(
        nodeCache,
        "api_contracts",
        softwareArchitectInput,
        createMddSoftwareArchitectNode(apiContractsChunkLlm, getMddArchitectTools(), {
          theforge: theForgeForArchitect,
          uiMcpFrontendLibraryLabel: compileOptions?.uiMcpFrontendLibraryLabel ?? null,
          scope: "api_contracts",
        }),
      )
    : null;
  const postCriticParallelNode = wrapCache(
    nodeCache,
    "post_critic_parallel",
    softwareArchitectInput,
    createMddPostCriticParallelNode(structuralLlm, {
      apiContractsFn: async (state) => apiContractsNode(state),
      ...(apiContractsFastArchitectNodeManager
        ? {
            apiContractsChunkFn: async (chunkIndex, state) =>
              chunkIndex === 0
                ? apiContractsNode(state)
                : apiContractsFastArchitectNodeManager(state),
          }
        : {}),
    }),
  );
  const dataModelPatchNode = wrapCache(
    nodeCache,
    "data_model_patch",
    softwareArchitectInput,
    createMddDataModelPatchNode(highComplexityLlm),
  );

  function shouldUsePostCriticParallelManager(state: MDDStateType): boolean {
    return isMddTailParallelEnabled() && isHighSplitArchitectPipeline(state) && state.delegateTarget !== "sections";
  }

  function routeAfterSection5Manager(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (state.deliveryGateLoopActive === true && state.deliveryGateFixTarget === "section5") {
      return "prepare_output";
    }
    if (state.section5FormatSkipped === true) {
      return "format_after_redactor";
    }
    return "format_after_architect";
  }

  function routeAfterPostCriticParallel(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    const next = nextInSections(state, "post_critic_parallel");
    if (next) return next;
    return "section5";
  }

  function routeAfterPrepareOutput(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (state.deliveryGateLoopActive === true) {
      if (state.deliveryGateFixTarget === "integration") return "integration";
      if (state.deliveryGateFixTarget === "clarifier") return "clarifier";
      if (state.deliveryGateFixTarget === "section5") return "section5";
      if (state.deliveryGateFixTarget === "stack_architect") return "stack_architect";
      if (state.deliveryGateFixTarget === "data_model") return "data_model";
      if (state.deliveryGateFixTarget === "api_contracts") return "api_contracts";
      return "software_architect";
    }
    return "structured_hydrator";
  }

  /** Si hay directiva/requisitos, SQL blockers, o BRD domain skew y §3 con contenido y attempts < 1 → critic. */
  function routeAfterSoftwareArchitect(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    const next = nextInSections(state, "software_architect");
    if (next) return next;
    const hasDirective = !!(state.acceptedProposalDirective?.trim());
    const draft = (state.mddDraft ?? "").trim();
    const hasSection3 = /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i.test(draft) && /\bCREATE\s+TABLE\b/i.test(draft);
    const hasSection4 = /##\s*4\.\s*Contratos\s+de\s+API/i.test(draft);
    const attempts = state.architectCriticAttempts ?? 0;
    const section3SqlBlockers = detectSection3CompositionBlockers(draft);
    if (section3SqlBlockers.length > 0 && hasSection3 && attempts < 1) return "architect_critic";
    if (mddStateHasDomainAuthSkew(state) && hasSection3 && attempts < 1) return "architect_critic";
    if (hasDirective && hasSection3 && hasSection4 && attempts < 1) return "architect_critic";
    return "format_after_architect";
  }

  /** Tras critic: retry §3 (HIGH) o SA monolítico; si ok tras §3 → post_critic_parallel o api_contracts. */
  function routeAfterArchitectCritic(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    const hasFeedback = !!(state.architectCriticFeedback?.trim());
    const attempts = state.architectCriticAttempts ?? 0;
    if (state.architectCriticPhase === "after_section3") {
      if (hasFeedback && attempts <= 1 && !isScopedSectionSealed(3, state)) {
        const next = nextInSections(state, "architect_critic");
        if (next) return next;
        if (isTableOnlyCriticGap(state.architectCriticFeedback ?? "")) return "data_model_patch";
        return "data_model";
      }
      const next = nextInSections(state, "architect_critic");
      if (next) return next;
      if (shouldUsePostCriticParallelManager(state)) return "post_critic_parallel";
      return "api_contracts";
    }
    if (hasFeedback && attempts <= 1) return "software_architect";
    return "format_after_architect";
  }

  function routeAfterStackArchitect(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    const attempt = state.stackArchitectAttempt ?? 0;
    if (!draftHasSubstantialSection2(state.mddDraft ?? "") && attempt < 2) {
      return "stack_architect";
    }
    return nextInSections(state, "stack_architect") ?? "data_model";
  }

  function routeAfterDataModel(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return nextInSections(state, "data_model") ?? "architect_critic";
  }

  function routeAfterApiContracts(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return nextInSections(state, "api_contracts") ?? "format_after_architect";
  }

  function routeAfterClarifier(state: MDDStateType): "manager" | "merge_section1_only" | "software_architect" | "stack_architect" | "executor" {
    if (state.executorControlled === true) return "executor";
    if (state.clarifierJustGeneratedQuestions === true) return "manager";
    if (state.delegateTarget === "clarifier_only") return "merge_section1_only";
    if (isHighSplitArchitectPipeline(state)) return "stack_architect";
    return "software_architect";
  }

  /** Siguiente nodo en sectionsToRun tras currentNode, o null para usar el default del pipeline. */
  function nextInSections(state: MDDStateType, currentNode: string): string | null {
    if (state.delegateTarget !== "sections" || !state.sectionsToRun?.length) return null;
    const idx = state.sectionsToRun.indexOf(currentNode);
    if (idx === -1) return null;
    const next = state.sectionsToRun[idx + 1];
    return next ?? "manager";
  }

  function routeAfterFormatArchitect(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    const next = nextInSections(state, "format_after_architect");
    if (next) return next;
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    if (state.postCriticParallelDone === true) {
      return "format_after_redactor";
    }
    if (
      (state.deliveryGateAttempt ?? 0) > 0 &&
      draftHasSubstantialSections6And7(state.mddDraft ?? "")
    ) {
      return "format_after_redactor";
    }
    if (isMddTailParallelEnabled() && state.delegateTarget !== "sections") {
      return "tail_parallel";
    }
    // Pasada completa (no sectionsToRun): Security+Integration en paralelo.
    return "security_integration";
  }
  function routeAfterTailParallel(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    return "format_after_redactor";
  }
  function routeAfterSecurityIntegration(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    return "format_after_redactor";
  }
  function routeAfterSecurity(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    return nextInSections(state, "security") ?? "integration";
  }
  function routeAfterIntegration(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return nextInSections(state, "integration") ?? "format_after_redactor";
  }
  function routeAfterFormatRedactor(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (shouldSkipAuditor(state) || shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    // Antes: ?? "llm_formatter" (destructivo, eliminado). Ahora va directo a
    // los verificadores de consistencia + diagramas.
    return nextInSections(state, "format_after_redactor") ?? "cross_consistency_checker";
  }
  function routeAfterConsistency(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    const next = nextInSections(state, "cross_consistency_checker");
    if (next) return next;
    if (shouldShortCircuitGateLoopFix(state)) return "prepare_output";
    return "diagram_injector";
  }
  function routeAfterDiagram(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    const next = nextInSections(state, "diagram_injector");
    if (next) return next;
    return routeAuditorOrPrepareOutput(state);
  }
  function routeAfterAuditor(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    if (state.auditorDecision === "blackboard") return "blackboard";
    return "prepare_output";
  }
  function routeAfterBlackboard(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    return state.sectionsToRun?.[0] || "manager";
  }
  function routeAfterStructuredHydrator(state: MDDStateType): string {
    if (state.executorControlled === true) return "executor";
    return "manager";
  }
  function routeAfterMergeSection1(state: MDDStateType): "executor" | typeof END {
    if (state.executorControlled === true) return "executor";
    return END;
  }

  const mergeSection1Node = createMddMergeSection1Node();

  const managerEnds = [
    "clarifier",
    END,
    "manager",
    "ask_initial_topic",
    "plan_approval",
    "executor",
    "auditor",
    "software_architect",
    "stack_architect",
    "data_model",
    "api_contracts",
    "architect_critic",
    "post_critic_parallel",
    "data_model_patch",
    "format_after_architect",
    "security",
    "integration",
    "section5",
    "tail_parallel",
    "cross_consistency_checker",
    "structured_hydrator",
    "blackboard",
    "prepare_output",
  ] as const;

  const planApprovalNode = createMddPlanApprovalNode();
  const executorNode = createMddExecutorNode();
  const executorEnds = [
    "clarifier",
    "merge_section1_only",
    "software_architect",
    "stack_architect",
    "data_model",
    "api_contracts",
    "architect_critic",
    "post_critic_parallel",
    "data_model_patch",
    "format_after_architect",
    "security",
    "integration",
    "section5",
    "tail_parallel",
    "format_after_redactor",
    "cross_consistency_checker",
    "diagram_injector",
    "auditor",
    "structured_hydrator",
    "blackboard",
    "manager",
    "prepare_output",
  ] as const;

  const builder = new StateGraph(MDDStateAnnotation)
    .addNode("manager", managerNode, { ends: [...managerEnds] })
    .addNode("ask_initial_topic", askInitialTopicNode, { ends: ["clarifier"] })
    .addNode("plan_approval", planApprovalNode, { ends: ["manager"] })
    .addNode("executor", executorNode, { ends: [...executorEnds] })
    .addNode("clarifier", clarifierNode)
    .addNode("merge_section1_only", mergeSection1Node)
    .addNode("software_architect", softwareArchitectNode)
    .addNode("stack_architect", stackArchitectNode)
    .addNode("data_model", dataModelNode)
    .addNode("api_contracts", apiContractsNode)
    .addNode("architect_critic", architectCriticNode)
    .addNode("format_after_architect", formatterNode)
    .addNode("security", securityNode)
    .addNode("integration", integrationNode)
    .addNode("security_integration", securityIntegrationNode)
    .addNode("tail_parallel", tailParallelNode)
    .addNode("post_critic_parallel", postCriticParallelNode)
    .addNode("data_model_patch", dataModelPatchNode)
    // Dedicated §5 pass: regenera SOLO §5 cuando el substance check falla
    // únicamente en §5. CHANGELOG [Unreleased] → Added → "Dedicated §5 pass".
    .addNode("section5", section5Node)
    .addNode("format_after_redactor", formatterNode)
    .addNode("cross_consistency_checker", consistencyNode)
    .addNode("diagram_injector", diagramInjectorNode)
    .addNode("auditor", auditorNode)
    .addNode("prepare_output", prepareOutputNode)
    .addNode("blackboard", blackboardNode)
    .addNode("structured_hydrator", structuredHydratorNode)
    .addEdge(START, "manager")
    .addConditionalEdges("clarifier", routeAfterClarifier, {
      manager: "manager",
      merge_section1_only: "merge_section1_only",
      software_architect: "software_architect",
      stack_architect: "stack_architect",
      executor: "executor",
    })
    .addConditionalEdges("merge_section1_only", routeAfterMergeSection1, {
      executor: "executor",
      [END]: END,
    })
    .addConditionalEdges("stack_architect", routeAfterStackArchitect, {
      data_model: "data_model",
      prepare_output: "prepare_output",
      stack_architect: "stack_architect",
      executor: "executor",
      manager: "manager",
    })
    .addConditionalEdges("data_model", routeAfterDataModel, {
      architect_critic: "architect_critic",
      prepare_output: "prepare_output",
      executor: "executor",
      manager: "manager",
    })
    .addEdge("data_model_patch", "architect_critic")
    .addConditionalEdges("api_contracts", routeAfterApiContracts, {
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
      executor: "executor",
      manager: "manager",
    })
    .addConditionalEdges("software_architect", routeAfterSoftwareArchitect, {
      architect_critic: "architect_critic",
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
      security: "security",
      integration: "integration",
      cross_consistency_checker: "cross_consistency_checker",
      format_after_redactor: "format_after_redactor",
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("architect_critic", routeAfterArchitectCritic, {
      data_model: "data_model",
      data_model_patch: "data_model_patch",
      api_contracts: "api_contracts",
      post_critic_parallel: "post_critic_parallel",
      software_architect: "software_architect",
      format_after_architect: "format_after_architect",
      executor: "executor",
    })
    .addConditionalEdges("post_critic_parallel", routeAfterPostCriticParallel, {
      section5: "section5",
      executor: "executor",
      manager: "manager",
    })
    .addConditionalEdges("section5", routeAfterSection5Manager, {
      format_after_architect: "format_after_architect",
      prepare_output: "prepare_output",
      executor: "executor",
    })
    .addConditionalEdges("format_after_architect", routeAfterFormatArchitect, {
      security: "security",
      integration: "integration",
      security_integration: "security_integration",
      tail_parallel: "tail_parallel",
      format_after_redactor: "format_after_redactor",
      cross_consistency_checker: "cross_consistency_checker",
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      prepare_output: "prepare_output",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("security_integration", routeAfterSecurityIntegration, {
      format_after_redactor: "format_after_redactor",
      executor: "executor",
    })
    .addConditionalEdges("tail_parallel", routeAfterTailParallel, {
      format_after_redactor: "format_after_redactor",
      executor: "executor",
    })
    .addConditionalEdges("security", routeAfterSecurity, {
      integration: "integration",
      cross_consistency_checker: "cross_consistency_checker",
      format_after_redactor: "format_after_redactor",
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("integration", routeAfterIntegration, {
      format_after_redactor: "format_after_redactor",
      cross_consistency_checker: "cross_consistency_checker",
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      prepare_output: "prepare_output",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("format_after_redactor", routeAfterFormatRedactor, {
      cross_consistency_checker: "cross_consistency_checker",
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      prepare_output: "prepare_output",
      manager: "manager",
      executor: "executor",
    })
    .addEdge("format_after_redactor", "cross_consistency_checker")
    .addConditionalEdges("cross_consistency_checker", routeAfterConsistency, {
      diagram_injector: "diagram_injector",
      auditor: "auditor",
      prepare_output: "prepare_output",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("diagram_injector", routeAfterDiagram, {
      auditor: "auditor",
      prepare_output: "prepare_output",
      manager: "manager",
      executor: "executor",
    })
    .addConditionalEdges("auditor", routeAfterAuditor, {
      executor: "executor",
      blackboard: "blackboard",
      prepare_output: "prepare_output",
    })
    .addConditionalEdges("prepare_output", routeAfterPrepareOutput, {
      executor: "executor",
      software_architect: "software_architect",
      stack_architect: "stack_architect",
      data_model: "data_model",
      api_contracts: "api_contracts",
      integration: "integration",
      clarifier: "clarifier",
      section5: "section5",
      structured_hydrator: "structured_hydrator",
    })
    .addConditionalEdges("blackboard", routeAfterBlackboard, {
      executor: "executor",
      manager: "manager",
      software_architect: "software_architect",
      security: "security",
      integration: "integration",
    })
    .addConditionalEdges("structured_hydrator", routeAfterStructuredHydrator, {
      executor: "executor",
      manager: "manager",
    });

  return builder.compile(checkpointer ? { checkpointer } : undefined);
}
