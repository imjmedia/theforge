/**
 * Reparación determinista MDD SSOT pre-gate: §3 DBGA core, UAT, §4 journeys, tablas plataforma.
 */

import type { DomainInventory } from "@theforge/shared-types";
import {
  checkBrdMddUatConformance,
  injectMissingUatScenariosIntoMdd,
} from "./brd-mdd-uat-conformance.util.js";
import {
  checkMddJourneySection4Gaps,
  injectMissingJourneyEndpointsIntoMddSection4,
} from "./mdd-journey-section4.util.js";
import { annotateJustifiedPlatformTablesInMdd } from "./platform-table-justify.util.js";
import { stripUnjustifiedPlatformTablesFromMdd } from "./mdd-platform-table-strip.util.js";
import { rebuildDomainInventoryPreferringBrd } from "./domain-inventory-persist.util.js";
import {
  mergeDbgaCoreGapsIntoMdd,
  mergeDomainTablesIntoMdd,
} from "./compose-section3-from-inventory.util.js";
import { collectDomainInventoryConformanceGaps } from "./domain-inventory-conformance.util.js";

export type MddSsotRepairResult = {
  markdown: string;
  section3Injected: string[];
  uatInjected: string[];
  section4Injected: string[];
  platformAnnotated: string[];
  platformStripped: string[];
  remainingGaps: string[];
};

export function reconcileMddSsotBeforeDeliveryGate(
  mddMarkdown: string,
  params: {
    brdMarkdown?: string | null;
    dbgaMarkdown?: string | null;
    specMarkdown?: string | null;
    inventory?: DomainInventory | null;
  },
): MddSsotRepairResult {
  const inventory =
    params.inventory ??
    (params.brdMarkdown?.trim() || params.dbgaMarkdown?.trim()
      ? rebuildDomainInventoryPreferringBrd({
          brdMarkdown: params.brdMarkdown,
          dbgaMarkdown: params.dbgaMarkdown,
          mddMarkdown,
        })
      : null);

  let markdown = mddMarkdown ?? "";
  const section3Injected: string[] = [];

  const dbgaCore = mergeDbgaCoreGapsIntoMdd(markdown, {
    dbgaMarkdown: params.dbgaMarkdown,
    brdMarkdown: params.brdMarkdown,
  });
  markdown = dbgaCore.markdown;
  section3Injected.push(...dbgaCore.injected);

  if (inventory) {
    const domain = mergeDomainTablesIntoMdd(markdown, inventory);
    markdown = domain.markdown;
    section3Injected.push(...domain.injected);
  }

  const stripped = stripUnjustifiedPlatformTablesFromMdd(markdown, {
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    specMarkdown: params.specMarkdown,
    inventory: inventory ?? undefined,
  });
  markdown = stripped.markdown;

  const platform = annotateJustifiedPlatformTablesInMdd(markdown, {
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    specMarkdown: params.specMarkdown,
    inventory: inventory ?? undefined,
  });
  markdown = platform.markdown;

  const uatReport = checkBrdMddUatConformance({
    brdMarkdown: params.brdMarkdown,
    mddMarkdown: markdown,
  });
  const uatRepair = injectMissingUatScenariosIntoMdd(markdown, uatReport.missingInMdd);
  markdown = uatRepair.markdown;

  const section4Report = checkMddJourneySection4Gaps({
    mddMarkdown: markdown,
    inventory: inventory ?? undefined,
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
  });
  const section4Repair = injectMissingJourneyEndpointsIntoMddSection4(
    markdown,
    section4Report.missing,
  );
  markdown = section4Repair.markdown;

  const invAfter = collectDomainInventoryConformanceGaps({
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
    mddMarkdown: markdown,
    specMarkdown: params.specMarkdown,
    inventory: inventory ?? undefined,
  });
  const uatAfter = checkBrdMddUatConformance({
    brdMarkdown: params.brdMarkdown,
    mddMarkdown: markdown,
  });
  const section4After = checkMddJourneySection4Gaps({
    mddMarkdown: markdown,
    inventory: inventory ?? undefined,
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
  });

  return {
    markdown,
    section3Injected,
    uatInjected: uatRepair.injected,
    section4Injected: section4Repair.injected,
    platformAnnotated: platform.annotated,
    platformStripped: stripped.stripped,
    remainingGaps: [...invAfter.gaps, ...uatAfter.gaps, ...section4After.gaps],
  };
}

export function collectMddSsotGateGaps(params: {
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  mddMarkdown: string;
  inventory?: DomainInventory | null;
}): string[] {
  const uat = checkBrdMddUatConformance(params);
  const section4 = checkMddJourneySection4Gaps({
    mddMarkdown: params.mddMarkdown,
    inventory: params.inventory,
    brdMarkdown: params.brdMarkdown,
    dbgaMarkdown: params.dbgaMarkdown,
  });
  return [...uat.gaps, ...section4.gaps];
}
