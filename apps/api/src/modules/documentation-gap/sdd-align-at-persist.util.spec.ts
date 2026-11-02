import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignSddDeliverablesAtPersist,
  alignTasksWithMddConflicts,
  alignUserStoriesWithMddConflicts,
  alignUserStoriesEntityCountsWithMdd,
} from "./sdd-align-at-persist.util.js";

const MDD_RABBITMQ = `## 2. Arquitectura y Stack

Broker: RabbitMQ para eventos de dominio.

## 6. Seguridad

JWT RS256 con par de claves JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.
`;

const MDD_TYPEORM = `## 2. Arquitectura y Stack

ORM: TypeORM con PostgreSQL.

## 6. Seguridad

JWT RS256 con par de claves JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.
`;

describe("alignTasksWithMddConflicts", () => {
  it("sustituye BullMQ por RabbitMQ cuando el MDD prioriza RabbitMQ", () => {
    const tasks = "- Configurar worker BullMQ para outbox\n- JWT_SECRET en .env";
    const out = alignTasksWithMddConflicts(MDD_RABBITMQ, tasks);
    assert.match(out, /RabbitMQ/);
    assert.ok(!/\bBullMQ\b/i.test(out));
    assert.ok(!/\bJWT_SECRET\b/.test(out));
    assert.match(out, /JWT_PRIVATE_KEY/);
  });

  it("sustituye Prisma por TypeORM cuando el MDD prioriza TypeORM", () => {
    const tasks = "- Migrar schema.prisma\n- Repositorio Prisma para usuarios";
    const out = alignTasksWithMddConflicts(MDD_TYPEORM, tasks);
    assert.match(out, /TypeORM/);
    assert.ok(!/\bPrisma\b/.test(out));
    assert.match(out, /entidades TypeORM/i);
  });

  it("reescribe rutas migrations/*.sql → .ts cuando ORM es TypeORM", () => {
    const tasks =
      "- [ ] Crear `apps/backend/src/infrastructure/database/migrations/1730000000000_create_security_events.sql`\n" +
      "- Montar init-db.sql en docker-compose para bootstrap";
    const out = alignTasksWithMddConflicts(MDD_TYPEORM, tasks);
    assert.match(
      out,
      /migrations\/1730000000000_create_security_events\.ts/,
    );
    assert.doesNotMatch(out, /create_security_events\.sql/);
    assert.match(out, /init-db\.sql/);
  });
});

