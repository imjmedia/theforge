import type { PagEndpoint, ProjectArchitectureGraph } from "../project-architecture-graph.js";
import { buildSeededEntityExample, DEFAULT_PAG_FIXTURE_SEED, seededUuid } from "./pag-fixture-seed.js";

export type PagMswExport = {
  handlersTs: string;
  browserTs: string;
};

function openApiPathToMswPattern(openApiPath: string): string {
  return openApiPath.replace(/\{([a-zA-Z0-9_]+)\}/g, ":$1");
}

function methodToMswFn(method: string): string {
  return method.toLowerCase();
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function buildHandlerBlock(
  seed: string,
  pag: ProjectArchitectureGraph,
  ep: PagEndpoint,
  openApiPath: string,
): string {
  const pattern = openApiPathToMswPattern(openApiPath);
  const fn = methodToMswFn(ep.method);
  const entity = ep.targetEntity ? pag.entities.find((e) => e.name === ep.targetEntity) : undefined;
  const listBody = entity
    ? `[${JSON.stringify(buildSeededEntityExample(seed, entity))}]`
    : `[{ "ok": true }]`;
  const itemBody = entity
    ? JSON.stringify(
        buildSeededEntityExample(seed, entity, {
          id: seededUuid(seed, `${pattern}:id`),
        }),
      )
    : `{ "ok": true }`;
  const errorBody = `{ "statusCode": 500, "message": "Error simulado", "error": "Internal Server Error" }`;

  return `  http.${fn}(\`${escapeTemplateLiteral(pattern)}\`, ({ request, params }) => {
    const mockState = request.headers.get("x-mock-state");
    if (mockState === "empty") {
      return HttpResponse.json(null, { status: 204 });
    }
    if (mockState === "error") {
      return HttpResponse.json(${errorBody}, { status: 500 });
    }
    ${
      ep.method === "GET" && openApiPath.includes("{")
        ? `return HttpResponse.json(${itemBody});`
        : ep.method === "GET"
          ? `return HttpResponse.json(${listBody});`
          : ep.method === "DELETE"
            ? `return HttpResponse.json({ deleted: true, id: params.id ?? "unknown" });`
            : `return HttpResponse.json(${itemBody});`
    }
  })`;
}

export function exportPagToMswHandlers(
  pag: ProjectArchitectureGraph,
  options?: { fixtureSeed?: string },
): PagMswExport {
  const seed = options?.fixtureSeed ?? DEFAULT_PAG_FIXTURE_SEED;
  const blocks: string[] = [];
  const sorted = [...pag.endpoints].sort((a, b) =>
    `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`),
  );
  for (const ep of sorted) {
    const openApiPath = ep.path.startsWith("/")
      ? ep.path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")
      : `/${ep.path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")}`;
    blocks.push(buildHandlerBlock(seed, pag, ep, openApiPath));
  }

  const handlersTs = [
    'import { http, HttpResponse } from "msw";',
    "",
    "export const handlers = [",
    blocks.join(",\n"),
    "];",
    "",
  ].join("\n");

  const browserTs = [
    'import { setupWorker } from "msw/browser";',
    'import { handlers } from "./handlers";',
    "",
    "export const worker = setupWorker(...handlers);",
    "",
  ].join("\n");

  return { handlersTs, browserTs };
}
