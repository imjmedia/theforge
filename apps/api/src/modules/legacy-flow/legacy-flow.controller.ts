import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { generateCodebaseDocRequestSchema } from "@theforge/shared-types";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { ProjectsService } from "../projects/projects.service.js";
import { LegacyCoordinatorService } from "./legacy-coordinator.service.js";
import { LegacyDeliverablesQueueService } from "./legacy-deliverables-queue.service.js";
import { MddQueueService } from "../ai-analysis/mdd/mdd-queue.service.js";
import { ResolveChangeToFilesService } from "./resolve-change-to-files.service.js";
import { CheckNavigationImpactService } from "./check-navigation-impact.service.js";
import { LegacyTransitionService } from "./legacy-transition.service.js";

/**
 * Controlador REST del flujo legacy: inicio (AriadneSpecs MCP), respuestas, generación de MDD y de entregables en cascada.
 */
@Controller("projects/:projectId/legacy")
export class LegacyFlowController {
  constructor(
    private readonly coordinator: LegacyCoordinatorService,
    private readonly legacyDeliverablesQueue: LegacyDeliverablesQueueService,
    private readonly mddQueue: MddQueueService,
    private readonly projects: ProjectsService,
    private readonly resolveChange: ResolveChangeToFilesService,
    private readonly navImpact: CheckNavigationImpactService,
    private readonly legacyTransition: LegacyTransitionService,
  ) {}

  /**
   * Resuelve los archivos a modificar a partir de una descripción de cambio.
   * Usa el navigation map del proyecto para hacer matching semántico.
   * @param projectId - ID del proyecto.
   * @param body.description - Descripción del cambio en lenguaje natural.
   * @param body.stageId - Etapa base opcional.
   * @returns suggestedFiles, affectedRoutes, sharedComponents, sddImpact.
   */
  @ProjectScoped({ key: "projectId", level: "contribute", stage: { from: "body", key: "stageId", optional: true } })
  @Post("resolve-change-to-files")
  async resolveChangeToFiles(
    @Param("projectId") projectId: string,
    @Body() body: { description?: string; stageId?: string },
  ) {
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    if (!description) throw new BadRequestException("description is required");
    return this.resolveChange.resolve({ projectId, description, stageId: body.stageId });
  }

  /**
   * Evalúa el impacto de modificar un componente en el mapa de navegación.
   * Detecta si el componente es compartido y qué rutas afecta.
   * @param projectId - ID del proyecto.
   * @param body.componentPath - Ruta del componente a modificar.
   * @param body.stageId - Etapa base opcional.
   * @returns isShared, routesAffected, screenNames, warning.
   */
  @ProjectScoped({ key: "projectId", level: "contribute", stage: { from: "body", key: "stageId", optional: true } })
  @Post("check-navigation-impact")
  async checkNavigationImpact(
    @Param("projectId") projectId: string,
    @Body() body: { componentPath?: string; stageId?: string },
  ) {
    const componentPath = typeof body?.componentPath === "string" ? body.componentPath.trim() : "";
    if (!componentPath) throw new BadRequestException("componentPath is required");
    return this.navImpact.checkImpact(projectId, componentPath, body.stageId);
  }

  /**
   * Verifica si el proyecto puede transicionar a flujo legacy.
   * Consulta AriadneSpecs para saber si el código está indexado.
   */
  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("transition-status")
  async transitionStatus(@Param("projectId") projectId: string) {
    return this.legacyTransition.checkTransition(projectId);
  }

  /**
   * Ejecuta la transición a flujo legacy: crea stage baseline con navigation map.
   */
  @ProjectScoped({ key: "projectId", level: "contribute" })
  @Post("execute-transition")
  async executeTransition(@Param("projectId") projectId: string) {
    return this.legacyTransition.executeTransition(projectId);
  }

