/**
 * Exenciones de huérfanos §3↔§4 (plataforma, auth, infra).
 */

import { AUTH_ENTITY_FAMILY, type DomainInventory } from "@theforge/shared-types";

/** Tablas infra adicionales no contadas como huérfanas de negocio. */
export const MDD_COHERENCE_INFRA_TABLES = new Set(["outbox", "outbox_events"]);

/** Tablas hijas FK-only: exentas cuando la tabla padre ya está consumida por §4. */
export const FK_CHILD_TABLE_PARENTS: Record<string, readonly string[]> = {
  key_assignments: ["kms_keys", "keys"],
  key_versions: ["kms_keys", "keys"],
};

/** Tablas hijas FK-only que nunca reciben endpoint inyectado en repair. */
export const FK_ONLY_CHILD_TABLES = new Set(["key_assignments", "key_versions", "user_roles", "role_permissions"]);

/** Endpoints plataforma/auth que no requieren enlace CONSUMES a tabla §3. */
export function isExemptPlatformEndpoint(path: string): boolean {
  const p = (path ?? "").toLowerCase().replace(/`/g, "").trim();
  if (!p) return false;
  if (/\/health\b|\/healthz\b|^\/health\b/.test(p)) return true;
  if (/\/auth(?:\/|$)/.test(p)) return true;
  if (/\/(login|logout|refresh|mfa|jwks)\b/.test(p)) return true;
  return false;
}

export function buildInfraOnlyEntitySet(inventory?: DomainInventory | null): Set<string> {
  const set = new Set<string>();
  for (const row of inventory?.crudMatrix ?? []) {
    if (row.infraOnly) set.add(row.entity.toLowerCase());
  }
  return set;
}

/** Tabla §3 exenta del conteo de entidades huérfanas. */
export function isExemptEntityTable(
  bareName: string,
  infraOnlyEntities?: Set<string>,
): boolean {
  const bare = (bareName ?? "").toLowerCase();
  if (!bare) return false;
  if (AUTH_ENTITY_FAMILY.has(bare)) return true;
  if (MDD_COHERENCE_INFRA_TABLES.has(bare)) return true;
  if (infraOnlyEntities?.has(bare)) return true;
  return false;
}

/** True si la entidad es hija FK-only y su padre ya está cubierto por endpoints. */
export function isFkChildCoveredByConsumedParent(
  bareName: string,
  consumedBareNames: ReadonlySet<string>,
): boolean {
  const bare = (bareName ?? "").toLowerCase();
  const parents = FK_CHILD_TABLE_PARENTS[bare];
  if (!parents) return false;
  return parents.some((p) => consumedBareNames.has(p.toLowerCase()));
}
