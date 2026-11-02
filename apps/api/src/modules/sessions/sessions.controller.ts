import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, forwardRef } from "@nestjs/common";
import type { ProjectAccessLevel } from "../../common/access/project-access.policy.js";
import { ProjectAccessService } from "../../common/access/project-access.service.js";
import { ProjectAccessExempt, ProjectScoped } from "../../common/access/project-scoped.decorator.js";
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
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Las rutas `:id` son de sesión, no de proyecto: se carga la sesión con el scope del usuario (404 si no es
   * suya) y se exige `level` sobre el proyecto de la sesión. Así un antiguo colaborador pierde el acceso si el
   * proyecto pasa a PRIVATE, y quien solo puede contribuir no gasta el LLM del dueño (`spend`).
   */
  private async authorizeSession(sessionId: string, level: ProjectAccessLevel): Promise<void> {
    const projectId = await this.sessions.getSessionProjectId(sessionId);
    await this.access.assertProject(this.access.actorFromRequest(), projectId, level);
  }

  @ProjectScoped({ from: "body", key: "projectId", level: "contribute" })
  @Post()
  create(@Body() body: unknown) {
    return this.sessions.create(createSessionSchema.parse(body));
  }

  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("project/:projectId")
  findByProject(@Param("projectId") projectId: string) {
    return this.sessions.findByProject(projectId);
  }

  @ProjectAccessExempt("autorizado en el handler por el proyecto de la sesión (read)")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    await this.authorizeSession(id, "read");
    return this.sessions.findOne(id);
  }

  /** Con imágenes (rol user) se invoca el modelo de visión con el LLM del dueño: `spend`; si no, `contribute`. */
  @ProjectAccessExempt("autorizado en el handler por el proyecto de la sesión (spend con imágenes, contribute sin ellas)")
  @Post(":id/messages")
  async appendMessage(@Param("id") id: string, @Body() body: unknown) {
    const parsed = appendChatSchema.parse(body);
    const callsVision = parsed.role === "user" && (parsed.images?.length ?? 0) > 0;
    await this.authorizeSession(id, callsVision ? "spend" : "contribute");
    return this.sessions.appendMessage(id, parsed);
  }

  /**
   * Paridad con `POST /ai-orchestrator/chat`: delega en `AiOrchestratorService.chatBySessionId`
   * (HITL complejidad, PATCH MDD/UX/DBGA del body, supervisor + etapa, legacy/TheForge, Guía UX/Stitch,
   * persistencia de documentos devueltos por la IA, ingest SDD, `evaluatorCritique`).
   * Respuesta: `{ session, project, uxUiGuideContent?, evaluatorCritique? }` (no el objeto crudo de `SessionsService.chat`).
   */
  @ProjectAccessExempt("autorizado en el handler por el proyecto de la sesión (spend)")
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
    await this.authorizeSession(id, "spend");
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

  @ProjectScoped({ key: "projectId", level: "spend" })
  @Post("project/:projectId/salvage-dbga")
  salvageDbgaFromChat(@Param("projectId") projectId: string) {
    return this.sessions.salvageAndRestoreDbgaFromChat(projectId);
  }

  @ProjectAccessExempt("autorizado en el handler por el proyecto de la sesión (contribute)")
  @Patch(":id/context")
  async updateContextStep(
    @Param("id") id: string,
    @Body() body: { contextStep: string },
  ) {
    await this.authorizeSession(id, "contribute");
    return this.sessions.updateContextStep(id, body.contextStep);
  }
}
