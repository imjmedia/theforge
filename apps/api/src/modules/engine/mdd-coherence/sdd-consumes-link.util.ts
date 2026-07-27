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

function segmentMatchesTable(segment: string, bareName: string): boolean {
  const seg = segment.toLowerCase();
  const bare = bareName.toLowerCase();
  if (seg === bare) return true;
  if (singularize(seg) === bare) return true;
  if (seg === singularize(bare)) return true;
  if (bare.endsWith(seg) && seg.length >= 4) return true;
  return false;
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
    const direct = bareToStorage.get(seg) ?? bareToStorage.get(singularize(seg));
    if (direct) matched.add(direct);
  }

  if (fkByTable) {
    for (const owner of [...matched]) {
      for (const target of fkByTable.get(owner) ?? []) matched.add(target);
    }
  }

  return [...matched];
}
