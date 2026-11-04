import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { serializeAgentGovernanceScaffold } from "../ai/utils/agent-governance.util.js";
import { appendArchitectureDecisionToScaffold, buildArchitectureDecisionFromSddConflict } from "../documentation-gap/architecture-decision.util.js";
import {
  analyzeAgentGovernanceSlice,
  buildProjectDeliverableExportInput,
  buildSpecKitFilesForProject,
  buildUnifiedHandoff,
  designFirstRepoHandoffFiles,
  enrichSpecKitFilesForHandoff,
  hashHandoffContent,
  reconcileExportScaffold,
  scaffoldToRepoHandoffGovernance,
  synthesizeExportGovernanceScaffold,
  toHandoffFilesWithHash,
} from "./handoff-export.util.js";

const baseProject = {
  id: "proj-1",
  name: "Demo App",
  userId: "u1",
  visibility: "PRIVATE" as const,
  complexity: "MEDIUM" as const,
  projectType: "GREENFIELD" as const,
  hasUxTeam: false,
  specContent: "# Spec\n",
  blueprintContent: "# Blueprint\n",
  tasksContent: "- [ ] Task one\n",
  agentGovernanceContent: null as string | null,
  stages: [
    {
      id: "s1",
      projectId: "proj-1",
      ordinal: 1,
      status: "VERDE",
      mddContent: "# MDD\n\n## 2. Stack\nNestJS",
    },
  ],
};

