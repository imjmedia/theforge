import { isAdminOrAbove } from "../roles.js";

/**
 * Niveles de acceso a un proyecto:
 * - `read`: ver el proyecto y sus entregables.
 * - `contribute`: aportar contenido sin coste de LLM (comentarios, ediciones manuales, etc.).
 * - `spend`: acciones que consumen LLM / créditos del dueño.
 * - `manage`: borrar o cambiar ajustes del proyecto.
 */
export type ProjectAccessLevel = "read" | "contribute" | "spend" | "manage";

export interface ProjectAccessActor {
  userId: string;
  role: string;
}

export interface ProjectAccessTarget {
  /** Dueño del proyecto (`Project.userId`). */
  userId: string;
  /** `PRIVATE` | `SHARED`. */
  visibility: string;
}

export interface ProjectAccessOptions {
  /**
   * Paridad con el borrado actual: un admin o super_admin obtiene `manage` sobre un proyecto
   * ajeno que ya puede ver (SHARED). Nunca da acceso a proyectos PRIVATE ajenos.
   */
  allowAdmin?: boolean;
}

/** Niveles que tiene un no dueño sobre un proyecto SHARED. */
export const SHARED_NON_OWNER_LEVELS = ["read", "contribute"] as const;

/** Política pura: ¿puede `actor` ejercer `level` sobre `target`? Sin Nest ni Prisma. */
export function canAccessProject(
  actor: ProjectAccessActor,
  target: ProjectAccessTarget,
  level: ProjectAccessLevel,
  options?: ProjectAccessOptions,
): boolean {
  if (!actor.userId) return false;
  if (actor.userId === target.userId) return true;
  if (target.visibility !== "SHARED") return false;
  if ((SHARED_NON_OWNER_LEVELS as readonly string[]).includes(level)) return true;
  return level === "manage" && options?.allowAdmin === true && isAdminOrAbove(actor.role);
}
