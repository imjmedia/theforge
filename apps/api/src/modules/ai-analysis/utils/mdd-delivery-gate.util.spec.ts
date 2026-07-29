import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validateMddForDelivery,
  mddDeliveryGateHasBlockers,
  applyDeliveryGateToSemaphoreStatus,
  mddStreamDeliveryGateFields,
} from "./mdd-delivery-gate.util.js";

const VALID_MDD = `# Master Design Document

## 1. Contexto

ForgeOps es una plataforma SaaS de gestión de licenciamiento y aprovisionamiento de software que centraliza el ciclo de vida completo de plugins comerciales sobre el ecosistema de The Forge + Ariadne + Kreo Eventos. La plataforma resuelve tres dolores simultáneos del equipo de operaciones y comercial de KreoDevs: gestión manual del licenciamiento (cada plugin requiere su propio portal de claves, lógica de tiers, revocación y panel de auditoría), aprovisionamiento de infraestructura heterogéneo y propenso a error (despliegue manual de The Forge + Ariadne con costo de 2-4 horas por despliegue) y falta de monetización unificada (el cliente paga suscripción + costo de servidor por dos canales distintos, reduciendo conversión y diluyendo margen). El alcance del MVP incluye: Catálogo de Aplicaciones con URL de webhook de creación, secreto compartido, plantilla JSON de aprovisionamiento, plantilla \`.env\` e identificador de producto Stripe; Paquetes Comerciales vinculados a una aplicación; Aprovisionamiento en VPS Privado con contratación automática vía API contabo; Motor de Licenciamiento Agnóstico; Facturación Unificada vía Stripe; Dashboards para cliente/admin/Finanzas.

## 2. Arquitectura y Stack

Backend: NestJS 10 sobre Node.js 20 LTS con TypeScript 5.4, Prisma 5 como ORM y PostgreSQL 16 como base de datos principal. BullMQ 5 sobre Redis 7 para colas asíncronas de aprovisionamiento. Zod 3 + nestjs-zod para validación en el borde, undici para HTTP saliente, opossum para circuit breaker. Frontend: React 18 con Vite 5, TanStack Query 5 para estado servidor, Zustand 4 para estado UI, Tailwind 3 + Radix UI + kreo-ui 5.3 para componentes, React Hook Form 7 + Zod resolver para forms, Recharts 2 para dashboards. Despliegue: Docker multi-stage, Kubernetes (Helm) para producción, Docker Compose para desarrollo local. CI/CD con GitHub Actions y OpenTelemetry + Grafana + Loki + Tempo para observabilidad.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(45),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  ip_address INET,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| POST | /api/v1/auth/login | Inicio de sesión con email y password (opcional MFA TOTP) |
| POST | /api/v1/auth/refresh | Renovar access token con refresh token opaco |
| GET  | /api/v1/tenants | Listar tenants del usuario actual (paginado) |
| POST | /api/v1/tenants | Crear nuevo tenant (desencadena aprovisionamiento) |
| GET  | /api/v1/tenants/:id | Detalle de un tenant con licencias y suscripciones |

\`\`\`json
{
  "email": "user@example.com",
  "password": "secret"
}
\`\`\`

\`\`\`json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "rt_8x9aB2c",
  "expiresIn": 900
}
\`\`\`

## 5. Lógica y Edge Cases

- Login: si el usuario tiene MFA habilitado, exigir código TOTP RFC 6238 en el mismo request. Sin password nunca es suficiente. Reintentos fallidos (>5 en 15 min) bloquean la cuenta y registran en security_events.
- Refresh tokens: rotación automática en cada uso. El refresh viejo queda marcado como revocado; un reintento con token revocado invalida toda la cadena familiar.
- Aprovisionamiento de tenant privado (VPS vía Contabo): job BullMQ con reintentos exponenciales 1s, 5s, 30s, 2m, 10m. Si tras 4 intentos sigue fallando, se notifica al equipo de Ops.
- Cancelación de suscripción: webhook Stripe \`customer.subscription.deleted\` marca la licencia activa como revocada y propaga push a las instancias.

## 6. Seguridad

Hashing de contraseñas con **Argon2id** (memCost ≥ 64 MiB, timeCost ≥ 3, parallelism ≥ 1). Sesiones server-side con token opaco + \`refresh_token_hash\` (SHA-256); nunca se guarda el token en texto plano. Cookies con \`HttpOnly\`, \`Secure\`, \`SameSite=Lax\`. Expiración absoluta de 8 h y expiración deslizante por inactividad de 30 min. Bloqueo temporal progresivo tras 5 intentos fallidos por usuario/IP con ventana de 15 minutos y notificación vía Resend. MFA TOTP RFC 6238 opcional pero recomendado para admin/operaciones/finanzas; obligatorio desde el primer login para super_admin. Re-prompt MFA (challenge fresco ≤ 5 min) obligatorio para acciones críticas: cambio de application_catalog.webhookSecret, revocación masiva de licencias, modificación de system_settings, exportación de datos de Finanzas, alta de un nuevo admin. Webhooks firmados con HMAC-SHA256 + ventana temporal anti-replay de 5 min. Toda integración externa (Stripe, API contabo, Dokploy, Resend) sobre TLS 1.2+ con verificación estricta de certificado y pinning opcional para Stripe. Defensa en profundidad con auditoría continua en security_events. RLS en PostgreSQL multi-tenant con SET LOCAL app.current_tenant por conexión; el rol app_user_rls no tiene BYPASSRLS.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "backend": {
      "runtime": "node:20-alpine",
      "framework": "nestjs@10",
      "exposed_port": 3000,
      "healthcheck": "GET /api/v1/health"
    },
    "database": {
      "engine": "postgresql@16",
      "hosting": "postgres:5432 (compose)",
      "migrations": "prisma migrate deploy en entrypoint"
    },
    "queue": {
      "engine": "bullmq@5",
      "hosting": "redis://theforge-redis-queue:6379"
    },
    "graph": {
      "engine": "falkordb",
      "hosting": "theforge-falkor-sdd:6379"
    }
  },
  "deploy": {
    "method": "docker compose",
    "ssl": "traefik + letsencrypt",
    "backups": "pg_dump diario a s3"
  }
}
\`\`\`
`;