describe("alignSddDeliverablesAtPersist", () => {
  it("marca changed y alinea tasks, userStories y blueprint", () => {
    const result = alignSddDeliverablesAtPersist({
      mddContent: MDD_RABBITMQ,
      tasksContent: "Worker BullMQ + Prisma",
      userStoriesContent: "Como ops quiero RabbitMQ y Bull",
      blueprintContent: "Cola BullMQ para jobs",
      infraContent: "JWT_SECRET=changeme",
    });
    assert.equal(result.changed, true);
    assert.ok(!/\bBullMQ\b/i.test(result.tasksContent ?? ""));
    assert.ok(!/\bBull\b/i.test(result.userStoriesContent ?? ""));
    assert.ok(!/\bJWT_SECRET\b/.test(result.infraContent ?? ""));
  });

  it("alinea infra JWT desde tasks cuando MDD carece de §6", () => {
    const mddTruncated = `## 2. Arquitectura y Stack

Broker: RabbitMQ.

## 4. Contratos de API

POST /api/v1/auth/login
`;
    const tasks = "- Implementar JwtService firmado con RS256\n- JWT_PRIVATE_KEY en .env";
    const result = alignSddDeliverablesAtPersist({
      mddContent: mddTruncated,
      tasksContent: tasks,
      infraContent: "JWT_SECRET=changeme\nNODE_ENV=development",
    });
    assert.ok(result.changed);
    assert.ok(!/\bJWT_SECRET\b/.test(result.infraContent ?? ""));
    assert.match(result.infraContent ?? "", /JWT_PRIVATE_KEY/);
  });

  it("no marca changed cuando ya está alineado (punto fijo)", () => {
    const tasks = "Worker RabbitMQ con TypeORM\nJWT_PRIVATE_KEY en .env";
    // Primera pasada: forma persistida (p. ej. separadores --- antes de cada H2).
    const first = alignSddDeliverablesAtPersist({
      mddContent: MDD_TYPEORM,
      tasksContent: tasks,
    });
    // Segunda pasada sobre la forma ya persistida: no debe cambiar nada.
    const second = alignSddDeliverablesAtPersist({
      mddContent: first.mddContent,
      tasksContent: first.tasksContent,
    });
    assert.equal(second.changed, false);
  });

  it("normaliza recuento de tablas en user stories según §3 SQL", () => {
    const mdd = `${MDD_TYPEORM}

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY);
CREATE TABLE sessions (id UUID PRIMARY KEY);
\`\`\`
`;
    const stories = "Como DBA quiero migrar las 23 tablas del dominio con TypeORM.";
    const out = alignUserStoriesEntityCountsWithMdd(mdd, stories);
    assert.match(out, /3 tablas/);
    assert.doesNotMatch(out, /23 tablas/);
    assert.match(out, /Nota \(alineación MDD\)/);
  });

  it("conserva Kubernetes (v2) en roadmap al alinear user stories", () => {
    const mdd = `${MDD_TYPEORM}

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const stories = "- Roadmap: Kubernetes (v2).\n- Dominio con 99 entidades legacy.";
    const out = alignUserStoriesWithMddConflicts(mdd, stories);
    assert.match(out, /Kubernetes \(v2\)/);
    assert.match(out, /1 entidades/);
  });

  it("sustituye TypeORM o raw SQL por TypeORM migrations", () => {
    const stories = "Migraciones con TypeORM o raw SQL para el esquema.";
    const out = alignUserStoriesWithMddConflicts(MDD_TYPEORM, stories);
    assert.match(out, /TypeORM migrations/);
    assert.doesNotMatch(out, /raw SQL/i);
  });

  it("alinea Dockerfile yarn → pnpm cuando §2 declara pnpm", () => {
    const mdd = `## 2. Arquitectura y Stack

Monorepo pnpm workspace. apps/backend packages/shared-types.
`;
    const infra = `\`\`\`dockerfile
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
RUN yarn build
\`\`\`
`;
    const result = alignSddDeliverablesAtPersist({ mddContent: mdd, infraContent: infra });
    assert.match(result.infraContent ?? "", /pnpm install --frozen-lockfile/);
    assert.match(result.infraContent ?? "", /pnpm build/);
    assert.doesNotMatch(result.infraContent ?? "", /yarn/i);
  });

  it("detecta pnpm en §2 aunque haya un ## suelto antes del gestor", () => {
    const mdd = `## 2. Arquitectura y Stack

## Dependencias clave

Monorepo con pnpm workspace y Turborepo.
`;
    const infra = "RUN yarn install --frozen-lockfile";
    const result = alignSddDeliverablesAtPersist({ mddContent: mdd, infraContent: infra });
    assert.match(result.infraContent ?? "", /pnpm install --frozen-lockfile/);
  });

  it("sustituye TypeORM o raw SQL cuando §2 declara TypeORM tras ## suelto", () => {
    const mdd = `## 2. Arquitectura y Stack

## Stack backend

ORM: TypeORM con PostgreSQL 16.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const stories = "Migraciones con TypeORM o raw SQL para el esquema.";
    const result = alignSddDeliverablesAtPersist({
      mddContent: mdd,
      userStoriesContent: stories,
    });
    assert.match(result.userStoriesContent ?? "", /TypeORM migrations/);
    assert.doesNotMatch(result.userStoriesContent ?? "", /raw SQL/i);
  });

  it("alinea Dockerfile yarn → pnpm con monorepo apps/packages sin pnpm explícito en §2", () => {
    const mdd = `## 2. Arquitectura y Stack

Backend Fastify. Monorepo apps/backend packages/shared-types.

## 7. Infraestructura

\`\`\`json
{ "deployment": { "orchestrator": "Railway" } }
\`\`\`
`;
    const infra = `\`\`\`dockerfile
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
RUN yarn build
\`\`\`
`;
    const result = alignSddDeliverablesAtPersist({ mddContent: mdd, infraContent: infra });
    assert.match(result.infraContent ?? "", /pnpm install --frozen-lockfile/);
    assert.match(result.infraContent ?? "", /pnpm-lock\.yaml/);
    assert.doesNotMatch(result.infraContent ?? "", /yarn/i);
  });

  it("sustituye hedging ORM desde manifest §7 cuando §2 no menciona TypeORM", () => {
    const mdd = `## 2. Arquitectura y Stack

Backend Fastify. Monorepo apps/backend packages/shared-types.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 7. Infraestructura

\`\`\`json
{ "orm": "typeorm", "deployment": { "orchestrator": "Railway" } }
\`\`\`
`;
    const stories = "Migraciones con TypeORM o raw SQL y migración SQL del esquema.";
    const tasks = "- [ ] Aplicar migración SQL en staging";
    const result = alignSddDeliverablesAtPersist({
      mddContent: mdd,
      userStoriesContent: stories,
      tasksContent: tasks,
    });
    assert.match(result.userStoriesContent ?? "", /TypeORM migrations/);
    assert.doesNotMatch(result.userStoriesContent ?? "", /raw SQL/i);
    assert.match(result.tasksContent ?? "", /migraciones TypeORM/i);
    assert.doesNotMatch(result.tasksContent ?? "", /migraci[oó]n SQL/i);
  });

  it("reescribe migrations/*.sql → .ts desde manifest §7 (PELUDO security_events)", () => {
    const mdd = `## 2. Arquitectura y Stack

Backend Fastify. Monorepo apps/backend packages/shared-types.

## 7. Infraestructura

\`\`\`json
{ "orm": "typeorm", "deployment": { "orchestrator": "Railway" } }
\`\`\`
`;
    const tasks =
      "- [ ] TypeORM migration en `apps/backend/src/infrastructure/database/migrations/1730000000000_create_security_events.sql`";
    const result = alignSddDeliverablesAtPersist({
      mddContent: mdd,
      tasksContent: tasks,
    });
    assert.match(
      result.tasksContent ?? "",
      /migrations\/1730000000000_create_security_events\.ts/,
    );
    assert.doesNotMatch(result.tasksContent ?? "", /security_events\.sql/);
  });
});
