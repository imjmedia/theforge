import { NotFoundException } from "@nestjs/common";
import type { Project } from "@theforge/database";
import {
  canAccessProject,
  type ProjectAccessLevel,
  type ProjectAccessOptions,
} from "../../common/access/project-access.policy.js";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { StageWithEstimation } from "./stage-helpers.js";

/**
 * Carga proyecto con etapas exigiendo `level` al usuario de la petición actual.
 * La decisión es `canAccessProject` (fuente única); inexistente y sin acceso responden igual (404).
 */
export async function loadAccessibleProjectWithStagesAt(
  prisma: PrismaService,
  projectId: string,
  level: ProjectAccessLevel,
  options?: ProjectAccessOptions,
): Promise<Project & { stages: StageWithEstimation[] }> {
  const actor = { userId: getRequestUserId(), role: getRequestUserRole() };
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: {
      stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
      group: { select: { name: true } },
    },
  });
  if (!project || !canAccessProject(actor, project, level, options)) {
    throw new NotFoundException("Project not found");
  }
  return project as Project & { stages: StageWithEstimation[] };
}

/** Carga proyecto con etapas si el usuario actual puede verlo (nivel `read`: dueño o SHARED). */
export async function loadAccessibleProjectWithStages(
  prisma: PrismaService,
  projectId: string,
): Promise<Project & { stages: StageWithEstimation[] }> {
  return loadAccessibleProjectWithStagesAt(prisma, projectId, "read");
}

/** Scope de proyecto solo owner (p. ej. crear etapa). */
export function projectWhereForOwner(projectId: string) {
  return { id: projectId, userId: getRequestUserId() };
}
