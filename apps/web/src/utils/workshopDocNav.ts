/**
 * Document tabs shown in Workshop (toolbar) and global sidebar when a project is open.
 * Keeps visibility rules in sync with `WorkshopView` / `isTabVisibleForComplexity`.
 */
import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Bot,
  ClipboardList,
  Edit3,
  FileCode,
  FileText,
  FileWarning,
  GitBranch,
  LayoutTemplate,
  Link2,
  ListOrdered,
  ListTodo,
  MonitorSmartphone,
  Package,
  Palette,
  Presentation,
  ScrollText,
  Server,
  Target,
} from "lucide-react";
import type { ArtifactTypeDefinition } from "@theforge/shared-types";
import { agentGovernanceScaffoldHasContent, detectWebSurfaces } from "@theforge/shared-types";
import { isTabVisibleForComplexity, type ProjectTypeForTabs, type WorkshopDocTab } from "./complexityTabs";

/** Greenfield (NEW) steps required before generating downstream deliverables. */
export const WORKSHOP_MANDATORY_NEW_PROJECT_STEP_IDS = ["benchmark", "brd", "mdd"] as const;

export type WorkshopMandatoryNewProjectStepId =
  (typeof WORKSHOP_MANDATORY_NEW_PROJECT_STEP_IDS)[number];

/** Central panels for agent activity (sidebar nav + workshop workspace). */
export const WORKSHOP_AGENT_PENDING_CHANGES_PANEL = "agent-pending-changes" as const;
export const WORKSHOP_AGENT_SESSION_LOG_PANEL = "agent-session-log" as const;

/** Prefijo para IDs de paneles generados por plugins. */
const PLUGIN_PANEL_PREFIX = "plugin:";

/** Mapa de nombres de icono Lucide a componentes. */
const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  Presentation,
  FileCode,
  FileText,
  FileWarning,
  GitBranch,
  LayoutTemplate,
  Bot,
  Palette,
  Server,
  Target,
  ListOrdered,
  ListTodo,
  Package,
  ClipboardList,
  Edit3,
  MonitorSmartphone,
  Brain,
  Link2,
  ScrollText,
};

export function isPluginPanel(panelId: string): boolean {
  return panelId.startsWith(PLUGIN_PANEL_PREFIX);
}

export function pluginPanelId(pluginId: string, artifactId: string): string {
  return `${PLUGIN_PANEL_PREFIX}${pluginId}/${artifactId}`;
}

