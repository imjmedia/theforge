import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CLI_FRONTEND_STACK_LABEL,
  detectSddConflicts,
  extractProjectGovernanceFacts,
  extractProjectTitle,
  filterTaskExcerptsForProjectStack,
  extractTaskCheckboxes,
  inferStacks,
  isValidBlueprintModulePath,
  resolveAuthoritativeOrm,
  resolveAuthoritativePackageManager,
  suggestAgentGovernanceArtifacts,
} from "./suggest-agent-governance-artifacts.js";
import { parseAgentGovernanceResponse } from "./agent-governance.util.js";

const NEST_REACT_MDD = `
# MDD Proyecto Demo

## 2. Stack técnico
- Backend: NestJS con TypeScript
- Frontend: React 18 + Vite
- Monorepo con packages/api y packages/web

## 4. Contratos de API
REST con validación Zod y OpenAPI.

## 6. Seguridad
JWT y OAuth2 para sesiones.
`;

const ARIADNE_LEGACY_MDD = `
# MDD Legacy

## 1. Contexto
Integración MCP Ariadne para análisis de código legacy existente.
Proyecto strangler fig sobre monolito.

## 2. Stack
Backend Express, refactor incremental.
`;

const KMS_BLUEPRINT = `
## Estructura del repositorio

- kms-backend/
- packages/shared/
- packages/kms-auth/

## Convenciones

- **Autenticación/Autorización:** OAuth2 con JWT — no es una ruta de código.
- **Observabilidad:** logs estructurados y métricas Prometheus.
`;

const KMS_MDD = `# Master Design Document

## 1. Contexto

**(KMS Corporativo)** — plataforma documental API-first.

Este documento constituye el Master Design Document del proyecto.

## 2. Stack técnico

Backend NestJS. MVP API-only sin dashboard ni frontend.
Monorepo kms-backend/ y packages/shared.
`;

describe("suggestAgentGovernanceArtifacts", () => {
  it("MDD NestJS+React MEDIUM sugiere stack-backend, stack-frontend y orchestrator", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: NEST_REACT_MDD,
      complexity: "MEDIUM",
    });
    const ruleIds = result.suggestedRules.map((r) => r.id);
    assert.ok(ruleIds.includes("stack-backend"), `rules: ${ruleIds.join(",")}`);
    assert.ok(ruleIds.includes("stack-frontend"));
    assert.ok(ruleIds.includes("orchestrator"));
    assert.ok(ruleIds.includes("api-contracts"));
    assert.ok(result.archetypes.includes("nestjs-react-monorepo"));
  });

  it("MDD con Ariadne sugiere skill mcp-ariadne y rule mcp-governance en LEGACY", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: ARIADNE_LEGACY_MDD,
      projectType: "LEGACY",
      complexity: "MEDIUM",
    });
    const skillIds = result.suggestedSkills.map((s) => s.id);
    const ruleIds = result.suggestedRules.map((r) => r.id);
    assert.ok(skillIds.includes("mcp-ariadne"), `skills: ${skillIds.join(",")}`);
    assert.ok(ruleIds.includes("mcp-governance"), `rules: ${ruleIds.join(",")}`);
    assert.ok(result.archetypes.includes("legacy-ariadne"));
  });

  it("LOW limita a pocas rules y sin skills", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: NEST_REACT_MDD,
      complexity: "LOW",
    });
    assert.ok(result.suggestedRules.length <= 2);
    assert.equal(result.suggestedSkills.length, 0);
    assert.ok(result.rationale.some((r) => /LOW/i.test(r)));
  });

  it("HIGH monorepo sugiere más skills (domain + monorepo)", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: NEST_REACT_MDD + "\nDesign system en packages/ui con Storybook.\n",
      complexity: "HIGH",
    });
    const skillIds = result.suggestedSkills.map((s) => s.id);
    assert.ok(skillIds.includes("domain-package"));
    assert.ok(
      skillIds.includes("monorepo-packages") || skillIds.includes("design-system-ui"),
      `skills: ${skillIds.join(",")}`,
    );
    assert.ok(
      result.rationale.some((r) => /monorepo|HIGH/i.test(r)),
      "debe mencionar monorepo o HIGH",
    );
  });
});

