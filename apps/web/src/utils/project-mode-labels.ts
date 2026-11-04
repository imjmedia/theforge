import {
  isDesignFirst,
  isLegacy,
  type ProjectApproach,
  type ProjectType,
} from "@theforge/shared-types";

/** D8: UX_FIRST no se ofrece en el wizard de creación. */
export function isUxFirstWizardOptionVisible(): boolean {
  return false;
}

export type ProjectModeBadge = {
  label: string;
  title: string;
  tone: "design-first" | "ux-first" | "domain-first" | "legacy";
};

/** Etiqueta de modo para tiles, cabecera del taller y ajustes (solo lectura en Design-First). */
export function getProjectModeBadge(
  projectType: ProjectType | undefined,
  approach: ProjectApproach | undefined,
): ProjectModeBadge {
  const pt = projectType ?? "NEW";
  if (isLegacy(pt)) {
    return {
      label: "Legacy",
      title: "Proyecto legacy: documentación de cambios con Relic",
      tone: "legacy",
    };
  }
  if (isDesignFirst(pt)) {
    return {
      label: "Design-First",
      title: "Modo Design-First: pantallas, datos y contrato antes del MDD compilado",
      tone: "design-first",
    };
  }
  if (approach === "UX_FIRST") {
    return {
      label: "UX-First",
      title: "Enfoque UX-First (legado): las pantallas dictaban contratos OpenAPI",
      tone: "ux-first",
    };
  }
  return {
    label: "Domain-First",
    title: "Enfoque Domain-First: idea → BD/API en MDD → UI",
    tone: "domain-first",
  };
}

/** El enfoque metodológico no se edita en proyectos Design-First (D9). */
export function isProjectApproachEditable(projectType: ProjectType | undefined): boolean {
  return !isDesignFirst(projectType ?? "NEW");
}

export const DESIGN_FIRST_DISABLED_USER_MESSAGE =
  "Design-First no está habilitado en este entorno. Pide al administrador que active el flag en el servidor.";