  /**
   * Genera documentación de partida del codebase vía MCP (opcional, ideal como primer paso).
   * @param projectId - ID del proyecto (debe ser LEGACY con theforgeProjectId).
   * @returns { codebaseDoc: string } o null si TheForge no está configurado.
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("generate-codebase-doc")
  async generateCodebaseDoc(@Param("projectId") projectId: string, @Body() body: unknown) {
    const parsed = generateCodebaseDocRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const stageId = (body as Record<string, unknown>)?.stageId as string | undefined;
    return this.coordinator.generateCodebaseDoc(projectId, parsed.data, stageId);
  }

  /**
   * Tras 409 LEGACY_INDEX_SDD_MISMATCH: confirma si se confía en el índice MCP, en el SDD (Falkor) o continuar con advertencia.
   */
  @ProjectScoped({ key: "projectId", level: "contribute", stage: { from: "body", key: "stageId", optional: true } })
  @Post("resolve-index-sdd-conflict")
  async resolveIndexSddConflict(
    @Param("projectId") projectId: string,
    @Body() body: { choice?: "trust_index" | "trust_sdd" | "proceed_with_warnings"; stageId?: string },
  ) {
    const choice = body?.choice;
    if (choice !== "trust_index" && choice !== "trust_sdd" && choice !== "proceed_with_warnings") {
      throw new BadRequestException("body.choice debe ser trust_index | trust_sdd | proceed_with_warnings");
    }
    return this.coordinator.resolveIndexSddConflict(projectId, choice, body.stageId);
  }

  /**
   * Actualiza la documentación de partida del codebase (edición manual).
   * @param projectId - ID del proyecto.
   * @param body.codebaseDoc - Contenido Markdown de la documentación.
   * @returns { codebaseDoc: string }.
   */
  @ProjectScoped({ key: "projectId", level: "contribute", stage: { from: "body", key: "stageId", optional: true } })
  @Patch("codebase-doc")
  async updateCodebaseDoc(
    @Param("projectId") projectId: string,
    @Body() body: { codebaseDoc?: string; stageId?: string },
  ) {
    const codebaseDoc = typeof body?.codebaseDoc === "string" ? body.codebaseDoc : "";
    return this.coordinator.updateCodebaseDoc(projectId, codebaseDoc, body.stageId);
  }

  /**
   * Inicia el flujo legacy: envía la descripción al MCP AriadneSpecs y obtiene archivos a modificar y preguntas para afinar.
   * @param projectId - ID del proyecto (debe ser tipo LEGACY con theforgeProjectId).
   * @param body.description - Descripción de la modificación que quiere el usuario.
   * @returns Lista de archivos, preguntas y respuestas sugeridas (opcional).
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("start")
  async start(
    @Param("projectId") projectId: string,
    @Body() body: { description?: string; stageId?: string },
  ) {
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    return this.coordinator.start(projectId, description, body.stageId);
  }

  /**
   * Registra las respuestas del usuario a las preguntas del flujo. Persiste en legacyFlowState.answers.
   * @param projectId - ID del proyecto.
   * @param body.answers - Mapa índice → respuesta (p. ej. { "0": "10", "1": "30" }).
   * @returns { ok: true }.
   */
  @ProjectScoped({ key: "projectId", level: "contribute", stage: { from: "body", key: "stageId", optional: true } })
  @Post("answer")
  async answer(
    @Param("projectId") projectId: string,
    @Body() body: { answers?: Record<string, string>; stageId?: string },
  ) {
    const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
    return this.coordinator.answer(projectId, answers, body.stageId);
  }

  /**
   * Genera el MDD de cambio a partir del estado del flujo (descripción, archivos, respuestas) y contexto AriadneSpecs. Persiste en mddContent.
   * Respuesta ligera por defecto (`ok`, `mddLength`, `wordCount`); `?includeContent=true` incluye el markdown (evitar en UI).
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("generate-mdd")
  async generateMdd(
    @Param("projectId") projectId: string,
    @Body() body: { stageId?: string } = {},
    @Query("includeContent") includeContent?: string,
    @Query("queue") queue?: string,
  ) {
    const useQueue = queue !== "false" && this.mddQueue.isEnabled();
    if (useQueue) {
      const jobId = await this.mddQueue.enqueue({
        mode: "legacy",
        projectId,
        stageId: body.stageId?.trim() || undefined,
      });
      return {
        queued: true,
        jobId,
        statusPath: `/projects/${projectId}/mdd-jobs/${jobId}`,
      };
    }
    return this.coordinator.generateMdd(projectId, body.stageId, {
      includeContent: includeContent === "true",
    });
  }

  /**
   * Polling de MDD legacy encolado. El job debe pertenecer al proyecto de la ruta: si no existe o es de otro
   * proyecto responde 404 (nunca 403, para no revelar que el jobId existe).
   */
  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("mdd-jobs/:jobId")
  async getLegacyMddJobStatus(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    const ref = await this.mddQueue.getJobAccessRef(jobId);
    if (ref === null || ref.projectId !== projectId) {
      throw new NotFoundException("Job no encontrado");
    }
    const status = await this.mddQueue.getJobStatus(jobId);
    if (status.status === "unknown") {
      throw new NotFoundException("Job no encontrado");
    }
    return status;
  }

