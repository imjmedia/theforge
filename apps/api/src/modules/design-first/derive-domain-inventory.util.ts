import type { DomainInventory } from "@theforge/shared-types";
import type { DesignSpec } from "@theforge/shared-types";

/** Deriva inventario mínimo desde entidades Design-First (phase2). */
export function deriveDomainInventoryFromDesignSpec(spec: DesignSpec): DomainInventory {
  const entities = [...spec.entities].sort((a, b) => a.id.localeCompare(b.id));
  return {
    capabilities: [],
    suggestedEntities: entities.map((e) => e.id),
    processes: [],
    crudMatrix: entities.map((e) => ({
      entity: e.id,
      ops: ["L", "R", "C", "U", "D"],
      endpointHint: e.restEndpoint ?? undefined,
      screenHint: spec.screens[0]?.id,
      mvp: true,
      infraOnly: false,
      brdCapabilityIds: [],
    })),
    adminSurfaces: [],
  };
}
