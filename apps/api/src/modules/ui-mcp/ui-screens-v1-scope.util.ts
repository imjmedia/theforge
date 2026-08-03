/**
 * v1 scope helpers for pantallas.md — machine-readable in-scope vs out-of-scope screens.
 */

export type PantallaRowMeta = {
  route?: string;
  screenName: string;
  userStoryId?: string;
  primaryApi?: string;
  v1InScope: boolean;
  /** When true, screen must have API + frontend task or be excluded from v1 table. */
  v1RequiresApi: boolean;
};

const OUT_OF_SCOPE_HEADER = /^##\s+Fuera de alcance v1\b/im;

/** Parses pantallas table rows; v1InScope=false for rows under «Fuera de alcance v1». */
export function extractPantallaPlanMetaFromMarkdown(uiScreensMarkdown: string): PantallaRowMeta[] {
  const text = (uiScreensMarkdown ?? "").trim();
  if (!text) return [];

  const outIdx = text.search(OUT_OF_SCOPE_HEADER);
  const inScopeBody = outIdx >= 0 ? text.slice(0, outIdx) : text;
  const outScopeBody = outIdx >= 0 ? text.slice(outIdx) : "";

  const parseTable = (body: string, v1InScope: boolean): PantallaRowMeta[] => {
    const rows: PantallaRowMeta[] = [];
    for (const line of body.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      if (/^\|\s*[-:]+\s*\|/.test(line)) continue;
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length < 3) continue;
      const routeCell = cells.find((c) => c.startsWith("/"));
      const route = routeCell?.replace(/\/+$/, "") || undefined;
      const screenName = cells[0] ?? "Pantalla";
      const usCell = cells.find((c) => /^US-/i.test(c));
      const apiCell = cells.find((c) => /^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(c));
      const primaryApi = apiCell && !/fuera de alcance/i.test(apiCell) ? apiCell : undefined;
      rows.push({
        route,
        screenName,
        userStoryId: usCell?.match(/^(US-[A-Z0-9_-]+)/i)?.[1],
        primaryApi,
        v1InScope,
        v1RequiresApi: v1InScope && Boolean(route),
      });
    }
    return rows;
  };

  return [...parseTable(inScopeBody, true), ...parseTable(outScopeBody, false)];
}

/** Routes in v1 scope (excludes «Fuera de alcance v1» section). */
export function extractV1InScopePantallaRoutes(uiScreensMarkdown: string): string[] {
  const routes = new Set<string>();
  for (const row of extractPantallaPlanMetaFromMarkdown(uiScreensMarkdown)) {
    if (row.v1InScope && row.route) routes.add(row.route);
  }
  return [...routes];
}

/** Whether a pantalla plan item belongs in v1 (has API or is hu-only journey with linked US). */
export function resolvePantallaV1InScope(item: {
  source: string;
  primaryApi?: string;
  userStoryId?: string;
  route?: string;
  purpose?: string;
}): boolean {
  const api = (item.primaryApi ?? "").trim();
  if (api.length > 0 && !/fuera de alcance/i.test(api)) return true;
  if (item.source === "hu-only" && item.userStoryId?.trim()) return true;
  if (item.source === "hu-only" && /MDD §2\.2/i.test(item.purpose ?? "")) return true;
  if (item.source === "entity+hu" && item.userStoryId?.trim() && api.length > 0) return true;
  if (item.source === "entity" && api.length > 0) return true;
  return false;
}
