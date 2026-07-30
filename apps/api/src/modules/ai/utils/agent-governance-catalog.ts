import type { ComplexityLevel } from "@theforge/shared-types";

export type GovernanceArtifactStrength = "strong" | "weak";

export interface RuleCatalogEntry {
  id: string;
  path: string;
  description: string;
  globs?: string[];
  alwaysApply?: boolean;
  minComplexity: ComplexityLevel;
  /** Regex o keywords evaluados sobre MDD + Blueprint (case-insensitive). */
  signals: RegExp[];
  archetypes?: string[];
  template: (ctx: ArtifactTemplateContext) => string;
}

export interface SkillCatalogEntry {
  id: string;
  folder: string;
  path: string;
  description: string;
  triggers: string;
  minComplexity: ComplexityLevel;
  signals: RegExp[];
  archetypes?: string[];
  /** Si true, el nombre de carpeta puede sustituirse por dominio detectado en MDD. */
  dynamicFolder?: boolean;
  template: (ctx: ArtifactTemplateContext) => string;
}

export interface ArtifactTemplateContext {
  complexity: ComplexityLevel;
  archetypes: string[];
  domainSkillFolder?: string;
  backendStack?: string;
  frontendStack?: string;
  mobileStack?: string;
  infraStack?: string;
  projectFacts?: import("./suggest-agent-governance-artifacts.js").ProjectGovernanceFacts;
}

export const GOVERNANCE_ARCHETYPES = [
  "nestjs-react-monorepo",
  "legacy-ariadne",
  "design-system-ui",
  "spa-only",
  "api-only",
  "docker-dokploy",
  "kubernetes",
  "auth-jwt",
  "mcp-enabled",
] as const;

export type GovernanceArchetype = (typeof GOVERNANCE_ARCHETYPES)[number];

function ruleFrontmatter(
  description: string,
  opts?: { globs?: string[]; alwaysApply?: boolean },
): string {
  const lines = ["---", `description: ${description}`];
  if (opts?.globs?.length) lines.push(`globs: ${JSON.stringify(opts.globs)}`);
  if (opts?.alwaysApply) lines.push("alwaysApply: true");
  lines.push("---", "");
  return lines.join("\n");
}

function stackBackendGlobs(ctx: ArtifactTemplateContext): string[] {
  return ctx.projectFacts?.backendGlobs?.length
    ? ctx.projectFacts.backendGlobs
    : ["src/**", "packages/**/src/**"];
}

function stackFrontendGlobs(ctx: ArtifactTemplateContext): string[] {
  return ctx.projectFacts?.frontendGlobs?.length
    ? ctx.projectFacts.frontendGlobs
    : ["apps/web/**", "packages/**/src/**"];
}

function enrichStackBody(ctx: ArtifactTemplateContext, layer: "backend" | "frontend"): string {
  const facts = ctx.projectFacts;
  const lines = [
    "Deriva comandos exactos (lint, typecheck, tests) del MDD §2 y del repo.",
    "",
    "- Ejecuta gates del paquete tocado antes de cerrar tareas.",
    "- Respeta capas y módulos declarados en Blueprint.",
  ];
  if (facts?.blueprintModules.length) {
    lines.push("", "**Módulos Blueprint:**", ...facts.blueprintModules.slice(0, 6).map((m) => `- \`${m}\``));
  }
  if (facts?.npmScripts.length) {
    lines.push("", "**Scripts detectados:**", ...facts.npmScripts.map((s) => `- \`${s}\``));
  }
  if (layer === "backend" && facts?.backendGlobs.length) {
    lines.push("", "**Globs backend:**", ...facts.backendGlobs.map((g) => `- \`${g}\``));
  }
  if (layer === "frontend" && facts?.frontendGlobs.length) {
    lines.push("", "**Globs frontend:**", ...facts.frontendGlobs.map((g) => `- \`${g}\``));
  }
  return lines.join("\n");
}

