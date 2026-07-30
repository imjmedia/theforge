/**
 * @fileoverview Nodo arquitecto de software — genera especificaciones de arquitectura.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { softwareArchitectMddPrompt } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { mddContratosApiSchema } from "../state/mdd-structured.schema.js";
import { mddStructuredToMarkdown } from "../render/mdd-structured-to-markdown.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import {
  applyDeploymentStackDirectiveToDraft,
  ensureContratosSection,
  extractContratosSectionBody,
  extractSection3Body,
  extractSection6Body,
  extractSection7Body,
  getMddDraftSummary,
  getSectionsToPreserveFromExecutorPlan,
  isContratosPlaceholder,
  isContratosSectionRegression,
  isContratosSubstantial,
  isMddSectionPlaceholderBody,
  isMddSectionPipelinePlaceholderBody,
  logMddNodeOutput,
  logSection3Debug,
  normalizeMddFormat,
  parseModeloDatosFromSection3Markdown,
  preserveContextSectionIfSubstantial,
  restoreArquitecturaSectionFromBaselineIfMissing,
  preserveUntouchedMddSectionsFromBaseline,
  replaceContextWhenOnlyMetadata,
  replaceMddSection4Body,
  sanitizeContextSection,
  tryMergeSingleArchitectSectionIntoDraft,
  deduplicateMddDraftSections,
} from "../utils/mdd-sanitize.js";
import { repairMergeBaselineBeforeApiContractsMerge } from "../utils/mdd-api-contracts-merge.util.js";
import {
  architectScopePromptPrefix,
  architectScopeSectionNumber,
  formatScopedArchitectFullMddRejectFeedback,
  formatScopedArchitectMergeRejectFeedback,
  isHighSplitArchitectPipeline,
  processScopedArchitectResponse,
  resolveArchitectMergeBaseline,
  shouldDecoupleSection5FromArchitect,
  type MddSoftwareArchitectScope,
} from "../utils/mdd-architect-pipeline.util.js";
import { getUserBrief, getUserExplicitRequirements } from "../utils/mdd-user-brief.js";
import { ensureSection5TailParallelPlaceholder } from "../utils/mdd-tail-parallel.util.js";
import {
  canUseSurgicalMergeBaseline,
  draftHasPersistableSection4,
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  preserveNonTargetValidatedSectionsAfterArchitectMerge,
  preserveSection1FromClarifierSnapshot,
  preserveSection2FromStackSnapshot,
  preserveSection3FromDataModelSnapshot,
  preserveSection4FromApiContractsSnapshot,
  preserveValidatedSectionsIfSubstantial,
} from "../utils/mdd-section-preserve.util.js";
import {
  buildUserDeclaredStackPromptBlock,
  STACK_TECHNOLOGY_REGEX,
} from "../utils/user-declared-stack.util.js";
import { extractFirstJsonObject, extractJsonFromCodeBlock } from "../utils/parse-json.js";
import { parseJsonOrThrow } from "../utils/parse-json.js";
import { getInternalDirectivesContext, extractInternalDirectives } from "../utils/mdd-mesh-topology.js";
import { softwareArchitectComplexityAppendix } from "../utils/mdd-complexity-rigor.js";
import { buildUiMcpFrontendArchitectHint } from "../utils/mdd-inject-ui-mcp-frontend.util.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { invokeScopedArchitectLlmWithHeadingCap } from "../utils/mdd-scoped-stream.util.js";
import { buildArchitectScopedContext } from "../utils/build-architect-scoped-context.util.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import {
  domainInventoryPromptBlock,
  mddStateHasDomainAuthSkew,
} from "../utils/mdd-domain-prompt.util.js";
import type { TheForgeService } from "../../theforge/theforge.service.js";
import { getMddArchitectTheForgeTools } from "../tools/agent-theforge-tools.js";
import { stripThinkingTags } from "../utils/mdd-security-parse.js";
import { z } from "zod";

/** Schema estructurado que algunos LLMs devuelven en lugar de mddDraft. */
const structuredSchema = z.object({
  sqlSchema: z.object({ tables: z.record(z.unknown()) }).optional(),
  apiContracts: z.object({ endpoints: z.record(z.unknown()) }).optional(),
  logicaEdgeCases: z.string().optional(),
}).passthrough();

/**
 * Normaliza `tables` cuando el LLM devuelve array (ej. [{ name: "users", columns: [{ name, type, primaryKey, unique }] }])
 * a formato record esperado por structuredToMarkdown: { "users": { "columns": { "id": "UUID PRIMARY KEY", ... } } }.
 */
function normalizeTablesToRecord(tables: unknown): Record<string, { columns: Record<string, string> }> | null {
  if (!tables || typeof tables !== "object") return null;
  if (!Array.isArray(tables)) return tables as Record<string, { columns: Record<string, string> }>;

  const record: Record<string, { columns: Record<string, string> }> = {};
  for (const row of tables) {
    const t = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    const name = typeof t.name === "string" ? t.name : "table";
    const colsRaw = t.columns;
    const cols: Record<string, string> = {};
    if (Array.isArray(colsRaw)) {
      for (const c of colsRaw) {
        const col = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
        const colName = typeof col.name === "string" ? col.name : "id";
        const type = typeof col.type === "string" ? col.type : "VARCHAR(255)";
        const parts = [type];
        if (col.primaryKey) parts.push("PRIMARY KEY");
        if (col.unique) parts.push("UNIQUE");
        if (col.notNull !== false) parts.push("NOT NULL");
        cols[colName] = parts.join(" ");
      }
    }
    record[name] = { columns: Object.keys(cols).length ? cols : { id: "UUID PRIMARY KEY DEFAULT gen_random_uuid()" } };
  }
  return Object.keys(record).length ? record : null;
}

/** Convierte sqlSchema + apiContracts a markdown MDD con 7 secciones (2 Arquitectura, 3 Modelo, 4 Contratos, 5 Lógica). */
function structuredToMarkdown(parsed: z.infer<typeof structuredSchema>, contextIntro: string): string {
  const intro = contextIntro.trim() || "(Contexto del Clarificador.)";
  const contextBody =
    intro.startsWith("{") && intro.includes('"')
      ? (() => {
        try {
          const obj = JSON.parse(intro) as Record<string, unknown>;
          return Object.entries(obj)
            .map(([k, v]) => `- **${k}:** ${typeof v === "string" ? v : String(v)}`)
            .join("\n");
        } catch {
          return intro;
        }
      })()
      : intro;
  const sections: string[] = [
    "# Master Design Document",
    "",
    "## 1. Contexto",
    "",
    contextBody,
    "",
    "## 2. Arquitectura y Stack",
    "",
    "(Pendiente: Arquitecto de Software)",
    "",
  ];

  const tables = parsed.sqlSchema?.tables;
  if (tables && typeof tables === "object" && !Array.isArray(tables)) {
    sections.push("## 3. Modelo de Datos", "", "```sql");
    for (const [tableName, def] of Object.entries(tables)) {
      const defObj = def && typeof def === "object" && !Array.isArray(def) ? def as Record<string, unknown> : {};
      const cols = defObj.columns && typeof defObj.columns === "object" && !Array.isArray(defObj.columns)
        ? defObj.columns as Record<string, string>
        : {};
      const columnDefs: string[] = [];
      const constraints: string[] = [];
      for (const [k, v] of Object.entries(cols)) {
        const val = typeof v === "string" ? v : String(v);
        if (k === "PRIMARY KEY" || k.startsWith("FOREIGN KEY") || k.startsWith("UNIQUE")) {
          constraints.push(val ? `${k} ${val}` : k);
        } else {
          columnDefs.push(`  ${k} ${val}`);
        }
      }
      const allParts = columnDefs.length + constraints.length > 0
        ? [...columnDefs, ...constraints.map((c) => "  " + c)]
        : ["  id UUID PRIMARY KEY DEFAULT gen_random_uuid()"];
      sections.push(`CREATE TABLE ${tableName} (`, allParts.join(",\n"), ");", "");
    }
    sections.push("```", "");
  }

  const endpoints = parsed.apiContracts?.endpoints;
  if (endpoints && typeof endpoints === "object" && !Array.isArray(endpoints)) {
    sections.push("## 4. Contratos de API", "");
    for (const [route, spec] of Object.entries(endpoints)) {
      const specObj = spec && typeof spec === "object" && !Array.isArray(spec) ? spec as Record<string, unknown> : {};
      const desc = typeof specObj.description === "string" ? specObj.description : "";
      sections.push(`### ${route}`, "");
      if (desc) sections.push(desc, "");
      const req = specObj.request as Record<string, unknown> | undefined;
      if (req?.body) sections.push("**Request body:**", "```json", JSON.stringify(req.body, null, 2), "```", "");
      const res = specObj.response as Record<string, unknown> | undefined;
      if (res && typeof res === "object") {
        for (const [code, body] of Object.entries(res)) {
          const b = body && typeof body === "object" && (body as Record<string, unknown>).body != null
            ? (body as Record<string, unknown>).body
            : body;
          sections.push(`**Response ${code}:**`, "```json", JSON.stringify(b, null, 2), "```", "");
        }
      }
      sections.push("");
    }
  }

  sections.push("## 5. Lógica y Edge Cases", "");
  if (parsed.logicaEdgeCases && parsed.logicaEdgeCases.trim()) {
    sections.push(parsed.logicaEdgeCases.trim());
  } else {
    sections.push("(Pendiente: Arquitecto de Software)");
  }
  sections.push("", "## 6. Seguridad", "", "(Pendiente)", "", "## 7. Infraestructura", "", "(Pendiente)");
  return sections.join("\n");
}

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:SoftwareArchitect] ${msg}`, ...args);

/** Extrae del texto de respuesta un bloque de diagramas (mermaid, ## Diagramas) o sección markdown sustancial. */
function extractDiagramOrExtraSection(text: string): string | null {
  const t = text.trim();
  if (!t || t.length < 50) return null;
  // Bloque ```mermaid ... ```
  const mermaidMatch = t.match(/```mermaid\s*([\s\S]*?)```/i);
  if (mermaidMatch?.[1]?.trim().length) return "## Diagramas\n\n```mermaid\n" + mermaidMatch[1].trim() + "\n```\n";
  // Sección ## Diagramas o ### Diagramas hasta el siguiente ##
  const diagramHeading = t.match(/(##\s+Diagramas[\s\S]*?)(?=\n##\s+|\n#\s+|\n```|$)/i);
  if (diagramHeading?.[1]?.trim().length) return diagramHeading[1].trim();
  // Cualquier bloque ``` con "diagram" o "mermaid" dentro
  const anyDiagram = t.match(/```(?:\w+)?\s*([\s\S]*?diagram[\s\S]*?|[\s\S]*?mermaid[\s\S]*?)```/i);
  if (anyDiagram?.[1]?.trim().length) return "## Diagramas\n\n```\n" + anyDiagram[1].trim() + "\n```\n";
  return null;
}

