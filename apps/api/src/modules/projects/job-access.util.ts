import { NotFoundException } from "@nestjs/common";
import {
  isProjectAccessDenied,
  type ProjectAccessService,
} from "../../common/access/project-access.service.js";

/** Referencia mínima de un job de cola (`getJobAccessRef` de las colas de entregables y MDD). */
export interface JobAccessRef {
  projectId: string;
  /** `null` en jobs antiguos encolados sin `userId`. */
  userId: string | null;
}

/** `read`: consultar estado/stream. `cancel`: abortar el job. */
export type JobAccessMode = "read" | "cancel";

export const JOB_NOT_FOUND_MESSAGE = "Job no encontrado";

type JobAccessChecker = Pick<ProjectAccessService, "actorFromRequest" | "assertProject">;

/**
 * Autoriza el acceso a un job de cola a partir de su referencia. Cualquier denegación responde
 * 404 "Job no encontrado" (nunca 403: el polling del frontend no se detiene ante un 403 y no
 * debe revelar si el job existe). Esto incluye el 403 `PROJECT_LEVEL_FORBIDDEN` que lanza
 * `assertProject` cuando el actor lee el proyecto pero no tiene `manage` (cancelar job ajeno).
 *
 * - `read`: exige `read` sobre el proyecto del job.
 * - `cancel`: permitido a quien encoló el job, o a quien tenga `manage` (dueño o admin).
 * - `expectedProjectId`: en rutas `/projects/:id/...-jobs/:jobId`, el job debe ser de ese proyecto.
 */
export async function assertJobAccess(
  access: JobAccessChecker,
  ref: JobAccessRef | null,
  mode: JobAccessMode,
  expectedProjectId?: string,
): Promise<JobAccessRef> {
  if (!ref) throw new NotFoundException(JOB_NOT_FOUND_MESSAGE);
  if (expectedProjectId !== undefined && ref.projectId !== expectedProjectId.trim()) {
    throw new NotFoundException(JOB_NOT_FOUND_MESSAGE);
  }
  const actor = access.actorFromRequest();
  try {
    if (mode === "read") {
      await access.assertProject(actor, ref.projectId, "read");
    } else if (!(ref.userId && ref.userId === actor.userId)) {
      await access.assertProject(actor, ref.projectId, "manage", { allowAdmin: true });
    }
  } catch (err) {
    if (isProjectAccessDenied(err)) throw new NotFoundException(JOB_NOT_FOUND_MESSAGE);
    throw err;
  }
  return ref;
}
