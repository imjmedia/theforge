/** Pestañas de documentos en Workshop (alineado con `DocPanel` en WorkshopView). */
export type WorkshopDocTab =
  | "benchmark"
  | "legacy"
  | "mdd-inicial"
  | "spec"
  | "brd"
  | "mdd"
  | "ux-ui-guide"
  | "blueprint"
  | "tasks"
  | "agent-governance"
  | "api-contracts"
  | "logic-flows"
  | "architecture"
  | "use-cases"
  | "user-stories"
  | "infra"
  | "adrs"
  | "aem"
  | "integration"
  | "handoff-spec"
  | "ui-screens"
;

export type ProjectTypeForTabs = "NEW" | "LEGACY";

/** Etapa 1 = AS-IS/baseline; etapa 2+ = modificación (solo MDD de cambio). */
export function isLegacyModificationStage(
  projectType: ProjectTypeForTabs | undefined,
  stageOrdinal: number | undefined,
): boolean {
  return projectType === "LEGACY" && (stageOrdinal ?? 1) >= 2;
}

/**
 * Visibilidad de pestañas según `Project.complexity` y tipo de proyecto.
 * Alineado con `DELIVERABLES_BY_COMPLEXITY` (incl. `agent_governance` en LOW/MEDIUM/HIGH).
 *
 * - **LOW:** oculta MDD, Blueprint y API (constitución vía DBGA / Spec).
 * - **MEDIUM + NEW:** solo Paso 0, Spec, API, Guía UX/UI, Tasks, ADRs — sin MDD en barra (insumo: DBGA/Spec); sin Arq., Casos, H.U., Blueprint, Flujos, Infra.
 * - **MEDIUM + LEGACY:** Modificación, MDD, Spec, API, Guía UX/UI, Tasks — el MDD sigue siendo la constitución del cambio.
 * - **HIGH:** todas las pestañas.
 */
export function isTabVisibleForComplexity(
  tab: WorkshopDocTab,
  complexity: "LOW" | "MEDIUM" | "HIGH" | undefined,
  opts?: { projectType?: ProjectTypeForTabs; legacyStageOrdinal?: number },
): boolean {
  const c = complexity ?? "HIGH";
  const pt: ProjectTypeForTabs = opts?.projectType ?? "NEW";
  const legacyModification = isLegacyModificationStage(pt, opts?.legacyStageOrdinal);

  // En etapas de modificación (ordinal ≥ 2) no se generan MDD Inicial ni BRD.
  if (legacyModification && (tab === "mdd-inicial" || tab === "brd")) return false;

  // AEM siempre visible, sin importar complejidad ni tipo de proyecto
  if (tab === "aem") return true;

  // Integración cross-project NEW ↔ LEGACY
  if (tab === "integration") return true;

  // Handoff Spec: artefacto de acuerdo mutuo NEW ↔ LEGACY. El NEW (greenfield) valida que está
  // modelando bien la integración; el LEGACY (brownfield) corrobora el impacto. Visible en ambos
  // lados, igual que la pestaña Integración.
  if (tab === "handoff-spec") return true;

  // Pantallas: gate principal en shouldShowUiScreensTab (MCP, contenido o detectWebSurfaces).
  // A nivel de complejidad no se oculta; buildWorkshopDocNavItems omite visible() para ui-screens.
  if (tab === "ui-screens") return true;

  if (c === "HIGH") return true;

  if (c === "LOW") {
    const hidden: WorkshopDocTab[] = ["mdd", "blueprint", "api-contracts"];
    return !hidden.includes(tab);
  }

  if (c === "MEDIUM") {
    if (pt === "LEGACY") {
      const allow: WorkshopDocTab[] = [
        "legacy",
        "mdd-inicial",
        "brd",
        "mdd",
        "spec",
        "api-contracts",
        "ux-ui-guide",
        "agent-governance",
        "tasks",
      ];
      return allow.includes(tab);
    }
    const allowNew: WorkshopDocTab[] = [
      "benchmark",
      "spec",
      "brd",
      "api-contracts",
      "ux-ui-guide",
      "agent-governance",
      "tasks",
      "adrs",
    ];
    return allowNew.includes(tab);
  }

  return true;
}

/** Paneles que no deben quedar activos cuando la complejidad los oculta (para redirigir). */
export function centralPanelHiddenForComplexity(
  panel: string,
  complexity: "LOW" | "MEDIUM" | "HIGH" | undefined,
  opts?: { projectType?: ProjectTypeForTabs; legacyStageOrdinal?: number },
): boolean {
  return !isTabVisibleForComplexity(panel as WorkshopDocTab, complexity, opts);
}
