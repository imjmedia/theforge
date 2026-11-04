import type { ProjectType } from "./project.js";

/** Tipos de proyecto usados en enrutamiento (alineado con Prisma `ProjectType`). */
export type ProjectTypeRouting = ProjectType;

export function isGreenfield(projectType: ProjectTypeRouting): boolean {
  if (projectType === "DESIGN_FIRST") return true;
  return projectType === "NEW";
}

export function isLegacy(projectType: ProjectTypeRouting): boolean {
  return projectType === "LEGACY";
}

export function isDesignFirst(projectType: ProjectTypeRouting): boolean {
  return projectType === "DESIGN_FIRST";
}

/** CL-26: merge de proyectos con DESIGN_FIRST no soportado en v1. */
export function isMergeBlockedByDesignFirst(types: readonly ProjectTypeRouting[]): boolean {
  return types.some(isDesignFirst);
}

export const MERGE_DESIGN_FIRST_CONFLICT_MESSAGE =
  "La fusión de proyectos Design-First no está soportada en esta versión.";

/** Rama imposible en switches exhaustivos sobre `ProjectTypeRouting`. */
export function assertNever(value: never): never {
  throw new Error(`Tipo de proyecto no soportado: ${String(value)}`);
}
