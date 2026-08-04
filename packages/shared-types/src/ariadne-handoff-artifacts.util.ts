/**
 * Read, label and export Ariadne handoff artifacts persisted on Stage.handoffSnapshot.
 */
import type { IntegrationHandoffItem } from "./project-integration.js";

export const ARIADNE_HANDOFF_KIND_LABELS: Record<string, string> = {
  requirement: "Requisito",
  integration_scope: "Alcance integración",
  mdd_evidence: "MDD / evidencia as-is",
  modification_plan_enriched: "Plan de modificación (grafo)",
  change_plan_seed: "ChangePlan seed",
  tasks_json_seed: "Tasks JSON (SSOT)",
  change_work_description: "Descripción del trabajo",
  cursor_tasks_markdown: "Tareas Cursor (# Tasks)",
  er_diagram: "Diagrama ER",
  deliverable_request: "Entregable solicitado",
  post_deliverable_gate: "Gate 2 Ariadne",
};

export type AriadneHandoffArtifactKind =
  | keyof typeof ARIADNE_HANDOFF_KIND_LABELS
  | (string & {});

export function handoffItemKind(item: IntegrationHandoffItem): string {
  return (item as IntegrationHandoffItem & { kind?: string }).kind ?? "requirement";
}

/** Body text or JSON string from description, payload or legacy `content`. */
export function readHandoffItemBody(item: IntegrationHandoffItem): string {
  const row = item as IntegrationHandoffItem & { content?: unknown; payload?: unknown };
  if (typeof row.content === "string" && row.content.trim()) return row.content.trim();
  const payload = row.payload;
  if (payload != null) {
    if (typeof payload === "string") return payload.trim();
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }
  return item.description?.trim() ?? "";
}

export function handoffItemDownloadFilename(item: IntegrationHandoffItem): string {
  const kind = handoffItemKind(item);
  const id = item.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const body = readHandoffItemBody(item);
  const ext =
    kind === "cursor_tasks_markdown" || kind === "change_work_description"
      ? "md"
      : kind === "er_diagram"
        ? "mmd"
        : body.startsWith("{") || body.startsWith("[")
          ? "json"
          : "txt";
  return `${id}-${kind}.${ext}`;
}

export function handoffItemIsJsonBody(item: IntegrationHandoffItem): boolean {
  const body = readHandoffItemBody(item);
  return body.startsWith("{") || body.startsWith("[");
}

export function formatHandoffItemPreview(item: IntegrationHandoffItem, maxLen = 160): string {
  const body = readHandoffItemBody(item);
  if (!body) return "—";
  if (handoffItemIsJsonBody(item)) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.mode === "string") return `mode: ${parsed.mode}`;
      if (Array.isArray(parsed.tasks)) return `${parsed.tasks.length} task(s)`;
      if (Array.isArray(parsed.files)) return `${parsed.files.length} file(s) in plan`;
      return "JSON embebido";
    } catch {
      return body.slice(0, maxLen);
    }
  }
  return body.slice(0, maxLen) + (body.length > maxLen ? "…" : "");
}

/** Markdown corpus for agent governance when stage has no full MDD cascade yet. */
export function buildAriadneHandoffGovernanceCorpus(
  items: IntegrationHandoffItem[],
  changeDescription?: string | null,
): string {
  const parts: string[] = [];
  if (changeDescription?.trim()) {
    parts.push("## Cambio (Ariadne)", changeDescription.trim());
  }
  for (const item of items) {
    const kind = handoffItemKind(item);
    if (kind === "deliverable_request" || kind === "post_deliverable_gate") continue;
    const body = readHandoffItemBody(item);
    if (!body) continue;
    const label = ARIADNE_HANDOFF_KIND_LABELS[kind] ?? kind;
    parts.push(`## ${label} (${item.id})`, body);
  }
  return parts.join("\n\n").slice(0, 120_000);
}

export function listAriadneSeedHandoffItems(items: IntegrationHandoffItem[]): IntegrationHandoffItem[] {
  return items.filter((i) => handoffItemKind(i) !== "requirement");
}
