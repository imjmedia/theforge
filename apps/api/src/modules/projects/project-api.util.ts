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

/**
 * Quita el fence interno del MDD (ADR 0004) de una etapa: es un detalle de escritura, no un campo de la API.
 * Además evita serializar un `BigInt` en las respuestas.
 */
export function omitMddLeaseFence<S extends { mddLeaseFence?: unknown }>(stage: S): S {
  const { mddLeaseFence: _fence, ...stageRest } = stage;
  // El tipo conserva la forma de Stage para los consumidores internos (no leen el fence); en runtime el campo ya no está.
  return stageRest as S;
}

/**
 * Proyecto completo aplanado para API (MDD/semáforo desde etapa principal).
 *
 * `convergeWebhookSecret` es un secreto del dueño: solo viaja con `isOwner: true`. Un lector SHARED ajeno
 * recibe `null` (por defecto), nunca el valor; la clave se conserva para no cambiar el tipo del DTO que
 * consumen los servicios internos.
 */
export function toApiProject<P extends { stages: StageWithEst[] } & Record<string, unknown>>(
  project: P,
  options: { isOwner?: boolean } = {},
) {
  const flat = flattenStageDeliverables(project.stages, project as ProjectDeliverableSource);
  const group = project.group as { name: string } | undefined;
  const { group: _g, stages, ...rest } = project;
  return {
    ...rest,
    stages: stages.map(omitMddLeaseFence),
    ...(options.isOwner === true ? {} : { convergeWebhookSecret: null }),
    ...flat,
    groupId: project.groupId as string,
    groupName: group?.name,
  };
}
