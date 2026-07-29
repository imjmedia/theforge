import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  GenerateResponseOptions,
  ChatMessage as LlmChatMessage,
} from "./interfaces/llm-provider.interface.js";
import { AIFactory } from "./ai.factory.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import type { ChatImagePart } from "@theforge/shared-types";
import type { AemMarketScope, DomainInventory } from "@theforge/shared-types";
import { stableCrudUserStoryId, stableJourneyUserStoryId } from "@theforge/shared-types";
import { buildWorkshopSystemPrompt } from "./workshop-system-prompt.builder.js";

import { UX_UI_GUIDE_PROMPT } from "./prompts/ux-ui-guide-prompt.js";
import { BLUEPRINT_PROMPT } from "./prompts/blueprint-prompt.js";
import { API_CONTRACTS_PROMPT } from "./prompts/api-contracts-prompt.js";
import { LOGIC_FLOWS_PROMPT } from "./prompts/logic-flows-prompt.js";
import { INFRA_PROMPT } from "./prompts/infra-prompt.js";
import { SPEC_PROMPT } from "./prompts/spec-prompt.js";
import { ARCHITECTURE_PROMPT } from "./prompts/architecture-prompt.js";
import { USE_CASES_PROMPT } from "./prompts/use-cases-prompt.js";
import { USER_STORIES_PROMPT } from "./prompts/user-stories-prompt.js";
import { TASKS_PROMPT } from "./prompts/tasks-prompt.js";
import { CLARIFY_SPEC_PROMPT } from "./prompts/clarify-spec-prompt.js";
import {
  CLARIFY_DOCUMENT_PROMPT,
  RESOLVE_CLARIFICATIONS_PROMPT,
} from "./prompts/clarify-document-prompt.js";
import { AGENT_GOVERNANCE_PROMPT } from "./prompts/agent-governance-prompt.js";
import { AEM_PROMPT } from "./prompts/aem-prompt.js";
import { AEM_INVESTMENT_ADVISOR_PROMPT } from "./prompts/aem-investment-advisor-prompt.js";
import { formatSuggestedArtifactsPromptBlock } from "./utils/suggest-agent-governance-artifacts.js";
import type { AgentGovernanceSuggestions } from "./utils/suggest-agent-governance-artifacts.js";
import type { ComplexityLevel } from "@theforge/shared-types";
import { VERIFY_DELIVERABLE_PROMPT } from "./prompts/verify-deliverable-prompt.js";
import { CONFORMANCE_CHECK_PROMPT } from "./prompts/conformance-check-prompt.js";
import { MDD_DOC_GAP_PATCH_PROMPT } from "./prompts/mdd-doc-gap-patch-prompt.js";
import { parseJsonOrThrow } from "../ai-analysis/utils/parse-json.js";
import { z } from "zod";
import { appendMddGovernancePatternsToPrompt } from "./utils/mdd-governance-prompt.util.js";
import {
  buildMddContextForUserStories,
  buildMddContextForUseCases,
  buildMddContextForBlueprint,
  buildMddContextForApiContracts,
  buildMddContextForLogicFlows,
  buildMddContextForArchitecture,
  buildMddContextForTasks,
  buildMddContextForInfra,
  buildMddContextForSpec,
  buildMddContextForAgentGovernance,
  buildLogicFlowsDiagramHint,
} from "./utils/mdd-user-stories-context.util.js";
import {
  appendLegacyBaselineDetailPrompt,
  capTextForLegacyBaseline,
} from "./utils/legacy-baseline-detail.util.js";
import { TechnologyDocsMcpClientService } from "../technology-docs-mcp/technology-docs-mcp-client.service.js";
import {
  appendTechDocsToUserPrompt,
} from "../technology-docs-mcp/tech-docs-context.util.js";
import {
  extractExplicitContext7Query,
  isExplicitContext7ChatRequest,
  shouldAutoFetchPhase0TechDocs,
} from "@theforge/shared-types";
import {
  buildLegacyAsIsSpecCoverageChecklist,
  buildLegacyAsIsSpecUserPreamble,
  LEGACY_AS_IS_SPEC_SYSTEM_APPENDIX,
} from "./utils/legacy-as-is-spec.util.js";
import {
  buildLegacyAsIsUseCasesCoverageChecklist,
  buildLegacyAsIsUseCasesUserPreamble,
  LEGACY_AS_IS_USE_CASES_SYSTEM_APPENDIX,
} from "./utils/legacy-as-is-use-cases.util.js";
import {
  buildLegacyAsIsUserStoriesCoverageChecklist,
  buildLegacyAsIsUserStoriesUserPreamble,
  LEGACY_AS_IS_USER_STORIES_SYSTEM_APPENDIX,
} from "./utils/legacy-as-is-user-stories.util.js";
import {
  buildLegacyAsIsBlueprintCoverageChecklist,
  buildLegacyAsIsBlueprintUserPreamble,
  LEGACY_AS_IS_BLUEPRINT_SYSTEM_APPENDIX,
  LEGACY_AS_IS_BLUEPRINT_THEFORGE_APPENDIX,
} from "./utils/legacy-as-is-blueprint.util.js";
import {
  buildLegacyAsIsLogicFlowsCoverageChecklist,
  buildLegacyAsIsLogicFlowsUserPreamble,
  buildLogicFlowsBatchSystemAppendix,
  buildLogicFlowsBatchUserPreamble,
  chunkArray,
  extractSection5Services,
  finalizeLogicFlowsDocument,
  isLegacyAsIsLogicFlowsBatchEnabled,
  isLegacyAsIsLogicFlowsGapPassEnabled,
  LEGACY_AS_IS_LOGIC_FLOWS_SYSTEM_APPENDIX,
  LEGACY_AS_IS_LOGIC_FLOWS_THEFORGE_APPENDIX,
  readLogicFlowsBatchSize,
  stripLogicFlowsFragmentWrapper,
  type MddSection5ServiceRow,
} from "./utils/legacy-as-is-logic-flows.util.js";
import type { MddDeliverableContextOptions } from "./utils/mdd-deliverable-context.util.js";
import {
  appendCoverageChecklistToPrompt,
  buildGreenfieldCoverageChecklist,
} from "../engine/sdd-coverage-checklist.util.js";
import { resolveLlmMaxTokensForPurpose } from "./config/llm-config.js";
import { runWithTokenUsageContext } from "../ai-analysis/token-usage/token-usage.context.js";
import { MERMAID_REGENERATE_PROMPT } from "./prompts/mermaid-regenerate-prompt.js";
import { repairMermaidBlockBody, stripMermaidFenceWrappers } from "@theforge/shared-types/mermaid";
import { PluginDocumentPipelineService } from "../../plugins/plugin-document-pipeline.service.js";
import type { BeforeDocumentRenderPayload } from "../../plugins/types/plugin-payloads.js";

function mddDeliverableCtx(options?: LegacyGenerateOptions): MddDeliverableContextOptions | undefined {
  return options?.legacyBaselineStage ? { legacyBaselineStage: true } : undefined;
}

function capPhase0Summary(text: string | null | undefined, max = 12000): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t.length <= max ? t : t.slice(0, max) + "\n\n[… phase0 truncado …]";
}

function appendPhase0ResearchBlock(prompt: string, options?: LegacyGenerateOptions): string {
  const research = capPhase0Summary(options?.phase0SummaryContent);
  if (!research) return prompt;
  return (
    `${prompt.trimEnd()}\n\nResearch / Phase0 (mandatorios M* y open gaps — trazar en el entregable):\n---\n${research}\n---\n`
  );
}

function appendGreenfieldCoverageChecklist(
  prompt: string,
  mddRaw: string,
  artifactLabel: string,
  options?: LegacyGenerateOptions,
  blueprintMarkdown?: string | null,
): string {
  if (options?.legacyBaselineStage || !mddRaw.trim()) return prompt;
  const checklist = buildGreenfieldCoverageChecklist({
    mddMarkdown: mddRaw,
    phase0Summary: options?.phase0SummaryContent,
    phase0GapsJson: options?.phase0GapsJson,
    blueprintMarkdown: blueprintMarkdown ?? options?.coverageBlueprintContent,
    artifactLabel,
    brdMarkdown: options?.brdContent,
    dbgaMarkdown: options?.dbgaContent,
  });
  let out = appendCoverageChecklistToPrompt(prompt, checklist);
  if (options?.domainInventory?.processes?.length) {
    const journeys = options.domainInventory.processes
      .slice(0, 20)
      .map(
        (p) =>
          `- [ ] Journey «${p.name}»${p.trigger ? ` (trigger: ${p.trigger})` : ""}` +
          (p.steps.length ? `\n  Steps: ${p.steps.slice(0, 6).join(" → ")}` : ""),
      )
      .join("\n");
    out += `\n\n**ProcessInventory journeys (trazabilidad obligatoria):**\n${journeys}\n`;
  }
  return out;
}

function buildThinUseCasesFromInventory(inventory: DomainInventory): string {
  const lines = [
    "# Casos de uso (thin — ProcessInventory)",
    "",
    "Documento generado sin prosa literaria (PLAN-CASCADE-90). Cada proceso = journey Spec.",
    "",
  ];
  for (const p of inventory.processes.slice(0, 30)) {
    lines.push(`## CU-${p.id}: ${p.name}`);
    lines.push(`- **Trigger:** ${p.trigger ?? "user.request"}`);
    if (p.steps.length) {
      lines.push("- **Pasos:**");
      for (const s of p.steps) lines.push(`  1. ${s}`);
    }
    if (p.entities.length) lines.push(`- **Entidades:** ${p.entities.join(", ")}`);
    lines.push("");
  }
  if (inventory.processes.length === 0) {
    lines.push("_Sin procesos en inventario; regenerar BRD/MDD._");
  }
  return lines.join("\n");
}