describe("validateMddForDelivery", () => {
  it("aprueba MDD canónico mínimo (score >= 90, sin blockers)", () => {
    const result = validateMddForDelivery(VALID_MDD);
    assert.equal(result.blockers.length, 0, result.blockers.join("; "));
    assert.ok(result.score >= 90, `score=${result.score}`);
    assert.equal(result.ok, true);
  });

  it("bloquea §4 con placeholder (Falta: definir endpoints) aunque tenga >200 chars", () => {
    const draft = VALID_MDD.replace(
      /## 4\. Contratos de API[\s\S]*?(?=## 5\.)/,
      `## 4. Contratos de API

(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco; en la siguiente iteración se deben completar los contratos.)

### Endpoints journey core (sincronización determinista)

| Método | Ruta | Descripción | Auth | Notas |
| :----- | :--- | :---------- | :--- | :---- |
| GET | /api/v1/tenants/{id}/quota | Quota tokens tenant | Bearer | DBGA/BRD |

`,
    );
    const result = validateMddForDelivery(draft);
    assert.ok(
      result.blockers.some((b) => /4\.\s*Contratos|§4|endpoints reales/i.test(b)),
      result.blockers.join("; "),
    );
    assert.equal(result.ok, false);
  });

  it("bloquea §4 solo con tabla journey sin ```json ni MÉTODO /ruta", () => {
    const draft = VALID_MDD.replace(
      /## 4\. Contratos de API[\s\S]*?(?=## 5\.)/,
      `## 4. Contratos de API

Resumen de journey sin contratos ejecutables. Texto de relleno para superar el umbral de longitud mínima de sustancia del gate de entrega MDD y evitar falsos negativos por body corto.

| Método | Ruta | Descripción |
| :----- | :--- | :---------- |
| GET | /api/v1/tenants/{id}/quota | Quota |

`,
    );
    const result = validateMddForDelivery(draft);
    assert.ok(
      result.blockers.some((b) => /4\.\s*Contratos|§4|endpoints reales/i.test(b)),
      result.blockers.join("; "),
    );
  });

  it("auto-alinea node:XX en §7 con §2 antes de validar (sin blocker Node)", () => {
    const draft = `# MDD

## 2. Arquitectura y Stack

| Capa | Tecnología | Versión |
| Backend | Node.js | 20 |

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| GET | /api/v1/health |

\`\`\`json
{"ok": true}
\`\`\`

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

JWT.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "backend": {
      "container": { "base_image": "node:22-alpine", "exposed_port": 3000 }
    }
  }
}
\`\`\`
`;
    const result = validateMddForDelivery(draft);
    assert.ok(
      !result.blockers.some((b) => b.includes("versión Node distinta")),
      result.blockers.join("; "),
    );
  });

  it("bloquea prosa SQL pegada a DDL (Peludo)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY
);
-- comentario partido
  particionado por mes
application_id o NULL para system
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| POST | /auth/login | Login |

\`\`\`json
{"a":1}
\`\`\`

## 6. Seguridad

Hash Argon2id.

## 7. Infraestructura

K8s.
`;
    const result = validateMddForDelivery(draft);
    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((b) => b.includes("prosa inválida") || b.includes("Secciones obligatorias")),
    );
  });

  it("auto-repara o advierte outbox duplicado sin bloquear (Peludo)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE eventos (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  procesado BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE outbox (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| POST | /events | Publicar |

\`\`\`json
{"x":1}
\`\`\`

## 6. Seguridad

JWT.

## 7. Infraestructura

Lee la tabla eventos pendientes de publicar.
`;
    const result = validateMddForDelivery(draft);
    assert.equal(
      result.blockers.filter((b) => b.includes("outbox-like")).length,
      0,
      result.blockers.join("; "),
    );
  });

  it("advierte tablas §6 sin CREATE TABLE en §3 (security_events, refresh_tokens)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

| POST | /auth/login | Login |

\`\`\`json
{"email":"a"}
\`\`\`

## 6. Seguridad

- Los intentos fallidos se registran en security_events.
- Los refresh tokens rotativos se almacenan en refresh_tokens.

## 7. Infraestructura

Docker.
`;
    const result = validateMddForDelivery(draft);
    assert.ok(
      result.warnings.some((b) => b.includes("security_events")),
      result.warnings.join("; "),
    );
    assert.ok(
      result.warnings.some((b) => b.includes("refresh_tokens")),
      result.warnings.join("; "),
    );
    assert.equal(
      result.blockers.filter((b) => /security_events|refresh_tokens/.test(b)).length,
      0,
    );
  });

  it("auto-repara bloque ```sql sin cerrar o advierte sin bloquear", () => {
    const draft = `${VALID_MDD.split("## 3. Modelo de Datos")[0]}## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);

### Diagrama entidad-relación

\`\`\`TechnicalMetadata
[high_security]
\`\`\`
${VALID_MDD.split("## 4. Contratos de API")[1]}`;
    const result = validateMddForDelivery(draft);
    assert.equal(
      result.blockers.filter((b) => b.includes("```sql sin cerrar")).length,
      0,
      result.blockers.join("; "),
    );
  });

  it("deduplica criterios UAT duplicados §1/§5 sin bloquear", () => {
    const uatBullets = `### Criterios UAT
- Login exitoso con credenciales válidas.
- Exportación rechazada sin aprobación dual.
- Auditoría registra cada intento fallido.`;
    const sec1Anchor = "## 1. Contexto\n\n";
    const sec5Anchor = "## 5. Lógica y Edge Cases\n\n";
    const draft1 = VALID_MDD.replace(sec1Anchor, `${sec1Anchor}${uatBullets}\n\n`);
    const draft = draft1.replace(sec5Anchor, `${sec5Anchor}${uatBullets}\n\n`);
    const result = validateMddForDelivery(draft, { skipDeterministicRepair: true });
    assert.equal(result.blockers.length, 0, result.blockers.join("; "));
  });

  it("mddDeliveryGateHasBlockers refleja blockers del gate", () => {
    assert.equal(mddDeliveryGateHasBlockers(VALID_MDD), false);
    assert.equal(mddDeliveryGateHasBlockers(""), true);
  });
});