/** Inserta la sección de diagramas en el draft antes de ## Seguridad o al final. */
function insertDiagramSectionIntoDraft(draft: string, diagramSection: string): string {
  const seguridadIdx = draft.search(/\n##\s+(?:6\.\s+)?Seguridad\b/i);
  if (seguridadIdx !== -1) {
    return draft.slice(0, seguridadIdx) + "\n\n" + diagramSection.trim() + "\n\n" + draft.slice(seguridadIdx);
  }
  return draft.trimEnd() + "\n\n" + diagramSection.trim() + "\n";
}

/** Extrae el cuerpo de la sección 4 (Contratos de API) de un draft. */
function extractContratosBody(draft: string): string | null {
  return extractContratosSectionBody(draft);
}

const SECTION5_HEADING_REGEX = /##\s*5\.\s*L[oó]gica\s+y\s*Edge\s+Cases|##\s*L[oó]gica\s+y\s*Edge\s+Cases/i;

/** Extrae el cuerpo de la sección 5 (Lógica y Edge Cases) de un draft. */
function extractLogicaEdgeCasesBody(draft: string): string | null {
  const t = draft.trim();
  const match = t.match(SECTION5_HEADING_REGEX);
  if (!match) return null;
  const start = t.indexOf(match[0]) + match[0].length;
  const rest = t.slice(start).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  return (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).trim() || null;
}

/** Extrae la sección 4 (Contratos de API) del texto crudo del LLM si tiene contratos reales. */
function extractContratosFromArchitectResponse(text: string): string | null {
  const body = extractContratosBody(text);
  return body && isContratosSubstantial(body) ? body : null;
}

/** Reemplaza el cuerpo de la sección 4 (Contratos de API) en draft. */
function replaceContratosInDraft(draft: string, newContratosBody: string): string {
  return replaceMddSection4Body(draft, newContratosBody);
}

/**
 * Convierte un objeto "por secciones" (ej. "1. Contexto y alcance": {...}, "2. Modelo de datos": { schemaSQL: [...] })
 * a un único string markdown. Fallback cuando el LLM devuelve mddDraft como objeto con claves de sección.
 */
function objectSectionToMarkdown(inner: Record<string, unknown>): string {
  const out: string[] = ["# Master Design Document", ""];
  const sectionOrder = [
    "1. Contexto",
    "2. Arquitectura y Stack",
    "3. Modelo de Datos",
    "4. Contratos de API",
    "5. Lógica y Edge Cases",
    "logicaEdgeCases",
    "6. Seguridad",
    "7. Infraestructura",
  ];
  const seen = new Set<string>();
  for (const sectionTitle of sectionOrder) {
    const val = inner[sectionTitle];
    if (val === undefined) continue;
    const headingCandidate = sectionTitle === "logicaEdgeCases" ? "5. Lógica y Edge Cases" : sectionTitle;
    const heading = headingCandidate.startsWith("##") ? headingCandidate : `## ${headingCandidate}`;
    out.push(heading, "");
    seen.add(sectionTitle);
    if (typeof val === "string") {
      out.push(val.trim(), "");
      continue;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        out.push(typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`);
      }
      out.push("");
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (sectionTitle === "1. Contexto y alcance" && !obj.schemaSQL && !obj.tables && !obj.endpoints && !obj.project) {
        const bullets = Object.entries(obj)
          .map(([k, v]) => `- **${k}:** ${typeof v === "string" ? v : String(v)}`)
          .join("\n");
        if (bullets) {
          out.push(bullets, "");
          continue;
        }
      }
      if (Array.isArray(obj.schemaSQL)) {
        out.push("```sql");
        out.push(obj.schemaSQL.filter((x): x is string => typeof x === "string").join("\n"));
        out.push("```", "");
        continue;
      }
      const tables = normalizeTablesToRecord(obj.tables ?? (obj.databaseSchema as Record<string, unknown>)?.tables);
      if (tables && (sectionTitle === "3. Modelo de Datos" || sectionTitle === "2. Modelo de datos")) {
        out.push("```sql");
        for (const [tableName, def] of Object.entries(tables)) {
          const cols = def?.columns && typeof def.columns === "object" ? def.columns as Record<string, string> : {};
          const columnDefs = Object.entries(cols)
            .filter(([k]) => k !== "PRIMARY KEY" && !k.startsWith("FOREIGN KEY") && !k.startsWith("UNIQUE"))
            .map(([k, v]) => `  ${k} ${v}`);
          const allParts = columnDefs.length > 0 ? columnDefs : ["  id UUID PRIMARY KEY DEFAULT gen_random_uuid()"];
          out.push(`CREATE TABLE ${tableName} (`, allParts.join(",\n"), ");", "");
        }
        out.push("```", "");
        continue;
      }
      const endpoints = (obj.endpoints ?? (obj.apiContracts as Record<string, unknown>)?.endpoints) as Record<string, unknown> | undefined;
      if (endpoints && typeof endpoints === "object" && !Array.isArray(endpoints) && sectionTitle === "4. Contratos de API") {
        for (const [route, spec] of Object.entries(endpoints)) {
          const s = spec && typeof spec === "object" && !Array.isArray(spec) ? spec as Record<string, unknown> : {};
          const desc = typeof s.description === "string" ? s.description : "";
          out.push(`### ${route}`, "");
          if (desc) out.push(desc, "");
          const reqBody = (s.request as Record<string, unknown> | undefined)?.body;
          if (reqBody != null) out.push("**Request body:**", "```json", JSON.stringify(reqBody, null, 2), "```", "");
          if (s.response && typeof s.response === "object") {
            for (const [code, body] of Object.entries(s.response as Record<string, unknown>)) {
              const b = body && typeof body === "object" && (body as Record<string, unknown>).body != null ? (body as Record<string, unknown>).body : body;
              out.push(`**Response ${code}:**`, "```json", JSON.stringify(b, null, 2), "```", "");
            }
          }
          out.push("");
        }
        continue;
      }
      if (typeof obj.project === "string" || Array.isArray(obj.features)) {
        if (typeof obj.project === "string") out.push(obj.project);
        if (Array.isArray(obj.features)) {
          for (const f of obj.features) out.push(typeof f === "string" ? `- ${f}` : `- ${String(f)}`);
        }
        out.push("");
        continue;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
          out.push(`### ${k}`, "", v, "");
        } else if (Array.isArray(v)) {
          out.push(`### ${k}`, "");
          for (const item of v) out.push(typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`);
          out.push("");
        } else if (v && typeof v === "object") {
          const restApi = (v as Record<string, unknown>)["RESTful API"];
          if (Array.isArray(restApi) && restApi.length > 0) {
            out.push(`### ${k}`, "");
            for (const ep of restApi) {
              const e = ep && typeof ep === "object" && !Array.isArray(ep) ? (ep as Record<string, unknown>) : {};
              const method = e.method ?? "POST";
              const path = e.endpoint ?? e.path ?? "";
              out.push(`#### ${method} ${path}`, "");
              if (typeof e.description === "string") out.push(e.description, "");
              if (e.payload) out.push("**Request body:**", "```json", JSON.stringify(e.payload, null, 2), "```", "");
            }
            out.push("");
          }
          const webhooks = (v as Record<string, unknown>)["Webhooks"];
          if (Array.isArray(webhooks)) {
            out.push("### Webhooks", "");
            for (const w of webhooks) {
              const o = w && typeof w === "object" && !Array.isArray(w) ? (w as Record<string, unknown>) : {};
              if (typeof o.event === "string") out.push(`- **${o.event}**: ${String(o.description ?? "")}`, "");
              if (o.payload) out.push("  ```json", JSON.stringify(o.payload, null, 2), "  ```", "");
            }
            out.push("");
          }
        }
      }
    }
  }
  if (!seen.has("6. Seguridad"))
    out.push("## 6. Seguridad", "", "(Pendiente: Arquitecto de Seguridad)", "");
  if (!seen.has("7. Infraestructura"))
    out.push("## 7. Infraestructura", "", "(Pendiente: Ingeniero de Integración)", "");
  return out.join("\n").trim();
}

