import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alignDockerfilePackageManager,
  repairBulletedYamlLines,
  repairFalseDockerfileHeadings,
  repairInfraMarkdown,
  repairMislabeledYamlFences,
  repairUnfencedYamlDesignBlock,
} from "./repair-infra-markdown.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import { compilePagToInfraMarkdown } from "./document-compiler.js";
import { repairPastedMarkdown } from "./repair-pasted-markdown.js";
import type { ProjectArchitectureGraph } from "./project-architecture-graph.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const infraFixture = readFileSync(join(fixtureDir, "repair-infra-markdown.fixture.txt"), "utf8");

describe("repairFalseDockerfileHeadings", () => {
  it("convierte ### WORKDIR en instrucción Docker", () => {
    const out = repairFalseDockerfileHeadings("### WORKDIR /app\nCOPY . .");
    assert.match(out, /^WORKDIR \/app/m);
    assert.doesNotMatch(out, /^### WORKDIR/);
  });
});

describe("repairBulletedYamlLines", () => {
  it("convierte viñetas en YAML indentado", () => {
    const raw = `version: '3.8'
services:
  postgres:
- image: postgres:16-alpine
- container_name: costos-postgres
- environment:
- POSTGRES_USER: user
- depends on:
- postgres:
- condition: service_healthy`;
    const out = repairBulletedYamlLines(raw);
    assert.match(out, /^\s+image: postgres:16-alpine/m);
    assert.match(out, /depends_on:/);
    assert.doesNotMatch(out, /^-\s+image:/m);
  });
});

describe("repairInfraMarkdown", () => {
  it("repara Dockerfile + compose + env típico de doc infra LLM", () => {
    const doc = `## 1. Dockerfile multietapa

### Backend (NestJS)

# ---- Build Stage ----
FROM node:20-alpine AS builder

### WORKDIR /app

COPY package*.json ./
RUN npm ci

## 2. docker-compose.yml

\`\`\`yaml
version: '3.8'

services:
\`\`\`
  postgres:
- image: postgres:16-alpine
- container_name: costos-postgres

## 3. Variables de entorno (.env.example)

# --- Base de datos ---
DATABASE_URL=postgresql://user:pass@postgres:5432/db

## 4. Volúmenes`;

    const out = repairInfraMarkdown(doc);
    assert.match(out, /```dockerfile[\s\S]*FROM node:20-alpine[\s\S]*WORKDIR \/app[\s\S]*```/);
    assert.match(out, /```yaml[\s\S]*image: postgres:16-alpine[\s\S]*```/);
    assert.match(out, /```env[\s\S]*DATABASE_URL=[\s\S]*```/);
    assert.doesNotMatch(out, /### WORKDIR/);
  });

  it("formatDocumentMarkdown aplica reparación infra", () => {
    const doc = `## 2. docker-compose.yml

\`\`\`yaml
services:
\`\`\`
  backend:
- image: node:20-alpine
- ports:
- "3000:3000"

## 3. Variables de entorno

NODE_ENV=development`;
    const out = formatDocumentMarkdown(doc);
    assert.match(out, /```yaml[\s\S]*backend:[\s\S]*image: node:20-alpine/);
    assert.match(out, /```env[\s\S]*NODE_ENV=development/);
  });

  it("repara fixture realista LLM (dockerfile/nginx/compose/env)", () => {
    const out = repairInfraMarkdown(infraFixture);
    assert.match(out, /```dockerfile[\s\S]*CMD \["node"[\s\S]*```[\s\S]*\*\*Características/);
    assert.match(out, /```nginx[\s\S]*proxy_pass[\s\S]*```[\s\S]*---/);
    assert.match(out, /```yaml[\s\S]*postgres:[\s\S]*image: postgres:16-alpine/);
    assert.match(out, /^\s{2}redis:/m);
    assert.match(out, /depends_on:/);
    assert.doesNotMatch(out, /\*\*Notas:\*\*[\s\S]*```yaml/);
    assert.match(out, /```env[\s\S]*NODE_ENV=development[\s\S]*```/);
    for (const block of out.match(/```dockerfile[\s\S]*?```/g) ?? []) {
      assert.doesNotMatch(block, /NODE_ENV=/);
    }
    assert.match(out, /```yaml[\s\S]*postgres_data:[\s\S]*```[\s\S]*- \*\*postgres_data/);
  });

  it("relabel dockerfile con tokens YAML de design system a yaml", () => {
    const doc = `# Design tokens
\`\`\`dockerfile
colors:
  primary: "#3366FF"
  surface: "#FFFFFF"
typography:
  fontFamily: Inter
\`\`\`
`;
    const out = repairMislabeledYamlFences(doc);
    assert.match(out, /```yaml[\s\S]*colors:[\s\S]*primary/);
    assert.doesNotMatch(out, /```dockerfile/);
  });

  it("relabel dockerfile con listas YAML de tipografía (PELUDO design-system)", () => {
    const doc = `typography:
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
    const out = repairInfraMarkdown(doc);
    assert.match(out, /```yaml[\s\S]*typography:[\s\S]*label-sm/);
    assert.doesNotMatch(out, /```dockerfile/);
  });

  it("repairUnfencedYamlDesignBlock envuelve frontmatter YAML completo antes de fence erróneo", () => {
    const doc = `# Guía UX/UI

typography:
  h1:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 32px
\`\`\`dockerfile
  label-sm:
- fontFamily: "Inter, system-ui, sans-serif"
- fontSize: 13px
\`\`\`
`;
    const out = repairUnfencedYamlDesignBlock(doc);
    assert.match(out, /```yaml[\s\S]*typography:[\s\S]*label-sm/);
    assert.doesNotMatch(out, /```dockerfile/);
  });
});

describe("alignDockerfilePackageManager", () => {
  it("reemplaza yarn por pnpm en RUN/COPY cuando §2 es pnpm", () => {
    const infra = `\`\`\`dockerfile
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
RUN yarn build
\`\`\`
`;
    const out = alignDockerfilePackageManager(infra, "pnpm");
    assert.match(out, /pnpm-lock\.yaml/);
    assert.match(out, /RUN pnpm install --frozen-lockfile/);
    assert.match(out, /RUN pnpm build/);
    assert.doesNotMatch(out, /yarn/i);
  });

  it("no modifica cuando el gestor autoritativo es yarn", () => {
    const infra = "RUN yarn install --frozen-lockfile";
    assert.equal(alignDockerfilePackageManager(infra, "yarn"), infra);
  });
});

describe("repairInfraMarkdown — prosa que parece instrucción Dockerfile", () => {
  it("no envuelve en ```dockerfile una línea de prosa que empieza con 'Healthcheck'", () => {
    const md = [
      "### 7.3 Resiliencia",
      "",
      "Healthcheck de Docker cada 30 segundos contra `GET /api/v1/health`.",
      "Reinicio automático con `restart: unless-stopped`.",
      "",
      "### 7.4 Infraestructura",
      "",
      "Texto.",
    ].join("\n");
    assert.ok(!repairInfraMarkdown(md).includes("```"));
  });
});

describe("repairInfraMarkdown — no rehace Markdown ya válido (salida del compilador PAG)", () => {
  const basePag = (database: string, withContent: boolean): ProjectArchitectureGraph => ({
    version: "1.0.0",
    projectName: "Proyecto Demo",
    description: "Demo",
    stack: {
      runtime: "Node.js 20",
      backendFramework: "NestJS",
      frontendFramework: "React 18 + Vite",
      database,
      orm: "Prisma",
      cache: "Redis 7",
    },
    entities: [],
    endpoints: withContent
      ? [
          { path: "/api/v1/a", method: "GET", description: "A", authRequired: false, errorCodes: [404], rolesAllowed: [] },
          { path: "/api/v1/b", method: "POST", description: "B", authRequired: true, errorCodes: [400], rolesAllowed: ["ADMIN"] },
        ]
      : [],
    services: withContent
      ? [
          { name: "AModule", layer: "backend_module", handledEndpoints: ["/api/v1/a"], dependencies: [] },
          { name: "BModule", layer: "backend_module", handledEndpoints: ["/api/v1/b"], dependencies: ["AModule"] },
        ]
      : [],
  });

  for (const [etiqueta, pag] of [
    ["PAG sin endpoints ni servicios", basePag("PostgreSQL 16", false)],
    ["PAG con 2 endpoints y 2 servicios", basePag("PostgreSQL 16", true)],
    ["PAG con MongoDB", basePag("MongoDB 7", true)],
  ] as const) {
    it(`es idempotente sobre ${etiqueta}`, () => {
      const md = compilePagToInfraMarkdown(pag);
      assert.equal(repairInfraMarkdown(md), md);
    });

    it(`repairPastedMarkdown conserva yaml byte a byte y tabla env sin fence (${etiqueta})`, () => {
      const md = compilePagToInfraMarkdown(pag);
      const yamlOriginal = md.match(/```yaml\n([\s\S]*?)\n```/)![1];
      const out = repairPastedMarkdown(md);
      assert.ok(out.includes(`\`\`\`yaml\n${yamlOriginal}\n\`\`\``));
      assert.doesNotMatch(out, /```env/);
      assert.match(out, /\|:-+\|:-+/);
    });
  }

  it("sigue reparando un compose realmente roto (viñetas sin indentación)", () => {
    const roto = `## 2. Definición Docker Compose (\`docker-compose.yml\`)

\`\`\`yaml
services:
  postgres:
- image: postgres:16-alpine
- restart: always
\`\`\`

## 3. Matriz de Variables de Entorno

\`\`\`env
A=1
\`\`\`
`;
    const out = repairInfraMarkdown(roto);
    assert.match(out, /^\s+image: postgres:16-alpine/m);
    assert.notEqual(out, roto);
  });

  it("una sección de variables sin tabla GFM sigue envolviéndose en env", () => {
    const sucio = `## 3. Variables de entorno

A=1
B=2
`;
    assert.match(repairInfraMarkdown(sucio), /```env\nA=1\nB=2\n```/);
  });
});

describe("repairInfraMarkdown — YAML compose válido con escalares de bloque y flow multilínea", () => {
  const wrap = (yaml: string) =>
    `## 1. Dockerfile\n\n\`\`\`dockerfile\nFROM node:20\n\`\`\`\n\n## 2. docker-compose.yml\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n## 3. Variables de entorno\n\n\`\`\`env\nA=1\n\`\`\`\n`;

  it("command con escalar plegado `>` se conserva byte a byte", () => {
    const doc = wrap("services:\n  api:\n    image: x\n    command: >\n      sh -c \"npm run migrate &&\n      node dist/main.js\"\n    restart: always");
    assert.equal(repairInfraMarkdown(doc), doc);
  });

  it("escalar literal `|-` se conserva", () => {
    const doc = wrap("services:\n  api:\n    image: x\n    command: |-\n      echo a\n      echo b\n    restart: always");
    assert.equal(repairInfraMarkdown(doc), doc);
  });

  it("healthcheck test flow multilínea se conserva", () => {
    const doc = wrap("services:\n  api:\n    image: x\n    healthcheck:\n      test: [\"CMD\",\n        \"curl\", \"-f\",\n        \"http://localhost/health\"]\n      interval: 10s");
    assert.equal(repairInfraMarkdown(doc), doc);
  });

  it("secuencia de mapas (`- type: bind` con source/target a +2 del guion) se conserva", () => {
    const doc = wrap("services:\n  api:\n    image: node:20\n    volumes:\n      - type: bind\n        source: ./data\n        target: /data");
    assert.equal(repairInfraMarkdown(doc), doc);
  });

  it("anchors y merge keys (`x-common: &common`, `<<: *common`) se conservan", () => {
    const doc = wrap("x-common: &common\n  restart: unless-stopped\nservices:\n  api:\n    <<: *common\n    image: node:20");
    assert.equal(repairInfraMarkdown(doc), doc);
  });

  it("sangrado base uniforme de 6 espacios se conserva", () => {
    const doc = wrap("      services:\n        api:\n          image: x");
    assert.equal(repairInfraMarkdown(doc), doc);
  });
});