describe("handoff-export.util", () => {
  it("buildUnifiedHandoff incluye spec-kit files, consumption guide y prompts de agente", () => {
    const unified = buildUnifiedHandoff(baseProject as never, "# Guía\n");
    assert.ok(unified.specKitFiles.some((f) => f.path === ".specify/memory/constitution.md"));
    assert.ok(unified.specKitFiles.some((f) => f.path === "THEFORGE-DOC-CONSUMPTION-GUIDE.md"));
    assert.ok(unified.specKitFiles.some((f) => f.path === ".theforge-project.json"));
    assert.ok(unified.specKitFiles.some((f) => f.path === "IMPLEMENT.md"));
    const implement = unified.specKitFiles.find((f) => f.path === "IMPLEMENT.md");
    assert.ok(implement?.content.includes(unified.featureDir));
    assert.equal(unified.layout, "spec-kit-primary");
    assert.ok(unified.pathMap.length >= 12);
    assert.equal(unified.governancePresent, false);
  });

  it("reconcileExportScaffold incluye PROMPT-INICIAL índice, variantes IDE y bundle multi-target", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS\n" }],
    });
    const project = { ...baseProject, agentGovernanceContent: gov };
    const scaffold = reconcileExportScaffold(project as never);
    assert.ok(scaffold);
    const paths = scaffold!.files.map((f) => f.path);
    assert.ok(paths.includes("PROMPT-INICIAL.md"));
    assert.ok(paths.includes("PROMPT-INICIAL.cursor.md"));
    assert.ok(paths.includes("PROMPT-INICIAL.antigravity.md"));
    assert.ok(paths.some((p) => p.startsWith("install-targets/antigravity/")));
    assert.ok(paths.includes("scripts/install-governance-antigravity.sh"));
    assert.ok(paths.includes("docs/agent-governance/references/AGENT-PROMPT.md"));
    const cursorPrompt = scaffold!.files.find((f) => f.path === "PROMPT-INICIAL.cursor.md");
    assert.ok(cursorPrompt?.content.includes("install-governance-cursor.sh"));
    assert.equal(/\.agents\//i.test(cursorPrompt?.content ?? ""), false);
    const antigravityPrompt = scaffold!.files.find((f) => f.path === "PROMPT-INICIAL.antigravity.md");
    assert.ok(antigravityPrompt?.content.includes("install-governance-antigravity.sh"));
    assert.equal(/\.cursor\//i.test(antigravityPrompt?.content ?? ""), false);
    assert.ok(scaffold!.manifest.installMaps);
    assert.ok(scaffold!.manifest.prompts?.length);
  });

  it("reconcileExportScaffold añade docs/sdd y overlay AGENTS.md dual spec-kit", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS personalizado\n\nSolo cuerpo LLM.\n" }],
    });
    const project = { ...baseProject, agentGovernanceContent: gov };
    const scaffold = reconcileExportScaffold(project as never);
    assert.ok(scaffold);
    const paths = scaffold!.files.map((f) => f.path);
    assert.ok(paths.includes("docs/sdd/mdd.md"));
    assert.ok(paths.includes("docs/sdd/spec.md"));
    assert.ok(paths.includes("docs/sdd/tasks.md"));
    const agents = scaffold!.files.find((f) => f.path === "AGENTS.md");
    assert.ok(agents?.content.includes("Documentos SDD (layout dual)"));
    assert.ok(agents?.content.includes("specs/001-demo-app/spec.md"));
    assert.ok(agents?.content.includes("Instalación de gobernanza"));
    assert.ok(agents?.content.includes("Solo cuerpo LLM"));
  });

  it("reconcileExportScaffold es idempotente al reconciliar dos veces", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS personalizado\n\nSolo cuerpo LLM.\n" }],
    });
    const project = {
      ...baseProject,
      agentGovernanceContent: gov,
      specContent: "# Spec\nTypeORM legacy mention\nPrisma en MDD.",
    };
    const first = reconcileExportScaffold(project as never);
    assert.ok(first);
    const reserialized = serializeAgentGovernanceScaffold(first!);
    const second = reconcileExportScaffold(
      { ...project, agentGovernanceContent: reserialized } as never,
    );
    assert.ok(second);
    assert.equal(serializeAgentGovernanceScaffold(second!), reserialized);
  });

  it("scaffoldToRepoHandoffGovernance mapea present/files", () => {
    const scaffold = {
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS\n" }],
    };
    const out = scaffoldToRepoHandoffGovernance(scaffold);
    assert.equal(out.present, true);
    assert.equal(out.files.length, 1);
  });

  it("analyzeAgentGovernanceSlice detecta ausencia", () => {
    const slice = analyzeAgentGovernanceSlice(baseProject as never);
    assert.equal(slice.present, false);
    assert.ok(slice.missingRequiredPaths.length > 0);
  });

  it("buildUnifiedHandoff incluye ADRs en docs/sdd/decisions/", () => {
    const adr = buildArchitectureDecisionFromSddConflict(
      "TypeORM vs Prisma: prioriza el ORM declarado en MDD §2/Blueprint.",
      "auto-deterministic",
    );
    const { serialized } = appendArchitectureDecisionToScaffold(null, adr);
    const project = { ...baseProject, agentGovernanceContent: serialized };
    const unified = buildUnifiedHandoff(project as never, null);
    assert.ok(unified.specKitFiles.some((f) => f.path === adr.path));
    assert.match(
      unified.specKitFiles.find((f) => f.path === adr.path)!.content,
      /## Decisión/,
    );
  });

  it("toHandoffFilesWithHash incluye hashes SHA-256", () => {
    const unified = buildUnifiedHandoff(baseProject as never, null);
    const payload = toHandoffFilesWithHash(unified.specKitFiles);
    assert.ok(payload.length > 0);
    assert.match(payload[0]!.sha256, /^[a-f0-9]{64}$/);
    assert.equal(payload[0]!.sha256, hashHandoffContent(payload[0]!.content));
  });

  it("enrichSpecKitFilesForHandoff añade docs/sdd mirrors y openspec/BRANCH-POLICY", () => {
    const unified = buildUnifiedHandoff(baseProject as never, null);
    const deliverables = buildProjectDeliverableExportInput(baseProject as never, baseProject.stages[0]);
    const enriched = enrichSpecKitFilesForHandoff(unified.specKitFiles, deliverables);
    const paths = enriched.map((f) => f.path);
    assert.ok(paths.includes("docs/sdd/mdd.md"));
    assert.ok(paths.includes("docs/sdd/spec.md"));
    assert.ok(paths.includes("docs/sdd/tasks.md"));
    assert.ok(paths.includes("openspec/BRANCH-POLICY.md"));
    assert.ok(paths.includes("docs/sdd/PROGRESO.md"));
  });

  it("synthesizeExportGovernanceScaffold incluye rutas obligatorias MEDIUM sin LLM previo", () => {
    const scaffold = synthesizeExportGovernanceScaffold({
      ...baseProject,
      complexity: "MEDIUM",
    } as never);
    const paths = scaffold.files.map((f) => f.path);
    assert.ok(paths.includes("AGENTS.md"));
    assert.ok(paths.includes("PROMPT-INICIAL.md"));
    assert.ok(paths.includes("scripts/install-agent-governance.sh"));
    assert.ok(paths.includes("docs/agent-governance/INSTALACION.md"));
    assert.ok(paths.includes("docs/sdd/mdd.md"));
  });

  it("buildUnifiedHandoff pathMap incluye pantallas", () => {
    const unified = buildUnifiedHandoff(baseProject as never, null);
    assert.ok(unified.pathMap.some((e) => e.mirror === "docs/sdd/pantallas.md"));
  });

  it("export incluye pantallas.md en spec-kit y espejo docs/sdd cuando hay uiScreensContent", () => {
    const project = {
      ...baseProject,
      uiScreensContent: "# Pantallas / UI Screens Spec\n\n## 1. Login\n",
    };
    const unified = buildUnifiedHandoff(project as never, null);
    const featureDir = unified.featureDir;
    const specPantallas = unified.specKitFiles.find((f) => f.path === `${featureDir}/pantallas.md`);
    assert.ok(specPantallas?.content.includes("Login"));
    const deliverables = buildProjectDeliverableExportInput(project as never, project.stages[0]);
    const enriched = enrichSpecKitFilesForHandoff(unified.specKitFiles, deliverables);
    const mirror = enriched.find((f) => f.path === "docs/sdd/pantallas.md");
    assert.ok(mirror?.content.includes("Login"));
    const scaffold = synthesizeExportGovernanceScaffold(project as never);
    assert.ok(scaffold.files.some((f) => f.path === "docs/sdd/pantallas.md"));
  });

  it("buildSpecKitFilesForProject sustituye JWT_SECRET por par RS256 en infra spec-kit", () => {
    const mdd = `## 6. Seguridad

- JWT firmado con RS256 y par de claves pública/privada (JWKS).

## 7. Infraestructura

### Variables de entorno

\`\`\`env
JWT_SECRET=changeme
NODE_ENV=development
\`\`\`
`;
    const project = {
      ...baseProject,
      infraContent: `### Variables de entorno

\`\`\`env
JWT_SECRET=changeme
NODE_ENV=development
\`\`\`
`,
      stages: [{ ...baseProject.stages[0], mddContent: mdd }],
    };
    const files = buildSpecKitFilesForProject(project as never, null);
    const infra = files.find((f) => f.path.endsWith("/infra.md"));
    assert.ok(infra);
    assert.match(infra!.content, /JWT_PRIVATE_KEY/);
    assert.match(infra!.content, /JWT_PUBLIC_KEY/);
    assert.ok(!/\bJWT_SECRET\b/.test(infra!.content));
  });

  it("specs design-system.md y docs/sdd/ux-ui-guide.md alineados tras formatDocumentMarkdown", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS\n" }],
    });
    const uxUiRaw = `# Guía UX/UI

typography:
  h1:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 32px
\`\`\`dockerfile
  label-sm:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 13px
rounded:
  sm: 6px
components:
  button-primary:
- backgroundColor: "{colors.tertiary}"
\`\`\`
`;
    const project = {
      ...baseProject,
      agentGovernanceContent: gov,
      uxUiGuideContent: uxUiRaw,
    };
    const unified = buildUnifiedHandoff(project as never, null);
    const specDesignSystem = unified.specKitFiles.find((f) => f.path.endsWith("/design-system.md"));
    const mirrorUx = unified.agentGovernance?.files.find((f) => f.path === "docs/sdd/ux-ui-guide.md");
    assert.ok(specDesignSystem);
    assert.ok(mirrorUx);
    assert.equal(specDesignSystem!.content, mirrorUx!.content);
    assert.match(specDesignSystem!.content, /```yaml[\s\S]*label-sm/);
    assert.doesNotMatch(specDesignSystem!.content, /```dockerfile/);
  });

  it("specs y docs/sdd infra alineados en buildUnifiedHandoff", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [{ path: "AGENTS.md", content: "# AGENTS\n" }],
    });
    const mdd = `## 6. Seguridad

- JWT firmado con RS256 y par de claves pública/privada.

## 7. Infraestructura

- NODE_ENV, JWT_SECRET, JWT_EXPIRES_IN
`;
    const project = {
      ...baseProject,
      agentGovernanceContent: gov,
      infraContent: `### Variables

- NODE_ENV, JWT_SECRET, JWT_EXPIRES_IN
`,
      stages: [{ ...baseProject.stages[0], mddContent: mdd }],
    };
    const unified = buildUnifiedHandoff(project as never, null);
    const specInfra = unified.specKitFiles.find((f) => f.path.endsWith("/infra.md"));
    const mirrorInfra = unified.agentGovernance?.files.find((f) => f.path === "docs/sdd/infra.md");
    assert.ok(specInfra);
    assert.ok(mirrorInfra);
    assert.equal(specInfra!.content, mirrorInfra!.content);
    assert.match(specInfra!.content, /JWT_PRIVATE_KEY/);
    assert.ok(!/\bJWT_SECRET\b/.test(specInfra!.content));
  });

  it("export PELUDO-like: pnpm en Dockerfile, TypeORM migrations y YAML design-system", () => {
    const gov = serializeAgentGovernanceScaffold({
      manifest: { templateVersion: "2.0.0", files: ["AGENTS.md"] },
      files: [
        {
          path: "AGENTS.md",
          content: "# AGENTS\n\nMonorepo Turborepo; usar pnpm install y pnpm build.\n",
        },
      ],
    });
    const mdd = `## 2. Arquitectura y Stack

Backend Fastify. Monorepo apps/backend packages/shared-types.

| Capa | Tecnología |
| --- | --- |
| API | Fastify |
| Persistencia | PostgreSQL |

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE pets (id UUID PRIMARY KEY);
\`\`\`

## 6. Seguridad

JWT RS256 con JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.

## 7. Infraestructura

Producción en Railway (single service); sin Kubernetes en v1.
\`\`\`json
{ "orm": "typeorm", "deployment": { "orchestrator": "Railway", "provider": "Railway" } }
\`\`\`
`;
    const project = {
      ...baseProject,
      name: "PELUDO",
      agentGovernanceContent: gov,
      infraContent: `## 1. Dockerfile

\`\`\`dockerfile
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
RUN yarn build
\`\`\`
`,
      userStoriesContent:
        "Como dev quiero migrar el esquema con TypeORM o raw SQL y desplegar con yarn.",
      uxUiGuideContent: `# Guía UX/UI

typography:
  h1:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 32px
\`\`\`dockerfile
  label-sm:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 13px
rounded:
  sm: 6px
\`\`\`
`,
      stages: [{ ...baseProject.stages[0], mddContent: mdd }],
    };
    const unified = buildUnifiedHandoff(project as never, null);
    const specInfra = unified.specKitFiles.find((f) => f.path.endsWith("/infra.md"));
    const mirrorInfra = unified.agentGovernance?.files.find((f) => f.path === "docs/sdd/infra.md");
    const mirrorStories = unified.agentGovernance?.files.find(
      (f) => f.path === "docs/sdd/user-stories.md",
    );
    const specDesignSystem = unified.specKitFiles.find((f) => f.path.endsWith("/design-system.md"));
    const mirrorUx = unified.agentGovernance?.files.find((f) => f.path === "docs/sdd/ux-ui-guide.md");

    assert.ok(specInfra);
    assert.ok(mirrorInfra);
    assert.equal(specInfra!.content, mirrorInfra!.content);
    assert.match(specInfra!.content, /pnpm install --frozen-lockfile/);
    assert.doesNotMatch(specInfra!.content, /yarn/i);

    assert.ok(mirrorStories);
    assert.match(mirrorStories!.content, /TypeORM migrations/);
    assert.doesNotMatch(mirrorStories!.content, /raw SQL/i);

    assert.ok(specDesignSystem);
    assert.ok(mirrorUx);
    assert.equal(specDesignSystem!.content, mirrorUx!.content);
    assert.match(specDesignSystem!.content, /```yaml[\s\S]*typography:[\s\S]*label-sm/);
    assert.doesNotMatch(specDesignSystem!.content, /```dockerfile/);
  });

  it("DESIGN_FIRST handoff incluye openapi.yaml y mocks MSW", () => {
    const pagFixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../packages/shared-types/src/design-first/__fixtures__/three-screens.pag.json",
    );
    const pag = JSON.parse(readFileSync(pagFixture, "utf8"));
    const designSpec = {
      schemaVersion: 1,
      entities: [],
      screens: [
        {
          id: "home",
          name: "Home",
          route: "/",
          roles: [],
          states: [],
          origin: { kind: "manual" },
          components: [],
        },
      ],
      navigation: [],
      dataNeeds: [],
    };
    const project = {
      ...baseProject,
      projectType: "DESIGN_FIRST" as const,
      stages: [
        {
          ...baseProject.stages[0],
          designSpec,
          architectureGraph: pag,
        },
      ],
    };
    const files = designFirstRepoHandoffFiles(project as never, project.stages[0] as never);
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("openapi.yaml"));
    assert.ok(paths.includes("mocks/handlers.ts"));
    assert.ok(paths.includes("docs/sdd/pantallas.md"));
    assert.ok(paths.includes("docs/sdd/datos.md"));

    const deliverables = buildProjectDeliverableExportInput(project as never, project.stages[0] as never);
    const enriched = enrichSpecKitFilesForHandoff([], deliverables, files);
    assert.ok(enriched.some((f) => f.path === "openapi.yaml"));
  });
});