  /**
   * Genera borrador BRD desde `codebaseDoc` (legacy); To-Be y As-Is eliminados del sistema.
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("suggest-brd-from-codebase-doc")
  @Post("suggest-brd-tobe-from-codebase-doc")
  async suggestBrdFromCodebaseDoc(
    @Param("projectId") projectId: string,
    @Body() body: { stageId?: string },
  ) {
    return this.coordinator.suggestBrdFromCodebaseDoc(projectId, body.stageId);
  }

  /**
   * Genera en cascada todos los entregables (SPEC, Arquitectura, Casos de uso, Historias, Blueprint, Guía UX/UI, API, Flujos, Infra, Tasks) desde el MDD.
   * @param projectId - ID del proyecto (debe tener mddContent generado previamente).
   * @returns Confirmación de que la cascada terminó.
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("generate-deliverables")
  async generateDeliverables(
    @Param("projectId") projectId: string,
    @Body() body: { stageId?: string } = {},
  ) {
    if (this.legacyDeliverablesQueue.isEnabled()) {
      const jobId = await this.legacyDeliverablesQueue.enqueue({
        projectId,
        stageId: body.stageId?.trim() || undefined,
      });
      return {
        queued: true,
        jobId,
        statusPath: `/projects/${projectId}/legacy/deliverables-jobs/${jobId}`,
      };
    }
    await this.projects.assertMddDeliveryGateForDeliverables(projectId);
    return this.coordinator.generateDeliverables(projectId, body.stageId);
  }

  /**
   * Polling de cascada legacy encolada (BullMQ). El job debe pertenecer al proyecto de la ruta: si no existe o es
   * de otro proyecto responde 404 (nunca 403).
   */
  @ProjectScoped({ key: "projectId", level: "read" })
  @Get("deliverables-jobs/:jobId")
  async getLegacyDeliverablesJobStatus(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    const ref = await this.legacyDeliverablesQueue.getJobAccessRef(jobId);
    if (ref === null || ref.projectId !== projectId) {
      throw new NotFoundException("Job no encontrado");
    }
    return this.legacyDeliverablesQueue.getJobStatus(jobId);
  }

  /**
   * Genera un entregable individual (documento técnico) a partir del codebaseDoc del proyecto legacy.
   * @param projectId - ID del proyecto.
   * @param body.documentType - Tipo de documento a generar: spec | architecture | use-cases | user-stories | blueprint | api-contracts | logic-flows | tasks | infra.
   * @param body.stageId - Etapa base opcional.
   * @returns { content: string; field: string }
   */
  @ProjectScoped({ key: "projectId", level: "spend", stage: { from: "body", key: "stageId", optional: true } })
  @Post("generate-from-codebase")
  async generateFromCodebase(
    @Param("projectId") projectId: string,
    @Body() body: { documentType?: string; stageId?: string },
  ) {
    const VALID_TYPES = [
      "spec", "architecture", "use-cases", "user-stories",
      "blueprint", "api-contracts", "logic-flows", "tasks", "infra",
    ] as const;
    const docType = typeof body?.documentType === "string" ? body.documentType.trim() : "";
    if (!VALID_TYPES.includes(docType as any)) {
      throw new BadRequestException(
        `documentType debe ser uno de: ${VALID_TYPES.join(", ")}`,
      );
    }
    return this.coordinator.generateFromCodebase(projectId, docType, body.stageId);
  }
}