function skillFrontmatter(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
}

export const RULE_CATALOG: RuleCatalogEntry[] = [
  {
    id: "git-commits",
    path: "docs/agent-governance/rules/git-commits.mdc",
    description: "Convenciones de commits y git safety",
    alwaysApply: true,
    minComplexity: "LOW",
    signals: [/./],
    template: () =>
      ruleFrontmatter("Convenciones de commits (Conventional Commits cuando aplique)", {
        alwaysApply: true,
      }) +
      "# Git commits\n\n" +
      "- Mensajes imperativos y acotados.\n" +
      "- No incluir co-autores de agentes IA salvo petición explícita.\n" +
      "- No force-push a main/master sin autorización.\n",
  },
  {
    id: "stack-backend",
    path: "docs/agent-governance/rules/stack-backend.mdc",
    description: "Stack backend: lint, typecheck, tests y convenciones",
    globs: ["**/*.{ts,js,py,go,java,php}"],
    minComplexity: "LOW",
    signals: [
      /nestjs/i,
      /express/i,
      /fastify/i,
      /fastapi/i,
      /django/i,
      /laravel/i,
      /spring\s*boot/i,
      /\bapi\s+backend\b/i,
      /§\s*2[\s\S]{0,400}backend/i,
    ],
    archetypes: ["nestjs-react-monorepo", "api-only"],
    template: (ctx) =>
      ruleFrontmatter(`Stack backend (${ctx.backendStack ?? "parametrizar desde MDD §2"})`, {
        globs: stackBackendGlobs(ctx),
      }) +
      "# Stack backend\n\n" +
      enrichStackBody(ctx, "backend") +
      "\n",
  },
  {
    id: "stack-frontend",
    path: "docs/agent-governance/rules/stack-frontend.mdc",
    description: "Stack frontend: componentes, tokens y gates",
    globs: ["**/*.{tsx,jsx,vue,svelte}"],
    minComplexity: "LOW",
    signals: [
      /react/i,
      /\bvue\b/i,
      /svelte/i,
      /angular/i,
      /next\.js/i,
      /vite/i,
      /§\s*2[\s\S]{0,400}frontend/i,
    ],
    archetypes: ["nestjs-react-monorepo", "spa-only", "design-system-ui"],
    template: (ctx) =>
      ruleFrontmatter(`Stack frontend (${ctx.frontendStack ?? "parametrizar desde MDD §2"})`, {
        globs: stackFrontendGlobs(ctx),
      }) +
      "# Stack frontend\n\n" +
      enrichStackBody(ctx, "frontend") +
      "\n\n" +
      "## Design System (obligatorio)\n\n" +
      "- **Toda creación de frontend** (componentes, vistas, layouts, estilos) debe seguir los **tokens** (colores, tipografía, spacing, radii, elevation) y **estilos** definidos en **`design-system.md`** (primario spec-kit; espejo `docs/sdd/ux-ui-guide.md`).\n" +
      "- **Antes de codificar UI**, lee ese documento; no valores ad-hoc (hex/rgb sueltos, `px`/`rem` arbitrarios, sombras o fuentes no documentadas).\n" +
      "- Si falta un token o variante, **extiende primero** `design-system.md` y luego implementa.\n\n" +
      "## Gates\n\n" +
      "- lint + typecheck del paquete UI/SPA antes de merge.\n" +
      "- Si existe `pantallas.md` (spec-kit) o `docs/sdd/pantallas.md`, léelo antes de crear vistas.\n",
  },
  {
    id: "ui-pantallas",
    path: "docs/agent-governance/rules/ui-pantallas.mdc",
    description: "Pantallas MCP: componentes reales, entidades y binding por vista",
    globs: ["**/*.{tsx,jsx,vue,svelte}"],
    minComplexity: "LOW",
    signals: [
      /UI Screens Spec/i,
      /pantallas\.md/i,
      /list_screens/i,
      /MCP gráfico/i,
      /resolve_component/i,
      /ui-mcp/i,
    ],
    archetypes: ["nestjs-react-monorepo", "spa-only", "design-system-ui"],
    template: (ctx) =>
      ruleFrontmatter("Pantallas / UI MCP — spec de vistas", {
        globs: stackFrontendGlobs(ctx),
      }) +
      "# Pantallas (UI MCP)\n\n" +
      "## Cuándo aplicar\n\n" +
      "- Antes de implementar **cualquier** pantalla o ruta de UI.\n" +
      "- Lee `specs/NNN-slug/pantallas.md` (primario) o espejo `docs/sdd/pantallas.md`.\n\n" +
      "## Reglas\n\n" +
      "- Usa **solo** los componentes listados (nombre + paquete@versión); no sustituyas por genéricos sin justificar en MDD.\n" +
      "- Respeta la tabla **Props / Binding** (endpoints, entidades).\n" +
      "- **Tokens y estilos:** aplica exclusivamente los definidos en **`design-system.md`** (Design System); no valores ad-hoc.\n" +
      "- Una fila del doc ≈ una vista o flujo; no mezcles pantallas.\n" +
      "- Si **no** hay `pantallas.md`, usa Blueprint §8 + `design-system.md`; no inventes componentes MCP.\n" +
      "- Ante conflicto con Blueprint §8 heurístico, **gana pantallas.md** cuando exista.\n",
  },
  {
    id: "api-contracts",
    path: "docs/agent-governance/rules/api-contracts.mdc",
    description: "Contratos API, validación y OpenAPI",
    minComplexity: "MEDIUM",
    signals: [
      /openapi/i,
      /\bzod\b/i,
      /contratos?\s+de\s+api/i,
      /§\s*4/i,
      /rest\s+api/i,
      /graphql/i,
    ],
    archetypes: ["nestjs-react-monorepo", "api-only"],
    template: (ctx) => {
      const facts = ctx.projectFacts;
      const lines = [
        ruleFrontmatter("Contratos API alineados al MDD §4") +
        "# API contracts\n\n" +
        "- Cambios de contrato: actualizar spec/OpenAPI y tests.\n" +
        "- Validación de entrada según stack (Zod, class-validator, etc.).\n",
      ];
      if (facts?.blueprintModules.length) {
        lines.push("## Módulos con endpoints\n");
        for (const mod of facts.blueprintModules.slice(0, 6)) {
          lines.push(`- \`${mod}\``);
        }
        lines.push("");
      }
      return lines.join("\n");
    },
  },
  {
    id: "orchestrator",
    path: "docs/agent-governance/rules/orchestrator.mdc",
    description: "Roles PM → Dev → QA → Reviewer y subflujos",
    alwaysApply: false,
    minComplexity: "MEDIUM",
    signals: [/./],
    template: () =>
      ruleFrontmatter("Orquestación de roles y subflujos de agente") +
      "# Orquestador\n\n" +
      "- Tareas no triviales: PM → Dev → QA → Reviewer.\n" +
      "- Consulta `workflows.md` para triggers y gates.\n",
  },
  {
    id: "security-auth",
    path: "docs/agent-governance/rules/security-auth.mdc",
    description: "Autenticación, autorización y secretos",
    minComplexity: "MEDIUM",
    signals: [
      /\bjwt\b/i,
      /oauth/i,
      /\bmfa\b/i,
      /sesión/i,
      /session/i,
      /§\s*6/i,
      /autenticaci[oó]n/i,
    ],
    archetypes: ["auth-jwt"],
    template: () =>
      ruleFrontmatter("Seguridad y auth según MDD §6") +
      "# Security & auth\n\n" +
      "- No commitear secretos ni `.env` con credenciales.\n" +
      "- Respeta flujos JWT/OAuth/MFA descritos en el MDD.\n",
  },
  {
    id: "architecture-patterns",
    path: "docs/agent-governance/rules/architecture-patterns.mdc",
    description: "Patrones wizard: Hexagonal, CQRS, DDD, etc.",
    minComplexity: "MEDIUM",
    signals: [
      /hexagonal/i,
      /\bcqrs\b/i,
      /\bddd\b/i,
      /clean\s+architecture/i,
      /microservicios/i,
      /monolito\s+modular/i,
      /event-?driven/i,
      /\[X\][^\n]*(Hexagonal|CQRS|Clean Architecture|Microservicios)/i,
    ],
    template: (ctx) => {
      const facts = ctx.projectFacts;
      const lines = [
        ruleFrontmatter("Patrones de arquitectura activos en el wizard MDD") +
        "# Architecture patterns\n\n" +
        "Alinea implementación a los patrones marcados [X] en el MDD.\n" +
        "No contradigas capas, puertos o bounded contexts acordados.\n",
      ];
      if (facts?.architectureLayers.length) {
        lines.push("## Capas del proyecto\n");
        for (const layer of facts.architectureLayers.slice(0, 8)) {
          lines.push(`- ${layer}`);
        }
        lines.push("");
      }
      if (facts?.blueprintModules.length) {
        lines.push("## Módulos Blueprint\n");
        for (const mod of facts.blueprintModules.slice(0, 8)) {
          lines.push(`- \`${mod}\``);
        }
        lines.push("");
      }
      return lines.join("\n");
    },
  },
  {
    id: "mcp-governance",
    path: "docs/agent-governance/rules/mcp-governance.mdc",
    description: "Uso de servidores MCP declarados en §1",
    minComplexity: "MEDIUM",
    signals: [/\bmcp\b/i, /model\s+context\s+protocol/i, /§\s*1[\s\S]{0,600}mcp/i],
    archetypes: ["mcp-enabled", "legacy-ariadne"],
    template: () =>
      ruleFrontmatter("Gobernanza MCP: leer descriptores antes de invocar herramientas") +
      "# MCP governance\n\n" +
      "- Lee el schema JSON de cada herramienta antes de `call_mcp_tool`.\n" +
      "- Placeholders en `mcp.json`; nunca secretos reales en el repo.\n",
  },
];

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    id: "domain-package",
    folder: "project-package",
    path: "docs/agent-governance/skills/project-package/SKILL.md",
    description: "Skill de dominio del paquete o módulo principal",
    triggers: "Trabajo en el paquete/módulo principal del proyecto (rutas del Blueprint).",
    minComplexity: "MEDIUM",
    signals: [/./],
    dynamicFolder: true,
    template: (ctx) => {
      const folder = ctx.domainSkillFolder ?? "project-package";
      const modules = ctx.projectFacts?.blueprintModules ?? [];
      return (
        skillFrontmatter(
          folder,
          `Trabajo en ${folder} según MDD/Blueprint.`,
        ) +
        `# Skill: ${folder}\n\n` +
        "## Cuándo cargar\n\n" +
        `- Edición o depuración en \`${folder}\` o rutas relacionadas.\n` +
        "- Feature o bug en rutas citadas en Blueprint.\n\n" +
        (modules.length
          ? `## Rutas Blueprint\n\n${modules.slice(0, 6).map((m) => `- \`${m}\``).join("\n")}\n\n`
          : "") +
        "## Checklist\n\n" +
        "1. Lee `AGENTS.md` y rules de stack.\n" +
        "2. Confirma gates (lint, typecheck, tests) del paquete.\n" +
        "3. Respeta contratos API y auth del MDD.\n"
      );
    },
  },
  {
    id: "design-system-ui",
    folder: "design-system-ui",
    path: "docs/agent-governance/skills/design-system-ui/SKILL.md",
    description: "Design system / paquete UI compartido",
    triggers: "Componentes UI, tokens, Storybook o paquete `@scope/ui`.",
    minComplexity: "HIGH",
    signals: [
      /design\s+system/i,
      /paquete\s+ui/i,
      /storybook/i,
      /@\w+\/ui\b/i,
      /componentes?\s+compartidos/i,
    ],
    archetypes: ["design-system-ui", "nestjs-react-monorepo"],
    template: () =>
      skillFrontmatter(
        "design-system-ui",
        "Design system: módulos UI, tokens, Storybook y publicación explícita.",
      ) +
      "# Design system UI\n\n" +
      "## Cuándo cargar\n\n" +
      "- Nuevo componente, variante o token.\n" +
      "- Auditoría de módulo UI.\n\n" +
      "## Checklist\n\n" +
      "- Lee **`design-system.md`** (espejo `docs/sdd/ux-ui-guide.md`) antes de crear o modificar UI.\n" +
      "- Usa **solo** tokens y estilos del Design System; sin colores/tamaños ad-hoc.\n" +
      "- JSDoc en exports públicos.\n" +
      "- Publicar paquete solo con petición explícita + QA.\n",
  },
  {
    id: "ui-pantallas",
    folder: "ui-pantallas",
    path: "docs/agent-governance/skills/ui-pantallas/SKILL.md",
    description: "Implementar vistas según Pantallas / UI Screens Spec (MCP gráfico)",
    triggers: "Tareas frontend, rutas SPA o componentes cuando existe pantallas.md.",
    minComplexity: "LOW",
    signals: [
      /UI Screens Spec/i,
      /pantallas\.md/i,
      /list_screens/i,
      /MCP gráfico/i,
      /resolve_component/i,
    ],
    archetypes: ["nestjs-react-monorepo", "spa-only", "design-system-ui"],
    template: () =>
      skillFrontmatter(
        "ui-pantallas",
        "Pantallas MCP: leer spec de vistas antes de codificar UI.",
      ) +
      "# Skill: Pantallas (UI MCP)\n\n" +
      "## Cuándo cargar\n\n" +
      "- Implementar listados, formularios, dashboards o rutas del front.\n" +
      "- Existe `specs/NNN-slug/pantallas.md` o `docs/sdd/pantallas.md`.\n\n" +
      "## Checklist\n\n" +
      "1. Leer **`design-system.md`** (Design System) y aplicar sus tokens y estilos.\n" +
      "2. Abrir pantallas.md y localizar la pantalla de la tarea actual.\n" +
      "3. Importar componentes con el paquete/versión indicados.\n" +
      "4. Cablear props según binding (API contracts + MDD §3).\n" +
      "5. Mobile responsive según design-system.md / MDD.\n" +
      "6. No cerrar la tarea UI sin revisar que la vista coincide con el doc.\n",
  },
  {
    id: "deploy-docker",
    folder: "deploy-docker",
    path: "docs/agent-governance/skills/deploy-docker/SKILL.md",
    description: "Despliegue contenedores / PaaS (Docker, Dokploy, K8s)",
    triggers: "Infra, Dockerfile, compose, Dokploy o pipeline de deploy.",
    minComplexity: "HIGH",
    signals: [/docker/i, /dokploy/i, /§\s*7/i, /contenedor/i, /paas/i],
    archetypes: ["docker-dokploy"],
    template: () =>
      skillFrontmatter("deploy-docker", "Despliegue: Docker, compose y PaaS según MDD §7.") +
      "# Deploy Docker / PaaS\n\n" +
      "## Cuándo cargar\n\n" +
      "- Cambios en Dockerfile, compose o manifests PaaS.\n" +
      "- Variables de entorno y healthchecks.\n\n" +
      "## Checklist\n\n" +
      "- Sin secretos en imágenes ni repos.\n" +
      "- Healthchecks alineados al stack real.\n",
  },
  {
    id: "deploy-kubernetes",
    folder: "deploy-kubernetes",
    path: "docs/agent-governance/skills/deploy-kubernetes/SKILL.md",
    description: "Despliegue Kubernetes / Helm según MDD §7",
    triggers: "Manifests K8s, Helm charts, ingress o operators.",
    minComplexity: "HIGH",
    signals: [/kubernetes/i, /\bk8s\b/i, /helm/i, /ingress/i],
    archetypes: ["kubernetes"],
    template: () =>
      skillFrontmatter(
        "deploy-kubernetes",
        "Despliegue Kubernetes/Helm según MDD §7 (prioritario sobre Docker/PaaS).",
      ) +
      "# Deploy Kubernetes / Helm\n\n" +
      "## Cuándo cargar\n\n" +
      "- Cambios en manifests, Helm charts o ingress.\n" +
      "- ConfigMaps, Secrets y health probes.\n\n" +
      "## Checklist\n\n" +
      "- Sin secretos en repos; usa Secret refs.\n" +
      "- Probes y recursos alineados al MDD §7.\n",
  },
  {
    id: "mcp-ariadne",
    folder: "mcp-ariadne",
    path: "docs/agent-governance/skills/mcp-ariadne/SKILL.md",
    description: "MCP Ariadne / grafo de código para legacy",
    triggers: "Refactor legacy, impacto multi-archivo, validate_before_edit.",
    minComplexity: "MEDIUM",
    signals: [
      /\bariadne\b/i,
      /validate_before_edit/i,
      /get_component_graph/i,
      /\.ariadne-project/i,
      /mcp\s+ariadne/i,
      /strangler/i,
    ],
    archetypes: ["legacy-ariadne", "mcp-enabled"],
    template: () =>
      skillFrontmatter(
        "mcp-ariadne",
        "MCP de grafo (Ariadne/Falkor): validate_before_edit antes de refactors.",
      ) +
      "# MCP Ariadne / grafo\n\n" +
      "## Cuándo cargar\n\n" +
      "- Refactor con impacto amplio.\n" +
      "- Proyecto legacy con índice de código.\n\n" +
      "## Checklist\n\n" +
      "1. Lee `.ariadne-project` o equivalente para `projectId`.\n" +
      "2. `validate_before_edit` antes de cambios serios.\n" +
      "3. Complementa con lint/tsc/tests; no sustituye gates.\n",
  },
  {
    id: "monorepo-packages",
    folder: "monorepo-packages",
    path: "docs/agent-governance/skills/monorepo-packages/SKILL.md",
    description: "Trabajo en monorepo multi-paquete",
    triggers: "Paquetes bajo `packages/`, workspaces npm/pnpm/lerna.",
    minComplexity: "HIGH",
    signals: [/monorepo/i, /lerna/i, /pnpm\s+workspace/i, /turborepo/i, /packages\//i],
    archetypes: ["nestjs-react-monorepo"],
    template: () =>
      skillFrontmatter(
        "monorepo-packages",
        "Paquetes del monorepo fuera del design system principal.",
      ) +
      "# Monorepo packages\n\n" +
      "## Cuándo cargar\n\n" +
      "- Cambios en `packages/*` que no sean el DS UI.\n" +
      "- Publicación explícita de un paquete nombrado.\n\n" +
      "## Checklist\n\n" +
      "- Scripts del paquete en su `package.json`.\n" +
      "- No publicar sin petición explícita del paquete.\n",
  },
];

/** Índice rápido por id. */
export function getRuleById(id: string): RuleCatalogEntry | undefined {
  return RULE_CATALOG.find((r) => r.id === id);
}

export function getSkillById(id: string): SkillCatalogEntry | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}

const COMPLEXITY_RANK: Record<ComplexityLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

export function complexityAtLeast(
  level: ComplexityLevel,
  min: ComplexityLevel,
): boolean {
  return COMPLEXITY_RANK[level] >= COMPLEXITY_RANK[min];
}
