/**
 * Extrae endpoints HTTP documentados en api-contracts.md (tablas, backticks, headings).
 */

export interface HttpEndpointRef {
  method: string;
  path: string;
}

const METHOD = "GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD";

/** Normaliza path (sin query, trailing slash opcional). */
export function normalizeApiPath(path: string): string {
  const trimmed = path.trim().replace(/\s+/g, "");
  const noQuery = trimmed.split("?")[0] ?? trimmed;
  if (noQuery.length > 1 && noQuery.endsWith("/")) return noQuery.slice(0, -1);
  return noQuery;
}

/** Lista endpoints únicos encontrados en markdown de contratos. */
export function extractHttpEndpointsFromMarkdown(markdown: string): HttpEndpointRef[] {
  const text = (markdown ?? "").trim();
  if (!text) return [];

  const seen = new Set<string>();
  const out: HttpEndpointRef[] = [];

  const push = (method: string, path: string) => {
    const m = method.toUpperCase();
    const p = normalizeApiPath(path);
    if (!p.startsWith("/")) return;
    const key = `${m} ${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method: m, path: p });
  };

  const tableRow = new RegExp(
    `\\|\\s*(${METHOD})\\s*\\|\\s*(\`[^\`]+\`|/[^\\|\\s]+)\\s*\\|`,
    "gi",
  );
  for (const match of text.matchAll(tableRow)) {
    const pathRaw = (match[2] ?? "").replace(/`/g, "").trim();
    push(match[1] ?? "GET", pathRaw);
  }

  const inline = new RegExp(`\\b(${METHOD})\\s+(\`/[^\`]+\`|/[^\\s\`\\|,]+)`, "gi");
  for (const match of text.matchAll(inline)) {
    const pathRaw = (match[2] ?? "").replace(/`/g, "").trim();
    push(match[1] ?? "GET", pathRaw);
  }

  return out;
}

/** Tokens de entidad/slug para matching contra paths API (incl. segmento final). */
export function entityPathTokens(entityOrSlug: string): string[] {
  const lower = entityOrSlug.toLowerCase().trim();
  const tokens = new Set<string>([
    lower,
    lower.replace(/_/g, "-"),
    lower.replace(/-/g, "_"),
  ]);

  for (const part of lower.split(/[_-]/).filter((p) => p.length >= 2)) {
    tokens.add(part);
    if (part.endsWith("ies") && part.length > 4) {
      tokens.add(part.slice(0, -3) + "y");
    } else if (part.endsWith("ses") && part.length > 4) {
      tokens.add(part.slice(0, -2));
    } else if (part.endsWith("es") && part.length > 3) {
      tokens.add(part.slice(0, -2));
      tokens.add(part.slice(0, -1));
    } else if (part.endsWith("s") && part.length > 2) {
      tokens.add(part.slice(0, -1));
    } else if (part.length >= 3) {
      tokens.add(`${part}s`);
    }
  }

  return [...tokens].filter((t) => t.length >= 2);
}

/** Endpoints cuyo path menciona el token de entidad/pantalla. */
export function matchEndpointsForEntity(
  entityOrSlug: string,
  endpoints: HttpEndpointRef[],
): HttpEndpointRef[] {
  const tokens = entityPathTokens(entityOrSlug);

  return endpoints.filter((ep) => {
    const p = ep.path.toLowerCase();
    const segments = p.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    return tokens.some(
      (t) =>
        t.length >= 3 &&
        (p.includes(t) ||
          lastSegment === t ||
          lastSegment.replace(/-/g, "_") === t.replace(/-/g, "_")),
    );
  });
}

/** Ruta SPA preferida desde el path REST (p. ej. `/api/v1/keys` → `/admin/keys`). */
export function inferRouteFromApiPath(
  endpointPath: string,
  opts?: { admin?: boolean },
): string | undefined {
  const normalized = normalizeApiPath(endpointPath);
  const match = normalized.match(/^\/api\/v\d+\/([^/?]+)/i);
  if (!match?.[1]) return undefined;
  const segment = match[1].replace(/_/g, "-").toLowerCase();
  if (!segment) return undefined;
  if (/^(auth|login|health|public|status)$/i.test(segment)) {
    return segment === "auth" || segment === "login" ? "/login" : `/${segment}`;
  }
  return opts?.admin === false ? `/${segment}` : `/admin/${segment}`;
}

export function formatEndpointList(endpoints: HttpEndpointRef[], max = 3): string {
  if (endpoints.length === 0) return "—";
  return endpoints
    .slice(0, max)
    .map((e) => `${e.method} ${e.path}`)
    .join(", ");
}

/** Endpoints típicos de auth/login cuando no hay match por entidad. */
export function inferAuthEndpoints(endpoints: HttpEndpointRef[]): HttpEndpointRef[] {
  return endpoints.filter((e) => /\/auth|\/login|\/otp|\/session/i.test(e.path));
}
