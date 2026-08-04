import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import type { Project } from "@theforge/database";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { AiService } from "../ai/ai.service.js";
import { UX_UI_GUIDE_PROMPT } from "../ai/prompts/ux-ui-guide-prompt.js";
import { uxGuideLlmOptions } from "../ai/ux-guide-llm-context.js";
import { buildMddContextForUxGuide } from "../ai/utils/mdd-ux-guide-brief.util.js";
import { appendUxGuideDesignAttribution } from "../design-ref/design-ref-attribution.util.js";
import {
  composeDesignSystemFromRef,
  composeDesignSystemFromScannedTokens,
} from "../design-ref/compose-design-system-from-ref.util.js";
import {
  lintDesignMd,
  formatLintSummary,
  type DesignMdLintResult,
} from "../design-ref/design-md-lint.util.js";
import {
  formatDesignSystemLintSummary,
  lintDesignSystemTokens,
} from "../design-ref/design-system-lint.util.js";
import { postProcessUxGuideDesignTokens } from "../design-ref/design-system-postprocess.util.js";
import { scanUrlForDesignTokens } from "../design-ref/scan-url.util.js";
import { UiMcpClientService } from "../ui-mcp/ui-mcp-client.service.js";
import { UiMcpService } from "../ui-mcp/ui-mcp.service.js";
import {
  UI_MCP_DESIGN_SYSTEM_HEADING,
  buildUiMcpDesignSystemSection,
} from "../ui-mcp/ui-design-system-section.util.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { PluginDocumentPipelineService } from "../../plugins/plugin-document-pipeline.service.js";
import { buildProjectHookContext } from "../../plugins/plugin-project-context.util.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import {
  buildConstitutionMarkdown,
  pickMddFromStages,
} from "./constitution-markdown.util.js";
import { pickPrimaryStage, type StageWithEstimation } from "./stage-helpers.js";
import { ProjectsService } from "./projects.service.js";

type ProjectWithStages = Project & { stages: StageWithEstimation[] };

@Injectable()
export class ProjectUxGuideService {
  private readonly logger = new Logger(ProjectUxGuideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly uiMcpClient: UiMcpClientService,
    private readonly uiMcp: UiMcpService,
    private readonly pluginPipeline: PluginDocumentPipelineService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}

