/**
 * Matriz de contexto mínimo por tipo de task (map-reduce segmentado).
 * Cada prompt recibe solo los contratos estrictamente necesarios.
 */

import type {
  TasksContractManifest,
  TasksContextAnchor,
  TasksGenerationLayer,
} from "@theforge/shared-types";
import { detectWebSurfaces } from "@theforge/shared-types";
import { extractSectionByNumber } from "../engine/mdd-markdown-parser.js";
import {
  extractHttpEndpointsFromMarkdown,
  formatEndpointList,
} from "../ui-mcp/api-contract-endpoints.util.js";
import { serializeTasksContractManifest } from "./tasks-contract-layers.util.js";
import { serializeTasksContextAnchors } from "./tasks-context-anchor.util.js";

export type TasksLayerContextInput = {
  manifest: TasksContractManifest;
  layer: TasksGenerationLayer;
  anchors?: TasksContextAnchor[];
  /** Extractos mínimos cuando el contrato no cubre un fragmento (fallback acotado). */
  mddMarkdown?: string;
  specMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  blueprintMarkdown?: string | null;
  infraMarkdown?: string | null;
  agentGovernanceMarkdown?: string | null;
  uxUiGuideMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  logicFlowsMarkdown?: string | null;
  useCasesMarkdown?: string | null;
  userStoriesMarkdown?: string | null;
  architectureMarkdown?: string | null;
};

function layerSlice(manifest: TasksContractManifest, name: "domain" | "architecture" | "experience" | "integration") {
  return manifest.layers.find((l) => l.layer === name);
}

function capMarkdown(label: string, content: string | null | undefined, cap: number): string {
  const t = (content ?? "").trim();
  if (!t) return "";
  return `\n\n${label}:\n---\n${t.slice(0, cap)}\n---`;
}

/** Documentos estrictamente necesarios por capa (matriz del diseño). */
const LAYER_CONTRACT_LAYERS: Record<TasksGenerationLayer, Array<"domain" | "architecture" | "experience" | "integration">> = {
  Backend: ["domain", "architecture", "integration"],
  Frontend: ["domain", "experience"],
  Infra: ["architecture"],
  QA: ["domain", "experience"],
  Integración: ["domain", "integration"],
};

