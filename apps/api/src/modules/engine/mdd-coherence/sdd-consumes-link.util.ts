/**
 * Inferencia de relaciones API_Endpoint -[:CONSUMES]-> DB_Entity desde SQL (FK) y rutas §4.
 */

export type SddTableRef = {
  /** Nombre persistido en Falkor (`public.users`). */
  storageName: string;
  /** Segmento corto para matching (`users`). */
  bareName: string;
};

export function normalizeSddTableRef(raw: string): SddTableRef {
  const clean = (raw ?? "").replace(/["']/g, "").trim();
  const parts = clean.split(".").filter(Boolean);
  const bare = (parts[parts.length - 1] ?? clean).toLowerCase();
  return { storageName: clean, bareName: bare };
}

/** Tablas mencionadas en CREATE TABLE (conserva schema.table). */
export function extractTableRefsFromSql(sql: string): SddTableRef[] {
  const refs: SddTableRef[] = [];
  const seen = new Set<string>();
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql ?? "")) !== null) {
    if (!match[1]) continue;
    const ref = normalizeSddTableRef(match[1]);
    if (!ref.bareName || seen.has(ref.storageName)) continue;
    seen.add(ref.storageName);
    refs.push(ref);
  }
  return refs;
}

/**
 * Mapa tabla → tablas referenciadas vía FOREIGN KEY / REFERENCES en el SQL §3.
 */
export function extractForeignKeyTargetsByTable(sql: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const blocks = (sql ?? "").split(/;\s*\n?/);
  for (const block of blocks) {
    const create = block.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)\s*\(/i,
    );
    if (!create?.[1]) continue;
    const owner = normalizeSddTableRef(create[1]).storageName;
    const refs = block.matchAll(
      /REFERENCES\s+(?:ONLY\s+)?([a-zA-Z0-9_".]+)(?:\s*\([^)]*\))?/gi,
    );
    for (const r of refs) {
      if (!r[1]) continue;
      const target = normalizeSddTableRef(r[1]).storageName;
      if (!map.has(owner)) map.set(owner, new Set());
      map.get(owner)!.add(target);
    }
  }
  return map;
}

/** Mapa inverso: tabla referenciada → tablas que la referencian (FK hijas). */
export function extractForeignKeyReferrersByTable(
  fkByTable: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const [owner, targets] of fkByTable) {
    for (const target of targets) {
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target)!.add(owner);
    }
  }
  return reverse;
}

function normalizeToken(token: string): string {
  return (token ?? "").toLowerCase().replace(/-/g, "_");
}

function pathSegments(path: string): string[] {
  return (path ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\{+|\}+$/g, "").toLowerCase())
    .filter((s) => s.length > 1 && s !== "api" && s !== "v1" && s !== "v2" && !/^v\d+$/.test(s));
}

function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ses") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokensEquivalent(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (na === nb) return true;
  if (singularize(na) === nb || na === singularize(nb)) return true;
  if (singularize(na) === singularize(nb)) return true;
  if (na.replace(/_/g, "-") === nb.replace(/_/g, "-")) return true;
  return false;
}

function segmentMatchesTable(segment: string, bareName: string): boolean {
  const seg = normalizeToken(segment);
  const bare = normalizeToken(bareName);
  if (tokensEquivalent(seg, bare)) return true;
  if (bare.endsWith(seg) && seg.length >= 4) return true;
  return false;
}

/** Tablas junction (`user_roles`) cuando la ruta incluye sus partes (`/users/{id}/roles`). */
function junctionTableMatchesPath(bareName: string, segments: string[]): boolean {
  const bare = normalizeToken(bareName);
  if (!bare.includes("_")) return false;
  const parts = bare.split("_").filter(Boolean);
  if (parts.length < 2) return false;
  const normalizedSegs = segments.map((s) => singularize(normalizeToken(s)));
  return parts.every((part) => {
    const p = singularize(normalizeToken(part));
    return normalizedSegs.some((seg) => tokensEquivalent(seg, p));
  });
}

/**
 * Devuelve nombres `storageName` de tablas que un endpoint debería consumir.
 */
export function inferConsumedTableStorageNames(
  endpointPath: string,
  tables: SddTableRef[],
  fkByTable?: Map<string, Set<string>>,
): string[] {
  const segments = pathSegments(endpointPath);
  const matched = new Set<string>();
  const bareToStorage = new Map(tables.map((t) => [t.bareName, t.storageName]));

  for (const seg of segments) {
    for (const table of tables) {
      if (segmentMatchesTable(seg, table.bareName)) {
        matched.add(table.storageName);
      }
    }
    const direct =
      bareToStorage.get(normalizeToken(seg)) ??
      bareToStorage.get(singularize(normalizeToken(seg)));
    if (direct) matched.add(direct);
  }

  for (const table of tables) {
    if (junctionTableMatchesPath(table.bareName, segments)) {
      matched.add(table.storageName);
    }
  }

  if (fkByTable) {
    const fkReferrers = extractForeignKeyReferrersByTable(fkByTable);
    for (const owner of [...matched]) {
      for (const target of fkByTable.get(owner) ?? []) matched.add(target);
      for (const referrer of fkReferrers.get(owner) ?? []) matched.add(referrer);
    }
  }

  return [...matched];
}
