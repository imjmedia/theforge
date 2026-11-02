import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
  type ProjectScopedSource,
  type ProjectScopedSpec,
} from "./project-access.metadata.js";
import type { ProjectAccessActor } from "./project-access.policy.js";
import { ProjectAccessService, type AuthorizedProject } from "./project-access.service.js";

interface ScopedRequest {
  user?: { userId?: string; role?: string };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  /** Un `AuthorizedProject` (un spec) o un array (varios specs, solo los evaluados). */
  projectAccess?: AuthorizedProject | AuthorizedProject[];
}

/**
 * Guard de ruta para `@ProjectScoped`. Corre después del guard JWT global (APP_GUARD) y antes del
 * `UserContextInterceptor`, por eso lee `req.user` y no el AsyncLocalStorage.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;

    const specs = this.resolveSpecs(context);
    if (!specs || specs.length === 0) return true;

    const req = context.switchToHttp().getRequest<ScopedRequest>();
    if (!req.user?.userId) throw new ForbiddenException("Contexto de usuario no disponible");
    const actor: ProjectAccessActor = { userId: req.user.userId, role: req.user.role ?? "developer" };

    const authorized: AuthorizedProject[] = [];
    for (const spec of specs) {
      const projectId = this.readValue(req, spec.from ?? "param", spec.key ?? "id");
      if (!projectId) {
        if (spec.optional) continue;
        throw new NotFoundException("Project not found");
      }
      const project = await this.access.assertProject(actor, projectId, spec.level, {
        allowAdmin: spec.allowAdmin,
      });
      if (spec.stage) {
        const stageId = this.readValue(req, spec.stage.from ?? "param", spec.stage.key);
        if (stageId) {
          await this.access.assertStageInProject(project.id, stageId);
        } else if (!spec.stage.optional) {
          throw new NotFoundException("Etapa no encontrada");
        }
      }
      authorized.push(project);
    }

    if (authorized.length > 0) {
      req.projectAccess = specs.length === 1 ? authorized[0] : authorized;
    }
    return true;
  }

  /**
   * Resuelve los specs aplicables. El handler manda sobre la clase, también para la exención:
   * `@ProjectScoped` en el handler gana siempre; si no, una `@ProjectAccessExempt` en el handler
   * anula el `@ProjectScoped` de la clase; si no, vale el de la clase.
   */
  private resolveSpecs(context: ExecutionContext): ProjectScopedSpec[] | undefined {
    const handler = context.getHandler();
    const handlerSpecs = this.reflector.get<ProjectScopedSpec[] | undefined>(PROJECT_SCOPED_KEY, handler);
    if (handlerSpecs !== undefined) return handlerSpecs;
    const handlerExempt = this.reflector.get<unknown>(PROJECT_ACCESS_EXEMPT_KEY, handler);
    if (handlerExempt !== undefined) return undefined;
    return this.reflector.get<ProjectScopedSpec[] | undefined>(PROJECT_SCOPED_KEY, context.getClass());
  }

  /** Devuelve el valor recortado o `null` si no es un string no vacío. */
  private readValue(req: ScopedRequest, from: ProjectScopedSource, key: string): string | null {
    let source: unknown;
    if (from === "body") {
      // `body-parser` no toca multipart y deja `req.body = {}`: se detecta por la cabecera, no por el body.
      const contentType = req.headers?.["content-type"];
      const ct = (Array.isArray(contentType) ? contentType[0] : contentType)?.trim().toLowerCase() ?? "";
      if (ct.startsWith("multipart/")) {
        throw new BadRequestException(
          `El campo "${key}" del cuerpo no está disponible en esta ruta (multipart); no se puede validar el acceso al proyecto.`,
        );
      }
      source = req.body;
    } else {
      source = from === "query" ? req.query : req.params;
    }
    if (!source || typeof source !== "object") return null;
    const value = (source as Record<string, unknown>)[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  }
}
