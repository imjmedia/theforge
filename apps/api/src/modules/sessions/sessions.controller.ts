import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, forwardRef } from "@nestjs/common";
import { parseChatImageAttachments } from "../ai/utils/chat-image-attachments.util.js";
import { AiOrchestratorService } from "../ai-orchestrator/ai-orchestrator.service.js";
import { SessionsService } from "./sessions.service.js";
import { createSessionSchema, appendChatSchema } from "@theforge/shared-types";

@Controller("sessions")
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    @Inject(forwardRef(() => AiOrchestratorService))
    private readonly orchestrator: AiOrchestratorService,
  ) {}

  @Post()
  create(@Body() body: unknown) {
    return this.sessions.create(createSessionSchema.parse(body));
  }

  @Get("project/:projectId")
  findByProject(@Param("projectId") projectId: string) {
    return this.sessions.findByProject(projectId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.sessions.findOne(id);
  }

  @Post(":id/messages")
  appendMessage(@Param("id") id: string, @Body() body: unknown) {
    return this.sessions.appendMessage(id, appendChatSchema.parse(body));
  }

  /**
   * Paridad con `POST /ai-orchestrator/chat`: delega en `AiOrchestratorService.chatBySessionId`
   * (HITL complejidad, PATCH MDD/UX/DBGA del body, supervisor + etapa, legacy/TheForge, Guía UX/Stitch,
   * persistencia de documentos devueltos por la IA, ingest SDD, `evaluatorCritique`).
   * Respuesta: `{ session, project, uxUiGuideContent?, evaluatorCritique? }` (no el objeto crudo de `SessionsService.chat`).
   */
  @Post(":id/chat")
  async chat(
    @Param("id") id: string,
    @Body()
    body: {
      message?: string;
      images?: unknown;
      activeTab?: string;
      stageId?: string;
      chatScope?: "stage" | "global";
      mddContent?: string | null;
      uxUiGuideContent?: string | null;
      dbgaContent?: string | null;
      phase0SummaryContent?: string | null;
    },
  ) {
    const images = parseChatImageAttachments(body?.images);
    const msg = typeof body?.message === "string" ? body.message.trim() : "";
    if (!msg && !images.length) {
      throw new BadRequestException("message or images are required");
    }
    return this.orchestrator.chatBySessionId(id, {
      message: msg,
      userImages: images.length ? images : undefined,
      mddContentFromClient: body.mddContent?.trim() || undefined,
      activeTab: body.activeTab?.trim() || undefined,
      uxUiGuideContentFromClient: body.uxUiGuideContent?.trim() || undefined,
      dbgaContentFromClient: body.dbgaContent?.trim() || undefined,
      phase0SummaryContentFromClient: body.phase0SummaryContent?.trim() || undefined,
      stageIdFromClient: body.stageId?.trim() || undefined,
      chatScopeFromClient:
        body.chatScope === "stage" || body.chatScope === "global" ? body.chatScope : undefined,
    });
  }

  @Post("project/:projectId/salvage-dbga")
  salvageDbgaFromChat(@Param("projectId") projectId: string) {
    return this.sessions.salvageAndRestoreDbgaFromChat(projectId);
  }

  @Patch(":id/context")
  updateContextStep(
    @Param("id") id: string,
    @Body() body: { contextStep: string },
  ) {
    return this.sessions.updateContextStep(id, body.contextStep);
  }
}
