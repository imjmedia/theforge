import type { ProjectAccessLevel } from "./project-access.policy.js";

/** Metadatos compartidos por el decorador y el guard (archivo aparte para evitar import circular). */
export const PROJECT_SCOPED_KEY = "project-access:scoped";
export const PROJECT_ACCESS_EXEMPT_KEY = "project-access:exempt";

export type ProjectScopedSource = "param" | "query" | "body";

export interface ProjectScopedSpec {
  /** Dónde viene el projectId. Por defecto `param`. */
  from?: ProjectScopedSource;
  /** Nombre del campo con el projectId. Por defecto `id`. */
  key?: string;
  level: ProjectAccessLevel;
  /** Si el valor falta o viene vacío, se omite este spec en lugar de responder 404. */
  optional?: boolean;
  /** Ver `ProjectAccessOptions.allowAdmin`. */
  allowAdmin?: boolean;
  /** Si se indica, además exige que la etapa pertenezca al proyecto. */
  stage?: { from?: ProjectScopedSource; key: string; optional?: boolean };
}
