import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProposedComponentDiagramMermaid,
  extractDomainModulesFromMddSections,
  injectProposedComponentDiagramIntoSection2,
  parseGreenfieldMddSignals,
  proposedComponentDiagramIsGeneric,
} from "./mdd-component-diagram.util.js";

const SAMPLE_MDD = `# Master Design Document

## 1. Contexto

Plataforma SSO con MFA.

## 2. Arquitectura y Stack

### 2.1 Backend
NestJS v10 con módulos por dominio.

### 2.2 Frontend
React 18 + Vite.

### 2.3 Datos
PostgreSQL 16 para identidad; Redis para colas de email.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh |

### POST /api/auth/login

Autenticación.

## 5. Lógica y Edge Cases

Refresh rotativo.

## 6. Seguridad

(Pendiente)

## 7. Infraestructura

(Pendiente)
`;

const MULTI_DOMAIN_MDD = `# Master Design Document

## 1. Contexto

Plataforma multi-tenant con proyectos y facturación.

## 2. Arquitectura y Stack

### 2.1 Backend
NestJS v10. Core (Auth, Projects, Tenants, Billing).

### 2.2 Frontend
React 18 + Vite.

### 2.3 Datos
PostgreSQL 16; Redis para colas de email.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE tenants (id UUID PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE projects (id UUID PRIMARY KEY, tenant_id UUID NOT NULL);
CREATE TABLE invoices (id UUID PRIMARY KEY, tenant_id UUID NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/v1/auth/login | Login |
| GET | /api/v1/tenants | Listar tenants |
| GET | /api/v1/projects | Listar proyectos |
| GET | /api/v1/billing/invoices | Facturas |

### POST /api/v1/auth/login

Login.

## 5. Lógica y Edge Cases

Multi-tenant.

## 6. Seguridad

JWT.

## 7. Infraestructura

Docker.
`;