describe("inferStacks", () => {
  it("detecta Expo, Cloudflare Workers, Hono y FastAPI", () => {
    assert.equal(inferStacks("Mobile app con Expo SDK 52").mobile, "Expo");
    assert.equal(inferStacks("Backend: Cloudflare Workers con Hono").backend, "Cloudflare Workers");
    assert.equal(inferStacks("API en FastAPI con Python").backend, "FastAPI");
    assert.equal(inferStacks("Despliegue serverless en Cloudflare").infra, "Serverless");
  });

  it("prioriza Kubernetes sobre Docker en infra", () => {
    assert.equal(
      inferStacks("Deploy con Kubernetes y Helm charts").infra,
      "Kubernetes",
    );
  });
});

describe("archetype false positives", () => {
  it("no activa legacy-ariadne en greenfield aunque el MDD mencione Ariadne activo", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: ARIADNE_LEGACY_MDD,
      projectType: "NEW",
      complexity: "HIGH",
    });
    assert.equal(result.archetypes.includes("legacy-ariadne"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "mcp-ariadne"), false);
    assert.equal(
      result.rationale.some((r) => r.includes("legacy-ariadne") || r.includes("mcp-ariadne")),
      false,
    );
  });

  it("no activa legacy-ariadne por grafo/FalkorDB sin Ariadne en greenfield", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# Plataforma KMS
## 2. Stack
Backend NestJS con FalkorDB para grafo de código en v1.
`,
      projectType: "NEW",
      complexity: "HIGH",
    });
    assert.equal(result.archetypes.includes("legacy-ariadne"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "mcp-ariadne"), false);
  });

  it("no activa legacy-ariadne solo por FalkorDB fase 2", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# KMS
## Roadmap
Fase 2: índice FalkorDB para análisis futuro.
Backend NestJS API-only MVP sin dashboard.
`,
      complexity: "MEDIUM",
    });
    assert.equal(result.archetypes.includes("legacy-ariadne"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "mcp-ariadne"), false);
  });

  it("no activa legacy-ariadne por grafo/FalkorDB fase 2 en blueprint KMS", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: KMS_MDD,
      blueprintMarkdown: `
## Stack
- **Base de datos grafo (fase 2):** FalkorDB (compatible con Neo4j)

# 4. Componentes transversales (pipeline, IA, grafo)

11. **Fase 2 (opcional)** – Integrar FalkorDB para grafo de dependencias.
`,
      complexity: "MEDIUM",
    });
    assert.equal(result.archetypes.includes("legacy-ariadne"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "mcp-ariadne"), false);
  });

  it("no activa legacy-ariadne por Ariadne solo en roadmap diferido", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# Proyecto
## Roadmap
Fase 2 (opcional): evaluar integración con Ariadne para grafo futuro.
Backend NestJS API-only.
`,
      complexity: "MEDIUM",
    });
    assert.equal(result.archetypes.includes("legacy-ariadne"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "mcp-ariadne"), false);
  });

  it("omite stack-frontend y design-system-ui en API-only sin UI", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# KMS Backend
## 2. Stack
Backend NestJS. API-only MVP sin dashboard ni frontend.
Monorepo kms-backend/ packages/shared
`,
      specMarkdown: "CLI-only para operaciones; sin interfaz web.",
      blueprintMarkdown: "## Árbol\n- kms-backend/\n- packages/shared/\n",
      complexity: "HIGH",
    });
    const ruleIds = result.suggestedRules.map((r) => r.id);
    const skillIds = result.suggestedSkills.map((s) => s.id);
    assert.equal(ruleIds.includes("stack-frontend"), false);
    assert.equal(skillIds.includes("design-system-ui"), false);
  });

  it("sugiere ui-pantallas rule y skill cuando hay uiScreensMarkdown", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: "# App\n## 2. Stack\nReact + NestJS monorepo apps/web",
      specMarkdown: "Dashboard para usuarios.",
      uiScreensMarkdown: "# Pantallas / UI Screens Spec\n\n## 1. Login\n",
      complexity: "MEDIUM",
    });
    const ruleIds = result.suggestedRules.map((r) => r.id);
    const skillIds = result.suggestedSkills.map((s) => s.id);
    assert.ok(ruleIds.includes("ui-pantallas"));
    assert.ok(skillIds.includes("ui-pantallas"));
  });

  it("prefiere deploy-kubernetes sobre deploy-docker con señales K8s", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# Plataforma
## 7. Infra
Despliegue en Kubernetes con Helm charts e ingress.
`,
      complexity: "HIGH",
    });
    assert.ok(result.archetypes.includes("kubernetes"));
    assert.ok(result.suggestedSkills.some((s) => s.id === "deploy-kubernetes"));
    assert.equal(result.suggestedSkills.some((s) => s.id === "deploy-docker"), false);
  });

  it("excluye deploy-kubernetes cuando §7 es Railway y K8s está negado (PELUDO)", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: `
# Peludo
## 2. Arquitectura y Stack
Backend Fastify. Monorepo apps/backend packages/shared-types.
## 7. Infraestructura
| **Hosting** | Railway / Fly.io | — | Despliegue single-container, sin gestión de K8s |
Producción en Railway (single service); sin Kubernetes en v1 para simplificar operaciones.
\`\`\`json
{ "deployment": { "orchestrator": "Railway", "provider": "Railway" } }
\`\`\`
`,
      userStoriesMarkdown: "- Kubernetes (v2).\n",
      infraMarkdown: `
\`\`\`dockerfile
RUN yarn build
\`\`\`
`,
      complexity: "HIGH",
    });
    assert.equal(result.archetypes.includes("kubernetes"), false);
    assert.equal(result.suggestedSkills.some((s) => s.id === "deploy-kubernetes"), false);
  });
});

