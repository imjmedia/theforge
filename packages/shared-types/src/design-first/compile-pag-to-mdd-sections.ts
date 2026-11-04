import type { HttpMethod, PagEndpoint, ProjectArchitectureGraph } from "../project-architecture-graph.js";
import { compilePagEntitiesToSql, resolvePagTableName } from "./pag-entity-to-sql.js";

const METHOD_ORDER: HttpMethod[] = ["DELETE", "GET", "PATCH", "POST", "PUT"];

function entityProse(entity: { name: string; description?: string }, table: string): string {
  const kind = entity.description?.trim() || "Entidad de dominio";
  return `${kind}: persistencia de **${entity.name}** en la tabla \`${table}\` (PostgreSQL).`;
}

function sortEndpoints(endpoints: PagEndpoint[]): PagEndpoint[] {
  return [...endpoints].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
  });
}

function endpointAuth(ep: PagEndpoint): string {
  if (!ep.authRequired) return "Pública";
  return ep.rolesAllowed.length > 0 ? `JWT (${ep.rolesAllowed.join(", ")})` : "JWT";
}

/**
 * Cuerpo de §3 del MDD (sin heading `## 3`): SQL + prosa por entidad.
 * El bloque erDiagram se añade en la API con `buildErDiagramSectionBlockFromSql` (opción 14.1a).
 */
export function compilePagToMddSection3(pag: ProjectArchitectureGraph): string {
  const sql = compilePagEntitiesToSql(pag);
  const lines: string[] = ["```sql", sql, "```", ""];

  const sortedEntities = [...pag.entities].sort((a, b) => a.name.localeCompare(b.name));
  for (const entity of sortedEntities) {
    const table = resolvePagTableName(entity);
    lines.push(`### ${entity.name}`, "", entityProse(entity, table), "");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Cuerpo de §4 del MDD (sin heading `## 4`): tabla GFM válida para `validateApiTablesSyntax`.
 */
export function compilePagToMddSection4(pag: ProjectArchitectureGraph): string {
  const endpoints = sortEndpoints(pag.endpoints);
  const lines: string[] = [
    "| Método | Ruta | Descripción | Auth |",
    "|:---|:---|:---|:---|",
  ];

  if (endpoints.length === 0) {
    lines.push("| GET | `/api/health` | Health check del sistema | Pública |");
  } else {
    for (const ep of endpoints) {
      const desc = (ep.description ?? `Operación ${ep.method}`).replace(/\|/g, "-").replace(/\n/g, " ");
      lines.push(`| ${ep.method} | \`${ep.path}\` | ${desc} | ${endpointAuth(ep)} |`);
    }
  }

  return lines.join("\n");
}

/** Endpoints del PAG en el mismo orden que §4 compilada (para tests de paridad). */
export function listPagEndpointsForMddCompare(pag: ProjectArchitectureGraph): Array<{ method: string; path: string }> {
  return sortEndpoints(pag.endpoints).map((ep) => ({
    method: ep.method,
    path: ep.path,
  }));
}