/** Extractos markdown de respaldo acotados por capa. */
function layerFallbackExtracts(input: TasksLayerContextInput): string {
  const parts: string[] = [];
  switch (input.layer) {
    case "Backend":
      parts.push(capMarkdown("MDD §3 Modelo (extracto)", extractSectionByNumber(input.mddMarkdown ?? "", 3), 6_000));
      parts.push(capMarkdown("MDD §4 API (extracto)", extractSectionByNumber(input.mddMarkdown ?? "", 4), 4_000));
      parts.push(capMarkdown("Spec (invariantes)", input.specMarkdown, 4_000));
      if ((layerSlice(input.manifest, "integration")?.endpoints.length ?? 0) === 0) {
        parts.push(capMarkdown("API Contracts (fallback)", input.apiContractsMarkdown, 8_000));
      }
      break;
    case "Frontend":
      parts.push(capMarkdown("User Stories (HU focal)", input.userStoriesMarkdown, 6_000));
      parts.push(capMarkdown("Pantallas (fallback)", input.uiScreensMarkdown, 6_000));
      parts.push(capMarkdown("Design System (fallback)", input.uxUiGuideMarkdown, 4_000));
      parts.push(capMarkdown("Flujos (extracto)", input.logicFlowsMarkdown, 4_000));
      break;
    case "Infra":
      parts.push(capMarkdown("Blueprint (fases)", input.blueprintMarkdown, 8_000));
      parts.push(capMarkdown("Infra", input.infraMarkdown, 6_000));
      parts.push(capMarkdown("Gobernanza IA", input.agentGovernanceMarkdown, 4_000));
      parts.push(capMarkdown("MDD §7", extractSectionByNumber(input.mddMarkdown ?? "", 7), 4_000));
      break;
    case "QA":
      parts.push(capMarkdown("Casos de uso", input.useCasesMarkdown, 6_000));
      parts.push(capMarkdown("Flujos", input.logicFlowsMarkdown, 6_000));
      parts.push(capMarkdown("User Stories", input.userStoriesMarkdown, 4_000));
      break;
    case "Integración":
      parts.push(capMarkdown("Spec", input.specMarkdown, 4_000));
      parts.push(capMarkdown("API Contracts (fallback)", input.apiContractsMarkdown, 6_000));
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join("");
}

/** Construye manifiesto reducido solo con capas relevantes para el prompt. */
export function buildReducedManifestForLayer(
  manifest: TasksContractManifest,
  layer: TasksGenerationLayer,
): TasksContractManifest {
  const allowed = new Set(LAYER_CONTRACT_LAYERS[layer]);
  return {
    ...manifest,
    layers: manifest.layers.filter((l) => allowed.has(l.layer)),
  };
}

/**
 * Contexto mínimo para un prompt map-reduce (Backend / Frontend / Infra / QA / Integración).
 */
export function buildTasksLayerPromptContext(input: TasksLayerContextInput): string {
  const reduced = buildReducedManifestForLayer(input.manifest, input.layer);
  const parts: string[] = [
    `Genera tasks de capa **${input.layer}** usando SOLO el manifiesto de contratos y context anchors.`,
    "No repitas documentos completos; deriva tareas accionables del JSON.",
    "\n\n## Manifiesto de contratos (reducido)\n---\n",
    serializeTasksContractManifest(reduced),
    "\n---",
  ];

  if (input.anchors && input.anchors.length > 0) {
    parts.push(
      "\n\n## Context Anchors (HU focalizadas)\n---\n",
      serializeTasksContextAnchors(input.anchors),
      "\n---",
    );
  }

  const integration = layerSlice(reduced, "integration");
  const experience = layerSlice(reduced, "experience");
  const architecture = layerSlice(reduced, "architecture");

  if (input.layer === "Backend" && (integration?.endpoints.length ?? 0) > 0) {
    parts.push(
      "\n\nEndpoints clave:\n",
      formatEndpointList(
        integration!.endpoints.map((e) => ({ method: e.method, path: e.path })),
        40,
      ),
    );
  }

  if (input.layer === "Frontend" && (experience?.screens.length ?? 0) > 0) {
    parts.push("\n\nPantallas v1:\n");
    for (const s of experience!.screens.slice(0, 24)) {
      parts.push(`- ${s.route} (${s.name ?? "?"}) US=${s.userStoryId ?? "?"} API=${s.primaryApi ?? "?"}`);
    }
  }

  const webSurfaces = detectWebSurfaces(input.mddMarkdown, input.blueprintMarkdown);
  if (input.layer === "Frontend" && webSurfaces) {
    parts.push(
      "\n\n**Obligatorio Frontend:** incluir `Surface:`, `Responsive:`, referencias a design-system.md + pantallas.md, y target_files bajo `apps/web/`.",
    );
  }

  if (input.layer === "Infra" && architecture?.infraServices?.length) {
    parts.push("\n\nServicios infra:", architecture.infraServices.join(", "));
  }

  if (input.layer === "Integración" && integration?.externalServices?.length) {
    parts.push("\n\nServicios externos:", integration.externalServices.join(", "));
  }

  parts.push(layerFallbackExtracts(input));

  return parts.join("");
}

/** Contexto compacto para Tasks Planner (sustituye dump masivo). */
export function buildTasksPlannerContractContext(input: {
  manifest: TasksContractManifest;
  mddMarkdown: string;
  blueprintMarkdown?: string | null;
}): string {
  const domain = layerContract(input.manifest, "domain");
  const architecture = layerContract(input.manifest, "architecture");
  const experience = layerContract(input.manifest, "experience");
  const integration = layerContract(input.manifest, "integration");

  const parts: string[] = [
    "Genera el plan JSON de Tasks desde el **manifiesto de contratos** (no documentos completos).",
    "Cobertura: endpoints listados, pantallas v1, entidades del glosario, servicios infra.",
    "\n\nManifiesto:\n---\n",
    serializeTasksContractManifest(input.manifest),
    "\n---",
  ];

  if ((domain?.glossary.length ?? 0) > 0) {
    parts.push("\n\nGlosario:", domain!.glossary.slice(0, 20).map((g) => g.term).join(", "));
  }
  if ((integration?.endpoints.length ?? 0) > 0) {
    parts.push(
      "\n\nEndpoints:",
      formatEndpointList(integration!.endpoints.map((e) => ({ method: e.method, path: e.path })), 60),
    );
  }
  if ((experience?.screens.length ?? 0) > 0) {
    parts.push("\n\nPantallas:", experience!.screens.map((s) => s.route).join(", "));
  }
  if ((architecture?.infraServices.length ?? 0) > 0) {
    parts.push("\n\nInfra:", architecture!.infraServices.join(", "));
  }

  parts.push(
    capMarkdown("MDD §1 (solo contexto MVP)", extractSectionByNumber(input.mddMarkdown, 1), 4_000),
  );
  parts.push(capMarkdown("Blueprint (roadmap/fases)", input.blueprintMarkdown, 12_000));

  return parts.join("");
}

function layerContract(
  manifest: TasksContractManifest,
  layer: "domain" | "architecture" | "experience" | "integration",
) {
  return manifest.layers.find((l) => l.layer === layer);
}

/** Resumen ultra-compacto de endpoints cuando api-contracts no está en el manifiesto. */
export function summarizeApiContractsFallback(apiMarkdown: string | null | undefined, max = 30): string {
  const eps = extractHttpEndpointsFromMarkdown(apiMarkdown ?? "");
  return formatEndpointList(eps, max);
}