describe("extractProjectTitle", () => {
  it("extrae KMS Corporativo desde §1 cuando el H1 es Master Design Document", () => {
    const title = extractProjectTitle({
      mddMarkdown: `# Master Design Document

## 1. Contexto

**(KMS Corporativo)** — plataforma de gestión documental para empresas.

## 2. Arquitectura y Stack
Backend NestJS.
`,
      complexity: "MEDIUM",
    });
    assert.equal(title, "KMS Corporativo");
  });

  it("extrae KMS Corporativo desde §1 cuando el H1 es Master Design Document (em-dash)", () => {
    const title = extractProjectTitle({
      mddMarkdown: `# Master Design Document

## 1. Contexto

KMS Corporativo — plataforma de gestión documental para empresas.

## 2. Arquitectura y Stack
Backend NestJS.
`,
      complexity: "MEDIUM",
    });
    assert.equal(title, "KMS Corporativo");
  });

  it("prefiere projectName si §1 no tiene línea útil", () => {
    const title = extractProjectTitle({
      mddMarkdown: `# Master Design Document

## 1. Contexto

`,
      projectName: "Portal Clientes",
      complexity: "LOW",
    });
    assert.equal(title, "Portal Clientes");
  });

  it("prioriza projectName sobre entidad §1 con em-dash (patrón MDD real)", () => {
    const mddWithEntityBullets = `# Master Design Document

## 1. Contexto y entidades principales

### Entidades principales

- Geografía (país, estado, ciudad, plaza, ubicación) – tablas espejo
- Producto (SKU, precio, moneda) – catálogo central

## 2. Arquitectura y Stack
Backend NestJS.
`;

    assert.equal(
      extractProjectTitle({
        mddMarkdown: mddWithEntityBullets,
        projectName: "IMJ",
        complexity: "MEDIUM",
      }),
      "IMJ",
    );

    const microServicio = "Micro Servicio de costos y listas de precios";
    assert.equal(
      extractProjectTitle({
        mddMarkdown: mddWithEntityBullets,
        projectName: microServicio,
        complexity: "MEDIUM",
      }),
      microServicio,
    );
  });
});

const KMS_BLUEPRINT_PROSE_FRAGMENT = `
## Modelo de datos

- Entidades \`WorkflowProcess\`, \`Document\`
- Tabla \`audit_logs\`
- Todos los módulos en kms-backend/

## Schemas

- Schemas en Prisma para users y sessions

## Estructura del repositorio

- kms-backend/
- packages/shared/
- packages/kms-auth/
`;

