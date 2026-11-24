/**
 * Context Anchors por Historia de Usuario (Pasos 2–3 del algoritmo Tasks).
 * Inyección focalizada: solo fragmentos asociados a cada HU.
 */

import type {
  DomainInventory,
  TasksContextAnchor,
  TasksContractManifest,
  TasksGenerationLayer,
  TasksGenerationPlan,
  TasksPlanItem,
} from "@theforge/shared-types";
import {
  matchBusinessRulesForStory,
  matchEndpointsForStory,
} from "./tasks-contract-layers.util.js";
import {
  flattenJourneyPartitions,
  partitionTasksPlanByJourney,
} from "./tasks-journey-partition.util.js";

function layerContract(manifest: TasksContractManifest, layer: "domain" | "architecture" | "experience" | "integration") {
  return manifest.layers.find((l) => l.layer === layer);
}

/** Paso 2: construye un Context Anchor por cada HU del manifiesto. */
export function buildTasksContextAnchors(manifest: TasksContractManifest): TasksContextAnchor[] {
  const domain = layerContract(manifest, "domain");
  const architecture = layerContract(manifest, "architecture");
  const experience = layerContract(manifest, "experience");
  const integration = layerContract(manifest, "integration");

  const stories = domain?.userStories ?? experience?.userStories ?? [];
  const screens = experience?.screens ?? [];
  const endpoints = integration?.endpoints ?? [];
  const glossary = domain?.glossary ?? [];
  const rules = domain?.businessRules ?? [];
  const tech = architecture?.techStack;

  return stories.map((story) => {
    const storyEndpoints = matchEndpointsForStory(story, screens, endpoints);
    const storyScreens = screens.filter((s) => s.userStoryId === story.id);
    const components = [
      ...new Set(storyScreens.flatMap((s) => s.components)),
    ];

    return {
      story_id: story.id,
      feature: story.title,
      business_rules: matchBusinessRulesForStory(story, rules, glossary),
      tech_stack: tech
        ? {
            framework: tech.framework,
            patterns: tech.patterns.join(" / ") || undefined,
          }
        : undefined,
      contracts: {
        endpoints: storyEndpoints.map((e) => `${e.method} ${e.path}`),
        ui_components: components,
        screens: storyScreens.map((s) => s.route),
      },
      acceptance_criteria: story.acceptanceCriteria,
    };
  });
}

/** Context anchors relevantes para ítems del plan (por storyRefs). */
export function selectContextAnchorsForPlanItems(
  anchors: TasksContextAnchor[],
  items: TasksPlanItem[],
): TasksContextAnchor[] {
  const storyIds = new Set<string>();
  for (const item of items) {
    for (const ref of item.storyRefs ?? []) {
      if (ref.trim()) storyIds.add(ref.trim());
    }
  }
  if (storyIds.size === 0) return anchors.slice(0, 3);
  return anchors.filter((a) => storyIds.has(a.story_id));
}

/** Serializa anchors como bloque JSON para el prompt del redactor. */
export function serializeTasksContextAnchors(anchors: TasksContextAnchor[]): string {
  if (anchors.length === 0) return "";
  return JSON.stringify(anchors, null, 2);
}

/** Agrupa ítems del plan por capa de generación map-reduce. */
export function partitionPlanItemsByGenerationLayer(
  items: TasksPlanItem[],
): Map<TasksGenerationLayer, TasksPlanItem[]> {
  const map = new Map<TasksGenerationLayer, TasksPlanItem[]>();
  for (const item of items) {
    const layer = normalizeGenerationLayer(item.layer);
    const bucket = map.get(layer) ?? [];
    bucket.push(item);
    map.set(layer, bucket);
  }
  return map;
}

function normalizeGenerationLayer(layer: string): TasksGenerationLayer {
  if (/^frontend$/i.test(layer)) return "Frontend";
  if (/^infra/i.test(layer)) return "Infra";
  if (/^qa$/i.test(layer)) return "QA";
  if (/integraci/i.test(layer)) return "Integración";
  return "Backend";
}

/** Orden canónico de secciones al mergear salidas map-reduce. */
export const TASKS_GENERATION_LAYER_ORDER: TasksGenerationLayer[] = [
  "Backend",
  "Frontend",
  "Infra",
  "Integración",
  "QA",
];

