/**
 * Compilador determinista Design-First: `designSpec` → PAG (I4–I6).
 */
import {
  projectArchitectureGraphSchema,
  validateProjectArchitectureGraph,
  type HttpMethod,
  type PagEndpoint,
  type PagEntity,
  type PagTheforgeSource,
  type ProjectArchitectureGraph,
} from "../project-architecture-graph.js";
import {
  validateDesignSpecInvariants,
  type DesignSpec,
  type DesignSpecEntity,
} from "./design-spec.js";

const METHOD_ORDER: HttpMethod[] = ["DELETE", "GET", "PATCH", "POST", "PUT"];

const PAG_ENDPOINT_DEFAULTS = {
  authRequired: true,
  rolesAllowed: [] as string[],
  errorCodes: [400, 401, 403, 404, 500],
};

export { PAG_ENDPOINT_DEFAULTS };

export type CompileDataNeedsToPagIssue = {
  path: string;
  message: string;
};

export type CompileDataNeedsToPagResult =
  | { ok: true; pag: ProjectArchitectureGraph }
  | { ok: false; issues: CompileDataNeedsToPagIssue[] };

function paginateEntityId(entityId: string): string {
  const base = entityId.replace(/-/g, "");
  if (base.endsWith("s")) return base;
  return `${base}s`;
}

function entityResourceBase(entity: DesignSpecEntity): string {
  const raw = entity.restEndpoint?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return `/api/v1/${paginateEntityId(entity.id)}`;
}

function entityDisplayName(entity: DesignSpecEntity): string {
  const n = entity.name.trim();
  if (!n) return entity.id;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function collectSourcesForEntity(spec: DesignSpec, entityId: string): PagTheforgeSource[] {
  const sources: PagTheforgeSource[] = [];
  for (const entry of spec.dataNeeds) {
    for (const block of entry.components) {
      for (const need of block.needs) {
        if (need.action !== entityId) continue;
        sources.push({
          screenId: entry.screenId,
          needId: need.id,
          componentId: block.componentId,
        });
      }
    }
  }
  sources.sort((a, b) =>
    `${a.screenId}:${a.componentId ?? ""}:${a.needId ?? ""}`.localeCompare(
      `${b.screenId}:${b.componentId ?? ""}:${b.needId ?? ""}`,
    ),
  );
  return sources;
}

function buildPagEntity(spec: DesignSpec, entity: DesignSpecEntity): PagEntity {
  const name = entityDisplayName(entity);
  const keyFields = entity.keyFields?.length ? entity.keyFields : ["id"];
  const fields = keyFields.map((fieldName) => ({
    name: fieldName,
    type: fieldName === "id" ? "UUID" : "String",
    required: true,
    constraints: fieldName === "id" ? [{ type: "unique" as const }] : [],
  }));
  if (!fields.some((f) => f.name === "id")) {
    fields.unshift({
      name: "id",
      type: "UUID",
      required: true,
      constraints: [{ type: "unique" as const }],
    });
  }
  return {
    name,
    tableName: entity.id.replace(/-/g, "_"),
    description: entity.classification ? `${entity.classification}` : undefined,
    primaryKey: "id",
    fields,
    indexes: keyFields.filter((k) => k !== "id"),
    theforgeSources: collectSourcesForEntity(spec, entity.id),
  };
}

function crudEndpoints(
  spec: DesignSpec,
  entity: DesignSpecEntity,
  pagEntityName: string,
): PagEndpoint[] {
  const base = entityResourceBase(entity);
  const sources = collectSourcesForEntity(spec, entity.id);
  const list: PagEndpoint[] = [
    {
      ...PAG_ENDPOINT_DEFAULTS,
      path: base,
      method: "GET",
      description: `List ${pagEntityName}`,
      targetEntity: pagEntityName,
      theforgeSources: sources,
    },
    {
      ...PAG_ENDPOINT_DEFAULTS,
      path: `${base}/{id}`,
      method: "GET",
      description: `Get ${pagEntityName} by id`,
      targetEntity: pagEntityName,
      theforgeSources: sources,
    },
    {
      ...PAG_ENDPOINT_DEFAULTS,
      path: base,
      method: "POST",
      description: `Create ${pagEntityName}`,
      targetEntity: pagEntityName,
      theforgeSources: sources,
    },
    {
      ...PAG_ENDPOINT_DEFAULTS,
      path: `${base}/{id}`,
      method: "PATCH",
      description: `Update ${pagEntityName}`,
      targetEntity: pagEntityName,
      theforgeSources: sources,
    },
    {
      ...PAG_ENDPOINT_DEFAULTS,
      path: `${base}/{id}`,
      method: "DELETE",
      description: `Delete ${pagEntityName}`,
      targetEntity: pagEntityName,
      theforgeSources: sources,
    },
  ];
  return list;
}

function viewEndpointsFromHints(spec: DesignSpec): PagEndpoint[] {
  const byPath = new Map<string, PagTheforgeSource[]>();
  for (const entry of spec.dataNeeds) {
    for (const block of entry.components) {
      for (const need of block.needs) {
        const hint = need.endpointHint?.trim();
        if (!hint) continue;
        const path = hint.startsWith("/") ? hint : `/${hint}`;
        const src: PagTheforgeSource = {
          screenId: entry.screenId,
          needId: need.id,
          componentId: block.componentId,
        };
        const list = byPath.get(path) ?? [];
        list.push(src);
        byPath.set(path, list);
      }
    }
  }
  const endpoints: PagEndpoint[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const sources = (byPath.get(path) ?? []).sort((a, b) =>
      `${a.screenId}:${a.needId}`.localeCompare(`${b.screenId}:${b.needId}`),
    );
    endpoints.push({
      ...PAG_ENDPOINT_DEFAULTS,
      path,
      method: "GET",
      description: "Aggregated view (endpointHint)",
      theforgeSources: sources,
    });
  }
  return endpoints;
}

function sortEndpoints(endpoints: PagEndpoint[]): PagEndpoint[] {
  return [...endpoints].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
  });
}

