/**
 * Normaliza ids de handoff en change packs Ariadne → formato Forge `NEW-LEG-NN`.
 * Ariadne puede enviar `LEG-01`, `NEW-LEG-1`, UUIDs, etc.; Forge exige `^NEW-LEG-\d{2,}$`.
 */

const FORGE_NEW_LEG_ID = /^NEW-LEG-(\d+)$/i;

export type AriadneHandoffIdRemap = { from: string; to: string };

export type NormalizeAriadneHandoffItemsResult = {
  items: Record<string, unknown>[];
  remapped: AriadneHandoffIdRemap[];
};

/** Id canónico Forge: `NEW-LEG-01`, `NEW-LEG-12`, … */
export function toForgeNewLegId(sequence: number): string {
  return `NEW-LEG-${String(Math.max(1, sequence)).padStart(2, "0")}`;
}

function isValidForgeNewLegId(id: string): boolean {
  return /^NEW-LEG-\d{2,}$/.test(id);
}

function isUuidLike(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Extrae número de sufijos habituales en packs externos (NEW-LEG-1, LEG-03, CHG-7). */
export function extractHandoffItemSequenceHint(rawId: string): number | null {
  const trimmed = rawId.trim();
  if (!trimmed || isUuidLike(trimmed)) return null;

  let m = trimmed.match(/^NEW-LEG-(\d+)$/i);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/^LEG-(\d+)$/i);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/-(\d+)$/);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/(\d+)$/);
  if (m) return parseInt(m[1]!, 10);

  return null;
}

/**
 * Convierte un id crudo a `NEW-LEG-NN`. Si no hay pista numérica, usa `fallbackIndex` (1-based).
 * Reserva ids ya usados incrementando hasta encontrar uno libre.
 */
export function normalizeHandoffItemIdForForge(
  rawId: string,
  fallbackIndex: number,
  usedIds: Set<string>,
): { id: string; remapped: AriadneHandoffIdRemap | null } {
  const trimmed = rawId.trim();
  const hint = extractHandoffItemSequenceHint(trimmed);
  let candidate =
    hint != null ? toForgeNewLegId(hint) : toForgeNewLegId(fallbackIndex);

  if (trimmed && isValidForgeNewLegId(trimmed)) {
    const canon = toForgeNewLegId(parseInt(trimmed.match(FORGE_NEW_LEG_ID)![1]!, 10));
    candidate = canon;
  }

  while (usedIds.has(candidate)) {
    const n = parseInt(candidate.replace(/^NEW-LEG-/i, ""), 10) + 1;
    candidate = toForgeNewLegId(n);
  }
  usedIds.add(candidate);

  const remapped =
    trimmed && trimmed !== candidate ? { from: trimmed, to: candidate } : null;
  return { id: candidate, remapped };
}

/**
 * Preprocess Zod: normaliza `handoffItems[].id` antes de validar contra `integrationHandoffItemSchema`.
 * Ignora entradas que no sean objetos; conserva el resto de campos del ítem.
 */
export function normalizeAriadneChangePackHandoffItems(raw: unknown): unknown {
  if (raw == null) return raw;
  if (!Array.isArray(raw)) return raw;
  return normalizeAriadneHandoffItemsRaw(raw).items;
}

export function normalizeAriadneHandoffItemsRaw(
  rawItems: unknown[],
): NormalizeAriadneHandoffItemsResult {
  const usedIds = new Set<string>();
  const remapped: AriadneHandoffIdRemap[] = [];
  const items: Record<string, unknown>[] = [];

  rawItems.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const row = { ...(entry as Record<string, unknown>) };
    const rawId = typeof row.id === "string" ? row.id : "";
    const { id, remapped: map } = normalizeHandoffItemIdForForge(rawId, index + 1, usedIds);
    row.id = id;
    if (map) remapped.push(map);
    items.push(row);
  });

  return { items, remapped };
}
