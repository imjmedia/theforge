import type { PagEntity, PagEndpoint, ProjectArchitectureGraph } from "../project-architecture-graph.js";

/** Semilla fija para ejemplos OpenAPI y fixtures (I8, determinista). */
export const DEFAULT_PAG_FIXTURE_SEED = "theforge-design-first-fixture-v1";

export function pagHasTheforgeSources(pag: ProjectArchitectureGraph): boolean {
  for (const ep of pag.endpoints) {
    if (ep.theforgeSources?.length) return true;
  }
  for (const ent of pag.entities) {
    if (ent.theforgeSources?.length) return true;
  }
  return false;
}

export function buildOpenApiOperationId(method: string, openApiPath: string): string {
  const slug = openApiPath
    .replace(/^\//, "")
    .replace(/\{([^}]+)\}/g, "By_$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

/** FNV-1a extendido (determinista, sin `node:crypto`; usable en web y API). */
function seededHex(seed: string, key: string, hexChars: number): string {
  const input = `${seed}:${key}`;
  const chunks: string[] = [];
  let round = 0;
  while (chunks.join("").length < hexChars) {
    let hash = 2166136261 ^ round;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    chunks.push((hash >>> 0).toString(16).padStart(8, "0"));
    round += 1;
  }
  return chunks.join("").slice(0, hexChars);
}

/** UUID v4 determinista (no criptográfico; solo mocks). */
export function seededUuid(seed: string, key: string): string {
  const h = seededHex(seed, key, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function exampleFieldValue(
  seed: string,
  entityName: string,
  fieldName: string,
  fieldType: string,
): unknown {
  const key = `${entityName}.${fieldName}`;
  const t = fieldType.toLowerCase();
  if (t.includes("uuid") || fieldName.toLowerCase() === "id") {
    return seededUuid(seed, key);
  }
  if (t.includes("bool")) return true;
  if (t.includes("int") || t.includes("number")) return 1;
  if (t.includes("array")) return [];
  if (t.includes("json") || t.includes("object")) return {};
  return `${fieldName}-demo`;
}

export function buildSeededEntityExample(
  seed: string,
  entity: PagEntity,
  pathParamValues?: Record<string, string>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (pathParamValues && field.name in pathParamValues) {
      row[field.name] = pathParamValues[field.name];
      continue;
    }
    row[field.name] = exampleFieldValue(seed, entity.name, field.name, field.type);
  }
  return row;
}

export function buildSeededResponseExample(
  seed: string,
  pag: ProjectArchitectureGraph,
  ep: PagEndpoint,
  openApiPath: string,
): unknown {
  const entity =
    ep.targetEntity != null ? pag.entities.find((e) => e.name === ep.targetEntity) : undefined;
  const pathParams = Object.fromEntries(
    [...openApiPath.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => [m[1], seededUuid(seed, `path:${m[1]}`)]),
  );
  if (!entity) {
    return { ok: true };
  }
  const row = buildSeededEntityExample(seed, entity, pathParams);
  const method = ep.method.toUpperCase();
  if (method === "GET" && openApiPath.includes("{")) {
    return row;
  }
  if (method === "GET") {
    return [row];
  }
  if (method === "POST") {
    return row;
  }
  if (method === "DELETE") {
    return { deleted: true, id: pathParams.id ?? row.id };
  }
  return row;
}