describe("extractProjectGovernanceFacts", () => {
  it("filtra bullets prose del Blueprint y mantiene rutas reales", () => {
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: KMS_MDD,
      blueprintMarkdown: KMS_BLUEPRINT,
      complexity: "HIGH",
    });
    assert.ok(facts.blueprintModules.includes("kms-backend"));
    assert.ok(facts.blueprintModules.includes("packages/shared"));
    assert.equal(
      facts.blueprintModules.some((m) => /autenticaci/i.test(m)),
      false,
    );
    assert.ok(facts.backendGlobs.every((g) => /^[\w./-]+\/\*\*$/.test(g)));
    assert.ok(facts.backendGlobs.some((g) => g.includes("kms-backend")));
  });

  it("rechaza prosa KMS (Entidades, Tabla, Todos, Schemas) y conserva árbol real", () => {
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: KMS_MDD,
      blueprintMarkdown: KMS_BLUEPRINT_PROSE_FRAGMENT,
      complexity: "HIGH",
    });
    assert.deepEqual(facts.blueprintModules, [
      "kms-backend",
      "packages/shared",
      "packages/kms-auth",
    ]);
    for (const junk of ["Entidades", "Tabla", "Todos", "Schemas", "En"]) {
      assert.equal(
        facts.blueprintModules.some((m) => m.toLowerCase() === junk.toLowerCase()),
        false,
        `no debe incluir módulo basura: ${junk}`,
      );
    }
    assert.ok(facts.backendGlobs.some((g) => g.startsWith("kms-backend/")));
    assert.ok(facts.backendGlobs.some((g) => g.startsWith("packages/shared/")));
    assert.equal(facts.backendGlobs.some((g) => /Entidades|Tabla/i.test(g)), false);
  });

  it("ignora frontend aunque exista ux-ui-guide post-MVP", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: KMS_MDD,
      specMarkdown: "CLI-only para operaciones; sin interfaz web.",
      blueprintMarkdown: KMS_BLUEPRINT,
      uxUiGuideMarkdown: "# UX post-MVP\nDashboard React con design system.\n",
      complexity: "HIGH",
    });
    const ruleIds = result.suggestedRules.map((r) => r.id);
    const skillIds = result.suggestedSkills.map((s) => s.id);
    assert.equal(ruleIds.includes("stack-frontend"), false);
    assert.equal(skillIds.includes("design-system-ui"), false);
    assert.equal(result.archetypes.includes("design-system-ui"), false);
  });

  it("usa título del MDD y globs del Blueprint", () => {
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: "# KMS Platform\n## 1. Visión\nSistema de llaves.\n",
      blueprintMarkdown: "## Módulos\n- kms-backend/\n- packages/shared/\n",
      tasksMarkdown: "- [ ] Configurar monorepo\n- [ ] Primer endpoint\n",
      complexity: "MEDIUM",
    });
    assert.equal(facts.projectTitle, "KMS Platform");
    assert.ok(facts.backendGlobs.some((g) => g.includes("kms-backend")));
    assert.ok(facts.docPaths.includes("docs/sdd/api-contracts.md") === false);
  });

  it("prioriza projectName sobre entidad §1 cuando H1 es Master Design Document", () => {
    const projectName = "Micro Servicio de costos y listas de precios";
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: `
# Master Design Document
## 1. Entidades del dominio

### Entidades principales

- Geografía (país, estado, ciudad, plaza, ubicación) – tablas espejo
- Producto (SKU, precio, moneda) – catálogo central
## 2. Stack
Backend NestJS.
`,
      projectName,
      complexity: "MEDIUM",
    });
    assert.equal(facts.projectTitle, projectName);
  });

  it("inferNpmScripts expande capturas reales, no el índice $1", () => {
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: "Monorepo. Ejecutar npm run test y npm run lint antes de merge.",
      complexity: "MEDIUM",
    });
    assert.ok(facts.npmScripts.some((s) => s === "npm run test"));
    assert.ok(facts.npmScripts.some((s) => s === "npm run lint"));
    assert.equal(facts.npmScripts.some((s) => s === "npm run 1"), false);
  });

  it("inferNpmScripts ignora RUN yarn del Dockerfile e infiere pnpm en monorepo", () => {
    const facts = extractProjectGovernanceFacts({
      mddMarkdown: `
## 2. Arquitectura y Stack
Monorepo pnpm workspace. apps/backend packages/shared-types.
`,
      infraMarkdown: `
\`\`\`dockerfile
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
RUN yarn build
\`\`\`
`,
      complexity: "HIGH",
    });
    assert.equal(facts.npmScripts.some((s) => s.includes("yarn build")), false);
    assert.ok(facts.npmScripts.some((s) => s.startsWith("pnpm")));
  });

  it("nombra skill de dominio desde módulos Blueprint (fallback project-package)", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: "# KMS\nBackend NestJS monorepo.",
      blueprintMarkdown: "- kms-backend/src/\n- packages/kms-shared/\n",
      projectName: "Key Management Service",
      complexity: "HIGH",
    });
    const domain = result.suggestedSkills.find((s) => s.id === "domain-package");
    assert.ok(domain);
    assert.equal(domain.folder, "kms-backend");
    assert.match(domain.path, /kms-backend/);
  });

  it("domain-package usa project-package sin módulos en Blueprint", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: "# KMS\nBackend NestJS.",
      projectName: "key-management-service",
      complexity: "HIGH",
    });
    const domain = result.suggestedSkills.find((s) => s.id === "domain-package");
    assert.ok(domain);
    assert.equal(domain.folder, "project-package");
    assert.match(domain.path, /project-package/);
  });

  it("extrae checkboxes concretos para AGENT-PROMPT y PROMPT-INICIAL", () => {
    const boxes = extractTaskCheckboxes(`
## Fase 1
- [ ] Configurar monorepo pnpm
- [ ] Crear módulo auth
- [x] Hecho
`);
    assert.equal(boxes.length, 2);
    assert.match(boxes[0], /Configurar monorepo/);
  });

  it("filtra extractos NestJS/Prisma cuando MDD §2 es Spring Boot", () => {
    const boxes = filterTaskExcerptsForProjectStack(
      [
        "- [ ] Crear módulo NestJS auth",
        "- [ ] Migración schema.prisma",
        "- [ ] Configurar Spring Security JWT",
      ],
      { backendStack: "Spring Boot" },
    );
    assert.equal(boxes.length, 1);
    assert.match(boxes[0]!, /Spring Security/);
  });
});

