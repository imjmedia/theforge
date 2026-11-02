import { ForbiddenException } from "@nestjs/common";

export const APP_ROLES = ["super_admin", "admin", "developer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

/** Admin o super_admin (gestión de usuarios, etc.). */
export function isAdminOrAbove(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

export function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

/**
 * Matriz de gestión de usuarios (rol del actor frente al objetivo y al rol nuevo).
 * - Solo un `super_admin` puede tocar a un `super_admin` (rol, perfil, borrado, mcpSecret)
 *   y solo él puede asignar o crear el rol `super_admin`.
 * - Un `admin` gestiona `developer` y `admin`.
 * - Nadie cambia su propio rol (si se indica `newRole` sobre uno mismo).
 * `targetRole` es null/undefined al crear (aún no hay objetivo). `newRole` solo aplica si
 * la operación asigna un rol (cambio de rol o alta).
 */
export function assertCanManageUser(
  actorRole: string,
  targetRole: string | null | undefined,
  newRole?: string,
  opts?: { actorUserId?: string; targetUserId?: string },
): void {
  if (!isAdminOrAbove(actorRole)) {
    throw new ForbiddenException("Se requiere rol admin");
  }
  if (
    newRole !== undefined &&
    opts?.actorUserId !== undefined &&
    opts.actorUserId === opts.targetUserId
  ) {
    throw new ForbiddenException("No puedes cambiar tu propio rol");
  }
  if (isSuperAdmin(actorRole)) return;
  if (targetRole != null && isSuperAdmin(targetRole)) {
    throw new ForbiddenException("Solo un super_admin puede gestionar a un super_admin");
  }
  if (newRole !== undefined && isSuperAdmin(newRole)) {
    throw new ForbiddenException("Solo un super_admin puede asignar el rol super_admin");
  }
}
