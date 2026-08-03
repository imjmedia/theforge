/**
 * Plan de Tasks determinista cuando el Tasks Planner LLM no devuelve JSON válido.
 * Genera un plan completo que escala con la complejidad del proyecto:
 * - Blueprint phases → tasks por fase
 * - API endpoints → tasks por endpoint
 * - Entidades MDD §3 → tasks por entidad
 * - Pantallas → tasks por ruta
 * - Infraestructura → tasks por servicio detectado
 */

import type { DomainInventory, TasksGenerationPlan, TasksPlanItem } from "@theforge/shared-types";
import { detectWebSurfaces, stableJourneyUserStoryId } from "@theforge/shared-types";
import { extractEntities } from "../engine/conformance.service.js";
import { extractSectionByNumber } from "../engine/mdd-markdown-parser.js";
import {
  extractHttpEndpointsFromMarkdown,
} from "../ui-mcp/api-contract-endpoints.util.js";
import { extractV1InScopePantallaRoutes } from "../ui-mcp/ui-screens-v1-scope.util.js";
import { extractPantallaRoutes } from "./tasks-generation-structure.util.js";

export type HeuristicTasksPlanInput = {
  mddMarkdown: string;
  apiContractsMarkdown?: string | null;
  uiScreensMarkdown?: string | null;
  inventory?: DomainInventory | null;
  hasUxTeam?: boolean;
  blueprintMarkdown?: string | null;
};

function nextTaskId(counter: { n: number }): string {
  counter.n += 1;
  return `T-${String(counter.n).padStart(3, "0")}`;
}

function filterPlannerRoutes(routes: string[]): string[] {
  return routes.filter(
    (r) =>
      !/\/admin\/proc-cap/i.test(r) &&
      !/^\/gestion-/i.test(r) &&
      r.length >= 2,
  );
}

