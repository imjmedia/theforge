import type { DomainInventory } from "@theforge/shared-types";
import { rebuildDomainInventoryPreferringBrd } from "../../engine/domain-inventory-persist.util.js";
import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import type { ValidateMddForDeliveryOptions } from "./mdd-delivery-gate.util.js";

export type ResolveDeliveryGateContextInput = {
  mddMarkdown: string;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
  mddComplexity?: MddComplexityLevel | null;
  skipDeterministicRepair?: boolean;
};

export type ResolvedDeliveryGateContext = {
  options: ValidateMddForDeliveryOptions;
  inventory: DomainInventory | undefined;
};

/** Perfil único de validación del delivery gate (panel, pipeline, snapshot, puerta). */
export function resolveDeliveryGateContext(input: ResolveDeliveryGateContextInput): ResolvedDeliveryGateContext {
  const inventory = rebuildDomainInventoryPreferringBrd({
    brdMarkdown: input.brdMarkdown,
    dbgaMarkdown: input.dbgaMarkdown,
    mddMarkdown: input.mddMarkdown,
  });
  const options: ValidateMddForDeliveryOptions = {
    brdMarkdown: input.brdMarkdown ?? undefined,
    dbgaMarkdown: input.dbgaMarkdown ?? undefined,
    specMarkdown: input.specMarkdown ?? undefined,
    inventory,
    mddComplexity: input.mddComplexity ?? undefined,
    skipDeterministicRepair: input.skipDeterministicRepair,
  };
  return { options, inventory };
}
