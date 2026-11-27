/**
 * @module gapLocation
 * Ubicación de las brechas transversales: traduce los `targetDeliverables` de un
 * `ClassifiedGap` a etiquetas cortas en español y al id del panel de documento
 * que abre `setWorkshopActiveDocPanel` (ids de `workshopDocNav`).
 */
import type { ClassifiedGap } from "@theforge/shared-types";

/** Chip de ubicación de una brecha: etiqueta y, si existe, panel que abre. */
export type GapLocationChip = {
  /** Id del entregable tal como lo emite la auditoría (p. ej. `api_contracts`). */
  deliverable: string;
  /** Etiqueta corta en español. */
  label: string;
  /** Id de panel de documento; `null` si el destino no tiene panel (chip sin clic). */
  panelId: string | null;
};

const GAP_LOCATION_MAP: Record<string, { label: string; panelId: string }> = {
  api_contracts: { label: "API", panelId: "api-contracts" },
  architecture: { label: "Arquitectura", panelId: "architecture" },
  infra: { label: "Infra", panelId: "infra" },
  logic_flows: { label: "Flujos", panelId: "logic-flows" },
  blueprint: { label: "Blueprint", panelId: "blueprint" },
  brd: { label: "BRD", panelId: "brd" },
  tasks: { label: "Tasks", panelId: "tasks" },
  spec: { label: "Spec", panelId: "spec" },
  user_stories: { label: "Historias", panelId: "user-stories" },
  use_cases: { label: "Casos de uso", panelId: "use-cases" },
  ux_ui_guide: { label: "Guía UX", panelId: "ux-ui-guide" },
  ui_screens_sync: { label: "Pantallas", panelId: "ui-screens" },
  mdd_canonical: { label: "MDD", panelId: "mdd" },
};

/**
 * Chips de ubicación de una brecha, sin duplicados y en el orden de la auditoría.
 * Usa `targetDeliverables` y cae a `targetDeliverable`. Ids desconocidos se
 * muestran tal cual y sin clic.
 */
export function getGapLocationChips(
  gap: Pick<ClassifiedGap, "targetDeliverable" | "targetDeliverables">,
): GapLocationChip[] {
  const ids =
    gap.targetDeliverables && gap.targetDeliverables.length > 0
      ? gap.targetDeliverables
      : gap.targetDeliverable
        ? [gap.targetDeliverable]
        : [];
  const seen = new Set<string>();
  const chips: GapLocationChip[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const known = GAP_LOCATION_MAP[id];
    chips.push({
      deliverable: id,
      label: known?.label ?? id,
      panelId: known?.panelId ?? null,
    });
  }
  return chips;
}
