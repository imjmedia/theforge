/** Estado de coherencia §3/§4 del MDD (inferido del markdown; antes FalkorDB). */
export type SddGraphSyncState = "synced" | "empty" | "stale" | "unavailable";

export const SDD_GRAPH_SYNC_STATE_LABELS: Record<SddGraphSyncState, string> = {
  synced: "Coherente",
  empty: "Sin §3/§4",
  stale: "Incoherente",
  unavailable: "No evaluable",
};

export type SddGraphSyncStatus = {
  state: SddGraphSyncState;
  /** Tablas detectadas en §3 (SQL). */
  entityCount: number;
  /** Endpoints detectados en §4. */
  endpointCount: number;
  /** Tablas esperadas en §3. */
  expectedEntities: number;
  /** Endpoints esperados en §4. */
  expectedEndpoints: number;
  /** Coherencia endpoint↔tabla (sin huérfanos). */
  isCoherent: boolean;
  orphanEntityCount: number;
  orphanEndpointCount: number;
  lastSyncedAt: number | null;
  message: string;
};

export type ResolveMddCoherenceInput = {
  expectedEntities: number;
  expectedEndpoints: number;
  entityCount: number;
  endpointCount: number;
  isCoherent: boolean;
  orphanEntityCount?: number;
  orphanEndpointCount?: number;
  mddChangedSinceSync?: boolean;
};

/** @deprecated Usar ResolveMddCoherenceInput. Alias legacy para tests. */
export type ResolveSddGraphSyncInput = ResolveMddCoherenceInput & {
  falkorAvailable?: boolean;
  graphEntities?: number;
  graphEndpoints?: number;
};

/** Resuelve estado UI/API desde coherencia markdown §3/§4. */
export function resolveMddCoherenceState(input: ResolveMddCoherenceInput): SddGraphSyncStatus {
  const {
    expectedEntities,
    expectedEndpoints,
    entityCount,
    endpointCount,
    isCoherent,
    orphanEntityCount = 0,
    orphanEndpointCount = 0,
    mddChangedSinceSync = false,
  } = input;

  const indexable = expectedEntities > 0 || expectedEndpoints > 0;
  if (!indexable) {
    return {
      state: "empty",
      entityCount: 0,
      endpointCount: 0,
      expectedEntities: 0,
      expectedEndpoints: 0,
      isCoherent: false,
      orphanEntityCount: 0,
      orphanEndpointCount: 0,
      lastSyncedAt: null,
      message:
        "El MDD no expone tablas SQL ni contratos API indexables (p. ej. legacy Strapi).",
    };
  }

  if (mddChangedSinceSync) {
    return {
      state: "stale",
      entityCount,
      endpointCount,
      expectedEntities,
      expectedEndpoints,
      isCoherent,
      orphanEntityCount,
      orphanEndpointCount,
      lastSyncedAt: null,
      message: "El MDD cambió desde la última evaluación de coherencia.",
    };
  }

  if (isCoherent && entityCount > 0 && endpointCount > 0) {
    return {
      state: "synced",
      entityCount,
      endpointCount,
      expectedEntities,
      expectedEndpoints,
      isCoherent: true,
      orphanEntityCount: 0,
      orphanEndpointCount: 0,
      lastSyncedAt: null,
      message: "Coherencia §3/§4 OK (tablas y endpoints enlazados).",
    };
  }

  let message = "Coherencia §3/§4 pendiente o incompleta.";
  if (orphanEndpointCount > 0 || orphanEntityCount > 0) {
    message = `Hay ${orphanEndpointCount} endpoint(s) y ${orphanEntityCount} entidad(es) sin enlace CONSUMES inferido.`;
  } else if (entityCount === 0 || endpointCount === 0) {
    message = "Faltan tablas SQL (§3) o contratos API (§4) sustanciales.";
  }

  return {
    state: "stale",
    entityCount,
    endpointCount,
    expectedEntities,
    expectedEndpoints,
    isCoherent: false,
    orphanEntityCount,
    orphanEndpointCount,
    lastSyncedAt: null,
    message,
  };
}

/** @deprecated Usar resolveMddCoherenceState. */
export function resolveSddGraphSyncState(input: ResolveSddGraphSyncInput): SddGraphSyncStatus {
  return resolveMddCoherenceState({
    expectedEntities: input.expectedEntities,
    expectedEndpoints: input.expectedEndpoints,
    entityCount: input.graphEntities ?? input.entityCount ?? 0,
    endpointCount: input.graphEndpoints ?? input.endpointCount ?? 0,
    isCoherent: input.isCoherent === true,
    orphanEntityCount: input.orphanEntityCount,
    orphanEndpointCount: input.orphanEndpointCount,
    mddChangedSinceSync: input.mddChangedSinceSync,
  });
}

/** Huella ligera del MDD para detectar cambios post-sync sin hash completo. */
export function mddGraphFingerprint(mddMarkdown: string): string {
  const body = (mddMarkdown ?? "").trim();
  const len = body.length;
  const tables = (body.match(/\bCREATE\s+TABLE\b/gi) ?? []).length;
  const endpoints = (body.match(/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/gi) ?? []).length;
  const h3ep = (body.match(/###\s+(GET|POST|PUT|PATCH|DELETE)\s+\S+/gi) ?? []).length;
  return `${len}:${tables}:${Math.max(endpoints, h3ep)}`;
}
