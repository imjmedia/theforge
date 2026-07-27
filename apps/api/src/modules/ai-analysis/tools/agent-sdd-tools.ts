import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MDD_SECTION_ORDER } from "../state/mdd-structured.schema.js";
import { replaceOrAppendSection } from "../nodes/mdd-section-merge.js";
import { ProjectsService } from "../../projects/projects.service.js";
import type { AiService } from "../../ai/ai.service.js";

/**
 * Sustituye el cuerpo de una sección canónica 1..7 del MDD (markdown) y persiste en la etapa activa.
 */
export function createPatchMddSectionTool(projects: ProjectsService, projectId: string, activeStageId?: string) {
  return tool(
    async ({ sectionIndex, bodyMarkdown }) => {
      try {
        const project = await projects.findOne(projectId);
        const draft = project.mddContent ?? "";
        const heading = MDD_SECTION_ORDER[sectionIndex - 1];
        if (!heading) return "sectionIndex inválido.";
        const newSection = `## ${heading}\n\n${bodyMarkdown.trim()}\n`;
        const merged = replaceOrAppendSection(draft, heading, newSection);
        await projects.update(projectId, {
          mddContent: merged,
          ...(activeStageId?.trim() ? { stageId: activeStageId.trim() } : {}),
        });
        return `Sección «${heading}» actualizada y persistida.`;
      } catch (err) {
        return `Error patch_mdd_section: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "patch_mdd_section",
      description:
        "Sobrescribe una sección del MDD (1=Contexto … 7=Infraestructura) con markdown de cuerpo; mantiene el resto del documento.",
      schema: z.object({
        sectionIndex: z.number().int().min(1).max(7).describe("Índice 1..7 según secciones canónicas del MDD"),
        bodyMarkdown: z.string().describe("Contenido markdown de la sección (sin el ## título)"),
      }),
    },
  );
}

/**
 * Enmienda constitucional: alinea §3 Modelo de datos y/o §4 Contratos de API con un delta (p. ej. tabla nueva en Blueprint).
 */
export function createProposeMddAmendmentTool(
  projects: ProjectsService,
  ai: AiService,
  projectId: string,
  activeStageId?: string,
) {
  return tool(
    async ({ targetSections, rationale, artifactExcerpt }) => {
      try {
        const project = await projects.findOne(projectId);
        const current = project.mddContent ?? "";
        const sections = targetSections.filter((n) => n === 3 || n === 4);
        if (sections.length === 0) return "targetSections debe incluir 3 y/o 4.";
        const merged = await ai.proposeMddAmendment({
          currentMdd: current,
          targetSections: sections,
          rationale,
          artifactExcerpt,
        });
        await projects.update(projectId, {
          mddContent: merged,
          ...(activeStageId?.trim() ? { stageId: activeStageId.trim() } : {}),
        });
        return "MDD enmendado (§3/§4) y persistido en la etapa activa.";
      } catch (err) {
        return `Error propose_mdd_amendment: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "propose_mdd_amendment",
      description:
        "Evalúa impacto de un cambio en Blueprint/API y parchea el MDD base en §3 Modelo de datos y/o §4 Contratos de API manteniendo la Constitución viva.",
      schema: z.object({
        targetSections: z
          .array(z.union([z.literal(3), z.literal(4)]))
          .min(1)
          .describe("Secciones del MDD a enmendar (solo 3 y/o 4)"),
        rationale: z.string().describe("Por qué el MDD debe cambiar (impacto, consistencia SDD)"),
        artifactExcerpt: z
          .string()
          .describe("Extracto del Blueprint, OpenAPI o SQL que introduce el delta"),
      }),
    },
  );
}

/**
 * Herramientas SDD sobre markdown (patch/enmienda; sin Cypher/FalkorDB).
 */
export function getSddAgentTools(
  projects: ProjectsService,
  ai: AiService,
  projectId: string,
  activeStageId?: string,
) {
  return [
    createPatchMddSectionTool(projects, projectId, activeStageId),
    createProposeMddAmendmentTool(projects, ai, projectId, activeStageId),
  ];
}
