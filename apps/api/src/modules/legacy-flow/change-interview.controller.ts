/**
 * @fileoverview Controlador REST de la entrevista conversacional (ChangeInterviewService).
 * Endpoints para iniciar, continuar, confirmar y cancelar la entrevista.
 */
import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { ChangeInterviewService } from "./change-interview.service.js";

@Controller("projects/:projectId/legacy/interview")
export class ChangeInterviewController {
  constructor(private readonly interview: ChangeInterviewService) {}

  /**
   * Inicia una entrevista conversacional para definir el alcance de un cambio.
   * Nivel `spend` (llama al LLM); la etapa del body, si llega, debe ser del proyecto.
   * @param projectId - ID del proyecto LEGACY.
   * @param body.description - Descripción del cambio en lenguaje natural.
   * @param body.stageId - ID de etapa opcional (para persistir el resultado).
   * @returns sessionId, messages iniciales y resumen del navigation map.
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("start")
  async start(
    @Param("projectId") projectId: string,
    @Body() body: { description?: string; stageId?: string },
  ) {
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    if (!description) {
      throw new BadRequestException("description is required");
    }
    return this.interview.startInterview(projectId, description, body.stageId);
  }

  /**
   * Continúa la conversación con un mensaje del usuario.
   * @param sessionId - ID de sesión (del start).
   * @param body.message - Mensaje del usuario.
   * @returns Messages actualizados y changeScope si está listo.
   */
  @ProjectScoped({ key: "projectId", level: "spend" })
  @Post(":sessionId/chat")
  async chat(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { message?: string },
  ) {
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      throw new BadRequestException("message is required");
    }
    return this.interview.continueChat(projectId, sessionId, message);
  }

  /**
   * Confirma el ChangeScope de la entrevista actual y lo persiste.
   * @param sessionId - ID de sesión.
   * @returns ChangeScope confirmado.
   */
  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Post(":sessionId/confirm")
  async confirm(@Param("projectId") projectId: string, @Param("sessionId") sessionId: string) {
    return this.interview.confirmScope(projectId, sessionId);
  }

  /**
   * Cancela la entrevista actual.
   * @param sessionId - ID de sesión.
   */
  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Post(":sessionId/cancel")
  async cancel(@Param("projectId") projectId: string, @Param("sessionId") sessionId: string) {
    await this.interview.cancelInterview(projectId, sessionId);
    return { ok: true };
  }

  /**
   * Obtiene el estado actual de la entrevista.
   * @param sessionId - ID de sesión.
   * @returns Estado, mensajes y changeScope (si existe).
   */
  @ProjectScoped({ key: "projectId", level: "read" })
  @Get(":sessionId")
  async status(@Param("projectId") projectId: string, @Param("sessionId") sessionId: string) {
    return this.interview.getStatus(projectId, sessionId);
  }
}