export type TasksRedactorSlice = {
  layer: TasksGenerationLayer;
  layerBatchIndex: number;
  layerBatchCount: number;
  items: TasksPlanItem[];
};

const LAYER_CANONICAL_HEADING: Record<TasksGenerationLayer, string> = {
  Backend: "Backend tasks",
  Frontend: "Frontend tasks",
  Infra: "Infraestructura tasks",
  Integración: "Integración tasks",
  QA: "QA tasks",
};

const LAYER_HEADING_REGEX: Record<TasksGenerationLayer, RegExp> = {
  Backend: /^##\s+Backend\s+tasks\b/im,
  Frontend: /^##\s+Frontend\s+tasks\b/im,
  Infra: /^##\s+Infra(?:estructura)?\s+tasks\b/im,
  Integración: /^##\s+Integraci[oó]n\s+tasks\b/im,
  QA: /^##\s+(?:QA|Testing)\s+tasks\b/im,
};

export function canonicalTasksLayerHeading(layer: TasksGenerationLayer): string {
  return LAYER_CANONICAL_HEADING[layer];
}

/**
 * Construye lotes planos (capa × batchSize) evitando la explosión multiplicativa journeys × capas.
 * Dentro de cada capa conserva la cercanía de ítems por journey/proceso cuando hay inventario.
 */
export function buildTasksRedactorSlices(
  plan: TasksGenerationPlan,
  batchSize: number,
  inventory?: DomainInventory | null,
): TasksRedactorSlice[] {
  const safeBatchSize = Math.max(1, Math.trunc(batchSize));
  const byLayer = partitionPlanItemsByGenerationLayer(plan.items);
  const slices: TasksRedactorSlice[] = [];

  for (const layer of TASKS_GENERATION_LAYER_ORDER) {
    const rawItems = byLayer.get(layer);
    if (!rawItems?.length) continue;

    let orderedItems = rawItems;
    if ((inventory?.processes?.length ?? 0) > 0) {
      const journeyOrdered = flattenJourneyPartitions(
        partitionTasksPlanByJourney({ sections: plan.sections, items: rawItems }, inventory),
      ).items;
      if (journeyOrdered.length === rawItems.length) {
        orderedItems = journeyOrdered;
      }
    }

    const layerBatchCount = Math.max(1, Math.ceil(orderedItems.length / safeBatchSize));
    for (let bi = 0; bi < layerBatchCount; bi += 1) {
      slices.push({
        layer,
        layerBatchIndex: bi,
        layerBatchCount,
        items: orderedItems.slice(bi * safeBatchSize, (bi + 1) * safeBatchSize),
      });
    }
  }

  return slices;
}

/** Normaliza encabezados de un lote map-reduce para concatenar un único tasks.md limpio. */
export function normalizeTasksRedactorSliceMarkdown(
  raw: string,
  slice: Pick<TasksRedactorSlice, "layer" | "layerBatchIndex">,
  globalIndex: number,
  isFirstChunk = true,
): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  const isDocStart = globalIndex === 0 && isFirstChunk;
  const heading = canonicalTasksLayerHeading(slice.layer);

  if (!isDocStart) {
    text = text.replace(/^#\s+Tasks[^\n]*\n+/im, "").trim();
  }

  if (slice.layerBatchIndex > 0) {
    text = text
      .replace(/^(?:>\s*[^\n]*\n+)+/, "")
      .replace(
        /^##\s+(?:Backend|Frontend|Infra(?:estructura)?|Integraci[oó]n|QA|Testing)\s+tasks[^\n]*\n+/im,
        "",
      )
      .trim();
    return text;
  }

  const hasLayerHeading = LAYER_HEADING_REGEX[slice.layer].test(text);
  if (isDocStart) {
    if (!/^#\s+Tasks\b/im.test(text)) {
      text = hasLayerHeading ? `# Tasks\n\n${text}` : `# Tasks\n\n## ${heading}\n\n${text}`;
    } else if (!hasLayerHeading) {
      text = text.replace(/^(#\s+Tasks[^\n]*)\n*/im, `$1\n\n## ${heading}\n\n`);
    }
    return text.trim();
  }

  if (!hasLayerHeading) {
    text = `## ${heading}\n\n${text}`;
  }
  return text.trim();
}