describe("isValidBlueprintModulePath", () => {
  it("acepta apps/packages/kms paths y rechaza prose", () => {
    assert.equal(isValidBlueprintModulePath("kms-backend/"), true);
    assert.equal(isValidBlueprintModulePath("packages/shared"), true);
    assert.equal(isValidBlueprintModulePath("apps/api"), true);
    assert.equal(isValidBlueprintModulePath("**Autenticación/Autorización:** OAuth2"), false);
    assert.equal(isValidBlueprintModulePath("Observabilidad: logs"), false);
    assert.equal(isValidBlueprintModulePath("Entidades"), false);
    assert.equal(isValidBlueprintModulePath("Tabla"), false);
    assert.equal(isValidBlueprintModulePath("Todos"), false);
    assert.equal(isValidBlueprintModulePath("Schemas"), false);
    assert.equal(isValidBlueprintModulePath("Si"), false);
    assert.equal(isValidBlueprintModulePath("En"), false);
  });
});

describe("suggestAgentGovernanceArtifacts con Tasks y Architecture", () => {
  it("usa Tasks y Architecture en rationale y facts", () => {
    const result = suggestAgentGovernanceArtifacts({
      mddMarkdown: NEST_REACT_MDD,
      blueprintMarkdown: "## Módulos\n- `apps/api`\n- `apps/mobile`\n",
      tasksMarkdown: "## Fase 1\n### Configurar monorepo\n",
      architectureMarkdown: "## Capa API\n## Capa UI\n",
      complexity: "HIGH",
    });
    assert.ok(result.rationale.some((r) => /Tasks disponibles/i.test(r)));
  });
});

