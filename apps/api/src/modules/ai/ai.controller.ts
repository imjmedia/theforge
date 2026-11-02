import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { PreferencesService } from "./preferences.service.js";
import { AiService } from "./ai.service.js";

@Controller("ai")
export class AiController {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly ai: AiService,
  ) { }

  /**
   * Cuando el usuario aprueba un MDD: extrae preferencias arquitectónicas y las guarda (memoria semántica).
   * Body: { projectId?: string, mddContent: string }
   */
  @ProjectScoped({ from: "body", key: "projectId", level: "spend", optional: true })
  @Post("preferences/learn-from-mdd")
  async learnFromMdd(
    @Body() body: { projectId?: string; mddContent?: string },
  ): Promise<{ id: string }> {
    const mddContent = typeof body?.mddContent === "string" ? body.mddContent : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || null : null;
    return this.preferences.learnFromMdd(projectId, mddContent);
  }

  /** Regenera un diagrama Mermaid roto o truncado vía LLM (Workshop). */
  @Post("mermaid/regenerate")
  async regenerateMermaid(
    @Body() body: { content?: string },
  ): Promise<{ content: string }> {
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      throw new BadRequestException("content es obligatorio");
    }
    const diagram = await this.ai.regenerateMermaidDiagram(content);
    return { content: diagram };
  }
}