  /** Guía UX/UI generada por LLM (mismo criterio que legacy, sin Relic). */
  async generateUxUiGuide(projectId: string, signal?: AbortSignal) {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const mdd = buildConstitutionMarkdown(project);
    const bp = (project.blueprintContent ?? "").trim();

    if (!project.uxGuideDesignRef?.trim()) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { uxGuideDesignRef: "auto" },
      });
      project.uxGuideDesignRef = "auto";
    }

    const uxPrompt =
      "Genera la Guía UX/UI completa en markdown según tu rol. El contexto (resumen MDD, Blueprint y documentos SDD) está en el system prompt. Termina el documento con la línea exacta ---FIN_UX_UI--- y deja un mensaje breve para el usuario después.";
    const mddBrief = buildMddContextForUxGuide(mdd);
    const raw = await this.ai.generateUxUiGuide(
      uxPrompt,
      signal ? { ...this.buildHookGenerateOpts(project), abortSignal: signal } : this.buildHookGenerateOpts(project),
      {
        activeTab: "ux-ui-guide",
        currentMddContent: mddBrief || undefined,
        currentBlueprintContent: bp || undefined,
        abortSignal: signal,
        ...uxGuideLlmOptions(project, mdd),
      },
    );
    const clean = (raw ?? "").replace(/\n?-{1,}FIN_UX_UI-{1,}[\s\S]*$/i, "").trim();
    if (!clean) {
      this.logger.warn(`[generateUxUiGuide] LLM returned empty content for project ${projectId}`);
      return this.projects.findOne(projectId);
    }
    let finalContent = cleanDocumentContent(clean);
    if (!finalContent.startsWith("---")) {
      const name = project.name ?? projectId;
      finalContent = `---
name: ${JSON.stringify(name)}
---

${finalContent}`;
    }
    finalContent = postProcessUxGuideDesignTokens(finalContent, mdd, bp);
    finalContent = await this.appendUiMcpDesignSystem(finalContent);
    finalContent = appendUxGuideDesignAttribution(finalContent, project.uxGuideDesignRef, mdd);
    const tokenLint = lintDesignSystemTokens(finalContent, mdd, bp);
    if (tokenLint.findings.length > 0) {
      this.logger.log(
        `[generateUxUiGuide] ${formatDesignSystemLintSummary(tokenLint)} project=${projectId}`,
      );
    }
    const updated = await this.projects.update(projectId, { uxUiGuideContent: finalContent });
    this.notifyPluginAfterDocumentPersist(
      "ux-ui-guide",
      projectId,
      updated.uxUiGuideContent ?? finalContent,
    );
    return updated;
  }

  /**
   * Design System determinista desde biblioteca (DESIGN.md importado o catálogo builtin).
   * Sin LLM: auto-match heurístico + composición local.
   */
  async composeUxGuideFromDesignRef(projectId: string): Promise<{
    composed: boolean;
    uxUiGuideContent?: string | null;
    effectiveSlug?: string;
    source?: string;
    referenceName?: string;
    reason?: string;
    lint?: DesignMdLintResult;
  }> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const mdd = buildConstitutionMarkdown(project);
    const projectName = project.name || projectId;
    const storedRef = project.uxGuideDesignRef?.trim() ?? null;

    if (storedRef?.startsWith("url:")) {
      const url = storedRef.slice("url:".length).trim();
      const scan = await scanUrlForDesignTokens(url);
      if ("error" in scan) {
        this.logger.warn(`[scan-url] project=${projectId} url=${url} fallo: ${scan.error}`);
        return { composed: false, reason: "url-scan-failed" };
      }
      const content = cleanDocumentContent(
        composeDesignSystemFromScannedTokens(projectName, scan.tokens),
      );
      const updated = await this.projects.update(projectId, { uxUiGuideContent: content });
      const lint = await this.lintUxGuideContent(content, projectId, storedRef);
      return {
        composed: true,
        uxUiGuideContent: updated.uxUiGuideContent,
        effectiveSlug: storedRef,
        source: "url-scan",
        referenceName: scan.tokens.name,
        lint,
      };
    }

    const composed = composeDesignSystemFromRef({
      projectName,
      storedRef: project.uxGuideDesignRef,
      mddContext: mdd,
    });
    if (!composed) {
      return { composed: false, reason: "no-reference-match" };
    }

    let finalContent = cleanDocumentContent(composed.content);
    finalContent = appendUxGuideDesignAttribution(finalContent, project.uxGuideDesignRef, mdd);
    const updated = await this.projects.update(projectId, { uxUiGuideContent: finalContent });

    const lint = await this.lintUxGuideContent(finalContent, projectId, composed.effectiveSlug);

    return {
      composed: true,
      uxUiGuideContent: updated.uxUiGuideContent,
      effectiveSlug: composed.effectiveSlug,
      source: composed.source,
      referenceName: composed.referenceName,
      lint,
    };
  }

  /**
   * Repara/regenera solo el YAML frontmatter de la Guía UX/UI usando el MDD como contexto.
   * NO regenera el cuerpo markdown — solo los tokens de diseño (colors, typography, etc.).
   */
  async repairUxUiGuideYaml(projectId: string): Promise<string> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const mdd = buildConstitutionMarkdown(project);
    const bp = (project.blueprintContent ?? "").trim();
    const spec = (project.specContent ?? "").trim();
    const name = project.name || projectId;

    const repairPrompt =
      `Eres un diseñador UX/UI experto. Genera ÚNICAMENTE el YAML frontmatter del archivo DESIGN.md ` +
      `para el proyecto "${name}", basándote en el contexto del MDD, Blueprint y Spec que recibes.\n\n` +
      `IMPORTANTE: Responde ÚNICAMENTE con el bloque YAML entre --- y ---. NO incluyas secciones markdown, ` +
      `ni texto explicativo, ni bloques \`\`\` alrededor.\n\n` +
      `El YAML debe tener esta estructura:\n` +
      `---\n` +
      `version: alpha\n` +
      `name: "${name}"\n` +
      `description: "Frase corta que capture la personalidad visual del proyecto"\n` +
      `colors:\n` +
      `  primary: "#<Hex>"\n` +
      `  secondary: "#<Hex>"\n` +
      `  tertiary: "#<Hex>"\n` +
      `  neutral: "#<Hex>"\n` +
      `  foreground: "#<Hex>"\n` +
      `  background: "#<Hex>"\n` +
      `  muted: "#<Hex>"\n` +
      `  border: "#<Hex>"\n` +
      `  danger: "#<Hex>"\n` +
      `  success: "#<Hex>"\n` +
      `  warning: "#<Hex>"\n` +
      `  info: "#<Hex>"\n` +
      `typography:\n` +
      `  font-sans: ["Inter", "system-ui", "sans-serif"]\n` +
      `  h1: { fontFamily: "...", fontSize: 32px, fontWeight: 700, lineHeight: 40px, letterSpacing: "-0.02em" }\n` +
      `  h2: { similar }\n` +
      `  h3: { similar }\n` +
      `  body-md: { fontFamily: "...", fontSize: 16px, fontWeight: 400, lineHeight: 24px }\n` +
      `  body-sm: { similar }\n` +
      `  label-sm: { similar }\n` +
      `rounded:\n` +
      `  none: 0px\n` +
      `  sm: 6px\n` +
      `  md: 12px\n` +
      `  lg: 20px\n` +
      `  xl: 28px\n` +
      `  full: 9999px\n` +
      `spacing:\n` +
      `  xxs: 2px\n` +
      `  xs: 4px\n` +
      `  sm: 8px\n` +
      `  md: 16px\n` +
      `  lg: 24px\n` +
      `  xl: 32px\n` +
      `  2xl: 48px\n` +
      `  3xl: 64px\n` +
      `elevation:\n` +
      `  card: { boxShadow: "..." }\n` +
      `  dropdown: { boxShadow: "..." }\n` +
      `  modal: { boxShadow: "..." }\n` +
      `  sticky: { boxShadow: "..." }\n` +
      `components:\n` +
      `  button-primary: { backgroundColor, textColor, rounded, padding, typography }\n` +
      `  button-secondary: { ... }\n` +
      `  button-ghost: { ... }\n` +
      `  button-danger: { ... }\n` +
      `  card: { ... }\n` +
      `  badge: { ... }\n` +
      `  input: { ... }\n` +
      `  modal: { ... }\n` +
      `  toast: { ... }\n` +
      `  skeleton: { ... }\n` +
      `---\n\n` +
      `Contexto del proyecto:\n` +
      `${mdd ? `## Resumen MDD (design system)\n${buildMddContextForUxGuide(mdd)}` : ""}\n\n` +
      `${bp ? `## Blueprint\n${bp.slice(0, 3000)}` : ""}\n\n` +
      `${spec ? `## Spec\n${spec.slice(0, 2000)}` : ""}\n\n` +
      `NO incluyas secciones markdown, solo el bloque YAML.`;

    const mddBrief = buildMddContextForUxGuide(mdd);
    const raw = await this.ai.generateResponse(repairPrompt, [], {
      systemPrompt: UX_UI_GUIDE_PROMPT,
      activeTab: "ux-ui-guide",
      currentMddContent: mddBrief || undefined,
      currentBlueprintContent: bp || undefined,
      ...uxGuideLlmOptions(project, mdd),
    });

    const trimmed = (raw ?? "").trim();
    const yamlMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
      if (trimmed.startsWith("---")) {
        const endIdx = trimmed.indexOf("---", 3);
        if (endIdx !== -1) {
          return trimmed.slice(0, endIdx + 3);
        }
        return trimmed;
      }
      this.logger.warn(`[repairUxUiGuideYaml] No YAML block found in LLM response for ${projectId}`);
      return `---
name: ${JSON.stringify(name)}
---`;
    }

    return `---\n${yamlMatch[1]!.trim()}\n---`;
  }

  private buildHookGenerateOpts(project: ProjectWithStages) {
    const stage = pickPrimaryStage(project.stages);
    return {
      projectId: project.id,
      hookContext: buildProjectHookContext(project, {
        mddContent: pickMddFromStages(project.stages).trim() || null,
        brdContent: stage?.brdContent ?? null,
      }),
    };
  }

  private async appendUiMcpDesignSystem(content: string): Promise<string> {
    try {
      if (!(await this.uiMcpClient.isActive())) return content;
      if (content.includes(UI_MCP_DESIGN_SYSTEM_HEADING)) return content;
      const [tokens, meta, components] = await Promise.all([
        this.uiMcpClient.getDesignTokens(),
        this.uiMcp.getActiveCompatibleMeta(),
        this.uiMcpClient.listComponents(),
      ]);
      const section = buildUiMcpDesignSystemSection({
        tokens,
        components,
        libraryName: meta?.libraryName,
        libraryVersion: meta?.libraryVersion,
      });
      if (!section) return content;
      return `${content.trimEnd()}\n\n${section}`;
    } catch {
      return content;
    }
  }

  private async lintUxGuideContent(
    content: string,
    projectId: string,
    effectiveSlug?: string,
  ): Promise<DesignMdLintResult> {
    const lint = await lintDesignMd(content);
    if (lint.unavailable) return lint;

    const scope = `[design.md lint] project=${projectId} ref=${effectiveSlug ?? "-"}`;
    const summary = formatLintSummary(lint);
    if (lint.summary.errors > 0) {
      this.logger.warn(`${scope} ${summary}`);
    } else if (lint.summary.warnings > 0) {
      this.logger.log(`${scope} ${summary}`);
    }

    for (const finding of lint.findings) {
      if (finding.severity === "info") continue;
      const where = finding.path ? ` (${finding.path})` : "";
      const line = `${scope} ${finding.severity}${where}: ${finding.message}`;
      if (finding.severity === "error") this.logger.warn(line);
      else this.logger.log(line);
    }

    return lint;
  }

  private notifyPluginAfterDocumentPersist(
    documentType: string,
    projectId: string,
    finalContent: string,
  ): void {
    void this.pluginPipeline.runAfterDocumentPersist({
      documentType,
      projectId,
      finalContent,
      metadata: {
        durationMs: 0,
        provider: "core",
        model: documentType,
      },
    });
  }
}