function buildThinUserStoriesFromInventory(inventory: DomainInventory): string {
  const lines = [
    "# Historias de Usuario (thin — ProcessInventory / CrudMatrix)",
    "",
    "> IDs estables: CRUD → `US-CRUD-*`, journeys → `US-JRN-*` (no re-numerar por orden de matriz).",
    "",
  ];
  for (const row of inventory.crudMatrix.filter((r) => r.mvp && !r.infraOnly).slice(0, 40)) {
    const usId = row.usId ?? stableCrudUserStoryId(row.entity);
    lines.push(`## Historia de usuario: [${usId}] Gestionar ${row.entity}`);
    lines.push(`**Como:** ${row.actor ?? "Usuario autenticado"}`);
    lines.push(`**Quiero:** operar ${row.ops.join("/")} sobre \`${row.entity}\``);
    lines.push(`**Para:** cubrir capacidad de dominio vinculada al inventario.`);
    if (row.screenHint) lines.push(`**Pantalla:** ${row.screenHint}`);
    lines.push("");
  }
  for (const p of inventory.processes.slice(0, 15)) {
    const usId = p.usId ?? stableJourneyUserStoryId(p.id);
    lines.push(`## Historia de usuario: [${usId}] ${p.name}`);
    lines.push(`**Como:** Usuario del sistema`);
    lines.push(`**Quiero:** completar el proceso «${p.name}»`);
    lines.push(`**Para:** satisfacer el trigger ${p.trigger ?? "user.request"}.`);
    lines.push("");
  }
  return lines.join("\n");
}

function preferThinLiteraryDocs(options?: LegacyGenerateOptions, envKey?: "GENERATE_LITERARY_UC" | "GENERATE_LITERARY_US"): boolean {
  if (options?.preferThinLiteraryDocs === true) return true;
  if (options?.preferThinLiteraryDocs === false) return false;
  if (envKey && process.env[envKey] === "false") return true;
  if (envKey && process.env[envKey] === "true") return false;
  // Default: use literary docs for richer narrative quality
  return false;
}

/** Instrucción fija para que ningún documento generado use "militar" (se añade al system prompt en generación de docs). */
const NO_MILITAR_INSTRUCTION =
  "\n\n**Regla obligatoria:** En toda tu respuesta no uses nunca las palabras \"militar\", \"grado militar\" ni variantes; usa \"alta criticidad\", \"misión crítica\" o \"robustez industrial\" en su lugar.";

/** Opciones para generación legacy: contexto TheForge para priorizar conocimiento del codebase. */
export interface LegacyGenerateOptions {
  /** Contexto del codebase (TheForge). Cuando está presente, se inyecta al inicio del prompt y se instruye a priorizarlo. */
  theforgeContext?: string;
  /** Contratos de API reales obtenidos vía get_contract_specs del MCP de Ariadne. Props/firmas reales de componentes para alinear endpoints. */
  contractSpecs?: string;
  /** Etapa 1 legacy (AS-IS): MDD y entregables sin truncar ni resumir. */
  legacyBaselineStage?: boolean;
  /** Bloque markdown: dependencia externa legacy AS-IS (proyectos NEW). */
  externalLegacyContextBlock?: string;
  /** Handoff NEW-LEG para inyectar en prompts (NEW o legacy etapa 2+). */
  integrationHandoffItems?: { id: string; title: string; description: string; actor?: string; acceptanceCriteria?: string[] }[];
  /** Metadatos del proyecto NEW origen (legacy etapa 2+). */
  integrationNewProject?: { id: string; name: string };
  /** research.md / phase0 deep research — propagación a tasks y architecture. */
  phase0SummaryContent?: string | null;
  /** JSON envelope Phase0 gaps (`Project.phase0Gaps`). */
  phase0GapsJson?: string | null;
  /** Blueprint para checklist de cobertura cuando el artefacto destino no lo recibe como body. */
  coverageBlueprintContent?: string | null;
  /** Plan JSON del TasksPlanner (Fase 1); el redactor no debe salir del plan. */
  tasksPlanJson?: string | null;
  /** Feedback del Auditor LLM de Tasks para reparación. */
  tasksAuditorFeedback?: string | null;
  /** Manifiesto + context anchors (modo contratos — sustituye dump de documentos). */
  tasksContractContext?: string | null;
  /** Capa map-reduce activa (Backend | Frontend | Infra | QA | Integración). */
  tasksGenerationLayer?: string | null;
  /** Pre-fetched Technology Docs MCP block (Context7). When absent, AiService may resolve from MDD. */
  techDocsContext?: string | null;
  /** BRD stage — domain inventory injection in greenfield checklists. */
  brdContent?: string | null;
  /** DBGA / benchmark markdown for domain inventory. */
  dbgaContent?: string | null;
  /**
   * Prefer thin literary UC/US (journeys + matrix). True when GENERATE_LITERARY_*=false
   * or preferThinLiteraryDocs; HIGH cascade defaults to thin when env unset.
   */
  preferThinLiteraryDocs?: boolean;
  /** Skip literary UC/US LLM and emit ProcessInventory journeys (HIGH default). */
  omitLiteraryUcUs?: boolean;
  /** Persisted/live domain inventory for checklists + Spec journeys. */
  domainInventory?: DomainInventory | null;
  /** Hooks de plugins: id de proyecto para before/afterDocumentRender */
  projectId?: string;
  /** Stage ID para telemetría de tokens (tabla TokenUsage). */
  stageId?: string;
  /** Contexto de entregables para hooks de plugins */
  hookContext?: Record<string, string | null | undefined>;
  /** Cancelación cooperativa (jobs BullMQ / cascada). */
  abortSignal?: AbortSignal;
}

export interface AgentGovernanceGenerateOptions extends LegacyGenerateOptions {
  /** Sugerencias del detector pre-LLM (rules/skills del catálogo). */
  suggestions?: AgentGovernanceSuggestions;
  tasksContent?: string | null;
  architectureContent?: string | null;
  specContent?: string | null;
  apiContractsContent?: string | null;
  logicFlowsContent?: string | null;
  uxUiGuideContent?: string | null;
  uiScreensContent?: string | null;
  infraContent?: string | null;
  userStoriesContent?: string | null;
  useCasesContent?: string | null;
}

function appendDeliverableSection(
  prompt: string,
  label: string,
  content: string | null | undefined,
  maxLen: number,
  legacyBaselineStage?: LegacyGenerateOptions["legacyBaselineStage"],
): string {
  const capped = capTextForLegacyBaseline(content ?? "", maxLen, legacyBaselineStage);
  if (!capped.trim()) return prompt;
  return `${prompt}\n\n${label}:\n---\n${capped}\n---`;
}

/** Instrucción fija para toda documentación legacy: complementar sin inventar. */
const LEGACY_NO_INVENTAR =
  "**Regla obligatoria (legacy):** Cumple estrictamente con lo que especifican los documentos. No inventes funcionalidades nuevas ni cambies el alcance. Sin embargo, puedes y debes complementar con lo necesario para que lo especificado funcione correctamente: validaciones, manejo de errores, estados de UI, casos edge obvios, autenticación donde aplique, migraciones de DB requeridas, y cualquier boilerplate indispensable. Si algo es ambiguo o hay múltiples formas válidas de implementarlo, pregunta.";

function trimTheForgeContextBlock(theforgeContext: string): string {
  return (theforgeContext ?? "").trim();
}

function prependTheForgePrompt(prompt: string, theforgeContext: string): string {
  const block = trimTheForgeContextBlock(theforgeContext);
  if (!block) return prompt;
  return (
    "**Contexto del codebase (índice vía TheForge MCP) — priorizar y usar en su totalidad antes de elaborar el documento:**\n" +
    "**Nota:** «TheForge» aquí es la herramienta de indexado, **no** el nombre del producto ni del sistema que documentas (ese nombre sale del MDD).\n---\n" +
    block +
    "\n---\n\n" +
    LEGACY_NO_INVENTAR +
    "\n\n**Instrucción:** Usa TODO el conocimiento anterior para alinear el documento con lo que ya existe en el proyecto. A continuación, el MDD u otros insumos.\n\n" +
    prompt
  );
}