const CONTRACTS_REQUIRED_KEYWORDS = /openapi|contratos?\s+de\s+api|contratos?\s+api|definir\s+endpoints|request\/response|payloads?\s+json/i;

/** Detecta si el usuario o el alcance piden OpenAPI/contratos de API. */
function contractsRequired(state: MDDStateType): boolean {
  const scope = (state.clarifiedScope ?? "").trim();
  const draft = (state.mddDraft ?? "").trim();
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const lastMessage = (state.lastUserMessage ?? "").trim();
  return (
    CONTRACTS_REQUIRED_KEYWORDS.test(scope) ||
    CONTRACTS_REQUIRED_KEYWORDS.test(draft) ||
    CONTRACTS_REQUIRED_KEYWORDS.test(accumulated) ||
    CONTRACTS_REQUIRED_KEYWORDS.test(lastMessage)
  );
}

/** Detecta si clarifiedScope indica decisiones validadas que deben reflejarse en Modelo de datos o Contratos API. */
function hasValidatedDecisionsForArchitect(state: MDDStateType): boolean {
  const scope = (state.clarifiedScope ?? "").trim();
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const lastMessage = (state.lastUserMessage ?? "").trim();
  const text = [scope, accumulated, lastMessage].join(" ");
  return (
    /decisiones?\s+validadas/i.test(text) ||
    /reflejar\s+en\s+(modelo|modelo de datos|contratos|secci[oó]n\s*[23])/i.test(text) ||
    /Arquitecto\s+de\s+Software\s+debe/i.test(text) ||
    /(Modelo de datos|Contratos API).*reflejar/i.test(text)
  );
}

/** Si las decisiones validadas mencionan Modelo de datos o entidades, el Arquitecto debe poder actualizar §3 (no bloquear). */
function validatedDecisionsMentionModel(state: MDDStateType): boolean {
  const scope = (state.clarifiedScope ?? "").trim();
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const text = [scope, accumulated].join(" ");
  return (
    /reflejar\s+en\s+(modelo|modelo de datos|secci[oó]n\s*3)/i.test(text) ||
    /(Modelo de datos|entidades?|tablas?).*reflejar/i.test(text) ||
    /reflejar.*(modelo|modelo de datos|entidades?|tablas?)/i.test(text)
  );
}

const MAX_ARCHITECT_TOOL_LOOPS = 2;
const MAX_ARCHITECT_TOOL_LOOPS_FORGE = 5;

export type MddSoftwareArchitectNodeOptions = {
  /** Legacy + `theforgeProjectId`: añade herramientas MCP TheForge (contrato, impacto, firma). */
  theforge?: TheForgeService | null;
  /** MCP gráfico compatible activo → hint en §2 Frontend / UI Library. */
  uiMcpFrontendLibraryLabel?: string | null;
  /** Alcance del nodo: full (LOW/MEDIUM), stack/data_model/api_contracts (HIGH). */
  scope?: MddSoftwareArchitectScope;
};

/** Extrae el cuerpo de ## 6. Seguridad del draft (hasta ## 7. o fin). */
function extractSection6SeguridadBody(draft: string): string | null {
  return extractSection6Body(draft);
}

/** Extrae el cuerpo de ## 7. Infraestructura del draft (hasta fin de documento). */
function extractSection7InfraestructuraBody(draft: string): string | null {
  return extractSection7Body(draft);
}

