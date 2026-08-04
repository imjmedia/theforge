/**
 * Normaliza ids de handoff en change packs Ariadne.
 * - Pack artifacts (kind ≠ requirement): `ARIADNE-ART-NN`
 * - Business requirements (kind = requirement): `NEW-LEG-NN`
 */

const FORGE_NEW_LEG_ID = /^NEW-LEG-(\d+)$/i;
const FORGE_ARIADNE_ART_ID = /^ARIADNE-ART-(\d+)$/i;

export type AriadneHandoffIdRemap = { from: string; to: string };

export type NormalizeAriadneHandoffItemsResult = {
  items: Record<string, unknown>[];
  remapped: AriadneHandoffIdRemap[];
};

/** Id canónico para artefactos del pack Ariadne. */
export function toForgeAriadneArtId(sequence: number): string {
  return `ARIADNE-ART-${String(Math.max(1, sequence)).padStart(2, "0")}`;
}

/** Id canónico Forge para requisitos de negocio NEW→LEG. */
export function toForgeNewLegId(sequence: number): string {
  return `NEW-LEG-${String(Math.max(1, sequence)).padStart(2, "0")}`;
}

function isValidForgeNewLegId(id: string): boolean {
  return /^NEW-LEG-\d{2,}$/.test(id);
}

function isValidForgeAriadneArtId(id: string): boolean {
  return /^ARIADNE-ART-\d{2,}$/.test(id);
}

function isUuidLike(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function handoffItemKind(row: Record<string, unknown>): string {
  return typeof row.kind === "string" ? row.kind : "requirement";
}

function isAriadnePackArtifactKind(kind: string): boolean {
  return kind !== "requirement";
}

/** Extrae número de sufijos habituales en packs externos. */
export function extractHandoffItemSequenceHint(rawId: string): number | null {
  const trimmed = rawId.trim();
  if (!trimmed || isUuidLike(trimmed)) return null;

  let m = trimmed.match(/^NEW-LEG-(\d+)$/i);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/^ARIADNE-ART-(\d+)$/i);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/^LEG-(\d+)$/i);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/-(\d+)$/);
  if (m) return parseInt(m[1]!, 10);

  m = trimmed.match(/(\d+)$/);
  if (m) return parseInt(m[1]!, 10);

  return null;
}

function normalizeIdForForge(
  rawId: string,
  fallbackIndex: number,
  usedIds: Set<string>,
  artifact: boolean,
): { id: string; remapped: AriadneHandoffIdRemap | null } {
  const trimmed = rawId.trim();
  const hint = extractHandoffItemSequenceHint(trimmed);
  const toCanonical = artifact ? toForgeAriadneArtId : toForgeNewLegId;
  const isValid = artifact ? isValidForgeAriadneArtId : isValidForgeNewLegId;
  const pattern = artifact ? FORGE_ARIADNE_ART_ID : FORGE_NEW_LEG_ID;

  let candidate = hint != null ? toCanonical(hint) : toCanonical(fallbackIndex);

  if (trimmed && isValid(trimmed)) {
    const match = trimmed.match(pattern);
    if (match) {
      candidate = toCanonical(parseInt(match[1]!, 10));
    }
  }

  while (usedIds.has(candidate)) {
    const prefix = artifact ? "ARIADNE-ART-" : "NEW-LEG-";
    const n = parseInt(candidate.replace(prefix, ""), 10) + 1;
    candidate = toCanonical(n);
  }
  usedIds.add(candidate);

  const remapped =
    trimmed && trimmed !== candidate ? { from: trimmed, to: candidate } : null;
  return { id: candidate, remapped };
}

export function normalizeAriadneChangePackHandoffItems(raw: unknown): unknown {
  if (raw == null) return raw;
  if (!Array.isArray(raw)) return raw;
  return normalizeAriadneHandoffItemsRaw(raw).items;
}

export function normalizeAriadneHandoffItemsRaw(
  rawItems: unknown[],
): NormalizeAriadneHandoffItemsResult {
  const usedArtifactIds = new Set<string>();
  const usedRequirementIds = new Set<string>();
  const remapped: AriadneHandoffIdRemap[] = [];
  const items: Record<string, unknown>[] = [];

  rawItems.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const row = { ...(entry as Record<string, unknown>) };
    const kind = handoffItemKind(row);
    const artifact = isAriadnePackArtifactKind(kind);
    const rawId = typeof row.id === "string" ? row.id : "";
    const { id, remapped: map } = normalizeIdForForge(
      rawId,
      index + 1,
      artifact ? usedArtifactIds : usedRequirementIds,
      artifact,
    );
    row.id = id;
    if (map) remapped.push(map);
    const content = typeof row.content === "string" ? row.content.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (content && (!description || description === String(row.title ?? "").trim())) {
      row.description = content.slice(0, 200_000);
      if ((content.startsWith("{") || content.startsWith("[")) && row.payload == null) {
        try {
          row.payload = JSON.parse(content) as unknown;
        } catch {
          /* keep description only */
        }
      }
    }
    delete row.content;
    delete row.mimeType;
    items.push(row);
  });

  return { items, remapped };
}
