/**
 * Provenance of a LEGACY stage — distinguishes Forge-native vs Ariadne-sourced workflows.
 */
export type StageOrigin =
  | "forge_native"
  | "ariadne_change_pack"
  | "ariadne_integration_handoff"
  | "integration_promote";

export const STAGE_ORIGIN_LABELS: Record<StageOrigin, string> = {
  forge_native: "The Forge (legacy)",
  ariadne_change_pack: "Ariadne — cambio brownfield",
  ariadne_integration_handoff: "Ariadne — integración NEW→LEG",
  integration_promote: "Integración NEW→LEG (promote)",
};

export function isAriadneSourcedStageOrigin(origin: StageOrigin | null | undefined): boolean {
  return (
    origin === "ariadne_change_pack" ||
    origin === "ariadne_integration_handoff" ||
    origin === "integration_promote"
  );
}

export function resolveStageOriginFromHandoffSnapshot(source: unknown): StageOrigin | null {
  if (typeof source !== "string" || !source.trim()) return null;
  if (source === "ariadne_change_pack_v1") return "ariadne_change_pack";
  if (source === "promotedFromSendAt") return "integration_promote";
  return null;
}

export function resolveStageOriginFromIntegrationScope(
  scope: { mode?: string } | null | undefined,
): StageOrigin | null {
  if (scope?.mode === "integration_handoff") return "ariadne_integration_handoff";
  return null;
}