function appendTechDocsContextBlock(prompt: string, techDocsContext: string | null | undefined): string {
  return appendTechDocsToUserPrompt(prompt, techDocsContext);
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiFactory: AIFactory,
    private readonly techDocsMcp: TechnologyDocsMcpClientService,
    @Optional() private readonly pluginPipeline: PluginDocumentPipelineService | null,
  ) {}

  private async provider() {
    return this.aiFactory.createForUser(getRequestUserId());
  }

  /**
   * Genera contenido LLM ejecutando hooks before/afterDocumentRender cuando hay plugins
   * y se proporciona projectId.
   */
  async generateWithDocumentHooks(opts: {
    documentType: string;
    projectId: string;
    context: Record<string, string | null | undefined>;
    prompt: string;
    systemPrompt: string;
    history?: LlmChatMessage[];
    generateOptions?: GenerateResponseOptions;
  }): Promise<string> {
    const pipeline = this.pluginPipeline;
    if (!pipeline?.hasDocumentHooks()) {
      return this.generateResponse(opts.prompt, opts.history ?? [], {
        systemPrompt: opts.systemPrompt,
        ...opts.generateOptions,
      });
    }

    const userId = getRequestUserId();
    const runtime = await this.aiFactory.resolveRuntime(userId);
    const beforeBase: BeforeDocumentRenderPayload = {
      documentType: opts.documentType,
      projectId: opts.projectId,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      context: opts.context,
      llmRuntime: {
        providerId: runtime.providerId,
        model: runtime.chatModel,
        apiKey: runtime.apiKey,
        baseURL: runtime.baseURL,
      },
    };
    const before = await pipeline.runBeforeDocumentRender(beforeBase);
    const raw = await this.generateResponse(before.prompt, opts.history ?? [], {
      systemPrompt: before.systemPrompt,
      ...opts.generateOptions,
    });
    const after = await pipeline.runAfterDocumentRender({
      documentType: opts.documentType,
      projectId: opts.projectId,
      rawContent: raw,
      parsedContent: null,
      originalContext: before,
    });
    return after.rawContent;
  }

  /**
   * Cierra generación LLM con hooks opcionales. Sin `projectId` o sin plugins registrados
   * → mismo camino que `generateResponse` (core intacto).
   */
  private resolveAbortSignal(
    options?: LegacyGenerateOptions,
    generateOptions?: GenerateResponseOptions,
  ): AbortSignal | undefined {
    return options?.abortSignal ?? generateOptions?.abortSignal;
  }

  private async finishDocumentGeneration(
    documentType: string,
    options: LegacyGenerateOptions | undefined,
    prompt: string,
    systemPrompt: string,
    generateOptions?: GenerateResponseOptions,
  ): Promise<string> {
    const abortSignal = this.resolveAbortSignal(options, generateOptions);
    if (options?.projectId) {
      return this.generateWithDocumentHooks({
        documentType,
        projectId: options.projectId,
        context: options.hookContext ?? {},
        prompt,
        systemPrompt,
        generateOptions: {
          ...generateOptions,
          abortSignal,
          telemetryContext: {
            projectId: options.projectId,
            stageId: options.stageId ?? null,
            documentField: `${documentType}Content`,
            context: "initial",
            node: null,
            jobId: null,
          },
        },
      });
    }
    return this.generateResponse(prompt, [], { systemPrompt, ...generateOptions, abortSignal });
  }

  private async auditorProvider() {
    return this.aiFactory.createAuditorForUser(getRequestUserId());
  }

  /** Resolves optional Technology Docs MCP snippets; never throws. */
  private async resolveTechDocsContext(
    mddContent: string,
    blueprintContent: string | null | undefined,
    options?: LegacyGenerateOptions,
  ): Promise<string | null> {
    const preset = options?.techDocsContext?.trim();
    if (preset) return preset;
    try {
      return await this.techDocsMcp.buildContextForMdd(mddContent, blueprintContent);
    } catch (e) {
      this.logger.warn(
        `[tech-docs] buildContextForMdd failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Phase 0 / Benchmark chat — explicit Context7 or auto-detect API/auth topics. */
  private async resolvePhase0TechDocsForChat(
    prompt: string,
    options?: GenerateResponseOptions,
  ): Promise<string | null> {
    const preset = options?.techDocsContext?.trim();
    if (preset) return preset;

    const tab = options?.activeTab?.trim();
    const isPhase0Tab = tab === "benchmark" || tab === "phase0";

    if (isExplicitContext7ChatRequest(prompt)) {
      try {
        const q = extractExplicitContext7Query(prompt);
        return await this.techDocsMcp.buildContextForExplicitQuery(q);
      } catch (e) {
        this.logger.warn(
          `[tech-docs] explicit Context7 failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      }
    }

    if (!isPhase0Tab) return null;

    const combined = [
      prompt,
      options?.currentDbgaContent,
      options?.currentPhase0SummaryContent,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!shouldAutoFetchPhase0TechDocs(combined)) return null;

    try {
      return await this.techDocsMcp.buildContextFromText(combined);
    } catch (e) {
      this.logger.warn(
        `[tech-docs] phase0 auto fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  async generateResponse(
    prompt: string,
    history: LlmChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<string> {
    const invoke = async (): Promise<string> => {
      try {
        const phase0TechDocs = await this.resolvePhase0TechDocsForChat(prompt, options);
        const systemPrompt = buildWorkshopSystemPrompt(options, {
          variant: "sync",
          history,
          userPrompt: prompt,
          phase0TechDocs,
        });
        const ts = () => new Date().toISOString();
        console.log(`[AiService] ${ts()} → Enviando al LLM:`, {
          activeTab: options?.activeTab,
          welcomeBrief: options?.welcomeBrief === true,
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 120) + (prompt.length > 120 ? "…" : ""),
          systemPromptLength: systemPrompt.length,
          approxTotalChars: systemPrompt.length + prompt.length,
          historyLength: history.length,
        });
        const out = await (await this.provider()).generateResponse(prompt, history, {
          systemPrompt,
          userMessageImages: options?.userMessageImages,
          abortSignal: options?.abortSignal,
        });
        console.log(`[AiService] ${ts()} ← Respuesta del LLM recibida:`, {
          length: out?.length ?? 0,
          preview: (out ?? "").slice(0, 200) + ((out?.length ?? 0) > 200 ? "…" : ""),
        });
        return out;
      } catch (err) {
        console.error("[AiService] generateResponse error", err);
        throw err;
      }
    };
    return this.withTelemetryContext(options, invoke);
  }

  /**
   * LLM con runtime de auditor/planner (`auditorChatModel` de la instancia activa).
   * Misma ruta de adaptadores que `generateResponse` (OpenRouter, OpenAI, Anthropic, etc.).
   */
  async generateAuditorResponse(
    prompt: string,
    history: LlmChatMessage[] = [],
    options?: {
      systemPrompt?: string;
      maxTokensOverride?: number;
      jsonObjectMode?: boolean;
      abortSignal?: AbortSignal;
    },
  ): Promise<string> {
    try {
      const systemPrompt = options?.systemPrompt ?? "";
      const runtime = await this.aiFactory.resolveAuditorRuntime(getRequestUserId());
      this.logger.debug(
        `[AiService] generateAuditorResponse provider=${runtime.providerId} model=${runtime.chatModel}`,
      );
      const jsonSuffix = options?.jsonObjectMode
        ? "\n\nResponde ÚNICAMENTE con un objeto JSON válido parseable por JSON.parse."
        : "";
      const out = await (await this.auditorProvider()).generateResponse(prompt, history, {
        systemPrompt: systemPrompt + jsonSuffix,
        maxTokensOverride: options?.maxTokensOverride,
        jsonObjectMode: options?.jsonObjectMode,
        abortSignal: options?.abortSignal,
      });
      return out;
    } catch (err) {
      this.logger.error("[AiService] generateAuditorResponse error", err);
      throw err;
    }
  }

  async generateResponseStream(
    prompt: string,
    history: LlmChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<AsyncIterable<string>> {
    const userId = getRequestUserId();
    try {
      const runtime = await this.aiFactory.resolveRuntime(userId);
      this.logger.debug(
        `[generateResponseStream] userId=${userId} tab=${options?.activeTab ?? "mdd"} provider=${runtime.providerId} model=${runtime.chatModel} fallbacks=[${(runtime.chatModelFallbacks ?? []).join(",")}]`,
      );
    } catch (err) {
      this.logger.warn(
        `[generateResponseStream] resolveRuntime falló userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const invoke = async (): Promise<AsyncIterable<string>> => {
      const phase0TechDocs = await this.resolvePhase0TechDocsForChat(prompt, options);
      const systemPrompt = buildWorkshopSystemPrompt(options, {
        variant: "stream",
        history,
        userPrompt: prompt,
        phase0TechDocs,
      });
      return (await this.provider()).generateResponseStream(prompt, history, { ...options, systemPrompt });
    };
    return this.withTelemetryContext(options, invoke);
  }

  /**
   * Envuelve la llamada LLM en `runWithTokenUsageContext` cuando `options.telemetryContext`
   * está presente, para que los adapters capturen uso por proyecto/etapa/documento.
   */
  private async withTelemetryContext<T>(
    options: GenerateResponseOptions | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const tc = options?.telemetryContext;
    if (!tc) return fn();
    return runWithTokenUsageContext(
      {
        projectId: tc.projectId,
        stageId: tc.stageId ?? null,
        documentField: tc.documentField,
        context: tc.context ?? "unknown",
        node: tc.node ?? null,
        jobId: tc.jobId ?? null,
      },
      fn,
    );
  }

  /**
   * Visión → texto para el chat y agentes sin multimodal (Manager MDD, orquestador, historial).
   */
  async describeImagesForChat(
    userText: string,
    images: ChatImagePart[],
    activeTab?: string,
  ): Promise<string> {
    if (!images.length) return "";
    const userId = getRequestUserId();
    const visionProvider = await this.aiFactory.createForVisionUser(userId);
    const tab = (activeTab ?? "mdd").trim() || "mdd";
    const hint = (userText ?? "").trim() || "(sin texto adicional)";
    const tabHint =
      tab === "mdd"
        ? "Master Design Document"
        : tab === "ux-ui-guide"
          ? "Guía UX/UI y design system"
          : tab === "benchmark"
            ? "Fase 0 — Domain Benchmark & Gap Analysis (DBGA); tablas espejo, catálogo multi-origen, tenant_id"
            : `documento o pestaña «${tab}» del Workshop`;
    const benchmarkExtra =
      tab === "benchmark"
        ? " Si es un ERD o diagrama relacional, lista tablas, columnas, PK/FK y jerarquía (país→estado→ciudad→colonia, etc.)."
        : "";
    const prompt = `El usuario trabaja en ${tabHint}. Mensaje o petición asociada:\n---\n${hint}\n---\n\nDescribe con precisión lo que muestran las imágenes (UI, diagramas, datos, flujos, stack, texto visible, etc.). Responde en español, en viñetas; indica partes ilegibles o ambiguas.${benchmarkExtra}`;
    const out = await visionProvider.generateResponse(prompt, [], {
      systemPrompt:
        "Eres arquitecto de software: extrae solo información sustentada en las imágenes; no inventes.",
      userMessageImages: images,
    });
    return out.trim();
  }

  /** Alias del pipeline MDD (Manager LangGraph). */
  async describeImagesForMddPipeline(userText: string, images: ChatImagePart[]): Promise<string> {
    return this.describeImagesForChat(userText, images, "mdd");
  }

  async parseChecklist(text: string) {
    try {
      return await (await this.provider()).parseChecklist(text);
    } catch (err) {
      console.error("[AiService] parseChecklist error", err);
      throw err;
    }
  }

  /**
   * Genera el contenido de blueprint.md a partir del MDD.
   * Usa BLUEPRINT_PROMPT como system y el MDD como user message.
   */
  /**
   * Genera el documento Spec (SDD: what/why) desde Benchmark + opcional phase0/clarifiedScope.
   */
  async generateSpec(
    inputContent: string,
    phase0Summary?: string | null,
    source: "dbga" | "mdd" = "dbga",
    options?: LegacyGenerateOptions,
  ): Promise<string> {
    const raw = inputContent?.trim() ?? "";
    const legacyAsIsSpec = source === "mdd" && raw.length > 0 && options?.legacyBaselineStage === true;
    const content =
      source === "mdd" && raw.length > 0
        ? buildMddContextForSpec(raw, mddDeliverableCtx(options))
        : capTextForLegacyBaseline(raw, 12000, options?.legacyBaselineStage);
    const phase0 = capTextForLegacyBaseline(phase0Summary ?? "", 4000, options?.legacyBaselineStage);
    const label = source === "mdd" ? "MDD" : "Benchmark (DBGA)";
    const checklist = legacyAsIsSpec ? buildLegacyAsIsSpecCoverageChecklist(raw) : "";
    let prompt =
      content.length > 0
        ? (legacyAsIsSpec
            ? buildLegacyAsIsSpecUserPreamble(checklist)
            : `Genera el documento Spec según las instrucciones del system prompt.${
                source === "mdd"
                  ? " Refleja de forma exhaustiva todas las capacidades, actores y criterios UAT del MDD §1; recorre el CHECKLIST DE COBERTURA si aparece."
                  : ""
              }\n\n`) +
          `${label}:\n---\n${content}\n---` +
          (phase0 ? `\n\nResumen fase 0 / alcance:\n---\n${phase0}\n---` : "")
        : "No hay Benchmark ni MDD. Genera un Spec genérico (objetivos, alcance, criterios de éxito, user journeys) en markdown.";
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (source === "mdd" && content.length > 0 && !legacyAsIsSpec) {
      prompt = appendMddGovernancePatternsToPrompt(prompt, content);
    }
    if (options?.domainInventory?.processes?.length && !legacyAsIsSpec) {
      const journeys = options.domainInventory.processes
        .slice(0, 15)
        .map(
          (p) =>
            `- **${p.name}**${p.trigger ? ` — trigger \`${p.trigger}\`` : ""}` +
            (p.steps.length ? `: ${p.steps.slice(0, 5).join(" → ")}` : ""),
        )
        .join("\n");
      prompt +=
        `\n\n**Journeys (ProcessInventory — incluir como user journeys en Spec):**\n${journeys}\n` +
        "Cubre cada journey en sección de journeys/criterios; no inventes journeys ajenos al inventario.\n";
    }
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    const systemPrompt =
      SPEC_PROMPT + (legacyAsIsSpec ? LEGACY_AS_IS_SPEC_SYSTEM_APPENDIX : "");
    return this.finishDocumentGeneration("spec", options, prompt, systemPrompt);
  }

  /**
   * Clarify Spec pre-MDD (equivalent `/speckit.clarify`): marks ambiguities with [NEEDS CLARIFICATION].
   */
  async clarifySpec(
    specContent: string,
    context?: { dbgaContent?: string | null; brdContent?: string | null; notes?: string | null },
  ): Promise<string> {
    const spec = (specContent ?? "").trim();
    const dbga = (context?.dbgaContent ?? "").trim();
    const brd = (context?.brdContent ?? "").trim();
    const notes = (context?.notes ?? "").trim();
    const parts = [
      "Revisa y aclara el Spec según el system prompt. Marca ambigüedades con [NEEDS CLARIFICATION].\n",
      spec.length > 0 ? `Spec actual:\n---\n${spec}\n---` : "Spec vacío — genera esqueleto mínimo con marcadores.",
      dbga.length > 0 ? `\n\nContexto DBGA / Benchmark:\n---\n${dbga}\n---` : "",
      brd.length > 0 ? `\n\nBRD (alcance de negocio):\n---\n${brd}\n---` : "",
      notes.length > 0 ? `\n\nNotas del usuario:\n---\n${notes}\n---` : "",
    ];
    return this.generateResponse(parts.filter(Boolean).join("\n"), [], { systemPrompt: CLARIFY_SPEC_PROMPT });
  }

  /**
   * Clarify any SDD document: marks ambiguities with [NEEDS CLARIFICATION].
   */
  async clarifyDocument(
    documentContent: string,
    docLabel: string,
    context?: {
      notes?: string | null;
      relatedDocs?: Record<string, string>;
    },
  ): Promise<string> {
    const doc = (documentContent ?? "").trim();
    const notes = (context?.notes ?? "").trim();
    const related = context?.relatedDocs ?? {};
    const parts = [
      `Revisa y aclara el entregable **${docLabel}** según el system prompt. Marca ambigüedades con [NEEDS CLARIFICATION].\n`,
      doc.length > 0
        ? `${docLabel} actual:\n---\n${doc}\n---`
        : `${docLabel} vacío — genera esqueleto mínimo con marcadores.`,
      ...Object.entries(related).map(
        ([label, text]) => (text.trim() ? `\n\nContexto ${label}:\n---\n${text.trim()}\n---` : ""),
      ),
      notes.length > 0 ? `\n\nNotas del usuario:\n---\n${notes}\n---` : "",
    ];
    return this.generateResponse(parts.filter(Boolean).join("\n"), [], {
      systemPrompt: CLARIFY_DOCUMENT_PROMPT,
    });
  }

  /**
   * Integrates clarification answers and regenerates the full document without markers.
   */
  async resolveClarifications(
    documentContent: string,
    docLabel: string,
    answers: Array<{ question: string; answer: string }>,
  ): Promise<string> {
    const doc = (documentContent ?? "").trim();
    const qaBlock = answers
      .map((a, i) => `${i + 1}. **Pregunta:** ${a.question}\n   **Respuesta:** ${a.answer}`)
      .join("\n\n");
    const prompt = [
      `Regenera el ${docLabel} integrando las respuestas siguientes. Elimina todos los [NEEDS CLARIFICATION].\n`,
      `${docLabel} actual:\n---\n${doc}\n---\n`,
      `Respuestas del usuario:\n---\n${qaBlock}\n---`,
    ].join("\n");
    return this.generateResponse(prompt, [], { systemPrompt: RESOLVE_CLARIFICATIONS_PROMPT });
  }

  /**
   * Genera el documento Tasks (breakdown) desde MDD + Blueprint.
   */
  async generateTasks(
    mddContent: string,
    blueprintContent?: string | null,
    options?: LegacyGenerateOptions & {
      navigationMap?: string;
      specContent?: string | null;
      useCasesContent?: string | null;
      userStoriesContent?: string | null;
      apiContractsContent?: string | null;
      logicFlowsContent?: string | null;
      infraContent?: string | null;
      architectureContent?: string | null;
      uxUiGuideContent?: string | null;
      uiScreensContent?: string | null;
      gapsFeedback?: string | null;
      /** Bloque determinista: ChangeScope, resolve-change, module hints. */
      fileCoordinatesContext?: string | null;
      coordinatesMode?: boolean;
    },
  ): Promise<string> {
    const techDocsContext = await this.resolveTechDocsContext(mddContent, blueprintContent, options);
    const contractMode = Boolean(options?.tasksContractContext?.trim());

    const mdd = buildMddContextForTasks(mddContent?.trim() ?? "", mddDeliverableCtx(options));
    const blueprint = capTextForLegacyBaseline(blueprintContent ?? "", 15000, options?.legacyBaselineStage);
    const navMap = capTextForLegacyBaseline(options?.navigationMap ?? "", 8000, options?.legacyBaselineStage);
    const spec = capTextForLegacyBaseline(options?.specContent ?? "", 8000, options?.legacyBaselineStage);
    const useCases = capTextForLegacyBaseline(options?.useCasesContent ?? "", 10000, options?.legacyBaselineStage);
    const userStories = capTextForLegacyBaseline(options?.userStoriesContent ?? "", 12000, options?.legacyBaselineStage);
    const apiContracts = capTextForLegacyBaseline(options?.apiContractsContent ?? "", 20000, options?.legacyBaselineStage);
    const logicFlows = capTextForLegacyBaseline(options?.logicFlowsContent ?? "", 10000, options?.legacyBaselineStage);
    const infra = capTextForLegacyBaseline(options?.infraContent ?? "", 8000, options?.legacyBaselineStage);
    const architecture = capTextForLegacyBaseline(options?.architectureContent ?? "", 12000, options?.legacyBaselineStage);
    const designSystem = capTextForLegacyBaseline(options?.uxUiGuideContent ?? "", 10000, options?.legacyBaselineStage);
    const pantallas = capTextForLegacyBaseline(options?.uiScreensContent ?? "", 20000, options?.legacyBaselineStage);

    let prompt: string;
    if (contractMode) {
      const layerHint = options?.tasksGenerationLayer?.trim()
        ? `Capa activa: **${options.tasksGenerationLayer.trim()}**. `
        : "";
      prompt =
        layerHint +
        "Genera el documento Tasks según las instrucciones del system prompt. " +
        "Usa ÚNICAMENTE el manifiesto de contratos y context anchors — no inventes fuera del JSON.\n\n" +
        options!.tasksContractContext!.trim();
    } else if (mdd.length > 0) {
      prompt =
        "Genera el documento Tasks según las instrucciones del system prompt. " +
        "Deriva tareas comprobables para **cada** capacidad MVP, entidad §3, endpoint §4, flujo §5, control §6 e ítem §7 del MDD; recorre el CHECKLIST DE COBERTURA si aparece en el mensaje. " +
        "Incluye trazabilidad **MDD:** y **Story:** en cada ítem.\n\nMDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (blueprint ? "Blueprint:\n---\n" + blueprint + "\n---\n\n" : "");
    } else {
      prompt = "No hay MDD. Genera un documento Tasks genérico (Backend, Frontend, Infra) con ítems comprobables.";
    }

    if (!contractMode) {
      if (spec.length > 0) {
        prompt += "Spec (alcance what/why — alinear user stories):\n---\n" + spec + "\n---\n\n";
      }
      if (useCases.length > 0) {
        prompt += "Casos de uso (flujos actor-sistema — alinear tasks por UC):\n---\n" + useCases + "\n---\n\n";
      }
      if (userStories.length > 0) {
        prompt += "User Stories (backlog — una sección ## por HU cuando aplique):\n---\n" + userStories + "\n---\n\n";
      }
      if (apiContracts.length > 0) {
        prompt += "Contratos API (generar tarea Backend por endpoint listado):\n---\n" + apiContracts + "\n---\n\n";
      }
      if (logicFlows.length > 0) {
        prompt += "Flujos de lógica (generar tareas por flujo Mermaid o regla):\n---\n" + logicFlows + "\n---\n\n";
      }
      if (infra.length > 0) {
        prompt += "Infraestructura (generar tareas Infra por servicio/env):\n---\n" + infra + "\n---\n\n";
      }
      if (architecture.length > 0) {
        prompt += "Arquitectura (módulos, capas, convenciones — alinear rutas target_files):\n---\n" + architecture + "\n---\n\n";
      }
      if (designSystem.length > 0) {
        prompt += "Design system / UX guide (tokens y componentes autorizados para Frontend tasks):\n---\n" + designSystem + "\n---\n\n";
      }
      if (pantallas.length > 0) {
        prompt +=
          "Pantallas MCP (OBLIGATORIO: una Frontend task por vista/ruta; componentes y binding API reales):\n---\n" +
          pantallas +
          "\n---\n\n";
      }
      if (navMap.length > 0) {
        prompt += "\n\n## Mapa de Navegación del Proyecto\n\n" + navMap;
      }
    }
    if (options?.fileCoordinatesContext?.trim()) {
      prompt += "\n\n" + options.fileCoordinatesContext.trim() + "\n";
    }
    if (options?.coordinatesMode) {
      prompt =
        "**MODO COORDENADAS EXACTAS:** Obligatorio el formato T-NNN con Archivo, Función, Línea y diff en bloque Cambio cuando el contexto lo permita. " +
        "Si no hay línea exacta, indica archivo + función + posición relativa; nunca inventes rutas fuera del mapa.\n\n" +
        prompt;
    }
    prompt = appendPhase0ResearchBlock(prompt, options);
    prompt = appendGreenfieldCoverageChecklist(prompt, mddContent?.trim() ?? "", "Tasks", options, blueprintContent);
    if (options?.gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" +
        options.gapsFeedback.trim() +
        "\n---";
    }
    if (options?.tasksPlanJson?.trim()) {
      prompt +=
        "\n\n**PLAN JSON APROBADO (cobertura mínima obligatoria — expande CADA ítem en markdown YAML v2 completo; " +
        "si el CHECKLIST DE COBERTURA exige endpoints, pantallas, Testing o Deploy no listados en el plan, inclúyelos igual):**\n---\n" +
        options.tasksPlanJson.trim() +
        "\n---";
    }
    if (options?.tasksAuditorFeedback?.trim()) {
      prompt +=
        "\n\n**Feedback del Auditor Tasks:**\n---\n" +
        options.tasksAuditorFeedback.trim() +
        "\n---";
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    prompt = appendTechDocsContextBlock(prompt, techDocsContext);
    if (mdd.length > 0) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    return this.finishDocumentGeneration(
      "tasks",
      options,
      prompt,
      TASKS_PROMPT + NO_MILITAR_INSTRUCTION,
      { maxTokensOverride: resolveLlmMaxTokensForPurpose("tasksDoc") },
    );
  }

  /**
   * Genera el scaffold agent-governance/ (JSON con árbol de archivos) desde MDD + Blueprint.
   */
  async generateAgentGovernance(
    mddContent: string,
    blueprintContent: string | null | undefined,
    complexity: ComplexityLevel,
    options?: AgentGovernanceGenerateOptions,
  ): Promise<string> {
    const mdd = buildMddContextForAgentGovernance(mddContent?.trim() ?? "", mddDeliverableCtx(options));
    const blueprint = capTextForLegacyBaseline(blueprintContent ?? "", 15000, options?.legacyBaselineStage);
    const tasks = capTextForLegacyBaseline(options?.tasksContent ?? "", 12000, options?.legacyBaselineStage);
    const architecture = capTextForLegacyBaseline(options?.architectureContent ?? "", 12000, options?.legacyBaselineStage);
    const spec = capTextForLegacyBaseline(options?.specContent ?? "", 8000, options?.legacyBaselineStage);
    const constitutionNote =
      "El siguiente documento es la **Constitución del proyecto** (MDD, 7 secciones). " +
      "Deriva gobernanza de agentes únicamente de §1–§7 y patrones [X] del Wizard.\n\n";
    const suggestionsBlock = options?.suggestions
      ? formatSuggestedArtifactsPromptBlock(options.suggestions) + "\n\n"
      : "";
    let prompt =
      `Genera el scaffold **agent-governance/** según el system prompt.\n\n**complexity:** ${complexity}\n\n` +
      suggestionsBlock +
      (mdd.length > 0
        ? constitutionNote +
          "MDD:\n---\n" +
          mdd +
          "\n---"
        : "No hay MDD. Genera un scaffold mínimo LOW (AGENTS.md, CLAUDE.md, docs/agent-onboarding.md, 1 rule git-commits).");
    if (mdd.length > 0) {
      prompt = appendDeliverableSection(prompt, "Blueprint", blueprint, 15000, options?.legacyBaselineStage);
      prompt = appendDeliverableSection(prompt, "Architecture", architecture, 12000, options?.legacyBaselineStage);
      prompt = appendDeliverableSection(
        prompt,
        "Tasks (checklist — usar para PROMPT-INICIAL, AGENT-PROMPT y PROGRESO)",
        tasks,
        12000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(prompt, "Spec", spec, 8000, options?.legacyBaselineStage);
      prompt = appendDeliverableSection(
        prompt,
        "Contratos API",
        options?.apiContractsContent,
        12000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(
        prompt,
        "Flujos lógicos",
        options?.logicFlowsContent,
        8000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(
        prompt,
        "Design System",
        options?.uxUiGuideContent,
        8000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(
        prompt,
        "Pantallas (UI MCP)",
        options?.uiScreensContent,
        8000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(prompt, "Infra", options?.infraContent, 8000, options?.legacyBaselineStage);
      prompt = appendDeliverableSection(
        prompt,
        "Historias de usuario",
        options?.userStoriesContent,
        8000,
        options?.legacyBaselineStage,
      );
      prompt = appendDeliverableSection(
        prompt,
        "Casos de uso",
        options?.useCasesContent,
        8000,
        options?.legacyBaselineStage,
      );
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (mdd.length > 0) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    const suggestionsCount = options?.suggestions
      ? options.suggestions.suggestedRules.length + options.suggestions.suggestedSkills.length
      : 0;
    console.warn(
      `[agent-gov] ai.generateAgentGovernance promptLen=${prompt.length} suggestions=${suggestionsCount} archetypes=${options?.suggestions?.archetypes.length ?? 0} complexity=${complexity}`,
    );
    return this.finishDocumentGeneration(
      "agent-governance",
      options,
      prompt,
      AGENT_GOVERNANCE_PROMPT + NO_MILITAR_INSTRUCTION,
    );
  }

  async generateArchitecture(mddContent: string, blueprintContent?: string | null, options?: LegacyGenerateOptions & { gapsFeedback?: string | null }): Promise<string> {
    const techDocsContext = await this.resolveTechDocsContext(mddContent, blueprintContent, options);
    const mdd = buildMddContextForArchitecture(mddContent?.trim() ?? "", mddDeliverableCtx(options));
    const blueprint = capTextForLegacyBaseline(blueprintContent ?? "", 15000, options?.legacyBaselineStage);
    let prompt =
      mdd.length > 0
        ? "Genera el documento de **Arquitectura del sistema** (producto del MDD) según el system prompt. " +
        "Cubre de forma exhaustiva módulos, datos, APIs e integraciones del MDD; recorre el CHECKLIST DE COBERTURA si aparece. " +
        "Describe el software legacy real o planificado — **no** diseño multi-agente ni nombre TheForge como producto.\n\nMDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (blueprint ? "Blueprint:\n---\n" + blueprint + "\n---" : "")
        : "No hay MDD. Genera un documento breve de arquitectura genérica (capas, trade-offs) sin inventar dominio ni agentes.";
    prompt = appendPhase0ResearchBlock(prompt, options);
    prompt = appendGreenfieldCoverageChecklist(
      prompt,
      mddContent?.trim() ?? "",
      "Architecture",
      options,
      blueprintContent,
    );
    if (options?.gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" +
        options.gapsFeedback.trim() +
        "\n---";
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    prompt = appendTechDocsContextBlock(prompt, techDocsContext);
    if (mdd.length > 0) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    return this.finishDocumentGeneration(
      "architecture",
      options,
      prompt,
      ARCHITECTURE_PROMPT + NO_MILITAR_INSTRUCTION,
    );
  }

  async generateUseCases(mddContent: string, specContent?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const mddRaw = mddContent?.trim() ?? "";
    if (!mddRaw) {
      return (
        "# Casos de uso\n\n" +
        "No hay **MDD** (Constitución) disponible. No se generaron casos de uso automáticamente para **evitar inventar un dominio ajeno** al proyecto.\n\n" +
        "Completa el MDD y, si aplica, el **Spec**; luego vuelve a ejecutar **Generar casos de uso** desde el Workshop.\n"
      );
    }
    if (options?.omitLiteraryUcUs && options.domainInventory?.processes?.length) {
      return buildThinUseCasesFromInventory(options.domainInventory);
    }
    const legacyAsIsUseCases = options?.legacyBaselineStage === true;
    const mdd = buildMddContextForUseCases(mddRaw, mddDeliverableCtx(options));
    const spec = capTextForLegacyBaseline(specContent ?? "", 20000, options?.legacyBaselineStage);
    const checklist = legacyAsIsUseCases ? buildLegacyAsIsUseCasesCoverageChecklist(mddRaw) : "";
    let prompt = legacyAsIsUseCases
      ? buildLegacyAsIsUseCasesUserPreamble(checklist) +
        "MDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (spec ? "Spec (what/why — contexto, no sustituye el MDD):\n---\n" + spec + "\n---" : "")
      : "Genera el documento de Casos de Uso según las instrucciones del system prompt. " +
        "Cubre de forma exhaustiva cada capacidad MVP, actor, criterio UAT y dominio API del MDD. " +
        "Cada flujo debe alinearse al texto del MDD y del Spec; no cites archivos ni entidades que no aparezcan en esos documentos.\n\n" +
        (preferThinLiteraryDocs(options, "GENERATE_LITERARY_UC")
          ? "Modo thin activo — aplica **modo thin** del system prompt (journeys + matriz; sin novelas UC).\n\n"
          : "") +
        "MDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (spec ? "Spec (what/why):\n---\n" + spec + "\n---" : "");
    prompt = appendPhase0ResearchBlock(prompt, options);
    prompt = appendGreenfieldCoverageChecklist(prompt, mddRaw, "Use Cases", options);
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (!legacyAsIsUseCases) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    const systemPrompt =
      USE_CASES_PROMPT + (legacyAsIsUseCases ? LEGACY_AS_IS_USE_CASES_SYSTEM_APPENDIX : "");
    return this.finishDocumentGeneration("use-cases", options, prompt, systemPrompt);
  }

  async generateUserStories(mddContent: string, specContent?: string | null, useCasesContent?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const mddRaw = mddContent?.trim() ?? "";
    if (options?.omitLiteraryUcUs && options.domainInventory) {
      return buildThinUserStoriesFromInventory(options.domainInventory);
    }
    const legacyAsIsUserStories = options?.legacyBaselineStage === true && mddRaw.length > 0;
    const mdd = buildMddContextForUserStories(mddRaw, mddDeliverableCtx(options));
    const spec = capTextForLegacyBaseline(specContent ?? "", 15000, options?.legacyBaselineStage);
    const useCases = capTextForLegacyBaseline(useCasesContent ?? "", 20000, options?.legacyBaselineStage);
    const checklist = legacyAsIsUserStories ? buildLegacyAsIsUserStoriesCoverageChecklist(mddRaw) : "";
    const constitutionNote =
      "El **MDD es la Constitución del proyecto**. Las historias de usuario deben derivarse **únicamente** del MDD, Spec y Casos de Uso. No inventes funcionalidades no descritas en estos documentos.\n\n";
    let prompt: string;
    if (mdd.length > 0) {
      prompt = legacyAsIsUserStories
        ? buildLegacyAsIsUserStoriesUserPreamble(checklist) +
          "MDD:\n---\n" +
          mdd +
          "\n---\n\n" +
          (spec ? "Spec (what/why — contexto):\n---\n" + spec + "\n---\n\n" : "") +
          (useCases ? "Casos de Uso (flujos — traza HU ↔ CU):\n---\n" + useCases + "\n---" : "")
        : "Genera el documento de Historias de Usuario según las instrucciones del system prompt. " +
          constitutionNote +
          (preferThinLiteraryDocs(options, "GENERATE_LITERARY_US")
            ? "Modo thin activo — aplica **modo thin** del system prompt (HU trazables sin prosa literaria).\n\n"
            : "") +
          "MDD:\n---\n" +
          mdd +
          "\n---\n\n" +
          (spec ? "Spec:\n---\n" + spec + "\n---\n\n" : "") +
          (useCases ? "Casos de Uso:\n---\n" + useCases + "\n---" : "");
    } else {
      prompt =
        "No hay MDD disponible. No generes historias inventadas. Responde con un documento markdown que contenga solo un título " +
        "# Historias de Usuario y un párrafo indicando que se requiere el MDD (y opcionalmente Spec y Casos de Uso) para derivar historias de usuario alineadas al alcance del proyecto.";
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (options?.externalLegacyContextBlock?.trim()) {
      prompt = options.externalLegacyContextBlock.trim() + "\n\n---\n\n" + prompt;
    }
    if (options?.integrationHandoffItems?.length && !legacyAsIsUserStories) {
      const handoffBlock =
        options.integrationNewProject
          ? "**Integración legacy (MDD de cambio):** implementa handoff del proyecto NEW `" +
            options.integrationNewProject.id +
            "` (" +
            options.integrationNewProject.name +
            ").\n\n"
          : "";
      const rows = options.integrationHandoffItems
        .map(
          (i) =>
            `- **${i.id}** — ${i.title}: ${i.description.slice(0, 500)}` +
            (options.integrationNewProject ? " → incluir **Satisface:** `" + i.id + "` en la HU legacy correspondiente" : ""),
        )
        .join("\n");
      prompt +=
        "\n\n---\n\n" +
        handoffBlock +
        "**Handoff de integración (obligatorio en el backlog):**\n" +
        rows +
        "\n";
    }
    if (mdd.length > 0 && !legacyAsIsUserStories) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    const systemPrompt =
      USER_STORIES_PROMPT + (legacyAsIsUserStories ? LEGACY_AS_IS_USER_STORIES_SYSTEM_APPENDIX : "");
    return this.finishDocumentGeneration("user-stories", options, prompt, systemPrompt);
  }

  async generateBlueprint(mddContent: string, gapsFeedback?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const mddRaw = mddContent?.trim() ?? "";
    const legacyAsIsBlueprint = options?.legacyBaselineStage === true && mddRaw.length > 0;
    const mdd = buildMddContextForBlueprint(mddRaw, mddDeliverableCtx(options));
    const checklist = legacyAsIsBlueprint ? buildLegacyAsIsBlueprintCoverageChecklist(mddRaw) : "";
    const constitutionNote =
      "El siguiente documento es la **Constitución del proyecto** (MDD). Tu salida debe adherirse a él en todo momento.\n\n";
    let prompt =
      mdd.length > 0
        ? (legacyAsIsBlueprint
            ? buildLegacyAsIsBlueprintUserPreamble(checklist)
            : "Genera el blueprint.md según las instrucciones del system prompt. " +
              "Lista **todas** las entidades de §3 y **todos** los endpoints de §4; recorre el CHECKLIST DE COBERTURA si aparece. ") +
          (legacyAsIsBlueprint ? "" : constitutionNote) +
          "MDD:\n\n---\n" +
          mdd +
          "\n---"
        : "No hay MDD aún. Genera un blueprint.md genérico para un monorepo Turborepo con NestJS, React, Prisma y PostgreSQL.";
    if (gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" + gapsFeedback.trim() + "\n---";
    }
    prompt = appendPhase0ResearchBlock(prompt, options);
    prompt = appendGreenfieldCoverageChecklist(prompt, mddRaw, "Blueprint", options);
    if (mdd.length > 0 && !legacyAsIsBlueprint) {
      prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);

    let systemPrompt = BLUEPRINT_PROMPT + NO_MILITAR_INSTRUCTION;
    if (legacyAsIsBlueprint) systemPrompt += LEGACY_AS_IS_BLUEPRINT_SYSTEM_APPENDIX;
    if (options?.theforgeContext?.trim()) {
      systemPrompt += legacyAsIsBlueprint
        ? LEGACY_AS_IS_BLUEPRINT_THEFORGE_APPENDIX
        : "\n\n**CRÍTICO — Proyecto existente (contexto Relic):** El bloque anterior describe el codebase REAL indexado por el MCP. El Blueprint DEBE describir ÚNICAMENTE esta estructura y stack. **PROHIBIDO inventar:** no Turborepo, Nx, NestJS, ni nuevos repos ni directorios que no aparezcan en ese contexto. El sistema puede tener uno o varios repositorios; indica los repos y carpetas reales. Solo añade o modifica lo que el MDD exija para el cambio. Si el contexto no menciona un framework concreto, no lo inventes.";
    }

    return this.finishDocumentGeneration("blueprint", options, prompt, systemPrompt);
  }

  async generateApiContracts(mddContent: string, blueprintContent?: string | null, gapsFeedback?: string | null, brdContent?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const techDocsContext = await this.resolveTechDocsContext(mddContent, blueprintContent, options);
    const mdd = buildMddContextForApiContracts(mddContent?.trim() ?? "", mddDeliverableCtx(options));
    const blueprint = capTextForLegacyBaseline(blueprintContent ?? "", 16000, options?.legacyBaselineStage);
    const brd = capTextForLegacyBaseline(brdContent ?? "", 8000, options?.legacyBaselineStage);
    const constitutionNote =
      "El siguiente documento es la **Constitución del proyecto** (MDD). Tu salida debe adherirse a él en todo momento.\n\n";
    let prompt =
      mdd.length > 0
        ? "Genera el documento de Contratos de API según las instrucciones del system prompt. " +
        "Documenta **cada** endpoint de la tabla §4 del MDD (una fila por ruta); recorre el CHECKLIST DE COBERTURA si aparece.\n\n" +
        constitutionNote +
        "MDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (blueprint ? "Blueprint (esquema Prisma / estructura):\n---\n" + blueprint + "\n---" : "") +
        (brd ? "\n\n**BRD (requerimientos de negocio):** Los contratos de API deben satisfacer estos requerimientos.\n---\n" + brd + "\n---" : "")
        : "No hay MDD. Genera un documento de contratos API genérico (endpoints, request/response, códigos HTTP).";
    if (gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" + gapsFeedback.trim() + "\n---";
    }
    prompt = appendPhase0ResearchBlock(prompt, options);
    prompt = appendGreenfieldCoverageChecklist(
      prompt,
      mddContent?.trim() ?? "",
      "API Contracts",
      options,
      blueprintContent,
    );
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    prompt = appendTechDocsContextBlock(prompt, techDocsContext);
    if (options?.contractSpecs?.trim()) {
      const specsBlock = capTextForLegacyBaseline(options.contractSpecs, 12000, options?.legacyBaselineStage);
      prompt +=
        "\n\n**Contratos reales desde el codebase (get_contract_specs):** Usa estas firmas, props y tipos reales para alinear los endpoints del documento. No inventes tipos que contradigan esta evidencia.\n---\n" +
        specsBlock +
        "\n---";
    }
    if (mdd.length > 0) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    return this.finishDocumentGeneration(
      "api-contracts",
      options,
      prompt,
      API_CONTRACTS_PROMPT + NO_MILITAR_INSTRUCTION,
    );
  }

  async generateLogicFlows(mddContent: string, gapsFeedback?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const mddRaw = mddContent?.trim() ?? "";
    const legacyAsIsLogicFlows = options?.legacyBaselineStage === true && mddRaw.length > 0;

    if (legacyAsIsLogicFlows && isLegacyAsIsLogicFlowsBatchEnabled()) {
      const services = extractSection5Services(mddRaw);
      const batchSize = readLogicFlowsBatchSize();
      if (services.length > batchSize) {
        return this.generateLogicFlowsBatched(mddRaw, gapsFeedback, options, services, batchSize);
      }
    }

    return this.invokeLogicFlowsLlm(mddRaw, options, gapsFeedback, {});
  }

  private async generateLogicFlowsBatched(
    mddRaw: string,
    gapsFeedback: string | null | undefined,
    options: LegacyGenerateOptions | undefined,
    services: MddSection5ServiceRow[],
    batchSize: number,
  ): Promise<string> {
    const batches = chunkArray(services, batchSize);
    const parts: string[] = [];
    let flowNum = 1;

    for (let i = 0; i < batches.length; i++) {
      const body = await this.invokeLogicFlowsLlm(mddRaw, options, gapsFeedback, {
        batchServices: batches[i],
        batchIndex: i,
        totalBatches: batches.length,
        startFlowNumber: flowNum,
        fragmentOnly: true,
      });
      parts.push(body);
      flowNum += batches[i]!.length;
    }

    let mergedBody = parts.map(stripLogicFlowsFragmentWrapper).filter(Boolean).join("\n\n---\n\n");

    if (isLegacyAsIsLogicFlowsGapPassEnabled()) {
      let { coverage } = finalizeLogicFlowsDocument(mergedBody, mddRaw);
      if (!coverage.metTarget && coverage.missingServices.length > 0) {
        const missingRows = coverage.missingServices.map((service) => ({ service }));
        const gapChunks = chunkArray(missingRows, batchSize);
        for (let i = 0; i < gapChunks.length; i++) {
          const chunk = gapChunks[i]!;
          const gapFeedback =
            (gapsFeedback?.trim() ? `${gapsFeedback.trim()}\n\n` : "") +
            `**Re-pase cobertura §5:** documenta obligatoriamente estos servicios aún sin mención: ${chunk.map((s) => s.service).join(", ")}.`;
          const body = await this.invokeLogicFlowsLlm(mddRaw, options, gapFeedback, {
            batchServices: chunk,
            batchIndex: i,
            totalBatches: gapChunks.length,
            startFlowNumber: flowNum,
            fragmentOnly: true,
            gapPass: true,
          });
          mergedBody += `\n\n---\n\n${stripLogicFlowsFragmentWrapper(body)}`;
          flowNum += chunk.length;
        }
      }
    }

    return finalizeLogicFlowsDocument(mergedBody, mddRaw).content;
  }

  private async invokeLogicFlowsLlm(
    mddRaw: string,
    options: LegacyGenerateOptions | undefined,
    gapsFeedback: string | null | undefined,
    fragment: {
      batchServices?: MddSection5ServiceRow[];
      batchIndex?: number;
      totalBatches?: number;
      startFlowNumber?: number;
      fragmentOnly?: boolean;
      gapPass?: boolean;
    },
  ): Promise<string> {
    const legacyAsIsLogicFlows = options?.legacyBaselineStage === true && mddRaw.length > 0;
    const mdd = buildMddContextForLogicFlows(mddRaw, mddDeliverableCtx(options));

    let checklist = "";
    if (fragment.batchServices?.length && fragment.fragmentOnly) {
      checklist = buildLogicFlowsBatchUserPreamble(
        mddRaw,
        fragment.batchServices,
        fragment.batchIndex ?? 0,
        fragment.totalBatches ?? 1,
        fragment.startFlowNumber ?? 1,
      );
    } else if (legacyAsIsLogicFlows) {
      checklist = buildLegacyAsIsLogicFlowsUserPreamble(buildLegacyAsIsLogicFlowsCoverageChecklist(mddRaw));
    }

    const constitutionNote =
      "El siguiente documento es la **Constitución del proyecto** (MDD). Tu salida debe adherirse a él en todo momento.\n\n";
    let prompt =
      mdd.length > 0
        ? (legacyAsIsLogicFlows
            ? checklist
            : "Genera el documento de Casos de Uso y Flujos de Lógica según las instrucciones del system prompt. " +
              "Cubre de forma exhaustiva cada criterio UAT, edge case y flujo de seguridad del MDD; recorre el CHECKLIST DE COBERTURA si aparece. " +
              constitutionNote) +
          "MDD:\n\n---\n" +
          mdd +
          "\n---"
        : "No hay MDD. Genera un documento de flujos genérico (diagramas Mermaid, reglas de validación).";
    if (gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" + gapsFeedback.trim() + "\n---";
    }
    if (!legacyAsIsLogicFlows) {
      prompt = appendPhase0ResearchBlock(prompt, options);
      prompt = appendGreenfieldCoverageChecklist(prompt, mddRaw, "Logic Flows", options);
    }
    const diagramHint = buildLogicFlowsDiagramHint(mddRaw);
    if (diagramHint) prompt += `\n\n${diagramHint}\n`;
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (mdd.length > 0 && !legacyAsIsLogicFlows) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);

    let systemPrompt = LOGIC_FLOWS_PROMPT + NO_MILITAR_INSTRUCTION;
    if (legacyAsIsLogicFlows) systemPrompt += LEGACY_AS_IS_LOGIC_FLOWS_SYSTEM_APPENDIX;
    if (fragment.fragmentOnly && fragment.startFlowNumber) {
      systemPrompt += buildLogicFlowsBatchSystemAppendix(fragment.startFlowNumber);
    }
    if (options?.theforgeContext?.trim()) {
      systemPrompt += legacyAsIsLogicFlows ? LEGACY_AS_IS_LOGIC_FLOWS_THEFORGE_APPENDIX : "";
    }

    return this.finishDocumentGeneration("logic-flows", options, prompt, systemPrompt);
  }

  async generateInfra(mddContent: string, blueprintContent?: string | null, gapsFeedback?: string | null, options?: LegacyGenerateOptions): Promise<string> {
    const mdd = buildMddContextForInfra(mddContent?.trim() ?? "", mddDeliverableCtx(options));
    const blueprint = capTextForLegacyBaseline(blueprintContent ?? "", 6000, options?.legacyBaselineStage);
    const constitutionNote =
      "El siguiente documento es la **Constitución del proyecto** (MDD). Tu salida debe adherirse a él en todo momento.\n\n";
    let prompt =
      mdd.length > 0
        ? "Genera el documento de Infraestructura y Despliegue según las instrucciones del system prompt. " +
        "Cubre **todos** los servicios, volúmenes y variables que §7 y el stack del MDD exigen; recorre el CHECKLIST DE COBERTURA si aparece.\n\n" +
        constitutionNote +
        "MDD:\n---\n" +
        mdd +
        "\n---\n\n" +
        (blueprint ? "Blueprint (estructura de carpetas / servicios):\n---\n" + blueprint + "\n---" : "")
        : "No hay MDD. Genera un documento de infra genérico (Dockerfile, docker-compose, .env.example).";
    if (gapsFeedback?.trim()) {
      prompt +=
        "\n\n**Los siguientes puntos deben corregirse o incorporarse:**\n---\n" + gapsFeedback.trim() + "\n---";
    }
    if (options?.theforgeContext?.trim()) prompt = prependTheForgePrompt(prompt, options.theforgeContext);
    if (mdd.length > 0) prompt = appendMddGovernancePatternsToPrompt(prompt, mdd);
    prompt = appendLegacyBaselineDetailPrompt(prompt, options?.legacyBaselineStage);
    if (mdd.length > 0) {
      prompt = appendGreenfieldCoverageChecklist(prompt, mddContent?.trim() ?? "", "Infra", options, blueprintContent);
    }
    return this.finishDocumentGeneration(
      "infra",
      options,
      prompt,
      INFRA_PROMPT + NO_MILITAR_INSTRUCTION,
    );
  }

  /** Guía UX/UI (markdown). Hooks opcionales vía `options.projectId`. */
  async generateUxUiGuide(
    uxPrompt: string,
    options?: LegacyGenerateOptions,
    generateOptions?: GenerateResponseOptions,
  ): Promise<string> {
    return this.finishDocumentGeneration(
      "ux-ui-guide",
      options,
      uxPrompt,
      UX_UI_GUIDE_PROMPT,
      generateOptions,
    );
  }

  /**
   * Reflexión (SDD Fase 3): verifica si un entregable cumple el MDD. Devuelve texto breve (Cumple / No cumple + gaps).
   */
  async verifyDeliverable(
    mddContent: string,
    documentContent: string,
    deliverableKind: "blueprint" | "api" | "infra" | "logicFlows",
  ): Promise<string> {
    const kindLabel = {
      blueprint: "Blueprint",
      api: "Contratos de API",
      infra: "Infraestructura",
      logicFlows: "Flujos de lógica",
    }[deliverableKind];
    const prompt = `Verifica si el siguiente documento **${kindLabel}** cumple el MDD (Constitución) que se proporciona.\n\nMDD:\n---\n${(mddContent || "").trim()}\n---\n\nDocumento ${kindLabel}:\n---\n${(documentContent || "").trim()}\n---`;
    return this.generateResponse(prompt, [], { systemPrompt: VERIFY_DELIVERABLE_PROMPT });
  }

  /**
   * Conformance por LLM: devuelve { ok, gaps } para complementar heurísticas y reducir falsos positivos/negativos.
   */
  /**
   * Enmienda constitucional (SDD): alinea §3 y/o §4 con un delta detectado en entregables (Blueprint/API).
   */
  private static readonly mddGapPatchOutputSchema = z.object({
    mddContent: z.string().min(1),
  });

  /**
   * Parche focalizado del MDD tras un documentation gap (referencia §N + evidencia).
   */
  async patchMddFromGapFeedback(currentMdd: string, gapsFeedback: string): Promise<string | null> {
    const draft = currentMdd.trim();
    const feedback = gapsFeedback.trim();
    if (!draft || !feedback) return null;

    const payload = JSON.stringify(
      {
        mdd_actual: draft.slice(0, 48_000),
        gap_feedback: feedback,
      },
      null,
      2,
    );

    try {
      const raw = await this.generateResponse(payload, [], { systemPrompt: MDD_DOC_GAP_PATCH_PROMPT });
      const parsed = parseJsonOrThrow(raw, AiService.mddGapPatchOutputSchema);
      const next = parsed.mddContent.trim();
      if (!next || next.length < Math.min(200, draft.length * 0.5)) return null;
      return next;
    } catch (err) {
      this.logger.warn(
        `[patchMddFromGapFeedback] falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async proposeMddAmendment(params: {
    currentMdd: string;
    targetSections: number[];
    rationale: string;
    artifactExcerpt: string;
  }): Promise<string> {
    const sec = params.targetSections.filter((n) => n === 3 || n === 4);
    if (sec.length === 0) {
      throw new Error("targetSections debe incluir 3 y/o 4");
    }
    const label = sec.join(" y ");
    const prompt =
      `Actualiza el Master Design Document (markdown) incorporando el impacto descrito. ` +
      `Modifica solo las secciones ## 3. … y/o ## 4. … según corresponda; el documento completo debe seguir siendo coherente (7 secciones canónicas).\n\n` +
      `**Razonamiento / impacto:**\n${params.rationale}\n\n` +
      `**Extracto del entregable que provoca el cambio:**\n---\n${params.artifactExcerpt}\n---\n\n` +
      `**MDD actual (completo):**\n---\n${params.currentMdd}\n---\n\n` +
      `Devuelve el MDD completo en markdown, con las secciones §${label} alineadas al extracto.`;
    const system =
      "Eres el guardián de la Constitución SDD. No contradigas el stack ni el dominio ya fijados en otras secciones. " +
      "Conserva encabezados canónicos (## 1. … … ## 7.). Salida: solo el markdown del MDD.";
    return this.generateResponse(prompt, [], { systemPrompt: system });
  }

  async conformanceCheck(
    mddContent: string,
    documentContent: string,
    kind: "blueprint" | "api" | "logicFlows" | "infra",
  ): Promise<{ ok: boolean; gaps: string[] }> {
    const kindLabel = { blueprint: "Blueprint", api: "Contratos de API", logicFlows: "Flujos de lógica", infra: "Infraestructura" }[kind];
    const prompt = `¿El siguiente documento **${kindLabel}** cumple el MDD?\n\nMDD:\n---\n${(mddContent || "").trim()}\n---\n\nDocumento ${kindLabel}:\n---\n${(documentContent || "").trim()}\n---`;
    try {
      const raw = await this.generateResponse(prompt, [], { systemPrompt: CONFORMANCE_CHECK_PROMPT });
      const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(trimmed) as { ok?: boolean; gaps?: string[] };
      const ok = parsed?.ok === true;
      const gaps = Array.isArray(parsed?.gaps) ? parsed.gaps.filter((g) => typeof g === "string") : [];
      return { ok, gaps };
    } catch (err) {
      this.logger.warn(
        `[conformanceCheck] ${kind} parse/LLM falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, gaps: ["Verificación de conformidad con IA no disponible — revisar manualmente o repetir con ?useLlm=true"] };
    }
  }

  async generateAem(
    input: {
      marketScope: AemMarketScope;
      benchmarkContent?: string | null;
      phase0Content?: string | null;
      brdContent?: string | null;
      projectName?: string | null;
    },
    options?: LegacyGenerateOptions,
  ): Promise<string> {
    const cap = (raw: string | null | undefined, max: number) => {
      const t = (raw ?? "").trim();
      if (t.length <= max) return t;
      return `${t.slice(0, max)}\n\n[... contenido truncado ...]`;
    };

    const benchmark = cap(input.benchmarkContent, 28000);
    const phase0 = cap(input.phase0Content, 28000);
    const brd = cap(input.brdContent, 22000);
    const scopeLabel =
      input.marketScope === "global"
        ? "Global (mundial)"
        : input.marketScope === "mexico"
          ? "México"
          : "LATAM (América Latina)";

    const scopeInstruction =
      input.marketScope === "global"
        ? "Enfoca todo el estudio a nivel **global/internacional**."
        : input.marketScope === "mexico"
          ? "Enfoca todo el estudio al mercado **mexicano** (competidores, regulación y pricing en MXN cuando aplique)."
          : "Enfoca todo el estudio a **LATAM** (comparar mercados regionales clave; pricing en moneda local o USD según segmento).";

    const parts = [
      `Genera el documento **AEM — Análisis y Estudio de Mercado** según el system prompt.`,
      `**Alcance geográfico obligatorio:** ${scopeLabel}. ${scopeInstruction}`,
      input.projectName?.trim() ? `**Proyecto:** ${input.projectName.trim()}` : "",
      benchmark.length > 0 ? `Benchmark / Deep Research:\n---\n${benchmark}\n---` : "",
      phase0.length > 0 ? `Fase 0 (DBGA / borrador):\n---\n${phase0}\n---` : "",
      brd.length > 0 ? `BRD (alcance de negocio):\n---\n${brd}\n---` : "",
    ].filter(Boolean);

    if (!benchmark && !phase0 && !brd) {
      return (
        "# Análisis y Estudio de Mercado (AEM)\n\n" +
        "No hay Benchmark, Fase 0 ni BRD disponibles. Completa al menos uno de esos documentos y vuelve a generar el AEM.\n"
      );
    }

    return this.finishDocumentGeneration("aem", options, parts.join("\n\n"), AEM_PROMPT);
  }

  /** Dictamen de inversión digital que complementa el AEM generado. */
  async generateAemInvestmentAdvisory(input: {
    aemContent: string;
    marketScope: AemMarketScope;
    projectName?: string | null;
    benchmarkContent?: string | null;
    phase0Content?: string | null;
    brdContent?: string | null;
  }): Promise<string> {
    const cap = (raw: string | null | undefined, max: number) => {
      const t = (raw ?? "").trim();
      if (t.length <= max) return t;
      return `${t.slice(0, max)}\n\n[... contenido truncado ...]`;
    };

    const aem = cap(input.aemContent, 45000);
    if (!aem) {
      return (
        "# Dictamen de inversión digital\n\n" +
        "No hay AEM para analizar. Genera primero el Análisis y Estudio de Mercado.\n"
      );
    }

    const scopeLabel =
      input.marketScope === "global"
        ? "Global"
        : input.marketScope === "mexico"
          ? "México"
          : "LATAM";

    const benchmark = cap(input.benchmarkContent, 8000);
    const phase0 = cap(input.phase0Content, 8000);
    const brd = cap(input.brdContent, 8000);

    const parts = [
      "Analiza el **AEM** adjunto y genera el **Dictamen de inversión digital** según el system prompt.",
      `**Alcance geográfico del estudio:** ${scopeLabel}.`,
      input.projectName?.trim() ? `**Proyecto:** ${input.projectName.trim()}` : "",
      `AEM (documento a analizar):\n---\n${aem}\n---`,
      benchmark.length > 0 ? `Contexto adicional — Benchmark:\n---\n${benchmark}\n---` : "",
      phase0.length > 0 ? `Contexto adicional — Fase 0:\n---\n${phase0}\n---` : "",
      brd.length > 0 ? `Contexto adicional — BRD:\n---\n${brd}\n---` : "",
    ].filter(Boolean);

    return this.generateResponse(parts.join("\n\n"), [], {
      systemPrompt: AEM_INVESTMENT_ADVISOR_PROMPT,
    });
  }

  /** Regenera diagrama Mermaid roto/incompleto para el visor del Workshop. */
  async regenerateMermaidDiagram(brokenContent: string): Promise<string> {
    const broken = (brokenContent ?? "").trim();
    if (!broken) return "";

    const prompt =
      "Reconstruye el diagrama Mermaid siguiente. Completa el flujo si está truncado.\n\n" +
      `---\n${broken.slice(0, 14_000)}\n---`;

    const raw = await this.generateResponse(prompt, [], {
      systemPrompt: MERMAID_REGENERATE_PROMPT,
      maxTokensOverride: resolveLlmMaxTokensForPurpose("checklist", 4096),
    });

    const body = stripMermaidFenceWrappers(raw.trim());
    const normalized = repairMermaidBlockBody(body);
    return normalized.trim() || body.trim();
  }
}
