import type { Estimation, Stage } from "@theforge/database";
import type { ProjectDeliverableSource } from "@theforge/shared-types";
import { flattenStageDeliverables } from "./stage-helpers.js";

type StageWithEst = Stage & { estimation: Estimation | null };

/**
 * Resumen ligero de `pluginData` para respuestas HTTP (p. ej. GET /projects/:id).
 * Evita serializar payloads pesados (EVD con base64); el cliente carga con
 * GET /plugins/projects/:id/plugin-data/:pluginId.
 */
export function summarizePluginDataPresence(
  pluginData: unknown,
): Record<string, true> | null {
  if (!pluginData || typeof pluginData !== "object") return null;
  const raw = pluginData as Record<string, unknown>;
  const out: Record<string, true> = {};
  for (const [pluginId, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (typeof value === "object" && Object.keys(value as object).length === 0) continue;
    out[pluginId] = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Proyecto completo aplanado para API (MDD/semáforo desde etapa principal). */
export function toApiProject<P extends { stages: StageWithEst[] } & Record<string, unknown>>(project: P) {
  const flat = flattenStageDeliverables(project.stages, project as ProjectDeliverableSource);
  const group = project.group as { name: string } | undefined;
  const { group: _g, ...rest } = project;
  return {
    ...rest,
    ...flat,
    groupId: project.groupId as string,
    groupName: group?.name,
  };
}