describe("parseAgentGovernanceResponse + sugerencias", () => {
  it("añade rules omitidas por el LLM desde catálogo (strong y weak)", () => {
    const suggestions = suggestAgentGovernanceArtifacts({
      mddMarkdown: NEST_REACT_MDD,
      complexity: "MEDIUM",
    });
    const raw = JSON.stringify({
      files: {
        "AGENTS.md": "# AGENTS\n",
        "CLAUDE.md": "@AGENTS.md\n",
      },
    });
    const scaffold = parseAgentGovernanceResponse(raw, "MEDIUM", {
      suggestions,
      governanceInput: {
        mddMarkdown: NEST_REACT_MDD,
        complexity: "MEDIUM",
      },
    });
    const paths = scaffold.files.map((f) => f.path);
    assert.ok(
      paths.includes("docs/agent-governance/rules/stack-backend.mdc"),
      `paths: ${paths.filter((p) => p.includes("rules")).join(",")}`,
    );
    assert.ok(
      paths.includes("docs/agent-governance/rules/orchestrator.mdc"),
      `orchestrator weak también debe materializarse; rules: ${paths.filter((p) => p.includes("rules")).join(",")}`,
    );
    assert.ok(scaffold.manifest.suggestions?.archetypes.includes("nestjs-react-monorepo"));
    const comoUsar = scaffold.files.find(
      (f) => f.path === "docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md",
    );
    assert.ok(comoUsar?.content.includes("Por qué se incluyeron estos skills/rules"));
    assert.ok(paths.includes("PROMPT-INICIAL.md"));
    assert.ok(paths.includes("docs/agent-governance/references/AGENT-PROMPT.md"));
    assert.ok(paths.includes("docs/sdd/PROGRESO.md"));
  });
});

describe("resolveAuthoritativeOrm", () => {
  it("resuelve typeorm desde manifest §7 cuando §2/§3 no lo mencionan", () => {
    const mdd = `
## 2. Arquitectura y Stack
Backend Fastify. Monorepo apps/backend packages/shared-types.

## 3. Modelo de Datos
PostgreSQL multi-tenant.

## 7. Infraestructura
\`\`\`json
{ "orm": "typeorm", "deployment": { "orchestrator": "Railway" } }
\`\`\`
`;
    assert.equal(resolveAuthoritativeOrm(mdd), "typeorm");
  });

  it("resuelve typeorm desde stack.backend.orm anidado en manifest §7", () => {
    const mdd = `
## 2. Stack
NestJS + PostgreSQL.

## 7. Infraestructura
\`\`\`json
{
  "stack": {
    "backend": { "framework": "NestJS", "orm": "TypeORM" }
  }
}
\`\`\`
`;
    assert.equal(resolveAuthoritativeOrm(mdd), "typeorm");
  });
});

describe("resolveAuthoritativePackageManager", () => {
  it("infiere pnpm desde monorepo apps/packages sin pnpm explícito en §2", () => {
    const mdd = `
## 2. Arquitectura y Stack
Backend Fastify. Monorepo apps/backend packages/shared-types.
`;
    assert.equal(resolveAuthoritativePackageManager(mdd), "pnpm");
  });

  it("prioriza pnpm en overlay AGENTS cuando §2 no lo declara", () => {
    const mdd = `
## 2. Arquitectura y Stack
Backend Fastify. Monorepo apps/backend packages/shared-types.
`;
    const agents = "# AGENTS\n\nUsar pnpm install y pnpm build en CI.\n";
    assert.equal(resolveAuthoritativePackageManager(mdd, agents), "pnpm");
  });
});

