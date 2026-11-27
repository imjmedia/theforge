/**
 * Unifica prefijos API en contratos: alinea /api/ con /api/v1/ del MDD §4 (SSOT).
 */

import { extractHttpEndpointsFromMarkdown } from "../ui-mcp/api-contract-endpoints.util.js";
import { extractMddSection4Endpoints } from "./conformance.service.js";

export type ApiPrefixCounts = { bare: number; api: number; v1: number };

export function countApiPrefixUsage(markdown: string): ApiPrefixCounts {
  const counts: ApiPrefixCounts = { bare: 0, api: 0, v1: 0 };
  for (const ep of extractHttpEndpointsFromMarkdown(markdown)) {
    const path = ep.path.trim();
    if (/^\/api\/v1\b/i.test(path)) counts.v1 += 1;
    else if (/^\/api\b/i.test(path)) counts.api += 1;
    else if (path.startsWith("/")) counts.bare += 1;
  }
  return counts;
}

/** Resuelve prefijo dominante (prioriza /api/v1 si empate con /api). */
export function resolveDominantApiPrefix(counts: ApiPrefixCounts): "/api/v1" | "/api" | "/" | null {
  const { bare, api, v1 } = counts;
  const total = bare + api + v1;
  if (total === 0) return null;
  if (v1 >= api && v1 >= bare) return "/api/v1";
  if (api >= bare) return "/api";
  return "/";
}

function mddDeclaresV1(mddContent: string): boolean {
  return /api_prefix["']?\s*:\s*["']\/api\/v1["']/i.test(mddContent) ||
    /\/api\/v1\//i.test(mddContent);
}

function upgradePathsToV1(content: string): string {
  return content.replace(
    /(\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*)(`?)(\/api\/(?!v1[/"'])[^\s`|]+)(`?)/gi,
    (_m, lead: string, q1: string, path: string, q2: string) =>
      `${lead}${q1}${path.replace(/\/api\/(?!v1)/gi, "/api/v1/")}${q2}`,
  ).replace(
    /(#{1,6}\s*(?:GET|POST|PUT|DELETE|PATCH)\s+)(\/api\/(?!v1[/"'])[^\s\n]+)/gi,
    (_m, lead: string, path: string) => `${lead}${path.replace(/\/api\/(?!v1)/gi, "/api/v1/")}`,
  );
}

function prefixBareRoutes(content: string, prefix: string): string {
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return content.replace(
    /(\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*)(`?)(\/(?!api\/)[a-z0-9_/-]+)(`?)/gi,
    (_m, lead: string, q1: string, path: string, q2: string) =>
      `${lead}${q1}${normalized}${path.startsWith("/") ? path : `/${path}`}${q2}`,
  );
}

/**
 * Alinea api-contracts.md al prefijo del MDD §4.
 * Promueve /api/* → /api/v1/* cuando el MDD declara v1.
 */
export function unifyApiContractsPrefix(
  mddContent: string,
  apiContent: string,
): { content: string; changes: string[] } {
  const changes: string[] = [];
  let out = (apiContent ?? "").trim();
  if (!out) return { content: out, changes };

  const mddEps = extractMddSection4Endpoints(mddContent);
  const mddCounts = countApiPrefixUsage(mddEps.map((e) => `${e.method} ${e.path}`).join("\n"));
  const apiCounts = countApiPrefixUsage(out);
  const mddPrefix = resolveDominantApiPrefix(mddCounts) ?? (mddDeclaresV1(mddContent) ? "/api/v1" : null);
  const targetPrefix = mddPrefix ?? resolveDominantApiPrefix(apiCounts) ?? "/api/v1";

  if (targetPrefix === "/api/v1" && (apiCounts.api > 0 || mddDeclaresV1(mddContent))) {
    const before = out;
    out = upgradePathsToV1(out);
    if (out !== before) changes.push("promoted /api/* → /api/v1/*");
  }

  if (apiCounts.bare > 0 && targetPrefix !== "/") {
    const before = out;
    out = prefixBareRoutes(out, targetPrefix);
    if (out !== before) changes.push(`prefixed bare routes with ${targetPrefix}`);
  }

  if (mddCounts.v1 > 0 && apiCounts.api > apiCounts.v1) {
    const before = out;
    out = upgradePathsToV1(out);
    if (out !== before && !changes.includes("promoted /api/* → /api/v1/*")) {
      changes.push("reconciled contracts prefix with MDD §4 /api/v1");
    }
  }

  return { content: out, changes };
}