describe("mdd-component-diagram.util", () => {
  it("parseGreenfieldMddSignals detecta stack y conteos", () => {
    const signals = parseGreenfieldMddSignals(SAMPLE_MDD);
    assert.ok(signals);
    assert.equal(signals!.frontend, "React");
    assert.equal(signals!.backend, "NestJS");
    assert.equal(signals!.primaryDb, "PostgreSQL");
    assert.equal(signals!.cacheOrQueue, "Redis");
    assert.equal(signals!.tableCount, 2);
    assert.ok(signals!.endpointCount >= 2);
  });

  it("buildProposedComponentDiagramMermaid incluye capas FE/BE/DB", () => {
    const signals = parseGreenfieldMddSignals(SAMPLE_MDD)!;
    const mermaid = buildProposedComponentDiagramMermaid(signals);
    assert.ok(mermaid);
    assert.match(mermaid!, /flowchart TB/);
    assert.match(mermaid!, /NestJS/);
    assert.match(mermaid!, /React/);
    assert.match(mermaid!, /PostgreSQL/);
    assert.match(mermaid!, /Redis/);
    assert.match(mermaid!, /BE_DOMAIN\[Services \/ Domain\]/);
  });

  it("extractDomainModulesFromMddSections agrupa rutas y tablas por dominio", () => {
    const modules = extractDomainModulesFromMddSections({
      section2Body: "Core (Auth, Projects, Tenants, Billing)",
      section3Body: MULTI_DOMAIN_MDD.split("## 3. Modelo de Datos")[1]!.split("## 4.")[0]!,
      section4Body: MULTI_DOMAIN_MDD.split("## 4. Contratos de API")[1]!.split("## 5.")[0]!,
      fullDraft: MULTI_DOMAIN_MDD,
    });
    assert.ok(modules.length >= 4);
    const keys = new Set(modules.map((m) => m.key));
    assert.ok(keys.has("auth"));
    assert.ok(keys.has("tenants"));
    assert.ok(keys.has("projects"));
    assert.ok(keys.has("billing"));
  });

  it("buildProposedComponentDiagramMermaid enriquecido con módulos MOD_*", () => {
    const signals = parseGreenfieldMddSignals(MULTI_DOMAIN_MDD)!;
    const mermaid = buildProposedComponentDiagramMermaid(signals)!;
    assert.match(mermaid, /MOD_auth/);
    assert.match(mermaid, /MOD_projects/);
    assert.match(mermaid, /MOD_tenants/);
    assert.match(mermaid, /BE_API --> MOD_auth/);
    assert.doesNotMatch(mermaid, /BE_DOMAIN/);
  });

  it("injectProposedComponentDiagramIntoSection2 regenera diagrama genérico previo", () => {
    const generic = injectProposedComponentDiagramIntoSection2(SAMPLE_MDD);
    assert.ok(proposedComponentDiagramIsGeneric(generic.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? ""));
    const enriched = injectProposedComponentDiagramIntoSection2(MULTI_DOMAIN_MDD);
    assert.match(enriched, /MOD_projects/);
    assert.match(enriched, /módulos agrupados por prefijos de rutas API/);
    const second = injectProposedComponentDiagramIntoSection2(enriched);
    assert.equal(second, enriched);
  });

  it("injectProposedComponentDiagramIntoSection2 es idempotente", () => {
    const first = injectProposedComponentDiagramIntoSection2(SAMPLE_MDD);
    assert.match(first, /### Diagrama de componentes propuesto/);
    assert.match(first, /```mermaid/);
    assert.match(first, /FE_CLIENT -->/);
    const second = injectProposedComponentDiagramIntoSection2(first);
    assert.equal(second, first);
  });

  it("buildProposedComponentDiagramMermaid enlaza cola al hub API en backend enriquecido", () => {
    const mdd = `# Master Design Document

## 1. Contexto

API KMS.

## 2. Arquitectura y Stack

Backend NestJS. MVP API-only sin dashboard ni frontend.
BullMQ con Redis para jobs.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/keys | Listar |

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

JWT.

## 7. Infraestructura

Docker.
`;
    const signals = parseGreenfieldMddSignals(mdd);
    assert.ok(signals);
    assert.equal(signals!.frontend, undefined);
    assert.equal(signals!.cacheOrQueue, "BullMQ");
    const mermaid = buildProposedComponentDiagramMermaid(signals!)!;
    assert.match(mermaid, /MOD_keys/);
    assert.match(mermaid, /API --> BullMQ/);
    assert.doesNotMatch(mermaid, /BE_DOMAIN -->/);
  });

  it("no infiere BullMQ desde @nestjs/bull si Message Broker es RabbitMQ", () => {
    const mdd = `# Master Design Document

## 2. Arquitectura y Stack

| Componente | Tecnología |
|:-----------|:-----------|
| Message Broker | RabbitMQ 3.12 |
| Cache | Redis 7.2 |

Circuit Breaker con \`@nestjs/bull\` u opossum.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE outbox (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
| GET | /api/v1/health | Health |

## 5. Lógica

x

## 6. Seguridad

x

## 7. Infraestructura

x
`;
    const signals = parseGreenfieldMddSignals(mdd);
    assert.equal(signals?.cacheOrQueue, "RabbitMQ");
  });

  it("no inyecta diagrama propuesto si §2 ya tiene diagrama de microservicios", () => {
    const mdd = `# MDD

## 2. Arquitectura y Stack

### 2.6 Diagrama de componentes

\`\`\`mermaid
graph TD
  subgraph Microservicios
    AUTH[Auth Service]
    KMS[Key Service]
  end
  GW[Kong Gateway] --> AUTH
\`\`\`

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| GET | /api/v1/health | Health |

## 5. Lógica

x

## 6. Seguridad

x

## 7. Infraestructura

x
`;
    const out = injectProposedComponentDiagramIntoSection2(mdd);
    assert.doesNotMatch(out, /### Diagrama de componentes propuesto/);
  });

  it("repara diagrama propuesto con arista BE_DOMAIN huérfana", () => {
    const broken = `# MDD

## 2. Arquitectura y Stack

Backend NestJS. Panel web fuera del alcance del MVP. Commander CLI.
BullMQ con Redis.

### Diagrama de componentes propuesto

\`\`\`mermaid
flowchart TB
  subgraph_be_NestJS["NestJS"]
    API["REST API"]
    SVC[Services / Domain]
  end
  Redis["Redis"]
  API --> SVC
  BE_DOMAIN --> Redis
\`\`\`

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| GET | /api/v1/health | Health |

## 5. Lógica

x

## 6. Seguridad

x

## 7. Infraestructura

x
`;
    const out = injectProposedComponentDiagramIntoSection2(broken);
    assert.doesNotMatch(out, /BE_DOMAIN\s*-->/);
    assert.match(out, /SVC\s*-->\s*BullMQ/);
  });
});
