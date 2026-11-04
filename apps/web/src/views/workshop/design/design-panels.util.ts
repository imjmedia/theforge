import type { DesignFirstPhaseGates } from "@theforge/shared-types";
import type { DesignProposalDiff } from "@/lib/design-first-api";

export type DesignDiffSection = "add" | "update" | "remove";

export type GroupedDesignDiff = {
  section: DesignDiffSection;
  label: string;
  items: string[];
};

const ERROR_MESSAGES: Record<string, string> = {
  ERR_DESIGN_REVISION_CONFLICT:
    "La revisión del diseño cambió en otro lugar; recargamos el estado. Vuelve a intentar tu cambio.",
  ERR_DESIGN_INVARIANT: "El diseño no cumple las invariantes requeridas.",
  ERR_DESIGN_SPEC_TOO_LARGE: "El diseño supera el tamaño máximo permitido.",
  ERR_DESIGN_SCREEN_REFERENCED: "No se puede eliminar la pantalla porque otras partes del diseño la referencian.",
  ERR_DESIGN_PHASE_GATE: "Completa las fases anteriores antes de continuar.",
  ERR_DESIGN_STALE: "El diseño cambió después de compilar el contrato; vuelve a compilar.",
  ERR_FIGMA_NOT_CONNECTED: "Conecta tu token personal de Figma en Ajustes → Cuenta antes de importar.",
  ERR_FIGMA_TOKEN_INVALID: "El token de Figma es inválido o expiró; vuelve a conectar tu cuenta en Ajustes.",
  ERR_DESIGN_PROPOSAL_EXPIRED: "La propuesta expiró; vuelve a importar.",
  ERR_DESIGN_PROPOSAL_NOT_FOUND: "La propuesta ya no está disponible.",
  ERR_DESIGN_EXTRACT_INVALID: "No se pudieron extraer pantallas válidas de las imágenes.",
};

export function formatDesignApiError(
  code: string | undefined,
  fallbackMessage: string,
  issues?: Array<{ path: string; message: string }>,
): string {
  if (issues?.length) {
    const head = issues
      .slice(0, 4)
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join(" · ");
    const suffix = issues.length > 4 ? ` (+${issues.length - 4} más)` : "";
    return `${fallbackMessage} ${head}${suffix}`.trim();
  }
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return fallbackMessage.trim() || "No se pudo completar la operación de diseño.";
}

export function groupProposalDiff(diff: DesignProposalDiff): GroupedDesignDiff[] {
  const sections: GroupedDesignDiff[] = [];
  const addScreens = diff.add.screens.map((s) => `Pantalla «${s.name || s.id}» (${s.route})`);
  const addNav = diff.add.navigation.map((n) => `Navegación ${n.from} → ${n.to}`);
  if (addScreens.length || addNav.length) {
    sections.push({ section: "add", label: "Añadir", items: [...addScreens, ...addNav] });
  }
  const updScreens = diff.update.screens.map((s) => `Actualizar «${s.name || s.id}»`);
  const updNav = diff.update.navigation.map((n) => `Actualizar navegación ${n.id}`);
  if (updScreens.length || updNav.length) {
    sections.push({ section: "update", label: "Actualizar", items: [...updScreens, ...updNav] });
  }
  const remItems = [
    ...diff.remove.screenIds.map((id) => `Eliminar pantalla «${id}»`),
    ...diff.remove.navigationIds.map((id) => `Eliminar navegación «${id}»`),
  ];
  if (remItems.length) {
    sections.push({ section: "remove", label: "Eliminar", items: remItems });
  }
  if (diff.dataNeeds?.length) {
    sections.push({
      section: "update",
      label: "Necesidades de datos",
      items: [`${diff.dataNeeds.length} entradas propuestas`],
    });
  }
  return sections;
}

export function countProposalDiffChanges(diff: DesignProposalDiff): number {
  return (
    diff.add.screens.length +
    diff.add.navigation.length +
    diff.update.screens.length +
    diff.update.navigation.length +
    diff.remove.screenIds.length +
    diff.remove.navigationIds.length +
    (diff.dataNeeds?.length ?? 0)
  );
}

export type DesignPhaseKey = "phase1" | "phase2" | "phase3";

export const DESIGN_PHASE_LABELS: Record<DesignPhaseKey, string> = {
  phase1: "Fase 1 — Pantallas",
  phase2: "Fase 2 — Datos",
  phase3: "Fase 3 — Contrato",
};

export function summarizeDesignPhaseGate(
  key: DesignPhaseKey,
  gates: DesignFirstPhaseGates | null | undefined,
): { ok: boolean; label: string; detail: string } {
  const gate = gates?.[key];
  const label = DESIGN_PHASE_LABELS[key];
  if (!gate) {
    return { ok: false, label, detail: "Sin datos de puerta" };
  }
  if (gate.ok) {
    return { ok: true, label, detail: "Completa" };
  }
  const first = gate.issues[0];
  const detail = first ? `${first.message}` : "Pendiente";
  return { ok: false, label, detail };
}