describe("detectSddConflicts", () => {
  it("no marca conflicto TypeORM/Prisma cuando MDD §2 declara solo TypeORM", () => {
    const text = `
# MDD
## 2. Stack
Backend NestJS con TypeORM y PostgreSQL.

## Tasks (plantilla)
- En Nest/Prisma/TypeORM, apunta a entidades o schema.prisma según lo que TheForge muestre.
`;
    assert.deepEqual(detectSddConflicts(text), []);
  });

  it("marca conflicto cuando MDD §2 menciona TypeORM y Prisma", () => {
    const text = `
# MDD
## 2. Stack
Backend NestJS con TypeORM en borrador; Prisma en blueprint.
`;
    const conflicts = detectSddConflicts(text);
    assert.ok(conflicts.some((c) => /TypeORM vs Prisma/i.test(c)));
  });

  it("ignora Prisma suelto en blueprint cuando §2 es TypeORM-only", () => {
    const text = `
# MDD
## 2. Stack
Backend NestJS con TypeORM.

## Modelo de datos
- Schemas en Prisma para users y sessions
`;
    assert.deepEqual(detectSddConflicts(text), []);
  });

  it("resuelve Bull+Redis del MDD §2 frente a RabbitMQ/Kafka en blueprint", () => {
    const text = `
# MDD
## 2. Arquitectura y Stack
Colas BullMQ con Redis para jobs asíncronos.

## Blueprint
- Worker RabbitMQ consumer (plantilla legacy)
- Integración Kafka opcional en diagrama
`;
    const conflicts = detectSddConflicts(text);
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0]!, /BullMQ \+ Redis/i);
    assert.doesNotMatch(conflicts[0]!, /Kafka vs RabbitMQ/i);
  });

  it("marca conflicto cuando MDD §2 declara RabbitMQ y tasks mencionan BullMQ", () => {
    const text = `
# MDD
## 2. Arquitectura y Stack
Mensajería con RabbitMQ para workers asíncronos.

## Tasks
- [ ] Configurar cola BullMQ para procesamiento de eventos
`;
    const conflicts = detectSddConflicts(text);
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0]!, /RabbitMQ del MDD/i);
    assert.match(conflicts[0]!, /BullMQ/i);
  });

  it("inferStacks devuelve CLI cuando MDD excluye UI web", () => {
    const stacks = inferStacks(
      "Blueprint menciona React post-MVP.\nDashboard React con design system.",
      {
        authoritativeUiText:
          "MVP API-only sin dashboard. CLI-only para operaciones; panel web fuera de MVP.",
      },
    );
    assert.equal(stacks.frontend, CLI_FRONTEND_STACK_LABEL);
    assert.equal(stacks.mobile, undefined);
  });

  it("inferStacks prioriza React en MDD §2 sobre CLI en §1", () => {
    const mdd = `
## 1. Contexto
MVP incluye CLI para operaciones batch.
## 2. Arquitectura y Stack
Frontend React 18 + Vite + Tailwind + Radix UI (apps/web).
Backend NestJS API.
`;
    const stacks = inferStacks(`${mdd}\nCLI Commander para scripts.`, {
      authoritativeUiText: "MVP incluye CLI para operaciones batch.",
      authoritativeStackText:
        "Frontend React 18 + Vite + Tailwind + Radix UI (apps/web).\nBackend NestJS API.",
      mddMarkdown: mdd,
    });
    assert.match(stacks.frontend ?? "", /React|Tailwind \+ Radix/i);
    assert.notEqual(stacks.frontend, CLI_FRONTEND_STACK_LABEL);
  });

  it("prioriza Fastify+Railway de MDD §2 sobre FastAPI/Kubernetes en Blueprint", () => {
    const mdd = `
## 2. Arquitectura y Stack
Backend Fastify + Node.js. Deploy en Railway con Docker.

## 3. Modelo de Datos
PostgreSQL multi-tenant.
`;
    const blueprint = "Stack alterno: FastAPI en Kubernetes para microservicios.";
    const stacks = inferStacks(`${mdd}\n${blueprint}`, {
      authoritativeStackText: mdd,
    });
    assert.equal(stacks.backend, "Fastify");
    assert.equal(stacks.infra, "Railway");

    const facts = extractProjectGovernanceFacts({
      mddMarkdown: mdd,
      blueprintMarkdown: blueprint,
      complexity: "MEDIUM",
    });
    assert.equal(facts.backendStack, "Fastify");
    assert.equal(facts.infraStack, "Railway");

    const conflicts = detectSddConflicts(`${mdd}\n${blueprint}`);
    assert.ok(conflicts.some((c) => /Stack backend.*Fastify/i.test(c)));
  });
});
