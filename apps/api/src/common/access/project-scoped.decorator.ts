import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { ProjectAccessLevel } from "./project-access.policy.js";
import { ProjectAccessGuard } from "./project-access.guard.js";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
  type ProjectScopedSpec,
} from "./project-access.metadata.js";

export { PROJECT_ACCESS_EXEMPT_KEY, PROJECT_SCOPED_KEY, type ProjectScopedSpec };

/**
 * Exige acceso al proyecto antes de ejecutar el handler (o todos los de la clase).
 * Acepta un nivel (`"read"`), un spec o un array de specs (rutas con varios proyectos).
 * Defaults: `from: "param"`, `key: "id"`.
 */
export function ProjectScoped(spec: ProjectAccessLevel | ProjectScopedSpec | ProjectScopedSpec[]) {
  const specs: ProjectScopedSpec[] = (Array.isArray(spec) ? spec : [spec]).map((s) =>
    typeof s === "string" ? { level: s } : s,
  );
  return applyDecorators(SetMetadata(PROJECT_SCOPED_KEY, specs), UseGuards(ProjectAccessGuard));
}

/**
 * Marca una ruta o controller como exento de `@ProjectScoped` con el motivo explícito.
 * Solo marca; el spec de cobertura verifica que toda ruta con projectId esté decorada o exenta.
 */
export function ProjectAccessExempt(reason: string) {
  return SetMetadata(PROJECT_ACCESS_EXEMPT_KEY, reason);
}
