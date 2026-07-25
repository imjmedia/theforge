/**
 * Reparaciones deterministas MDD (BRD pre-patch, inventario, SSOT) para convergencia post-cascada.
 */

import type { DomainInventory } from "@theforge/shared-types";
import { patchMddFromBrdTraceability } from "../engine/brd-mdd-pre-patch.util.js";
import { rebuildDomainInventoryPreferringBrd } from "../engine/domain-inventory-persist.util.js";
import { reconcileDomainInventoryIntoMdd } from "../engine/domain-inventory-reconciler.util.js";
import { reconcileMddSsotBeforeDeliveryGate } from "../engine/mdd-ssot-repair.util.js";
import { applyPreDeliveryGateFixes } from "../ai-analysis/utils/mdd-sanitize.js";

export type DeterministicMddRepairResult = {
  markdown: string;
  changed: boolean;
  notes: string[];
};

export function applyDeterministicMddRepairs(
  mddMarkdown: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    inventory?: DomainInventory | null;
    specMarkdown?: string | null;
  },
): DeterministicMddRepairResult {
  const notes: string[] = [];
  let markdown = mddMarkdown;

  const brdPatch = patchMddFromBrdTraceability(markdown, params.brdMarkdown);
  if (brdPatch.injected.length > 0) {
    markdown = brdPatch.markdown;
    notes.push(...brdPatch.injected.map((x) => `BRD patch: ${x}`));
  }

  const inv = reconcileDomainInventoryIntoMdd(markdown, {
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    inventory: params.inventory,
  });
  if (inv.section3Injected.length > 0 || inv.section4Injected.length > 0) {
    markdown = inv.markdown;
    notes.push(...inv.section3Injected, ...inv.section4Injected);
  }

  const ssot = reconcileMddSsotBeforeDeliveryGate(markdown, {
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    specMarkdown: params.specMarkdown,
    inventory: params.inventory,
  });
  if (ssot.markdown !== markdown) {
    markdown = ssot.markdown;
    notes.push(
      ...ssot.section3Injected,
      ...ssot.uatInjected,
      ...ssot.section4Injected,
    );
  }

  return {
    markdown,
    changed: markdown.trim() !== mddMarkdown.trim(),
    notes,
  };
}

export type PrepareMddForDeliveryGateOptions = {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  inventory?: DomainInventory | null;
  specMarkdown?: string | null;
  /** Si true, no aplica reparaciones deterministas (tests unitarios del gate en bruto). */
  skipDeterministicRepair?: boolean;
};

/**
 * Pipeline agnóstico de dominio antes de validateMddForDelivery:
 * BRD patch → inventario §3/§4 → SSOT → fences/manifest/JSON.
 */
export function prepareMddForDeliveryGateValidation(
  mddMarkdown: string,
  params: PrepareMddForDeliveryGateOptions = {},
): DeterministicMddRepairResult {
  const base = (mddMarkdown ?? "").trim();
  if (!base) {
    return { markdown: base, changed: false, notes: [] };
  }

  let markdown = base;
  const notes: string[] = [];

  if (!params.skipDeterministicRepair) {
    const inventory =
      params.inventory ??
      (params.brdMarkdown?.trim() || params.dbgaMarkdown?.trim()
        ? rebuildDomainInventoryPreferringBrd({
            brdMarkdown: params.brdMarkdown,
            dbgaMarkdown: params.dbgaMarkdown,
            mddMarkdown: base,
          })
        : null);

    const repaired = applyDeterministicMddRepairs(base, {
      brdMarkdown: params.brdMarkdown,
      dbgaMarkdown: params.dbgaMarkdown,
      inventory,
      specMarkdown: params.specMarkdown,
    });
    markdown = repaired.markdown;
    notes.push(...repaired.notes);
  }

  const formatted = applyPreDeliveryGateFixes(markdown);
  if (formatted !== markdown) {
    notes.push("pre-delivery-gate fixes");
  }
  markdown = formatted;

  return {
    markdown,
    changed: markdown.trim() !== base.trim(),
    notes,
  };
}