describe("applyDeliveryGateToSemaphoreStatus", () => {
  it("degrada a rojo con blockers aunque el semáforo fuera verde", () => {
    const gate = validateMddForDelivery("# MDD\n\n## 1. Contexto\n\nSin secciones.");
    assert.ok(gate.blockers.length > 0);
    assert.equal(applyDeliveryGateToSemaphoreStatus("green", gate), "red");
  });

  it("degrada a amarillo con warnings sin blockers", () => {
    const gate = { ok: false, score: 85, blockers: [] as string[], warnings: ["Advertencia menor"] };
    assert.equal(applyDeliveryGateToSemaphoreStatus("green", gate), "yellow");
  });
});

describe("mddStreamDeliveryGateFields", () => {
  it("incluye deliveryGate en payload done cuando prepareMddForOutput validó el borrador", async () => {
    const { prepareMddForOutput } = await import("./mdd-prepare-output.js");
    const gateRef: { current?: ReturnType<typeof validateMddForDelivery> } = {};
    await prepareMddForOutput(VALID_MDD, { deliveryGateRef: gateRef });
    const fields = mddStreamDeliveryGateFields(gateRef.current, "green");
    assert.ok(fields.deliveryGate);
    assert.equal(fields.deliveryGate.ok, true);
    assert.equal(fields.status, "green");
  });

  it("done con MDD inválido expone deliveryGate y status rojo", () => {
    const gate = validateMddForDelivery("## 1. Contexto\n\nIncompleto.");
    const fields = mddStreamDeliveryGateFields(gate, "green");
    assert.equal(fields.deliveryGate?.ok, false);
    assert.equal(fields.status, "red");
    assert.ok((fields.deliveryGate?.blockers.length ?? 0) > 0);
  });
});

