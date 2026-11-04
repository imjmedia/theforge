import type { ProjectType } from "./project.js";

/**
 * Valores de enrutamiento por tipo de proyecto.
 * `DESIGN_FIRST` se añade al enum Zod/Prisma en el paso 5; hasta entonces solo afecta helpers preparados.
 */
export type ProjectTypeRouting = ProjectType | "DESIGN_FIRST";

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

/** Rama imposible en switches exhaustivos sobre `ProjectTypeRouting`. */
export function assertNever(value: never): never {
  throw new Error(`Tipo de proyecto no soportado: ${String(value)}`);
}