export function compileDataNeedsToPag(input: {
  designSpec: DesignSpec;
  projectName: string;
}): CompileDataNeedsToPagResult {
  const invariantIssues = validateDesignSpecInvariants(input.designSpec);
  if (invariantIssues.length > 0) {
    return {
      ok: false,
      issues: invariantIssues.map((i) => ({
        path: i.path,
        message: `[${i.invariant}] ${i.message}`,
      })),
    };
  }

  const sortedEntities = [...input.designSpec.entities].sort((a, b) => a.id.localeCompare(b.id));
  const pagEntities = sortedEntities.map((e) => buildPagEntity(input.designSpec, e));

  let endpoints: PagEndpoint[] = [];
  for (const entity of sortedEntities) {
    endpoints.push(...crudEndpoints(input.designSpec, entity, entityDisplayName(entity)));
  }
  endpoints.push(...viewEndpointsFromHints(input.designSpec));
  endpoints = sortEndpoints(endpoints);

  const pag = projectArchitectureGraphSchema.parse({
    version: "1.0.0",
    projectName: input.projectName.trim() || "DesignFirst",
    description: "Compilado desde designSpec (Design-First)",
    stack: {},
    entities: pagEntities,
    endpoints,
    services: [
      {
        name: "DesignFirstApi",
        layer: "backend_module",
        handledEndpoints: endpoints.map((e) => e.path),
        dependencies: [],
      },
    ],
  });

  const validation = validateProjectArchitectureGraph(pag);
  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.errors.map((message, index) => ({
        path: `pag.validation[${index}]`,
        message,
      })),
    };
  }

  return { ok: true, pag };
}

/** Serializa el PAG compilado de forma estable (I4). */
export function serializeCompiledPag(pag: ProjectArchitectureGraph): string {
  return `${JSON.stringify(pag, null, 2)}\n`;
}