describe("validateMddForDelivery — substance check (CHANGELOG [Unreleased])", () => {
  it("bloquea MDD con §2 en (Pendiente) aunque headings estén", () => {
    const draft = `# MDD\n\n## 1. Contexto\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10)}\n\n## 2. Arquitectura y Stack\n\n(Pendiente: Arquitecto de Software)\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE x (id UUID PRIMARY KEY); ".repeat(20)}\n\n\`\`\`TechnicalMetadata\n[high_security]\n\`\`\`\n\n## 4. Contratos de API\n\n${"Lorem ipsum dolor sit amet. ".repeat(20)}\n\n## 5. Lógica y Edge Cases\n\n${"Lorem ipsum dolor sit amet. ".repeat(15)}\n\n## 6. Seguridad\n\n${"Argon2id para hashing. ".repeat(20)}\n\n## 7. Infraestructura\n\n${"Docker Compose con PostgreSQL y Redis. ".repeat(15)}`;
    const result = validateMddForDelivery(draft);
    assert.equal(result.ok, false, "no debería pasar con §2 en (Pendiente)");
    const s2 = result.blockers.find((b) => b.includes("2. Arquitectura"));
    assert.ok(s2, "debería haber un blocker mencionando §2");
    assert.match(s2, /Pendiente|insuficiente/i);
  });

  it("bloquea MDD con §5 (Pendiente) aislado (las demás sustanciales)", () => {
    const draft = `# MDD\n\n## 1. Contexto\n\n${"Lorem ipsum ".repeat(60)}\n\n## 2. Arquitectura y Stack\n\n${"NestJS PostgreSQL Redis. ".repeat(20)}\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE x (id UUID PRIMARY KEY); ".repeat(15)}\n\n\`\`\`TechnicalMetadata\n[high_security]\n\`\`\`\n\n## 4. Contratos de API\n\n${"Lorem ipsum dolor sit amet. ".repeat(20)}\n\n## 5. Lógica y Edge Cases\n\n(Pendiente)\n\n## 6. Seguridad\n\n${"Argon2id. ".repeat(50)}\n\n## 7. Infraestructura\n\n${"Docker. ".repeat(40)}`;
    const result = validateMddForDelivery(draft);
    assert.equal(result.ok, false);
    const s5 = result.blockers.find((b) => b.includes("5. Lógica"));
    assert.ok(s5, "debería bloquear §5");
  });

  it("bloquea MDD con §3 SQL muy corto (< 100 chars) aunque headings bien", () => {
    const draft = `# MDD\n\n## 1. Contexto\n\n${"Lorem ipsum ".repeat(60)}\n\n## 2. Arquitectura y Stack\n\n${"NestJS ".repeat(40)}\n\n## 3. Modelo de Datos\n\nsolo tres tablas cortas\n\n\`\`\`TechnicalMetadata\n[high_security]\n\`\`\`\n\n## 4. Contratos de API\n\n${"Lorem ipsum ".repeat(20)}\n\n## 5. Lógica y Edge Cases\n\n${"Reglas de negocio. ".repeat(15)}\n\n## 6. Seguridad\n\n${"Argon2id. ".repeat(40)}\n\n## 7. Infraestructura\n\n${"Docker. ".repeat(40)}`;
    const result = validateMddForDelivery(draft);
    assert.equal(result.ok, false);
    const s3 = result.blockers.find((b) => b.includes("3. Modelo de Datos"));
    assert.ok(s3, "debería bloquear §3 con SQL < 100 chars");
  });

  it("bloquea §1 mínima (solo propósito) cuando mddComplexity es HIGH", () => {
    const thinS1 = `### Propósito del sistema\n\n${"Copiloto multiempresa vía WhatsApp. ".repeat(30)}`;
    const draft = `# MDD\n\n## 1. Contexto\n\n${thinS1}\n\n## 2. Arquitectura y Stack\n\n${"NestJS ".repeat(40)}\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE x (id UUID PRIMARY KEY); ".repeat(15)}\n\n\`\`\`TechnicalMetadata\n[high_security]\n\`\`\`\n\n## 4. Contratos de API\n\n${"POST /api/v1/x JSON. ".repeat(30)}\n\n## 5. Lógica y Edge Cases\n\n${"Reglas. ".repeat(40)}\n\n## 6. Seguridad\n\n${"Argon2id. ".repeat(40)}\n\n## 7. Infraestructura\n\n${"Docker. ".repeat(40)}`;
    const result = validateMddForDelivery(draft, { mddComplexity: "HIGH" });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => /estructura constitución incompleta/i.test(b)));
  });

  it("acepta MDD con todas las secciones sustanciales (200+ chars)", () => {
    const result = validateMddForDelivery(VALID_MDD);
    assert.equal(result.blockers.length, 0, result.blockers.join("; "));
    assert.equal(result.ok, true);
  });

  it("reproduce el caso del job 92: 3 de 7 secciones en (Pendiente) → bloquea", () => {
    // Simula el MDD real persistido en el proyecto ForgeOps tras el job 92
    // (7 secciones, 3 de ellas en (Pendiente) o muy cortas).
    const draft = `# Master Design Document\n\n---\n## 1. Contexto\n\n${"ForgeOps SaaS de licenciamiento. ".repeat(40)}\n\n---\n## 2. Arquitectura y Stack\n\n(Pendiente)\n\n---\n## 3. Modelo de Datos\n\n${"CREATE TABLE tenants (id UUID PRIMARY KEY); ".repeat(10)}\n\n\`\`\`TechnicalMetadata\n[high_security]\n\`\`\`\n\n---\n## 4. Contratos de API\n\n(Pendiente: definir endpoints)\n\n---\n## 5. Lógica y Edge Cases\n\n# (Pendiente)\n\n---\n## 6. Seguridad\n\n${"Argon2id para hashing. ".repeat(40)}\n\n---\n## 7. Infraestructura\n\n(Pendiente)`;
    const result = validateMddForDelivery(draft);
    assert.equal(result.ok, false, "debería rechazar con 3 (Pendiente) sections");
    const substanceBlockers = result.blockers.filter((b) => /Pendiente|insuficiente/.test(b));
    assert.ok(substanceBlockers.length >= 3, `esperaba ≥3 substance blockers, obtuve ${substanceBlockers.length}`);
  });
});