export function parsePluginPanelId(panelId: string): { pluginId: string; artifactId: string } | null {
  if (!panelId.startsWith(PLUGIN_PANEL_PREFIX)) return null;
  const rest = panelId.slice(PLUGIN_PANEL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { pluginId: rest.slice(0, slash), artifactId: rest.slice(slash + 1) };
}

/** Construye nav items dinámicos desde los artifact types registrados por plugins. */
export function buildPluginDocNavItems(ctx: WorkshopDocNavBuildContext): WorkshopDocNavItem[] {
  if (!ctx.pluginArtifactTypes?.length) return [];
  const items: WorkshopDocNavItem[] = [];
  for (const artifact of ctx.pluginArtifactTypes) {
    if (!artifact.showInSidebar) continue;
    const Icon = LUCIDE_ICON_MAP[artifact.icon ?? ""] ?? FileText;
    const content = ctx.pluginData?.[artifact.pluginId] ?? null;
    items.push({
      id: pluginPanelId(artifact.pluginId, artifact.id),
      label: artifact.label,
      title: artifact.label,
      Icon,
      content,
    });
  }
  return items;
}

export type WorkshopAgentActivityPanelId =
  | typeof WORKSHOP_AGENT_PENDING_CHANGES_PANEL
  | typeof WORKSHOP_AGENT_SESSION_LOG_PANEL;

export function isWorkshopAgentActivityPanel(panel: string): panel is WorkshopAgentActivityPanelId {
  return (
    panel === WORKSHOP_AGENT_PENDING_CHANGES_PANEL || panel === WORKSHOP_AGENT_SESSION_LOG_PANEL
  );
}

export function buildWorkshopAgentActivityNavItems(): WorkshopDocNavItem[] {
  return [
    {
      id: WORKSHOP_AGENT_PENDING_CHANGES_PANEL,
      label: "Cambios pendientes",
      title: "Cambios de documentación pendientes de aprobación humana (HITL)",
      Icon: FileWarning,
      content: null,
    },
    {
      id: WORKSHOP_AGENT_SESSION_LOG_PANEL,
      label: "Log de sesión",
      title: "Timeline de sesión agéntica (gaps MCP y reconciliaciones)",
      Icon: ScrollText,
      content: null,
    },
  ];
}

export function isWorkshopMandatoryDeliverableStep(
  id: string,
  opts: { isLegacyProject: boolean },
): boolean {
  if (opts.isLegacyProject) return false;
  return (WORKSHOP_MANDATORY_NEW_PROJECT_STEP_IDS as readonly string[]).includes(id);
}

export interface WorkshopDocNavItem {
  id: string;
  label: string;
  title: string;
  Icon: LucideIcon;
  content: unknown;
  /** Required before other deliverables can be generated (Paso 0 → BRD → MDD). */
  required?: boolean;
}

export interface WorkshopDocNavBuildContext {
  isLegacyProject: boolean;
  /** Etapa activa (1 = AS-IS, ≥2 = modificación). */
  legacyStageOrdinal?: number;
  effectiveComplexityForTabs: "LOW" | "MEDIUM" | "HIGH";
  activeLegacyState: { description?: string; codebaseDoc?: string } | null | undefined;
  activeWorkshopStage: { brdContent?: string | null } | null | undefined;
  phase0SummaryContent: string | null | undefined;
  dbgaContent: string | null | undefined;
  mddContent: string | null | undefined;
  specContent: string | null | undefined;
  architectureContent: string | null | undefined;
  useCasesContent: string | null | undefined;
  userStoriesContent: string | null | undefined;
  blueprintContent: string | null | undefined;
  uxUiGuideContent: string | null | undefined;
  aemContent: string | null | undefined;
  apiContractsContent: string | null | undefined;
  logicFlowsContent: string | null | undefined;
  tasksContent: string | null | undefined;
  agentGovernanceContent: string | null | undefined;
  infraContent: string | null | undefined;
  adrs: unknown[] | null | undefined;
  /** Deliverable "Pantallas" (texto) generado vía MCP gráfico. */
  uiScreensContent: string | null | undefined;
  /** Hay un MCP gráfico compatible activo (una de las señales para mostrar «Pantallas»). */
  uiMcpActive: boolean;
  /** Tipos de artifact registrados por plugins (para paneles dinámicos). */
  pluginArtifactTypes?: ArtifactTypeDefinition[];
  /** Data de plugins por proyecto: { [pluginId]: data }. */
  pluginData?: Record<string, unknown>;
}

export function workshopTabDocHasContent(tabId: string, content: unknown): boolean {
  if (tabId === "adrs") return Array.isArray(content) && content.length > 0;
  if (tabId === "agent-governance") return agentGovernanceScaffoldHasContent(content as string | null);
  return !!String(content ?? "").trim();
}

/** Pantallas tab: MCP activo, contenido persistido o superficies web en MDD/Blueprint. */
export function shouldShowUiScreensTab(ctx: WorkshopDocNavBuildContext): boolean {
  if (ctx.uiMcpActive) return true;
  if (!!(ctx.uiScreensContent ?? "").trim()) return true;
  return detectWebSurfaces(ctx.mddContent, ctx.blueprintContent);
}

function agentGovernanceNavItem(ctx: WorkshopDocNavBuildContext): WorkshopDocNavItem {
  return {
    id: "agent-governance",
    label: "Gobernanza IA",
    title: "Scaffold AGENTS.md + .cursor/** para agentes implementadores",
    Icon: Bot,
    content: ctx.agentGovernanceContent,
  };
}

export function buildWorkshopDocNavItems(ctx: WorkshopDocNavBuildContext): WorkshopDocNavItem[] {
  const tabPt: ProjectTypeForTabs = ctx.isLegacyProject ? "LEGACY" : "NEW";
  const tabOpts = { projectType: tabPt, legacyStageOrdinal: ctx.legacyStageOrdinal };
  const visible = (id: WorkshopDocTab) =>
    isTabVisibleForComplexity(id, ctx.effectiveComplexityForTabs, tabOpts);
  const items: WorkshopDocNavItem[] = [];

  if (ctx.isLegacyProject) {
    items.push({
      id: "legacy",
      label: "Modificación",
      title: "Describir modificación → AriadneSpecs → MDD → entregables",
      Icon: Edit3,
      content: ctx.activeLegacyState?.description ?? "",
    });
    if (visible("mdd-inicial")) {
      items.push({
        id: "mdd-inicial",
        label: "MDD Inicial",
        title: "Documentación de partida del codebase (AriadneSpecs)",
        Icon: FileText,
        content: ctx.activeLegacyState?.codebaseDoc ?? "",
      });
    }
  } else {
    items.push({
      id: "benchmark",
      label: "Paso 0",
      title: "Benchmark & Gap Analysis (Paso 0) — obligatorio para generar el resto de entregables",
      Icon: Target,
      content: (ctx.phase0SummaryContent || "") + (ctx.dbgaContent || ""),
      required: true,
    });
  }

  // WORKSHOP DOC NAV— keep only BRD tab
  if (visible("brd")) {
    items.push({
      id: "brd",
      label: "BRD",
      title: "BRD por etapa — obligatorio antes de MDD y entregables posteriores",
      Icon: ClipboardList,
      content: ctx.activeWorkshopStage?.brdContent,
      required: !ctx.isLegacyProject,
    });
  }
  if (visible("mdd")) {
    items.push({
      id: "mdd",
      label: "MDD",
      title: "Constitución del proyecto — obligatorio para Spec, Blueprint, API e Infra",
      Icon: FileText,
      content: ctx.mddContent,
      required: !ctx.isLegacyProject,
    });
  }
  if (visible("spec")) {
    items.push({
      id: "spec",
      label: "Spec",
      title: "Spec (SDD: what/why); alimenta el MDD",
      Icon: ListOrdered,
      content: ctx.specContent,
    });
  }
  if (visible("architecture")) {
    items.push({
      id: "architecture",
      label: "Arq.",
      title: "Arquitectura",
      Icon: GitBranch,
      content: ctx.architectureContent,
    });
  }
  if (visible("use-cases")) {
    items.push({
      id: "use-cases",
      label: "Casos",
      title: "Casos de uso",
      Icon: ListOrdered,
      content: ctx.useCasesContent,
    });
  }
  if (visible("user-stories")) {
    items.push({
      id: "user-stories",
      label: "H.U.",
      title: "Historias de usuario",
      Icon: Package,
      content: ctx.userStoriesContent,
    });
  }
  if (visible("blueprint")) {
    items.push({
      id: "blueprint",
      label: "Blueprint",
      title: "Blueprint",
      Icon: LayoutTemplate,
      content: ctx.blueprintContent,
    });
  }
  if (visible("ux-ui-guide")) {
    items.push({
      id: "ux-ui-guide",
      label: "Design System",
      title: "Design System (DESIGN.md)",
      Icon: Palette,
      content: ctx.uxUiGuideContent,
    });
  }
  // Pantallas: MCP activo, contenido ya generado o proyecto con superficie web (heurística / W2b).
  if (shouldShowUiScreensTab(ctx)) {
    items.push({
      id: "ui-screens",
      label: "Pantallas",
      title: "Pantallas / UI Screens Spec — rutas, componentes y binding a API",
      Icon: MonitorSmartphone,
      content: ctx.uiScreensContent,
    });
  }
  if (visible("api-contracts")) {
    items.push({
      id: "api-contracts",
      label: "API",
      title: "Contratos de API",
      Icon: FileCode,
      content: ctx.apiContractsContent,
    });
  }
  if (visible("logic-flows")) {
    items.push({
      id: "logic-flows",
      label: "Flujos",
      title: "Flujos lógicos",
      Icon: GitBranch,
      content: ctx.logicFlowsContent,
    });
  }
  const agentGovBeforeTasks = ctx.effectiveComplexityForTabs !== "LOW";
  if (visible("agent-governance") && agentGovBeforeTasks) {
    items.push(agentGovernanceNavItem(ctx));
  }
  if (visible("tasks")) {
    items.push({
      id: "tasks",
      label: "Tasks",
      title: "Tasks (breakdown desde MDD + Blueprint)",
      Icon: ListTodo,
      content: ctx.tasksContent,
    });
  }
  if (visible("agent-governance") && !agentGovBeforeTasks) {
    items.push(agentGovernanceNavItem(ctx));
  }
  if (visible("infra")) {
    items.push({
      id: "infra",
      label: "Infra",
      title: "Infraestructura",
      Icon: Server,
      content: ctx.infraContent,
    });
  }

  // Supplementary panels — always listed after core deliverables.
  if (visible("integration")) {
    items.push({
      id: "integration",
      label: "Integración",
      title: "Handoff NEW ↔ LEGACY y trazabilidad",
      Icon: Link2,
      content: "integration-panel",
    });
  }
  if (!ctx.isLegacyProject && visible("adrs")) {
    items.push({
      id: "adrs",
      label: "ADRs",
      title: "ADRs: Decisiones Arquitectónicas Guardadas en Memoria",
      Icon: Brain,
      content: ctx.adrs,
    });
  }
  if (visible("aem")) {
    items.push({
      id: "aem",
      label: "AEM",
      title: "Análisis y Estudio de Mercado (AEM)",
      Icon: FileText,
      content: ctx.aemContent,
    });
  }

  return items;
}

export interface WorkshopDocPanelHeaderMeta {
  title: string;
  subtitle?: string;
  Icon: LucideIcon;
}

/**
 * Full document title + icon for the workshop document column header (desktop).
 */
export function getWorkshopDocPanelHeader(
  panel: string,
  opts?: { benchmarkPhaseTab?: "fase0" | "benchmark" },
): WorkshopDocPanelHeaderMeta {
  if (panel === "benchmark") {
    if (opts?.benchmarkPhaseTab === "benchmark") {
      return {
        title: "Benchmark & Deep Research",
        subtitle: "Paso 0 — investigación y gap analysis",
        Icon: Target,
      };
    }
    return {
      title: "Domain Benchmark & Gap Analysis",
      subtitle: "Paso 0 — Fase 0 (DBGA)",
      Icon: Target,
    };
  }

  const byPanel: Record<string, WorkshopDocPanelHeaderMeta> = {
    legacy: {
      title: "Modificación",
      subtitle: "AriadneSpecs → Master Design Document → entregables",
      Icon: Edit3,
    },
    "mdd-inicial": {
      title: "Initial Master Design Document",
      subtitle: "Documentación AS-IS del codebase (partida)",
      Icon: FileText,
    },
    brd: {
      title: "Business Requirements Document",
      subtitle: "Requisitos de negocio por etapa",
      Icon: ClipboardList,
    },
    mdd: {
      title: "Master Design Document",
      subtitle: "Constitución del proyecto (7 secciones)",
      Icon: FileText,
    },
    spec: {
      title: "Project Specification",
      subtitle: "Alcance funcional y técnico (qué y por qué)",
      Icon: ListOrdered,
    },
    architecture: {
      title: "Software Architecture",
      subtitle: "Componentes, límites y decisiones estructurales",
      Icon: GitBranch,
    },
    "use-cases": {
      title: "Use Cases",
      subtitle: "Flujos frente al Master Design Document",
      Icon: ListOrdered,
    },
    "user-stories": {
      title: "User Stories",
      subtitle: "Historias priorizables para entrega",
      Icon: Package,
    },
    blueprint: {
      title: "Technical Blueprint",
      subtitle: "Modelo de datos y servicios alineados al MDD",
      Icon: LayoutTemplate,
    },
    "ux-ui-guide": {
      title: "Design System",
      subtitle: "Guía UX/UI y tokens (DESIGN.md)",
      Icon: Palette,
    },
    "ui-screens": {
      title: "Pantallas / UI Screens Spec",
      subtitle: "Pantallas con componentes reales del MCP gráfico conectado",
      Icon: MonitorSmartphone,
    },
    aem: {
      title: "Análisis y Estudio de Mercado",
      subtitle: "Mercado, monetización, glosario y dictamen de inversión",
      Icon: FileText,
    },
    "handoff-spec": {
      title: "Handoff Spec",
      subtitle: "Requerimientos técnicos NEW→LEGACY (IntegrationAgent)",
      Icon: FileCode,
    },
    "api-contracts": {
      title: "API Contracts",
      subtitle: "Contratos de interfaz entre servicios",
      Icon: FileCode,
    },
    "logic-flows": {
      title: "Logic Flows",
      subtitle: "Flujos de negocio y sistema",
      Icon: GitBranch,
    },
    tasks: {
      title: "Task Breakdown",
      subtitle: "Desglose ejecutable desde MDD y Blueprint",
      Icon: ListTodo,
    },
    "agent-governance": {
      title: "Gobernanza de agentes IA",
      subtitle: "AGENTS.md, .cursor/rules, skills y workflows derivados del MDD",
      Icon: Bot,
    },
    infra: {
      title: "Infrastructure",
      subtitle: "Despliegue y operación",
      Icon: Server,
    },
    adrs: {
      title: "Architecture Decision Records",
      subtitle: "Decisiones arquitectónicas guardadas",
      Icon: Brain,
    },
    integration: {
      title: "Integración Legacy ↔ Nuevo",
      subtitle: "Conecta proyectos para compartir contexto AS-IS y gestionar módulos enlazados",
      Icon: Link2,
    },
    [WORKSHOP_AGENT_PENDING_CHANGES_PANEL]: {
      title: "Cambios pendientes",
      subtitle: "Aprobación humana de cambios de documentación reportados por agentes",
      Icon: FileWarning,
    },
    [WORKSHOP_AGENT_SESSION_LOG_PANEL]: {
      title: "Log de sesión",
      subtitle: "Gaps MCP, reconciliaciones y eventos de la sesión agéntica",
      Icon: ScrollText,
    },
  };

  return (
    byPanel[panel] ?? {
      title: panel,
      Icon: FileText,
    }
  );
}

/**
 * Header metadata for a plugin artifact panel.
 * Uses the artifact id (without prefix) to look up the plugin definition.
 */
export function getPluginDocPanelHeader(
  panel: string,
  artifactTypes?: ArtifactTypeDefinition[],
): WorkshopDocPanelHeaderMeta {
  if (!artifactTypes?.length) return { title: panel, Icon: FileText };
  const parsed = parsePluginPanelId(panel);
  if (!parsed) return { title: panel, Icon: FileText };
  const artifact = artifactTypes.find((a) => a.id === parsed.artifactId);
  if (!artifact) return { title: parsed.artifactId, Icon: FileText };
  const Icon = LUCIDE_ICON_MAP[artifact.icon ?? ""] ?? FileText;
  return { title: artifact.label, Icon };
}