/** Reemplaza el cuerpo de una sección en el draft. Busca el heading y reemplaza hasta el siguiente ## o fin. */
function replaceSectionBody(draft: string, headingPattern: RegExp, newBody: string): string {
  const match = draft.match(headingPattern);
  if (!match || match.index == null) return draft;
  const startAfterHeading = match.index + match[0].length;
  const rest = draft.slice(startAfterHeading);
  const nextH2 = rest.search(/\n##\s+/);
  const bodyEnd = nextH2 !== -1 ? startAfterHeading + nextH2 : draft.length;
  return draft.slice(0, startAfterHeading) + "\n\n" + newBody.trim() + "\n" + draft.slice(bodyEnd);
}

/** Regex para detectar si §6 o §7 tienen solo placeholder (Pendiente, TBD, etc.). */
function isPlaceholderSection(body: string | null): boolean {
  return isMddSectionPlaceholderBody(body);
}

function buildArchitectToolsByName(tools: StructuredToolInterface[]): Record<string, StructuredToolInterface> {
  const byName: Record<string, StructuredToolInterface> = {};
  for (const t of tools) byName[t.name] = t;
  return byName;
}

/** Creates the MDD Software Architect node. Transforms Clarifier draft into technical doc (SQL schema, API contracts with payloads). Optionally with tools (format_section3_endpoints). 4.3: si state.currentStepAllowedTools está set, solo usa esas tools. */
export function createMddSoftwareArchitectNode(
  llm: BaseChatModel,
  tools: StructuredToolInterface[] = [],
  opts?: MddSoftwareArchitectNodeOptions | null,
) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const scope: MddSoftwareArchitectScope = opts?.scope ?? "full";
    const scopeSection = architectScopeSectionNumber(scope);
    const decoupleSection5 = shouldDecoupleSection5FromArchitect(state, scope);
    const tfPid = (state.theforgeProjectId ?? "").trim();
    const useTheForgeTools =
      !!opts?.theforge &&
      opts.theforge.isConfigured() &&
      state.isLegacyProject === true &&
      tfPid.length > 0;
    const forgeTools = useTheForgeTools ? getMddArchitectTheForgeTools(opts!.theforge!, tfPid) : [];
    const baseTools = [...tools, ...forgeTools];
    const allowed = state.currentStepAllowedTools;
    const toolsToUse = allowed?.length ? baseTools.filter((t) => allowed.includes(t.name)) : baseTools;
    const toolsByName = buildArchitectToolsByName(toolsToUse);
    const llmWithTools = llm.bindTools && toolsToUse.length > 0 ? llm.bindTools(toolsToUse) : llm;
    const maxToolLoops = forgeTools.length > 0 ? MAX_ARCHITECT_TOOL_LOOPS_FORGE : MAX_ARCHITECT_TOOL_LOOPS;

    LOG("entry mddDraftLen=%s tools=%s (allowed=%s)", (state.mddDraft ?? "").length, toolsToUse.length, allowed?.length ?? "all");
    if (state.clarifiedScope) LOG("Context/Scope received: %s...", state.clarifiedScope.slice(0, 100));
    LOG("Draft Preview (Section 2 search): %s", (state.mddDraft ?? "").match(/##\s*2\.[^#]*/)?.[0]?.slice(0, 100) ?? "Not found");
    const startedAt = Date.now();
    try {
      const draftTrimmed = (state.mddDraft ?? "").trim();
      const { baseline: mergeBaselineRaw, source: mergeBaselineSource } = resolveArchitectMergeBaseline(
        state,
        scope,
        draftTrimmed,
      );
      const mergeBaseline =
        scope === "api_contracts"
          ? repairMergeBaselineBeforeApiContractsMerge(mergeBaselineRaw)
          : mergeBaselineRaw;
      if (scope === "api_contracts" && mergeBaseline !== mergeBaselineRaw) {
        LOG("repaired §3 fences in merge baseline before api_contracts (len=%s→%s)", mergeBaselineRaw.length, mergeBaseline.length);
      }
      LOG(
        "mergeBaseline source=%s len=%s draftTrimmedLen=%s previousLen=%s",
        mergeBaselineSource,
        mergeBaseline.length,
        draftTrimmed.length,
        (state.previousMddDraftForMerge ?? "").trim().length,
      );
      const sectionsToPreserve =
        state.executorControlled === true
          ? getSectionsToPreserveFromExecutorPlan(state.sectionsToRun)
          : [];
      const brief = getUserBrief(state);
      const explicitReqs = getUserExplicitRequirements(state);
      const directive = state.acceptedProposalDirective?.trim();
      const AFFECTS_MODEL_REGEX =
        /\b(modelo\s+de\s+datos|sql|tablas?|fk|clave\s+externa|integridad\s+referencial|references|create\s+table|entidades?|diagrama\s*(er|entidad|relaci[oó]n)?|aplicaciones?|relaci[oó]n(es)?|permisos?\s+en|roles?\s+por\s+aplicaci[oó]n)\b/i;
      const AFFECTS_SECTION2_REGEX = STACK_TECHNOLOGY_REGEX;
      const affectsModel = !!(directive && AFFECTS_MODEL_REGEX.test(directive));
      const affectsSection2 = !!(directive && AFFECTS_SECTION2_REGEX.test(directive)) || (explicitReqs.length > 0 && AFFECTS_SECTION2_REGEX.test(explicitReqs));
      const explicitReqsAffectModel = explicitReqs.length > 0 && AFFECTS_MODEL_REGEX.test(explicitReqs);
      const hasExplicitRequirements = explicitReqs.length > 0 || affectsModel || affectsSection2;
      const userAskedForModelOrApiChanges = affectsModel || explicitReqsAffectModel;
      const domainAuthSkew = mddStateHasDomainAuthSkew(state);
      const mustRewriteSection3 = hasExplicitRequirements || domainAuthSkew;
      const stepGoal = state.currentStepGoal?.trim();
      const goalBlock = stepGoal ? `**Objetivo de este paso (del plan):** ${stepGoal}\n\n` : "";
      const scopedNoRepeat =
        " **NO repitas §1–§N anteriores en tu respuesta**; el pipeline las conserva vía merge quirúrgico. Responde **solo** con el cuerpo de tu sección asignada.";
      const briefBlock = brief
        ? mustRewriteSection3
          ? scope === "stack"
            ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Actualiza **solo ## 2. Arquitectura y Stack** según la directiva.${scopedNoRepeat} No modifiques §3 ni §4.${decoupleSection5 ? " Deja §5 con placeholder de paso dedicado." : ""}\n\n---\n\n`
            : scope === "data_model"
              ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Reescribe **solo ## 3. Modelo de Datos** (SQL + ER) según el dominio y requisitos.${scopedNoRepeat} No modifiques §4.${decoupleSection5 ? " Deja §5 con placeholder." : ""}\n\n---\n\n`
              : scope === "api_contracts"
                ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Redacta **solo ## 4. Contratos de API** alineados a §3.${scopedNoRepeat}${decoupleSection5 ? " Deja §5 con placeholder." : ""}\n\n---\n\n`
                : `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Debes **actualizar** ## 3. Modelo de Datos y ## 4. Contratos de API para reflejar el dominio de negocio (BRD/inventario) y los requisitos explícitos. **No copies §3 del borrador** si está sesgado a auth o incompleto frente al inventario; genera el SQL, diagrama ER y endpoints que cubran las capacidades de dominio. Copia solo ## 1. Contexto del borrador. Elabora §2 (Arquitectura y Stack)${decoupleSection5 ? "; deja §5 con placeholder de paso dedicado" : " y §5 (Lógica y Edge Cases)"}.${affectsSection2 ? " Actualiza también ## 2. Arquitectura y Stack si la directiva lo indica." : ""}\n\n---\n\n`
          : scope === "stack"
            ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar **solo ## 2. Arquitectura y Stack** para una aplicación que cumple este objetivo.${scopedNoRepeat} No reescribas §3 ni §4.${decoupleSection5 ? " Deja §5 con placeholder." : ""}\n\n---\n\n`
            : scope === "data_model"
              ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar **solo ## 3. Modelo de Datos** coherente con §1–§2 del contexto de referencia.${scopedNoRepeat}${decoupleSection5 ? " Deja §5 con placeholder." : ""}\n\n---\n\n`
              : scope === "api_contracts"
                ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar **solo ## 4. Contratos de API** a partir del SQL de §3 en contexto.${scopedNoRepeat}${decoupleSection5 ? " Deja §5 con placeholder." : ""}\n\n---\n\n`
                : `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar secciones 2 (Arquitectura y Stack) y 4 (Contratos de API)${decoupleSection5 ? "" : " y 5 (Lógica y Edge Cases)"} para una aplicación que cumple este objetivo. Copia 1 y 3 del borrador; no las reescribas salvo directiva explícita.\n\n---\n\n`
        : "";
      const contextParts = [
        goalBlock,
        briefBlock,
        "**Alcance clarificado:**",
        (state.clarifiedScope ?? "").trim() || "(vacío)",
        "",
      ];

      if (scope === "full") {
        contextParts.push(
          "**Borrador actual del MDD (Contexto + Modelo de datos del Experto en Datos):**",
          draftTrimmed || "(vacío)",
        );
        const inventoryBlock = domainInventoryPromptBlock(state);
        if (inventoryBlock) {
          contextParts.unshift(inventoryBlock.trim(), "");
        }
        try {
          const { buildInventoryFromMddState } = await import("../utils/mdd-domain-prompt.util.js");
          const { domainSchemaCompositionPromptBlock } = await import(
            "../../engine/compose-section3-from-inventory.util.js"
          );
          const { inventory } = buildInventoryFromMddState(state);
          const schemaBlock = domainSchemaCompositionPromptBlock(inventory, draftTrimmed);
          if (schemaBlock) contextParts.unshift(schemaBlock, "");
        } catch {
          /* optional */
        }
      } else {
        const scopedCtx = await buildArchitectScopedContext(state, scope);
        contextParts.push(...scopedCtx.lines);
      }

      contextParts.push(getInternalDirectivesContext(state, "software_architect"));
      if (domainAuthSkew) {
        contextParts.unshift(
          "**ALERTA domain-auth-only-skew:** El §3 actual solo tiene entidades de auth mientras el BRD lista capacidades de dominio. **Reescribe §3 y §4** con entidades y endpoints de negocio del inventario. Auth permanece como complemento.",
          "",
        );
      }
      if (explicitReqs.length > 0) {
        contextParts.push(
          "",
          "**Requisitos o petición del usuario (incorporar en las secciones que correspondan: §2 Arquitectura y Stack, §3 Modelo de datos, §4 Contratos de API, §5 Lógica):**",
          explicitReqs,
        );
      }
      if (affectsSection2) {
        contextParts.unshift(
          "**Cambios en stack/arquitectura:** El usuario pide cambios en el stack o arquitectura: debes **actualizar ## 2. Arquitectura y Stack** con las tecnologías y estructura indicadas; no copies §2 del borrador si contradice la directiva.",
          "",
        );
      }
      if (directive) {
        contextParts.unshift(
          "**ACCIÓN REQUERIDA (usuario aceptó esta propuesta):**",
          directive,
          affectsModel
            ? "Debes aplicar esta directiva al MDD. Si afecta al modelo de datos (SQL, tablas, FK, integridad referencial), actualiza ## 3. Modelo de Datos (SQL y diagrama ER) con las restricciones o cambios indicados. Luego ## 4. Contratos de API y ## 5. Lógica si aplica."
            : "Debes aplicar esta directiva al MDD en las secciones que correspondan (Arquitectura, Contratos API, Lógica).",
          "",
        );
      }
      if (contractsRequired(state)) {
        contextParts.unshift(
          "**Requisito de contratos:** El usuario o el alcance han pedido OpenAPI / contratos de API. La sección 4 (Contratos de API) DEBE contener tabla resumen y endpoints con request/response en JSON. Prohibido dejar 'Pendiente'.",
          "**IMPORTANTE:** Responde ÚNICAMENTE con el documento en Markdown puro (empieza por # Master Design Document). NO devuelvas JSON. La sección 4 debe incluir la tabla de endpoints y al menos 3 endpoints con request/response en bloques ```json.",
          "",
        );
      }
      if (hasValidatedDecisionsForArchitect(state)) {
        const allowSection3 = validatedDecisionsMentionModel(state) || userAskedForModelOrApiChanges;
        const directiveText = allowSection3
          ? "**Decisiones validadas por el usuario:** El alcance clarificado indica que el usuario validó propuestas. Refleja las decisiones en ## 3. Modelo de Datos y ## 4. Contratos de API según lo indicado en clarifiedScope."
          : "**Decisiones validadas por el usuario:** El alcance clarificado indica que el usuario validó propuestas que deben reflejarse en ## 4. Contratos de API. Aplica lo indicado en clarifiedScope solo en la sección 4. No modifiques ## 3. Modelo de Datos.";
        contextParts.unshift(directiveText, "");
      }
      const hasSection1 = /##\s*1\.\s*Contexto/i.test(draftTrimmed);
      const hasSection3Modelo = /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i.test(draftTrimmed) && /\bCREATE\s+TABLE\b/i.test(draftTrimmed);
      if (hasSection1 && draftTrimmed.length > 200) {
        contextParts.unshift(
          "**Fuente de verdad del alcance:** La sección '## 1. Contexto' del borrador es la fuente de verdad del alcance técnico del proyecto. Secciones 2 (Arquitectura y Stack), 4 (Contratos de API) y 5 (Lógica y Edge Cases) DEBEN reflejar **todo** lo allí mencionado. No reduzcas a un mínimo genérico.",
          "**Instrucción crítica de integridad:** Revisa 'Alcance clarificado' para detectar requisitos de resiliencia (reintentos, backoff), seguridad o consistencia/transacciones. Si el input menciona 'reintentos automáticos' o 'backoff', el output DEBE incluir la estrategia explícita en la Sección 2 (Arquitectura) o Sección 5 (Lógica).",
          "",
        );
      }
      if (hasSection1 && hasSection3Modelo) {
        contextParts.unshift(
          "**Cobertura de la sección 4:** La sección 4 (Contratos de API) debe incluir **un endpoint por cada capacidad** descrita en la sección 1 y **por cada entidad/recurso** del modelo (sección 3) que requiera API. Revisa el borrador completo: lista las funcionalidades del alcance y las tablas del modelo, y asegura que cada una tenga su operación en la tabla de endpoints. Si falta algún endpoint para algo que el documento describe, la sección 4 está incompleta.",
          "",
        );
      }
      if (state.architectCriticFeedback?.trim()) {
        contextParts.unshift(
          "**Feedback del Architect Critic (debes corregir §3 y §4):**",
          state.architectCriticFeedback.trim(),
          "Aplica estas correcciones en ## 3. Modelo de Datos y ## 4. Contratos de API antes de entregar.",
          "",
        );
      }
      if (state.auditorFeedback?.trim() && !directive) {
        const auditorNote =
          hasExplicitRequirements || userAskedForModelOrApiChanges
            ? "Aplica el feedback en ## 3. Modelo de Datos, ## 4. Contratos de API y §2/§5 según corresponda."
            : "Cierra estos gaps en ## 4. Contratos de API (endpoints faltantes, Ghost Features en API). No modifiques ## 3. Modelo de Datos (es responsabilidad del Experto en Datos).";
        contextParts.push(
          "",
          "**Feedback del Auditor (aplicar en Arquitectura/Stack, Contratos API y Lógica/Edge Cases):**",
          state.auditorFeedback.trim(),
          "",
          auditorNote,
        );
      } else if (state.auditorFeedback?.trim() && directive) {
        contextParts.push(
          "",
          "**Feedback del Auditor (contexto adicional):**",
          state.auditorFeedback.trim(),
        );
      }
      if (toolsToUse.length > 0) {
        const forgeHint =
          forgeTools.length > 0
            ? " **TheForge (legacy):** Tienes `get_contract_specs`, `get_implementation_details` y `get_legacy_impact`. Para interfaces UI o firmas backend **con nombre ya fijado en el índice**, usa `get_contract_specs` / `get_implementation_details` antes que deducir desde texto. Antes de cerrar §3 y §4, valida símbolos que cites. Si una tool devuelve NOT_FOUND_IN_GRAPH o vacío, no inventes: documenta «Bloqueante de negocio» en §1 o §5."
            : "";
        contextParts.push(
          "",
          `[Instrucción de sistema — no copiar al MDD] Si conviene, invoca la tool format_section3_endpoints (domain + lista de endpoints) para generar markdown de §4; el texto de esta línea no debe aparecer en el documento final.${forgeHint}`,
        );
      }
      // Prioridad inviolable como primera línea del contexto inyectado (plan A/C).
      const stackBlock = buildUserDeclaredStackPromptBlock(
        explicitReqs,
        state.userInputAccumulated,
        state.lastUserMessage,
        state.clarifiedScope,
        brief,
      );
      if (stackBlock) {
        contextParts.unshift(stackBlock, "");
      }
      if (decoupleSection5) {
        contextParts.unshift(
          "**Pasada del pipeline (sistema):** Genera **solo las secciones de tu alcance** (§2, §3 o §4 según tu rol). Deja ## 5. Lógica y Edge Cases con el placeholder exacto `(Pendiente: paso dedicado Lógica y Edge Cases)`. Un agente dedicado redactará §5 en paralelo con Seguridad e Infraestructura. **No** elabores §5 aquí.",
          "",
        );
      }
      contextParts.unshift(
        "**Prioridad (léelo primero):** Si en este mensaje aparece ACCIÓN REQUERIDA, Requisitos del usuario o STACK DECLARADO que piden cambios en §2 (Arquitectura y Stack), §3 o §4, esa instrucción tiene prioridad máxima sobre el borrador y el benchmark. Actualiza ## 2, ## 3 y/o ## 4 según corresponda e ignora cualquier instrucción de «no modifiques §3» cuando la directiva lo exija.",
        "",
      );
      // Si el objetivo de paso pide roles por aplicación, el §3 del borrador puede ser antiguo (roles global, user_roles). Forzar que el modelo no lo copie.
      const goalAndDirective = `${stepGoal ?? ""} ${directive ?? ""}`;
      const asksForAppLevelRoles =
        /(?:application_roles|roles?\s+por\s+aplicaci[oó]n|No copies §3|user_application_roles)/i.test(goalAndDirective);
      if (asksForAppLevelRoles && draftTrimmed && /\bCREATE\s+TABLE\s+roles\b/i.test(draftTrimmed) && /\buser_roles\b/i.test(draftTrimmed)) {
        contextParts.unshift(
          "**ADVERTENCIA (obligatoria):** El borrador que ves abajo tiene §3 con un modelo antiguo (tabla `roles` global y `user_roles`). Tu objetivo pide roles por aplicación. DEBES reemplazar §3 por completo: tablas `applications`, `application_roles` (id, application_id, name), `user_application_roles` (user_id, application_id, role_id). No copies ni reutilices el SQL actual de §3; escríbelo desde cero con esas tablas.",
          "",
        );
      }
      const section6Body = extractSection6SeguridadBody(draftTrimmed);
      if (section6Body) {
        contextParts.unshift(
          "",
          "**Requisitos de §6 Seguridad (OBLIGATORIO aplicar en §3 y §4):**",
          section6Body,
          "",
          "Interpreta §6 para descubrir endpoints y gaps. Aplica en §3: si §6 indica que un campo NO debe guardarse en BD (ej. jwt_token), elimínalo de tablas SQL y diagrama ER.",
          "Aplica en §4 (Contratos de API): (1) Deriva de §6 **cada endpoint** que mencione o implique (ej. «endpoint JWKS» o «JSON Web Key Set» → GET /auth/jwks o /.well-known/jwks.json con response { \"keys\": [...] }; «refresh_token» → POST /auth/refresh; MFA/TOTP → endpoints que §6 implique). Si §6 dice «se implementará X», X debe estar documentado en §4 con método, ruta y request/response. (2) No documentes en §4 campos que §6 prohíba persistir. La aplicación es genérica: interpreta §6 para cerrar gaps en §4.",
          "",
        );
      }
      const uiMcpHint = buildUiMcpFrontendArchitectHint(opts?.uiMcpFrontendLibraryLabel ?? "");
      if (uiMcpHint) {
        contextParts.unshift(uiMcpHint, "");
      }
      const context = contextParts.join("\n");
      const scopePrefix = architectScopePromptPrefix(scope);
      const architectPrompt = softwareArchitectMddPrompt(scope);
      const prompt = `${scopePrefix ? `${scopePrefix}\n\n---\n\n` : ""}${architectPrompt}${softwareArchitectComplexityAppendix(state.mddComplexity)}\n\n---\n${context}`;
      const messages = [new HumanMessage(prompt)];

      let text = "";
      if (toolsToUse.length > 0) {
        let loopCount = 0;
        while (loopCount < maxToolLoops) {
          // Retry sólo en la última iteración del tool-loop (cuando ya no hay
          // tool_calls y se genera el texto final). Iteraciones intermedias
          // con contenido vacío no son un problema — el LLM sigue invocando
          // tools hasta que termina. Ver CHANGELOG [Unreleased] → Fixed →
          // "SoftwareArchitect devuelve LLM vacío".
          const isFinalIteration = loopCount === maxToolLoops - 1;
          const response = isFinalIteration
            ? await invokeLlmWithRetry(llmWithTools, messages, { tag: "SoftwareArchitect:tools" })
            : await llmWithTools.invoke(messages);
          if (!response) {
            LOG("tool-loop LLM sin respuesta tras reintentos (iter=%s); saliendo del loop", loopCount);
            break;
          }
          const aiMsg = response as AIMessage;
          text = extractLlmText(aiMsg);
          const toolCalls = aiMsg.tool_calls ?? [];
          if (toolCalls.length === 0) break;
          const toolMessages: ToolMessage[] = [];
          for (const tc of toolCalls) {
            const tool = toolsByName[tc.name];
            const toolCallId = tc.id ?? `tc-${loopCount}-${tc.name}`;
            if (!tool) {
              toolMessages.push(new ToolMessage({ content: `Unknown tool: ${tc.name}`, tool_call_id: toolCallId, status: "error" }));
              continue;
            }
            const args = typeof tc.args === "object" && tc.args !== null ? (tc.args as Record<string, unknown>) : {};
            let result: unknown;
            try {
              result = await tool.invoke(args);
            } catch (toolErr) {
              LOG("tool.invoke error: %s args=%s", toolErr instanceof Error ? toolErr.message : String(toolErr), JSON.stringify(args).slice(0, 200));
              result = `Error: ${toolErr instanceof Error ? toolErr.message : "Tool call failed"}`;
            }
            const content = typeof result === "string" ? result : JSON.stringify(result);
            toolMessages.push(new ToolMessage({ content, tool_call_id: toolCallId }));
          }
          messages.push(aiMsg, ...toolMessages);
          loopCount++;
        }
      } else {
        const response =
          scope !== "full"
            ? await invokeScopedArchitectLlmWithHeadingCap(llm, messages, {
                tag: `SoftwareArchitect:scoped-${scope}`,
              })
            : await invokeLlmWithRetry(llm, messages, { tag: "SoftwareArchitect:no-tools" });
        text = response ? extractLlmText(response) : "";
      }
      text = stripThinkingTags(text);

      if (!text.trim() && scope === "stack") {
        const stackRetry = await invokeLlmWithRetry(llm, messages, {
          tag: "SoftwareArchitect:stack-empty-retry",
        });
        text = stripThinkingTags(stackRetry ? extractLlmText(stackRetry) : "");
        if (text.trim()) {
          LOG("§2 stack: respuesta tras reintento por LLM vacío (len=%s)", text.length);
        }
      }

      if (!text.trim()) {
        logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, 0), { scope, empty: true });
        LOG("LLM vacío, devolviendo borrador sin transformar");
        if (scope === "stack") {
          return { stackArchitectAttempt: (state.stackArchitectAttempt ?? 0) + 1 };
        }
        return {};
      }
      const contextIntro = ((state.clarifiedScope ?? "").trim() || (draftTrimmed.slice(0, 800) + (draftTrimmed.length > 800 ? "…" : ""))).trim();
      let mddDraft = "";

      // Intentar primero JSON dentro de bloque ```json ... ``` y luego primer objeto en el texto
      const jsonFromBlock = extractJsonFromCodeBlock(text);
      const firstJson = jsonFromBlock
        ? (extractFirstJsonObject(jsonFromBlock) ?? (jsonFromBlock.trim().startsWith("{") ? jsonFromBlock.trim() : null))
        : extractFirstJsonObject(text);
      const jsonStr = firstJson;
      if (jsonStr) {
        try {
          const architectSliceSchema = z.object({
            contratosApi: mddContratosApiSchema.optional(),
            arquitecturaStack: z.string().optional(),
            logicaEdgeCases: z.string().optional(),
          });
          const parsed = parseJsonOrThrow(jsonStr, architectSliceSchema);
          const slice =
            parsed.contratosApi !== undefined ||
              (parsed.arquitecturaStack !== undefined && parsed.arquitecturaStack.trim() !== "") ||
              (parsed.logicaEdgeCases !== undefined && parsed.logicaEdgeCases.trim() !== "")
              ? {
                ...(parsed.contratosApi !== undefined ? { contratosApi: parsed.contratosApi } : {}),
                ...(parsed.arquitecturaStack?.trim() ? { arquitecturaStack: parsed.arquitecturaStack.trim() } : {}),
                ...(parsed.logicaEdgeCases?.trim() ? { logicaEdgeCases: parsed.logicaEdgeCases.trim() } : {}),
              }
              : undefined;
          if (slice && Object.keys(slice).length > 0) {
            const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
            const structuredDraft = mddStructuredToMarkdown(merged);
            const internalDirectives = extractInternalDirectives(text, "software_architect");
            LOG("usando slice estructurado (contratosApi/arquitecturaStack/logicaEdgeCases), mddDraftLen=%s", structuredDraft.length);
            logMddNodeOutput("SoftwareArchitect", structuredDraft);
            return {
              mddStructured: merged,
              mddDraft: structuredDraft,
              ...(internalDirectives.length > 0 ? { internalDirectives } : {}),
            };
          }
        } catch {
          // fall through to legacy mddDraft / sqlSchema / apiContracts
        }
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, unknown> | null;
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.mddDraft === "string" && parsed.mddDraft.trim().length > 0) {
              mddDraft = parsed.mddDraft.trim();
              LOG("usando mddDraft del JSON (len=%s)", mddDraft.length);
            } else if (parsed.mddDraft && typeof parsed.mddDraft === "object" && !Array.isArray(parsed.mddDraft)) {
              // LLM devolvió mddDraft como objeto (ej. databaseSchema.tables); normalizar y convertir a markdown
              const inner = parsed.mddDraft as Record<string, unknown>;
              const tablesRaw =
                (inner.databaseSchema as Record<string, unknown> | undefined)?.tables ??
                (inner.sqlSchema as Record<string, unknown> | undefined)?.tables ??
                (inner.schemaSQL as Record<string, unknown> | undefined)?.tables ??
                inner.tables;
              const tables = normalizeTablesToRecord(tablesRaw) ?? (tablesRaw && typeof tablesRaw === "object" && !Array.isArray(tablesRaw) ? (tablesRaw as Record<string, { columns: Record<string, string> }>) : undefined);
              const endpoints =
                (inner.apiContracts as Record<string, unknown> | undefined)?.endpoints ??
                (inner.api_contracts as Record<string, unknown> | undefined)?.endpoints ??
                inner.endpoints;
              const hasTables = tables && typeof tables === "object" && Object.keys(tables).length > 0;
              const hasEndpoints = endpoints && typeof endpoints === "object" && !Array.isArray(endpoints);
              if (hasTables || hasEndpoints) {
                const data = { sqlSchema: hasTables ? { tables } : undefined, apiContracts: hasEndpoints ? { endpoints } : undefined };
                mddDraft = structuredToMarkdown(data as z.infer<typeof structuredSchema>, contextIntro);
                LOG("convertido mddDraft (objeto databaseSchema/apiContracts) a markdown (len=%s)", mddDraft.length);
              }
              if (!mddDraft) {
                mddDraft = objectSectionToMarkdown(inner);
                if (mddDraft.length > 100) LOG("convertido mddDraft (objeto por secciones) a markdown (len=%s)", mddDraft.length);
              }
            }
            if (!mddDraft) {
              const tables =
                (parsed.sqlSchema as Record<string, unknown> | undefined)?.tables ??
                (parsed.sql_schema as Record<string, unknown> | undefined)?.tables;
              const endpoints =
                (parsed.apiContracts as Record<string, unknown> | undefined)?.endpoints ??
                (parsed.api_contracts as Record<string, unknown> | undefined)?.endpoints;
              const hasTables = tables && typeof tables === "object" && !Array.isArray(tables);
              const hasEndpoints = endpoints && typeof endpoints === "object" && !Array.isArray(endpoints);
              if (hasTables || hasEndpoints) {
                const structured = structuredSchema.safeParse(parsed);
                const data = structured.success ? structured.data : { sqlSchema: hasTables ? { tables } : undefined, apiContracts: hasEndpoints ? { endpoints } : undefined };
                mddDraft = structuredToMarkdown(data as z.infer<typeof structuredSchema>, contextIntro);
                LOG("convertido sqlSchema/apiContracts a markdown (len=%s)", mddDraft.length);
              }
            }
          }
        } catch {
          // fallback below
        }
      }

      if (!mddDraft) {
        const rawStripped = text.replace(/^```(?:json|markdown)?\s*|\s*```$/g, "").trim();
        // Detectar markdown de Arquitecto: tiene modelo de datos y/o contratos API
        const hasArchitectSections =
          /##\s*2\.\s*Arquitectura\s+y\s*Stack|##\s*3\.\s*Modelo de datos|##\s*Modelo de datos|CREATE TABLE\s+/i.test(rawStripped) ||
          /##\s*4\.\s*Contratos de API|##\s*Contratos de API|\b(POST|GET|PUT|DELETE|PATCH)\s+[\"']?\/api\//i.test(rawStripped) ||
          /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i.test(rawStripped);
        const looksLikeMarkdown =
          rawStripped.length > 200 &&
          (rawStripped.startsWith("#") ||
            /^#+\s+/.test(rawStripped) ||
            hasArchitectSections ||
            /CREATE TABLE/i.test(rawStripped) ||
            /\b(POST|GET|PUT|DELETE|PATCH)\s+\/api\//i.test(rawStripped));
        if (looksLikeMarkdown) {
          // Si hay texto introductorio antes del primer #, recortar
          const firstHeading = rawStripped.search(/\n?#\s+/);
          const toUse = firstHeading > 0 ? rawStripped.slice(firstHeading).trim() : rawStripped;
          mddDraft = toUse.length > 100 ? toUse : rawStripped;
          LOG("usando respuesta como markdown (len=%s)", mddDraft.length);
          // Normalizar de inmediato para no propagar JSON en Contexto ni tablas rotas
          mddDraft = sanitizeContextSection(mddDraft);
          mddDraft = normalizeMddFormat(mddDraft);
        } else if (draftTrimmed.length > 100) {
          LOG("respuesta no parseable; conservando borrador del Clarificador (len=%s). prefix=%s", draftTrimmed.length, text.slice(0, 280).replace(/\n/g, " "));
          mddDraft = draftTrimmed;
          // Intentar extraer sección de diagramas del texto crudo y añadirla al draft
          const diagramBlock = extractDiagramOrExtraSection(text);
          if (diagramBlock) {
            const inserted = insertDiagramSectionIntoDraft(draftTrimmed, diagramBlock);
            if (inserted !== draftTrimmed) {
              mddDraft = inserted;
              LOG("insertada sección extraída de la respuesta (len=%s)", diagramBlock.length);
            }
          }
        } else {
          throw new SyntaxError("El Arquitecto no devolvió JSON con mddDraft, ni sqlSchema/apiContracts, ni markdown usable.");
        }
      }
      if (!mddDraft) return {};
      const minLength = 600;
      let extractedFromFullMdd = false;

      const applyPostMergeNormalization = (draft: string): string => {
        let out = draft;
        out = sanitizeContextSection(out);
        out = replaceContextWhenOnlyMetadata(out);
        out = ensureContratosSection(out);
        out = normalizeMddFormat(out);
        if (decoupleSection5) {
          out = ensureSection5TailParallelPlaceholder(out);
        }
        const incomingSection6 = extractSection6SeguridadBody(mergeBaseline);
        const currentSection6 = extractSection6SeguridadBody(out);
        if (incomingSection6 && isPlaceholderSection(currentSection6)) {
          out = replaceSectionBody(out, /##\s+(?:6\.\s+)?Seguridad\b[^\n]*/i, `## 6. Seguridad\n\n${incomingSection6}`);
          LOG("preservada sección 6 desde baseline (el Arquitecto puso placeholder)");
        }
        const incomingSection7 = extractSection7InfraestructuraBody(mergeBaseline);
        const currentSection7 = extractSection7InfraestructuraBody(out);
        if (incomingSection7 && isPlaceholderSection(currentSection7)) {
          out = replaceSectionBody(out, /##\s+(?:7\.\s+)?Infraestructura\b[^\n]*/i, `## 7. Infraestructura\n\n${incomingSection7}`);
          LOG("preservada sección 7 desde baseline (el Arquitecto puso placeholder)");
        }
        if (sectionsToPreserve.length > 0 && canUseSurgicalMergeBaseline(mergeBaseline, minLength)) {
          out = preserveUntouchedMddSectionsFromBaseline(out, mergeBaseline, sectionsToPreserve);
          LOG("preservadas secciones fuera de plan desde baseline: %s", sectionsToPreserve.join(","));
        }
        if (scopeSection === 4) {
          const baselineContratos = extractContratosBody(mergeBaseline);
          const mergedContratos = extractContratosBody(out);
          if (baselineContratos && isContratosSectionRegression(baselineContratos, mergedContratos)) {
            out = replaceContratosInDraft(out, baselineContratos);
            LOG(
              "preservada sección 4 desde baseline (merge quirúrgico regresión len=%s→%s)",
              baselineContratos.length,
              mergedContratos?.length ?? 0,
            );
          }
        }
        out = preserveSection1FromClarifierSnapshot(state.clarifierMddDraftSnapshot, out);
        out = preserveSection2FromStackSnapshot(state.stackArchitectMddDraftSnapshot, out);
        out = preserveSection3FromDataModelSnapshot(state.dataModelArchitectMddDraftSnapshot, out);
        out = preserveSection4FromApiContractsSnapshot(state.apiContractsArchitectMddDraftSnapshot, out);
        if (canUseSurgicalMergeBaseline(mergeBaseline, minLength)) {
          out =
            scopeSection !== null
              ? preserveNonTargetValidatedSectionsAfterArchitectMerge(mergeBaseline, out, scopeSection)
              : preserveValidatedSectionsIfSubstantial(mergeBaseline, out);
        }
        return out;
      };

      if (scope !== "full") {
        const processed = processScopedArchitectResponse(mddDraft, scope);
        extractedFromFullMdd = processed.extractedFromFullMdd;
        let architectFragment = processed.fragment;
        if (extractedFromFullMdd) {
          LOG("WARN scoped full-MDD detectado scope=%s; extracción §%s antes de merge", scope, scopeSection);
        }

        const fragmentContratos = extractContratosBody(architectFragment);
        const incomingContratosScoped = extractContratosBody(draftTrimmed);
        if (
          scope === "api_contracts" &&
          isContratosSubstantial(incomingContratosScoped) &&
          isContratosPlaceholder(fragmentContratos)
        ) {
          architectFragment = replaceContratosInDraft(architectFragment, incomingContratosScoped!);
          LOG("preservada sección 4 entrante en fragment scoped");
        }

        if (
          architectFragment.length < minLength &&
          draftTrimmed.length >= minLength &&
          scope === "api_contracts" &&
          contractsRequired(state)
        ) {
          const contratosFromText = extractContratosFromArchitectResponse(text);
          if (contratosFromText) {
            architectFragment = `## 4. Contratos de API\n\n${contratosFromText}`;
          }
        }

        let mergeResult =
          scopeSection !== null && canUseSurgicalMergeBaseline(mergeBaseline, minLength)
            ? tryMergeSingleArchitectSectionIntoDraft(mergeBaseline, architectFragment, scopeSection)
            : { draft: mergeBaseline, merged: false as const, rejectReason: "empty" as const };

        if (mergeResult.merged) {
          mddDraft = mergeResult.draft;
        } else if (scopeSection !== null && canUseSurgicalMergeBaseline(mergeBaseline, minLength)) {
          LOG(
            "merge rechazado scope=%s section=%s reason=%s extractedFromFullMdd=%s; reintento scoped (máx 1)",
            scope,
            scopeSection,
            mergeResult.rejectReason ?? "unknown",
            extractedFromFullMdd,
          );
          const rejectParts = [
            formatScopedArchitectMergeRejectFeedback(scopeSection, mergeResult.rejectReason ?? "empty"),
            extractedFromFullMdd ? formatScopedArchitectFullMddRejectFeedback(scope) : "",
          ].filter(Boolean);
          const retryMessages = [
            ...messages,
            new HumanMessage(
              `${rejectParts.join("\n")}\n\nResponde **solo** con el cuerpo de tu sección asignada (sin MDD completo).`,
            ),
          ];
          const retryResponse = await invokeLlmWithRetry(llm, retryMessages, {
            tag: `SoftwareArchitect:scoped-retry-${scopeSection}`,
          });
          const retryText = stripThinkingTags(retryResponse ? extractLlmText(retryResponse) : "");
          if (retryText.trim()) {
            const retryProcessed = processScopedArchitectResponse(retryText.trim(), scope);
            mergeResult = tryMergeSingleArchitectSectionIntoDraft(
              mergeBaseline,
              retryProcessed.fragment,
              scopeSection,
            );
            if (mergeResult.merged) {
              mddDraft = mergeResult.draft;
              LOG("merge scoped ok tras reintento scope=%s section=%s", scope, scopeSection);
            } else {
              LOG(
                "merge rechazado tras reintento scope=%s section=%s reason=%s",
                scope,
                scopeSection,
                mergeResult.rejectReason ?? "unknown",
              );
              mddDraft = mergeBaseline;
            }
          } else {
            LOG("reintento scoped sin respuesta LLM scope=%s", scope);
            mddDraft = mergeBaseline;
          }
        } else {
          mddDraft = mergeBaseline;
        }

        LOG(
          "merge quirúrgico scope=%s section=%s merged=%s baseline=%s",
          scope,
          scopeSection,
          mergeResult.merged,
          mergeBaselineSource,
        );
        mddDraft = applyPostMergeNormalization(mddDraft);
      } else {
        // Pasada full: helpers de documento completo antes de normalizar.
        const incomingContratos = extractContratosBody(draftTrimmed);
        const currentContratos = extractContratosBody(mddDraft);
        if (isContratosSubstantial(incomingContratos) && isContratosPlaceholder(currentContratos)) {
          mddDraft = replaceContratosInDraft(mddDraft, incomingContratos!);
          LOG("preservada sección 4 entrante (contratos reales); el Arquitecto había devuelto placeholder");
        }
        if (mddDraft.length < minLength && draftTrimmed.length >= minLength) {
          if (contractsRequired(state)) {
            const contratosFromText = extractContratosFromArchitectResponse(text);
            if (contratosFromText) {
              mddDraft = replaceContratosInDraft(draftTrimmed, contratosFromText);
              LOG("draft corto pero sección 4 extraída del texto (len=%s), inyectada en borrador Clarificador", contratosFromText.length);
            } else {
              LOG("draft convertido muy corto (len=%s), conservando borrador del Clarificador (len=%s)", mddDraft.length, draftTrimmed.length);
              mddDraft = draftTrimmed;
            }
          } else {
            LOG("draft convertido muy corto (len=%s), conservando borrador del Clarificador (len=%s)", mddDraft.length, draftTrimmed.length);
            mddDraft = draftTrimmed;
          }
        }
        if (draftTrimmed.length >= minLength) {
          mddDraft = preserveContextSectionIfSubstantial(draftTrimmed, mddDraft);
          mddDraft = restoreArquitecturaSectionFromBaselineIfMissing(draftTrimmed, mddDraft);
        }
        mddDraft = applyPostMergeNormalization(mddDraft);
      }
      if (directive && affectsSection2) {
        mddDraft = applyDeploymentStackDirectiveToDraft(mddDraft, directive);
      }
      const preDedupeStackSnapshot =
        scope === "stack" && draftHasSubstantialSection2(mddDraft) ? mddDraft : undefined;
      mddDraft = deduplicateMddDraftSections(mddDraft);
      if (scope === "stack") {
        const snapshotForRestore =
          preDedupeStackSnapshot ??
          (state.stackArchitectMddDraftSnapshot &&
          draftHasSubstantialSection2(state.stackArchitectMddDraftSnapshot)
            ? state.stackArchitectMddDraftSnapshot
            : undefined);
        if (snapshotForRestore) {
          mddDraft = preserveSection2FromStackSnapshot(snapshotForRestore, mddDraft);
        }
        if (!draftHasSubstantialSection2(mddDraft)) {
          if (preDedupeStackSnapshot && draftHasSubstantialSection2(preDedupeStackSnapshot)) {
            LOG(
              "ERROR §2 placeholder tras dedupe con contenido sustancial pre-dedupe (len=%s) — restaurando",
              preDedupeStackSnapshot.length,
            );
            mddDraft = preserveSection2FromStackSnapshot(preDedupeStackSnapshot, mddDraft);
          } else {
            LOG("ERROR §2 placeholder tras dedupe scope=stack — sin snapshot sustancial para restaurar");
          }
        }
      }
      const sum = getMddDraftSummary(mddDraft);
      logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, text.length), {
        scope,
        mddDraftLen: sum.length,
        section3: sum.section3,
      });
      LOG("ok mddDraftLen=%s section3=%s", sum.length, sum.section3);
      logMddNodeOutput("SoftwareArchitect", mddDraft);
      logSection3Debug("post-SoftwareArchitect", mddDraft);
      // Cuando el SA devolvió markdown (no JSON estructurado), §3, §4 y §5 están en mddDraft.
      // Siempre extraer y fusionar en mddStructured para que Security/Integration no reconstruyan §3 desde structured viejo.
      const section3Body = extractSection3Body(mddDraft);
      const modeloDatosParsed = section3Body ? parseModeloDatosFromSection3Markdown(section3Body) : null;
      const section4Body = extractContratosBody(mddDraft);
      const section5Body = extractLogicaEdgeCasesBody(mddDraft);
      LOG("[DIAG §4] contratosBody len=%s isSubstantial=%s isPlaceholder=%s preview=%s",
        section4Body?.length ?? 0,
        isContratosSubstantial(section4Body),
        isContratosPlaceholder(section4Body),
        (section4Body ?? "").slice(0, 120).replace(/\n/g, " "),
      );
      LOG("[DIAG §5] logicaEdgeCasesBody len=%s preview=%s",
        section5Body?.length ?? 0,
        (section5Body ?? "").slice(0, 120).replace(/\n/g, " "),
      );
      LOG("[DIAG LLM] text len=%s strippedThinking=%s rawPrefix=%s",
        text.length,
        text !== (typeof text === "string" ? text : ""),
        text.slice(0, 200).replace(/\n/g, " "),
      );
      const slice: Partial<MDDStateType["mddStructured"]> = {};
      if (scope === "full" || scope === "data_model") {
        if (modeloDatosParsed?.sql) slice.modeloDatos = modeloDatosParsed;
      }
      if (scope === "full" || scope === "api_contracts") {
        if (section4Body) slice.contratosApi = { summary: section4Body };
      }
      if (
        scope === "full" &&
        section5Body &&
        !(decoupleSection5 && isMddSectionPipelinePlaceholderBody(section5Body))
      ) {
        slice.logicaEdgeCases = section5Body;
      }
      const internalDirectives = extractInternalDirectives(text, "software_architect");
      const meshUpdate = internalDirectives.length > 0 ? { internalDirectives } : {};
      const phaseUpdate =
        scope === "data_model" && isHighSplitArchitectPipeline(state)
          ? { architectCriticPhase: "after_section3" as const }
          : scope === "api_contracts"
            ? { architectCriticPhase: undefined, architectCriticFeedback: undefined }
            : scope === "full" && !isHighSplitArchitectPipeline(state)
              ? { architectCriticPhase: "after_full" as const }
              : {};
      const stackSnapshotUpdate =
        scope === "stack" && draftHasSubstantialSection2(mddDraft)
          ? {
              stackArchitectMddDraftSnapshot:
                preDedupeStackSnapshot && draftHasSubstantialSection2(preDedupeStackSnapshot)
                  ? preDedupeStackSnapshot
                  : mddDraft,
            }
          : {};
      const dataModelSnapshotUpdate =
        scope === "data_model" && draftHasSubstantialSection3(mddDraft)
          ? { dataModelArchitectMddDraftSnapshot: mddDraft }
          : {};
      const apiContractsSnapshotUpdate =
        scope === "api_contracts" && draftHasPersistableSection4(mddDraft)
          ? { apiContractsArchitectMddDraftSnapshot: mddDraft }
          : {};
      const stackAttemptUpdate =
        scope === "stack"
          ? draftHasSubstantialSection2(mddDraft)
            ? { stackArchitectAttempt: 0 }
            : { stackArchitectAttempt: (state.stackArchitectAttempt ?? 0) + 1 }
          : {};

      if (Object.keys(slice).length > 0) {
        const merged = mergeMddStructured(state.mddStructured ?? undefined, slice, state.mddDraft ?? "");
        return {
          mddStructured: merged,
          mddDraft,
          ...meshUpdate,
          ...phaseUpdate,
          ...stackSnapshotUpdate,
          ...dataModelSnapshotUpdate,
          ...apiContractsSnapshotUpdate,
          ...stackAttemptUpdate,
        };
      }
      return {
        mddDraft,
        ...meshUpdate,
        ...phaseUpdate,
        ...stackSnapshotUpdate,
        ...dataModelSnapshotUpdate,
        ...apiContractsSnapshotUpdate,
        ...stackAttemptUpdate,
      };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
