/**
 * Deterministic post-LLM enrichment of clarifiedScope from domain inventory (0 extra LLM).
 */

import { AUTH_ENTITY_FAMILY, type DomainInventory } from "@theforge/shared-types";

/** Scope shorter than this with non-empty inventory triggers enrichment. */
const SHORT_SCOPE_THRESHOLD = 600;

/** Fraction of business entities that must appear in scope before we inject. */
const ENTITY_MENTION_RATIO_THRESHOLD = 0.5;

const ENTITIES_LINE_RE = /\*\*Entidades:\*\*/i;
const CAPABILITIES_LINE_RE = /\*\*Capacidades:\*\*/i;

function entityMentionedInScope(entity: string, scope: string): boolean {
  const normalized = entity.toLowerCase().replace(/_/g, "[\\s_-]*");
  const re = new RegExp(`\\b${normalized}\\b`, "i");
  if (re.test(scope)) return true;
  const human = entity.replace(/_/g, " ");
  return scope.toLowerCase().includes(human);
}

function countMentionedEntities(entities: string[], scope: string): number {
  return entities.filter((e) => entityMentionedInScope(e, scope)).length;
}

function formatEntityList(entities: string[]): string {
  return entities
    .map((e) => e.replace(/_/g, " "))
    .join(", ");
}

function formatCapabilityList(inventory: DomainInventory): string {
  const domainCaps = inventory.capabilities.filter((c) => !c.isAuthRelated);
  const titles = domainCaps.length > 0
    ? domainCaps.map((c) => c.title)
    : inventory.capabilities.map((c) => c.title);
  return titles.slice(0, 25).join("; ");
}

export type EnrichClarifiedScopeResult = {
  scope: string;
  enriched: boolean;
  addedEntities: boolean;
  addedCapabilities: boolean;
};

/**
 * Merges missing entities/capabilities from domain inventory into clarifiedScope.
 * Does not truncate — only appends structured lines when coverage is low.
 */
export function enrichClarifiedScopeFromInventory(
  clarifiedScope: string,
  inventory: DomainInventory | null | undefined,
): EnrichClarifiedScopeResult {
  const scope = (clarifiedScope ?? "").trim();
  const inv = inventory;
  const empty =
    !inv ||
    (inv.capabilities.length === 0 && inv.suggestedEntities.length === 0);

  if (empty) {
    return { scope, enriched: false, addedEntities: false, addedCapabilities: false };
  }

  const businessEntities = inv.suggestedEntities.filter((e) => !AUTH_ENTITY_FAMILY.has(e));
  const mentioned = countMentionedEntities(businessEntities, scope);
  const ratio = businessEntities.length > 0 ? mentioned / businessEntities.length : 1;

  const scopeTooShort = scope.length < SHORT_SCOPE_THRESHOLD;
  const lowEntityCoverage =
    businessEntities.length >= 2 && ratio < ENTITY_MENTION_RATIO_THRESHOLD;
  const missingEntitiesLine = businessEntities.length > 0 && !ENTITIES_LINE_RE.test(scope);
  const missingCapabilitiesLine =
    inv.capabilities.length > 0 && !CAPABILITIES_LINE_RE.test(scope);

  const shouldEnrichEntities =
    businessEntities.length > 0 &&
    (scopeTooShort || lowEntityCoverage || missingEntitiesLine);
  const shouldEnrichCapabilities = missingCapabilitiesLine && inv.capabilities.length > 0;

  const shouldEnrich = shouldEnrichEntities || shouldEnrichCapabilities;

  if (!shouldEnrich) {
    return { scope, enriched: false, addedEntities: false, addedCapabilities: false };
  }

  const additions: string[] = [];
  let addedEntities = false;
  let addedCapabilities = false;

  if (missingEntitiesLine && businessEntities.length > 0 && shouldEnrichEntities) {
    const missing = businessEntities.filter((e) => !entityMentionedInScope(e, scope));
    const toList = missing.length > 0 ? missing : businessEntities;
    additions.push(`**Entidades:** ${formatEntityList(toList)}.`);
    addedEntities = true;
  }

  if (missingCapabilitiesLine && inv.capabilities.length > 0 && shouldEnrichCapabilities) {
    additions.push(`**Capacidades:** ${formatCapabilityList(inv)}.`);
    addedCapabilities = true;
  }

  if (additions.length === 0) {
    return { scope, enriched: false, addedEntities: false, addedCapabilities: false };
  }

  const enrichedScope = [scope, ...additions].filter(Boolean).join("\n\n").trim();
  return {
    scope: enrichedScope,
    enriched: true,
    addedEntities,
    addedCapabilities,
  };
}
