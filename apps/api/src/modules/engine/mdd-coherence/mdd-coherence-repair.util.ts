/**
 * Reparación determinista de gaps §3↔§4 (endpoints mínimos para entidades huérfanas de negocio).
 */

import type { DomainInventory } from "@theforge/shared-types";
import {
  injectMissingJourneyEndpointsIntoMddSection4,
  type JourneyEndpointRequirement,
} from "../mdd-journey-section4.util.js";
import { findMddCoherenceOrphans } from "./mdd-coherence.util.js";
import { isExemptEntityTable, buildInfraOnlyEntitySet, FK_ONLY_CHILD_TABLES } from "./mdd-coherence-exemptions.util.js";

export type MddCoherenceRepairResult = {
  markdown: string;
  injected: string[];
};

/** Inyecta filas §4 GET mínimas para tablas de negocio sin endpoint enlazado. */
export function repairMddCoherenceSection4Gaps(
  mddMarkdown: string,
  options?: { inventory?: DomainInventory | null },
): MddCoherenceRepairResult {
  const infraOnly = buildInfraOnlyEntitySet(options?.inventory);
  const { orphanEntityBareNames } = findMddCoherenceOrphans(mddMarkdown, {
    inventory: options?.inventory,
  });

  const missing: JourneyEndpointRequirement[] = [];
  for (const bare of orphanEntityBareNames) {
    if (isExemptEntityTable(bare, infraOnly)) continue;
    if (FK_ONLY_CHILD_TABLES.has(bare.toLowerCase())) continue;
    const base = bare.replace(/_/g, "-");
    missing.push({
      id: `coherence-${bare}-list`,
      label: `${bare} (coherence auto)`,
      method: "GET",
      path: `/api/v1/${base}`,
      triggerEntity: bare,
    });
  }

  if (missing.length === 0) {
    return { markdown: mddMarkdown, injected: [] };
  }

  const { markdown, injected } = injectMissingJourneyEndpointsIntoMddSection4(mddMarkdown, missing);
  return { markdown, injected };
}