/** Extract phase/roadmap headings from blueprint markdown. */
function extractBlueprintPhases(blueprint: string): string[] {
  const phaseRegex = /^##\s+(?:(?:Fase|Phase|Roadmap|Milestone|Sprint|Hitos|Etapa)\s+(\d+)[^\n]*)/gim;
  const phases: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = phaseRegex.exec(blueprint)) !== null) {
    phases.push(m[0]!.replace(/^##\s+/, "").trim());
  }
  return phases;
}

/** Construye un plan que escala con la complejidad del proyecto. */
export function buildHeuristicTasksPlan(input: HeuristicTasksPlanInput): TasksGenerationPlan {
  const counter = { n: 0 };
  const items: TasksPlanItem[] = [];
  const sections = new Set<string>(["Backend", "Infra", "QA"]);

  // --- Blueprint phases → tasks por fase ---
  const blueprint = (input.blueprintMarkdown ?? "").trim();
  const phases = extractBlueprintPhases(blueprint);
  if (phases.length > 1) {
    for (const phase of phases) {
      items.push({
        id: nextTaskId(counter),
        title: `Implementar ${phase}`,
        layer: "Backend",
        mddRefs: [],
        storyRefs: [],
        upstreamRefs: [`blueprint:${phase}`],
        dependsOn: items.length > 0 ? [items[items.length - 1]!.id] : [],
        targetFilesHint: [],
      });
    }
  }

  // --- API endpoints → tasks por endpoint ---
  // Try apiContractsMarkdown first, then fall back to raw MDD §4 section
  let endpoints = extractHttpEndpointsFromMarkdown(input.apiContractsMarkdown ?? "");
  if (endpoints.length === 0) {
    const section4 = extractSectionByNumber(input.mddMarkdown ?? "", 4);
    if (section4) {
      endpoints = extractHttpEndpointsFromMarkdown(section4);
      // eslint-disable-next-line no-console
      if (endpoints.length > 0) console.log(`[heuristic] ${endpoints.length} endpoints extraídos de MDD §4 raw (apiContractsMarkdown vacío)`);
    }
  }
  for (const ep of endpoints) {
    items.push({
      id: nextTaskId(counter),
      title: `Implementar endpoint ${ep.method} ${ep.path}`,
      layer: "Backend",
      mddRefs: [`§4 ${ep.path}`],
      storyRefs: [],
      upstreamRefs: [`api-contracts:${ep.method} ${ep.path}`],
      dependsOn: [],
      targetFilesHint: [
        `apps/api/src/modules/${ep.path.split("/").filter(Boolean).pop()?.replace(/-/g, "_") ?? "domain"}/`,
      ],
    });
  }

  // --- Entidades MDD §3 → tasks por entidad ---
  // Always generate entity tasks, even when endpoints exist (broken §4 may yield few endpoints)
  const mddEntities = extractEntities(
    extractSectionByNumber(input.mddMarkdown ?? "", 3) || input.mddMarkdown || "",
  );
  if (mddEntities.size > 0) {
    for (const entity of [...mddEntities]) {
      // Skip if an endpoint task already covers this entity
      if (endpoints.length > 0 && endpoints.some((ep) => ep.path.toLowerCase().includes(entity.toLowerCase()))) continue;
      items.push({
        id: nextTaskId(counter),
        title: `Modelo y persistencia ${entity} (MDD §3)`,
        layer: "Backend",
        mddRefs: [`§3 ${entity}`],
        storyRefs: [],
        upstreamRefs: [`mdd:entity:${entity}`],
        dependsOn: [],
        targetFilesHint: [`apps/api/src/modules/${entity.replace(/_/g, "-")}/`],
      });
    }
  }

  // --- Journey / process inventory → phased tasks por US-JRN ---
  for (const proc of input.inventory?.processes ?? []) {
    const usId = proc.usId ?? stableJourneyUserStoryId(proc.id);
    items.push({
      id: nextTaskId(counter),
      title: `Journey: ${proc.name}`,
      layer: "Backend",
      mddRefs: proc.brdCapabilityIds.map((id) => `BRD ${id}`),
      storyRefs: [usId],
      upstreamRefs: [`journey:${proc.id}`],
      dependsOn: items.length > 0 ? [items[items.length - 1]!.id] : [],
      targetFilesHint: [`apps/api/src/modules/${proc.id.replace(/^proc-/, "")}/`],
    });
  }

  // --- Capabilidades del inventario → tasks por capacidad ---
  for (const cap of input.inventory?.capabilities.filter((c) => !c.isAuthRelated) ?? []) {
    if (items.some((i) => i.title.toLowerCase().includes(cap.title.toLowerCase().slice(0, 24)))) continue;
    items.push({
      id: nextTaskId(counter),
      title: `Implementar capacidad: ${cap.title}`,
      layer: "Backend",
      mddRefs: [cap.title],
      storyRefs: [],
      upstreamRefs: [`brd:${cap.id}`],
      dependsOn: [],
      targetFilesHint: [],
    });
  }

  // --- Pantallas v1 con API → mínimo 1 task Frontend por ruta ---
  const uiMd = input.uiScreensMarkdown ?? "";
  const rawRoutes =
    uiMd.trim().length > 0
      ? extractV1InScopePantallaRoutes(uiMd)
      : extractPantallaRoutes(uiMd);
  const routes = filterPlannerRoutes(rawRoutes);
  const hasWebSurfaces = detectWebSurfaces(input.mddMarkdown, input.blueprintMarkdown);
  if (routes.length > 0 || input.hasUxTeam || hasWebSurfaces) {
    sections.add("Frontend");
    const routesToCover =
      routes.length > 0
        ? routes
        : hasWebSurfaces
          ? ["/"]
          : [];
    for (const route of routesToCover) {
      items.push({
        id: nextTaskId(counter),
        title: `Implementar pantalla ${route}`,
        layer: "Frontend",
        mddRefs: ["§2 Frontend"],
        storyRefs: [],
        upstreamRefs: [`pantallas:${route}`],
        dependsOn: [],
        targetFilesHint: [`apps/web/src/views/`],
      });
    }
  }

  // --- T-002 Prisma: una task por entidad MDD §3 (cardinalidad modelo) ---
  if (mddEntities.size > 0) {
    for (const entity of [...mddEntities]) {
      if (items.some((i) => i.upstreamRefs?.includes(`prisma:${entity}`))) continue;
      items.push({
        id: nextTaskId(counter),
        title: `T-002 — Modelo Prisma ${entity} (MDD §3)`,
        layer: "Backend",
        mddRefs: [`§3 ${entity}`],
        storyRefs: [],
        upstreamRefs: [`prisma:${entity}`],
        dependsOn: [],
        targetFilesHint: [`packages/database/schema.prisma`],
      });
    }
  }

  // --- Infraestructura → tasks por servicio detectado ---
  const mddText = input.mddMarkdown ?? "";
  const infraServices: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /docker|dockerfile|docker-compose/i, label: "Docker/Dockerfile" },
    { pattern: /dokploy/i, label: "Dokploy" },
    { pattern: /redis/i, label: "Redis" },
    { pattern: /rabbitmq|rabbit/i, label: "RabbitMQ" },
    { pattern: /postgres|postgresql/i, label: "PostgreSQL" },
    { pattern: /mysql|mariadb/i, label: "MySQL/MariaDB" },
    { pattern: /mongo|mongodb/i, label: "MongoDB" },
    { pattern: /nginx/i, label: "Nginx" },
    { pattern: /traefik/i, label: "Traefik" },
    { pattern: /kubernetes|k8s|helm/i, label: "Kubernetes" },
  ];
  for (const svc of infraServices) {
    if (svc.pattern.test(mddText) || svc.pattern.test(blueprint)) {
      if (items.some((i) => i.title.toLowerCase().includes(svc.label.toLowerCase()))) continue;
      items.push({
        id: nextTaskId(counter),
        title: `Configurar ${svc.label} (MDD §7)`,
        layer: "Infra",
        mddRefs: ["§7 Infraestructura"],
        storyRefs: [],
        upstreamRefs: [`mdd:§7:${svc.label}`],
        dependsOn: items.length > 0 ? [items[0]!.id] : [],
        targetFilesHint: [`docker-compose.yml`, `${svc.label.toLowerCase()}/`],
      });
    }
  }

  // --- QA/E2E ---
  items.push({
    id: nextTaskId(counter),
    title: "Smoke tests E2E del MVP",
    layer: "QA",
    mddRefs: ["§5 Lógica"],
    storyRefs: [],
    upstreamRefs: ["spec:criterios-exito"],
    dependsOn: items.length > 1 ? [items[items.length - 2]!.id] : [],
    targetFilesHint: ["apps/api/test/"],
  });

  // --- Fallback si no se generó nada ---
  if (items.length === 0) {
    items.push({
      id: nextTaskId(counter),
      title: "Implementar MVP según MDD §1–§7",
      layer: "Backend",
      mddRefs: ["§1 Contexto"],
      storyRefs: [],
      upstreamRefs: ["mdd"],
      dependsOn: [],
      targetFilesHint: ["apps/api/src/"],
    });
  }

  return {
    sections: [...sections],
    items,
  };
}
