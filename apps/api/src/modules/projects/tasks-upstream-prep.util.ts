/**
 * Preparación de insumos upstream antes de Tasks (normalización + acciones sugeridas/automáticas).
 */

import {
  CASCADE_ACCURACY_THRESHOLD,
  type DocAccuracyResult,
  detectWebSurfaces,
} from "@theforge/shared-types";
import { normalizeSpecMarkdown } from "./spec-content.util.js";

export type TasksUpstreamArtifact =
  | "mdd"
  | "spec"
  | "api_contracts"
  | "logic_flows"
  | "ui_screens";

export type TasksUpstreamAction = {
  artifact: TasksUpstreamArtifact;
  message: string;
  /** Reparable sin intervención manual (sync MCP, normalizar Spec, regenerar vacío). */
  autoRepairable: boolean;
};

export function prepareSpecMarkdownForTasks(specMarkdown: string | null | undefined): {
  normalized: string;
  changed: boolean;
} {
  const raw = (specMarkdown ?? "").trim();
  if (!raw) return { normalized: "", changed: false };
  const normalized = normalizeSpecMarkdown(raw).trim();
  return { normalized, changed: normalized !== raw };
}

/** Mapea gaps DocAccuracy a acciones upstream (tabla C del plan Tasks). */
export function deriveTasksUpstreamActions(
  doc: DocAccuracyResult,
  opts: {
    hasUxTeam?: boolean;
    mddMarkdown?: string | null;
    blueprintMarkdown?: string | null;
    specMarkdown?: string | null;
    apiContractsMarkdown?: string | null;
    logicFlowsMarkdown?: string | null;
    uiScreensMarkdown?: string | null;
    mddHasApiSection?: boolean;
  },
): TasksUpstreamAction[] {
  const actions: TasksUpstreamAction[] = [];
  const seen = new Set<TasksUpstreamArtifact>();
  const hasWebSurfaces = detectWebSurfaces(opts.mddMarkdown, opts.blueprintMarkdown);
  const uiScreensRequired = hasWebSurfaces || opts.hasUxTeam === true;

  const push = (action: TasksUpstreamAction) => {
    if (seen.has(action.artifact)) return;
    seen.add(action.artifact);
    actions.push(action);
  };

  const specPrep = prepareSpecMarkdownForTasks(opts.specMarkdown);
  if (specPrep.changed) {
    push({
      artifact: "spec",
      message: "Normalizar Spec (headings `## N.` vacíos → viñetas) para mejorar DocAccuracy C5.",
      autoRepairable: true,
    });
  }

  const gaps = doc.components.flatMap((c) => c.gaps);
  const gapText = gaps.join(" ").toLowerCase();

  if (
    gapText.includes("uiscreens ausente") ||
    (uiScreensRequired && !(opts.uiScreensMarkdown ?? "").trim())
  ) {
    push({
      artifact: "ui_screens",
      message: hasWebSurfaces
        ? "Sincronizar pantallas (W2b) — superficie web declarada en MDD/Blueprint."
        : "Sincronizar pantallas MCP (W2b) — proyecto con equipo UX.",
      autoRepairable: true,
    });
  }

  if (
    !(opts.apiContractsMarkdown ?? "").trim() &&
    opts.mddHasApiSection !== false &&
    (gapText.includes("api contracts ausente") ||
      gapText.includes("crud sin entidad") ||
      gapText.includes("capacidad sin ancla"))
  ) {
    push({
      artifact: "api_contracts",
      message: "Generar Contratos API (MDD §4 o gaps C1/C3).",
      autoRepairable: true,
    });
  }

  if (
    !(opts.logicFlowsMarkdown ?? "").trim() &&
    (gapText.includes("proceso crítico ausente") || gapText.includes("logic flows"))
  ) {
    push({
      artifact: "logic_flows",
      message: "Generar Logic Flows para procesos críticos del dominio (C2).",
      autoRepairable: true,
    });
  }

  if (
    gapText.includes("capacidad sin ancla") &&
    (opts.specMarkdown ?? "").trim().length < 120
  ) {
    push({
      artifact: "spec",
      message: "Regenerar Spec con capacidades del BRD ancladas (C1).",
      autoRepairable: false,
    });
  }

  if (doc.blockers.some((b) => /solo auth|auth-only|domain-auth/i.test(b))) {
    push({
      artifact: "mdd",
      message: "Ampliar MDD §3 con entidades de negocio (skew auth-only vs BRD).",
      autoRepairable: false,
    });
  }

  if (doc.score < CASCADE_ACCURACY_THRESHOLD && actions.length === 0) {
    push({
      artifact: "spec",
      message: `DocAccuracy ${doc.score}/${CASCADE_ACCURACY_THRESHOLD}: revisa Spec, API, flujos y pantallas.`,
      autoRepairable: false,
    });
  }

  return actions;
}

export function formatTasksUpstreamHints(actions: TasksUpstreamAction[]): string[] {
  return actions.map((a) => `${a.autoRepairable ? "[auto] " : ""}${a.message}`);
}
