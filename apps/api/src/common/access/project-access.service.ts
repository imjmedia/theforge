import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getRequestUserId, getRequestUserRole } from "../request-user.store.js";
import {
  canAccessProject,
  type ProjectAccessActor,
  type ProjectAccessLevel,
  type ProjectAccessOptions,
} from "./project-access.policy.js";

/** Código del 403 cuando el actor puede leer el proyecto pero no tiene el nivel pedido. */
export const PROJECT_LEVEL_FORBIDDEN_CODE = "PROJECT_LEVEL_FORBIDDEN";

export const PROJECT_LEVEL_FORBIDDEN_MESSAGE = "Solo el dueño del proyecto puede ejecutar esta acción";

/** Cuerpo del 403 `PROJECT_LEVEL_FORBIDDEN`. */
export interface ProjectLevelForbiddenBody {
  code: typeof PROJECT_LEVEL_FORBIDDEN_CODE;
  level: ProjectAccessLevel;
  message: string;
}

/** ¿`err` es el 403 de nivel insuficiente que lanza `assertProject`? */
export function isProjectLevelForbidden(err: unknown): err is ForbiddenException {
  if (!(err instanceof ForbiddenException)) return false;
  const body = err.getResponse();
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === PROJECT_LEVEL_FORBIDDEN_CODE
  );
}

/** ¿`err` es una denegación de acceso a proyecto (404 sin acceso/inexistente o 403 de nivel)? */
export function isProjectAccessDenied(err: unknown): boolean {
  return err instanceof NotFoundException || isProjectLevelForbidden(err);
}

export interface AuthorizedProject {
  id: string;
  userId: string;
  visibility: string;
  isOwner: boolean;
}

/** Autorización de acceso a proyectos/etapas; aplica `canAccessProject` sobre datos de BD. */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Actor de la petición actual (AsyncLocalStorage del interceptor de usuario). */
  actorFromRequest(): ProjectAccessActor {
    return { userId: getRequestUserId(), role: getRequestUserRole() };
  }

  /**
   * Exige `level` sobre el proyecto.
   * - Inexistente o sin acceso de lectura: 404 "Project not found" (no revela existencia).
   * - El actor puede leer pero no tiene `level` (p. ej. colaborador en SHARED pidiendo `spend`/`manage`):
   *   403 `{ code: "PROJECT_LEVEL_FORBIDDEN", level, message }`, para que la UI lo distinga de un error.
   */
  async assertProject(
    actor: ProjectAccessActor,
    projectId: string,
    level: ProjectAccessLevel,
    options?: ProjectAccessOptions,
  ): Promise<AuthorizedProject> {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) throw new NotFoundException("Project not found");
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true, userId: true, visibility: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (!canAccessProject(actor, project, level, options)) {
      if (level !== "read" && canAccessProject(actor, project, "read")) {
        const body: ProjectLevelForbiddenBody = {
          code: PROJECT_LEVEL_FORBIDDEN_CODE,
          level,
          message: PROJECT_LEVEL_FORBIDDEN_MESSAGE,
        };
        throw new ForbiddenException(body);
      }
      throw new NotFoundException("Project not found");
    }
    return {
      id: project.id,
      userId: project.userId,
      visibility: project.visibility,
      isOwner: project.userId === actor.userId,
    };
  }

  /**
   * Devuelve, en el orden recibido y sin duplicados, los ids sobre los que el actor tiene `read`
   * (dueño o SHARED). Una sola query; los ids ajenos o inexistentes se descartan en silencio.
   */
  async filterReadable(actor: ProjectAccessActor, ids: readonly string[]): Promise<string[]> {
    if (!actor.userId) return [];
    const unique = [...new Set(ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean))];
    if (unique.length === 0) return [];
    const rows = await this.prisma.project.findMany({
      where: {
        id: { in: unique },
        OR: [{ userId: actor.userId }, { visibility: "SHARED" }],
      },
      select: { id: true },
    });
    const readable = new Set(rows.map((r) => r.id));
    return unique.filter((id) => readable.has(id));
  }

  /** Verifica que la etapa pertenece al proyecto (evita IDOR cruzando projectId/stageId). */
  async assertStageInProject(projectId: string, stageId: string): Promise<void> {
    const pid = typeof projectId === "string" ? projectId.trim() : "";
    const sid = typeof stageId === "string" ? stageId.trim() : "";
    if (!pid || !sid) throw new NotFoundException("Etapa no encontrada");
    const stage = await this.prisma.stage.findFirst({
      where: { id: sid, projectId: pid },
      select: { id: true },
    });
    if (!stage) throw new NotFoundException("Etapa no encontrada");
  }
}
