import type { StructuredToolInterface } from "@langchain/core/tools";
import { createTavilySearchTool } from "./tavily.tool.js";
import { createScrapeUrlTool } from "./scrape-cheerio.tool.js";
import {
  createValidateMddStructureTool,
  createSuggestMddDiagramsTool,
  createGetProjectTablesTool,
} from "./mdd-tools.js";
import {
  createValidateSqlTool,
  createValidateJsonPayloadsTool,
} from "./linter-tools.js";
import { getSddAgentTools } from "./agent-sdd-tools.js";
import { getLegacyTheForgeAgentTools } from "./agent-theforge-tools.js";
import { TheForgeService } from "../../theforge/theforge.service.js";
import { ProjectsService } from "../../projects/projects.service.js";
import type { AiService } from "../../ai/ai.service.js";

/**
 * Tools for the Scout (Market Scout) agent: search + scrape.
 * Scout uses these to find competitors and verify URLs.
 */
export function getScoutTools(): StructuredToolInterface[] {
  const tavily = createTavilySearchTool();
  const scrapeUrl = createScrapeUrlTool();
  return [tavily, scrapeUrl];
}

/**
 * Tools for the Auditor (Tech Auditor) agent: scrape competitor URLs.
 * Auditor uses scrape_url to get page content/metadata and infer tech stack.
 */
export function getAuditorTools(): StructuredToolInterface[] {
  return [createScrapeUrlTool()];
}

/**
 * Tools for MDD Auditor: validación de estructura del MDD (sección 3 con payloads, secciones, TechnicalMetadata).
 */
export function getMddAuditorTools(): StructuredToolInterface[] {
  return [
    createValidateMddStructureTool(),
    createValidateSqlTool(),
    createValidateJsonPayloadsTool(),
  ];
}

/**
 * Tools for MDD Software Architect: formatear sección 4 (Contratos de API) con endpoints en markdown.
 * Temporalmente vacío porque modelos como DeepSeek V4 Pro tienen problemas con tool calling
 * en LangChain ChatOpenAI. Sin tools, el Software Architect genera las secciones 2-5
 * directamente en markdown, que es más confiable con modelos actuales.
 */
export function getMddArchitectTools(): StructuredToolInterface[] {
  return [createGetProjectTablesTool()];
}

/**
 * Tools for MDD Redactor: validación de estructura para saber qué corregir.
 */
export function getMddRedactorTools(): StructuredToolInterface[] {
  return [
    createValidateMddStructureTool(),
    createValidateSqlTool(),
    createValidateJsonPayloadsTool(),
  ];
}

/**
 * Tools para detectar puntos del MDD donde enriquecer con diagramas Mermaid (ER, estados, flujo).
 */
export function getMddDiagramTools(): StructuredToolInterface[] {
  return [createSuggestMddDiagramsTool()];
}

/**
 * Agentic RAG: patch/enmienda MDD + herramientas TheForge para legacy (Coordinador).
 */
export function getAgenticRagToolset(
  projects: ProjectsService,
  theforge: TheForgeService,
  ai: AiService,
  projectId: string,
  opts: { legacy: boolean; theforgeProjectId: string | null; activeStageId?: string },
): StructuredToolInterface[] {
  const sdd = getSddAgentTools(projects, ai, projectId, opts.activeStageId);
  if (!opts.legacy || !opts.theforgeProjectId || !theforge.isConfigured()) {
    return sdd;
  }
  return [...sdd, ...getLegacyTheForgeAgentTools(theforge, opts.theforgeProjectId)];
}
