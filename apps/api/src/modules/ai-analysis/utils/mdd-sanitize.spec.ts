import { describe, it } from "node:test";
import assert from "node:assert";
import {
  listGovernancePatternOptions,
  selectedPatternIdsFromMdd,
  updateMddGovernancePatterns,
} from "@theforge/shared-types";
import {
  alignDeliverableMarkdownWithMddSecurity,
  ensurePostMvpUiSurfaceBanner,
  applyCrossConsistencyPatches,
  applyDeploymentStackDirectiveToDraft,
  applyDeterministicCrossConsistencyFixes,
  deduplicateAndReorderMddSections,
  detectCrossConsistencyIssues,
  detectDuplicateOutboxTables,
  detectJwtAlgorithmMismatch,
  detectSuspiciousUniqueConstraints,
  deduplicateOutboxTablesInDraft,
  deduplicateUatSections,
  extractNodeVersionFromSection2,
  draftHasRequestIdDualApprovalApi,
  ensureOutboxTableInDraft,
  ensureSection6WhenSection7Present,
  ensureSecurityLockoutInSection6,
  ensureSecurityTableStubsFromSection6,
  SECURITY_LOCKOUT_DEFAULT_PARAGRAPH,
  getSection6Or7Range,
  mddHasDuplicateSectionHeadings,
  stripTrailingDuplicateMddSections,
  applyPreDeliveryGateFixes,
  ensureTechnicalMetadataBlockInDraft,
  detectSection2Section7NodeVersionMismatchIssue,
  fixDeterministicMddCoherence,
  finalizeMddDeliverable,
  fixDualApprovalSchemaInDraft,
  getSectionsToPreserveFromExecutorPlan,
  normalizeCanonicalMddSectionHeadings,
  ensureMissingCanonicalSections,
  stripMeshDirectivesFromDraft,
  stripStrayParenAfterJsonCodeBlocks,
  repairNestedJsonFencesInDraft,
  repairSqlDetachedCheckConstraints,
  sanitizeAllSqlBlocksInDraft,
  sanitizeMddAtPersist,
  prepareMddMarkdownForPersist,
  sanitizeSqlBrokenCommentsAndProse,
  stripAlternateBackendFromSection1,
  countMddSection3CreateTables,
  stripUiUxSectionForApiOnlyMvp,
  mddExcludesWebUiSurface,
  isMddSectionPlaceholderBody,
  normalizeMddFormat,
  normalizeMddEnglishSubheadings,
  parseCrossConsistencyPatches,
  preserveUntouchedMddSectionsFromBaseline,
  restoreMddSectionsFromBaselineStrict,
  demoteProseHeadingsInSections,
  repairDisplacedJsonBracesInContratos,
  sanitizeSeguridadIntegracionRawJson,
  validateMddStructure,
} from "./mdd-sanitize.js";
import { expandSectionsToRun } from "../nodes/mdd-manager.node.js";

describe("normalizeMddEnglishSubheadings", () => {
  it("traduce subtítulos típicos del brief en inglés (§1–§2, §6)", () => {
    const raw = `
## 1. Contexto

**1.1. Project Vision & Objectives:**

Foo.

**1.2. Functional Requirements (EARS Format):**

Bar.

**2.1. Technical Architecture:**

Baz.

## 6. Seguridad**6.2. Identity:**

Qux.
`;
    const out = normalizeMddEnglishSubheadings(raw);
    assert.ok(out.includes("**1.1. Visión y objetivos del producto:**"));
    assert.ok(out.includes("**1.2. Requisitos funcionales (formato EARS):**"));
    assert.ok(out.includes("**2.1. Arquitectura técnica:**"));
    assert.ok(out.includes("**6.2. Identidad:**"));
    assert.ok(!out.includes("**6.2. Identity:**"));
    assert.match(out, /##\s*6\.\s*Seguridad\s*\n+\s*\*\*6\.2\./);
  });
});

describe("sanitizeSeguridadIntegracionRawJson", () => {
  it("descontamina sección Seguridad cuando viene como bullet list con líneas de JSON", () => {
    const contaminated = `
## Seguridad

### Seguridad

 - {
 - "title": "## Seguridad",
 - "content": [
 - {
 - "heading": "1. Autenticación y Autorización",
 - "details": [
 - "**Autenticación de Usuarios**: Se utiliza un sistema de autenticación basado en tokens.",
 - "**Autorización de Acceso**: Los roles y permisos se gestionan a través de la tabla roles."
 - ]
 - },
 - {
 - "heading": "2. Protección de Datos",
 - "details": [
 - "**Cifrado de Contraseñas**: Las contraseñas se almacenan como hashes.",
 - "**Borrados Lógicos**: Se utiliza el campo isActive."
 - ]
 - }
 - ],
 - "conclusion": "Estas medidas protegen el sistema."
 - }
`;

    const result = sanitizeSeguridadIntegracionRawJson(contaminated);

    assert.ok(result.includes("## Seguridad"), "debe conservar ## Seguridad");
    assert.ok(
      result.includes("### 1. Autenticación y Autorización") || result.includes("### Autenticación y Autorización"),
      "debe convertir heading a ###"
    );
    assert.ok(
      result.includes("Autenticación de Usuarios") && result.includes("tokens"),
      "debe incluir viñetas de details"
    );
    assert.ok(result.includes("### 2. Protección de Datos") || result.includes("### Protección de Datos"));
    assert.ok(result.includes("Cifrado de Contraseñas"));
    assert.ok(!result.includes('"title":'), "no debe dejar JSON crudo");
    assert.ok(!result.includes(' - {'), "no debe dejar viñetas con fragmentos JSON");
  });

  it("no modifica sección Seguridad que ya es markdown legible", () => {
    const clean = `
## Seguridad

### 1. Autenticación
- Tokens JWT.
- Argon2 para contraseñas.

### 2. Autorización
- RBAC por roles.
`;

    const result = sanitizeSeguridadIntegracionRawJson(clean);
    assert.strictEqual(result.trim(), clean.trim());
  });

  it("no modifica body que no parece bullet list as JSON", () => {
    const other = `
## Seguridad

(Pendiente de definir.)
`;
    const result = sanitizeSeguridadIntegracionRawJson(other);
    assert.ok(result.includes("(Pendiente de definir.)"));
  });
});

describe("isMddSectionPlaceholderBody", () => {
  it("trata (Pendiente: Arquitecto de Seguridad) como placeholder", () => {
    assert.ok(isMddSectionPlaceholderBody("(Pendiente: Arquitecto de Seguridad)"));
    assert.ok(!isMddSectionPlaceholderBody("### A. Autenticación\n\n- JWT con rotación de claves."));
  });
});

describe("normalizeMddFormat §6 bullets", () => {
  it("conserva viñetas bajo ## 6. Seguridad (no las confunde con 6. Seguridad- pegado)", () => {
    const draft = `# Master Design Document

## 5. Lógica y Edge Cases

Lógica.

## 6. Seguridad

- Autenticación:
    - JWT validado vía JWKS.

## 7. Infraestructura

Docker.
`;
    const out = normalizeMddFormat(draft);
    assert.ok(out.includes("JWT validado vía JWKS."));
  });
});

describe("ensureSection6WhenSection7Present", () => {
  it("inserta §6 placeholder cuando el documento salta de §5 a §7", () => {
    const draft = `# Master Design Document

## 5. Lógica y Edge Cases

Reglas de negocio y middleware JWT.

## 7. Infraestructura

Docker y SSO.
`;
    const fixed = ensureSection6WhenSection7Present(draft);
    assert.ok(fixed.includes("## 6. Seguridad"));
    assert.ok(fixed.indexOf("## 5.") < fixed.indexOf("## 6. Seguridad"));
    assert.ok(fixed.indexOf("## 6. Seguridad") < fixed.indexOf("## 7. Infraestructura"));
    const normalized = deduplicateAndReorderMddSections(fixed);
    assert.ok(normalized.includes("## 6. Seguridad"), "deduplicate debe conservar §6");
    assert.ok(normalized.includes("Pendiente: Arquitecto de Seguridad"));
  });

  it("no altera el documento si §6 ya existe", () => {
    const draft = `## 5. Lógica y Edge Cases

Lógica.

## 6. Seguridad

JWT.

## 7. Infraestructura

K8s.
`;
    assert.strictEqual(ensureSection6WhenSection7Present(draft), draft);
  });
});

describe("getSectionsToPreserveFromExecutorPlan", () => {
  it("preserva §6 cuando el plan solo incluye architect e integration", () => {
    const agents = expandSectionsToRun(["software_architect", "integration"], { tail: "minimal" });
    assert.deepStrictEqual(agents, ["software_architect", "integration"]);
    const preserve = getSectionsToPreserveFromExecutorPlan(agents);
    assert.ok(preserve.includes(6));
    assert.ok(!preserve.includes(2));
    assert.ok(!preserve.includes(7));
  });
});

describe("preserveUntouchedMddSectionsFromBaseline", () => {
  it("restaura §6 real cuando el arquitecto dejó placeholder", () => {
    const baseline = `# MDD

## 1. Contexto

Contexto largo con alcance del producto y requisitos no funcionales descritos.

## 2. Arquitectura y Stack

Stack original.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users ( id UUID PRIMARY KEY );
\`\`\`

## 4. Contratos de API

### GET /api/v1/health

OK.

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

### A. Autenticación

- MFA TOTP obligatorio para administradores.

## 7. Infraestructura

Docker legacy.
`;
    const damaged = baseline.replace(
      /## 6\. Seguridad[\s\S]*?(?=\n## 7\.)/,
      "## 6. Seguridad\n\n(Pendiente: Arquitecto de Seguridad)\n\n",
    );
    const out = preserveUntouchedMddSectionsFromBaseline(
      damaged,
      baseline,
      getSectionsToPreserveFromExecutorPlan(["software_architect", "integration"]),
    );
    assert.match(out, /MFA TOTP obligatorio/);
    assert.doesNotMatch(out, /Pendiente:\s*Arquitecto de Seguridad/);
  });
});

describe("restoreMddSectionsFromBaselineStrict", () => {
  it("restaura §6 aunque el sync upstream haya inyectado otro contenido", () => {
    const baseline = `# MDD

## 1. Contexto

Contexto largo con alcance del producto y requisitos no funcionales descritos.

## 2. Arquitectura y Stack

Stack.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users ( id UUID PRIMARY KEY );
\`\`\`

## 4. Contratos de API

### GET /api/v1/health

OK.

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

### A. Autenticación

- MFA TOTP obligatorio para administradores con contenido detallado.

## 7. Infraestructura

Docker legacy con variables de entorno documentadas.
`;
    const corrupted = baseline.replace(
      /## 6\. Seguridad[\s\S]*?(?=\n## 7\.)/,
      "## 6. Seguridad\n\nContenido genérico OAuth sin relación con el proyecto.\n\n",
    );
    const out = restoreMddSectionsFromBaselineStrict(corrupted, baseline, [6]);
    assert.match(out, /MFA TOTP obligatorio/);
    assert.doesNotMatch(out, /Contenido genérico OAuth/);
  });
});

describe("applyDeploymentStackDirectiveToDraft", () => {
  it("reemplaza Docker + Kubernetes por Dokploy en §2", () => {
    const draft = `# Master Design Document

## 1. Contexto

Algo.

## 2. Arquitectura y Stack

### 2.1 Stack Tecnológico

| Capa | Tecnología | Versión | Justificación |
| Contenedores | Docker + Kubernetes | 24 / 1.28 | Orquestación |
`;
    const out = applyDeploymentStackDirectiveToDraft(
      draft,
      "No se usará kubernetes; se usaría dokploy",
    );
    assert.match(out, /Docker \+ Dokploy/i);
    assert.doesNotMatch(out, /Docker \+ Kubernetes/i);
  });
});

describe("sanitizeSqlBrokenCommentsAndProse", () => {
  it("fusiona tokens huérfanos tras comentario SQL partido (enum)", () => {
    const broken = `CREATE TABLE access_policies (
  permission VARCHAR(50) NOT NULL,            -- read, use, rotate, export, revoke,
  manage
  effect VARCHAR(10) NOT NULL DEFAULT 'allow', -- allow,
  deny
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.ok(out.includes("revoke, manage"));
    assert.ok(out.includes("allow, deny"));
    assert.ok(!/^\s*manage\s*$/m.test(out));
    assert.ok(!/^\s*deny\s*$/m.test(out));
  });

  it("repara columna con espacio (original text TEXT → original_text TEXT)", () => {
    const broken = `CREATE TABLE message_embeddings (
  id UUID PRIMARY KEY,
  original text TEXT,
  created_at TIMESTAMPTZ
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.match(out, /original_text\s+TEXT/);
    assert.doesNotMatch(out, /original text TEXT/);
  });

  it("omite stubs de partición mensuales si existe la tabla padre", () => {
    const broken = `CREATE TABLE requests (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ
);
CREATE TABLE requests_2026_07 (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.match(out, /CREATE TABLE requests\b/);
    assert.match(out, /omitted partition stub requests_2026_07/);
    assert.doesNotMatch(out, /CREATE TABLE requests_2026_07/);
  });

  it("cierra CREATE INDEX con paréntesis partidos en varias líneas", () => {
    const broken = `CREATE TABLE audit_events (id UUID PRIMARY KEY);
  CREATE INDEX idx_audit_occurred_at ON audit_events(occurred_at
);
  CREATE INDEX idx_audit_resource ON audit_events(resource_type,
  resource_id
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.ok(out.includes("ON audit_events(occurred_at);"));
    assert.ok(out.includes("resource_type, resource_id);"));
    assert.ok(!/occurred_at\n\)/.test(out));
  });

  it("elimina CREATE INDEX sobre columna comentada (embedding fuera de MVP)", () => {
    const broken = `CREATE TABLE messages (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  -- embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_embedding ON messages (embedding);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.doesNotMatch(out, /CREATE INDEX.*embedding/i);
    assert.match(out, /-- embedding VECTOR/);
  });

  it("repara prosa suelta tras comentario SQL roto (audit_events)", () => {
    const broken = `CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor_id UUID,                           -- user_id,
  application_id o NULL para system
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.ok(!out.includes("application_id o NULL para system"));
    assert.ok(out.includes("application_id UUID"));
    assert.ok(out.includes("-- NULL for system"));
  });

  it("convierte línea de prosa huérfana en comentario SQL", () => {
    const broken = `CREATE TABLE foo (
  id UUID PRIMARY KEY,
  esto no es SQL válido para una columna
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.ok(out.includes("-- esto no es SQL válido para una columna"));
  });

  it("separa comentario pegado a CREATE EXTENSION / TYPE / FUNCTION / TRIGGER (Peludo)", () => {
    const broken = `-- ext uuid
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- enum estado
CREATE TYPE estado_enum AS ENUM ('activo', 'inactivo');
-- fn touch
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(
);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- trigger
CREATE TRIGGER trg_touch BEFORE UPDATE ON conversaciones FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`;
    const out = sanitizeSqlBrokenCommentsAndProse(broken);
    assert.ok(out.includes('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'));
    assert.ok(out.includes("CREATE TYPE estado_enum"));
    assert.ok(out.includes("CREATE OR REPLACE FUNCTION touch_updated_at"));
    assert.ok(out.includes("CREATE TRIGGER trg_touch"));
    assert.ok(out.includes("NOW());"));
    assert.ok(!/NOW\(\s*\n\s*\)\s*;/.test(out));
  });
});

describe("fixDeterministicMddCoherence", () => {
  it("alinea §7 con monolito modular (no microservicios internos)", () => {
    const draft = `## 2. Arquitectura y Stack

Monolito modular con única unidad de despliegue NestJS.

## 7. Infraestructura

TLS entre microservicios y PostgreSQL.
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("módulos internos"));
    assert.ok(!/entre microservicios/i.test(out));
  });

  it("promueve rutas /api/* a /api/v1/* cuando el manifest declara v1", () => {
    const draft = `## 4. Contratos de API

| POST | /api/auth/login |
| GET | /api/keys |

## 7. Infraestructura

\`\`\`json
{ "integration_metadata": { "api_prefix": "/api/v1" } }
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("| POST | /api/v1/auth/login |") || out.includes("| POST | /api/v1/auth/login"));
    assert.ok(out.includes("/api/v1/keys"));
    assert.ok(out.includes('"api_prefix": "/api/v1"'));
  });

  it("sustituye eliminar particiones por archivado cuando auditoría es inmutable", () => {
    const draft = `## 5. Lógica y Edge Cases

- Retención inmutable 5 años.
- Job mensual elimina particiones completas anteriores a 5 años.
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("archiva particiones"));
    assert.ok(!out.includes("elimina particiones"));
  });

  it("corrige dropea/purga de particiones cuando auditoría es inmutable (español)", () => {
    const draft = `## 5. Lógica y Edge Cases

- **Retención de auditoría**: los eventos en eventos_auditoria no pueden ser modificados ni eliminados.
- Después de 5 años, un job automático dropea la partición correspondiente previa exportación a backup frío.

## 6. Seguridad

- Los eventos solo se purgan automáticamente al cumplir 5 años mediante job de drop de partición.
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("archiva"));
    assert.ok(!/dropea la partición/i.test(out));
    assert.ok(out.includes("Los eventos solo se archivan a cold storage inmutable"));
    assert.ok(!/purgan automáticamente/i.test(out));
    assert.ok(!/job de drop de partición/i.test(out));
  });

  it("corrige retención inmutable también en §6", () => {
    const draft = `## 6. Seguridad

- Auditoría append-only con retención inmutable.
- pg_cron elimina particiones con más de 5 años.
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("archiva particiones"));
    assert.ok(!out.includes("elimina particiones"));
  });

  it('corrige "elimina de audit_events" cuando auditoría es inmutable', () => {
    const draft = `## 5. Lógica y Edge Cases

- Retención inmutable 5 años en audit_events.
- Tras exportación, el job elimina de audit_events los registros con más de 5 años.

## 6. Seguridad

- Auditoría append-only.
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("archiva registros de audit_events"));
    assert.ok(!/elimina de audit_events/i.test(out));
  });

  it("corrige manifest bcrypt → Argon2id cuando §6 documenta Argon2 (sin LDAP)", () => {
    const draft = `## 6. Seguridad

- Las contraseñas locales se almacenan con Argon2id (memoria 64 MB, tiempo 3).
- MFA TOTP para administradores.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "security": {
      "hashing_algorithm": "bcrypt",
      "hashing_rounds": 12,
      "mfa_strategy": "TOTP"
    }
  }
}
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes('"hashing_algorithm": "Argon2id"'));
    assert.ok(out.includes('"hashing_scope": "local_passwords_and_bootstrap"'));
    assert.ok(!/"hashing_algorithm"\s*:\s*"bcrypt"/i.test(out));
    const issues = detectCrossConsistencyIssues(out);
    assert.ok(!issues.some((i) => i.includes("bcrypt") && i.includes("Argon2")));
  });

  it("mantiene bcrypt en manifest cuando §6 solo documenta bcrypt", () => {
    const draft = `## 6. Seguridad

- Hashing local bcrypt (12 rounds) para bootstrap del super administrador.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "security": {
      "hashing_algorithm": "Argon2id",
      "hashing_rounds": 12
    }
  }
}
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes('"hashing_algorithm": "bcrypt"'));
    assert.ok(!/"hashing_algorithm"\s*:\s*"Argon2id"/i.test(out));
  });

  it("sustituye JWT_SECRET por par de claves cuando §6 documenta RS256", () => {
    const draft = `## 6. Seguridad

- JWT firmado con RS256 y par de claves pública/privada (JWKS).

## 7. Infraestructura

### 7.5 Variables de entorno

- NODE_ENV, JWT_SECRET, JWT_EXPIRES_IN
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("JWT_PRIVATE_KEY"));
    assert.ok(out.includes("JWT_PUBLIC_KEY"));
    assert.ok(!/\bJWT_SECRET\b/.test(out));
  });

  it("alinea §7 HS256 → RS256 cuando §6 documenta RS256 (Peludo)", () => {
    const draft = `## 2. Arquitectura y Stack

| Runtime | Node.js | 22 |

## 6. Seguridad

- Tokens JWT firmados con RS256; validación vía JWKS.

## 7. Infraestructura

- NODE_ENV, JWT_SECRET (HS256), JWT_EXPIRES_IN

\`\`\`json
{
  "stack": {
    "backend": {
      "container": { "base_image": "node:20-alpine" }
    },
    "security": { "jwt_algorithm": "HS256", "jwks_enabled": false }
  }
}
\`\`\`
`;
    assert.ok(detectJwtAlgorithmMismatch(draft));
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes('"jwt_algorithm": "RS256"') || out.includes("RS256"));
    assert.ok(out.includes("node:22-alpine"));
    assert.ok(!/\bJWT_SECRET\b/.test(out));
    const issues = detectCrossConsistencyIssues(out);
    assert.ok(!issues.some((i) => i.includes("JWT incoherente")));
  });

  it("extractNodeVersionFromSection2 lee versión de tabla stack", () => {
    const draft = `## 2. Arquitectura y Stack

| Capa | Tecnología | Versión |
| Backend | Node.js | 22 |
`;
    assert.equal(extractNodeVersionFromSection2(draft), "22");
  });

  it("applyPreDeliveryGateFixes alinea node en §7 y elimina mismatch detectado", () => {
    const draft = `## 2. Arquitectura y Stack

| Backend | Node.js | 20 |

## 7. Infraestructura

\`\`\`json
{ "stack": { "backend": { "container": { "base_image": "node:22-alpine" } } } }
\`\`\`
`;
    assert.ok(detectSection2Section7NodeVersionMismatchIssue(draft));
    const fixed = applyPreDeliveryGateFixes(draft);
    assert.match(fixed, /node:20-alpine/);
    assert.equal(detectSection2Section7NodeVersionMismatchIssue(fixed), null);
  });

  it("ensureTechnicalMetadataBlockInDraft inyecta etiquetas en §3", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const out = ensureTechnicalMetadataBlockInDraft(draft);
    assert.match(out, /```TechnicalMetadata/);
    assert.match(out, /\[high_security\]/);
  });

  it("alignDeliverableMarkdownWithMddSecurity separa JWT_PRIVATE_KEY y JWT_PUBLIC_KEY en bloques .env", () => {
    const mdd = `## 6. Seguridad

- JWT RS256 con par de claves PEM.
`;
    const infra = `### Variables

\`\`\`env
JWT_SECRET=changeme
NODE_ENV=development
\`\`\`
`;
    const out = alignDeliverableMarkdownWithMddSecurity(mdd, infra);
    assert.match(out, /JWT_PRIVATE_KEY=changeme/);
    assert.match(out, /JWT_PUBLIC_KEY=/);
    assert.ok(!/\bJWT_SECRET\b/.test(out));
  });

  it("ensurePostMvpUiSurfaceBanner detecta §1 Contexto y alcance sin panel web", () => {
    const mdd = `## 1. Contexto y alcance

MVP API-only sin dashboard ni panel web; operaciones vía CLI.

## 2. Arquitectura y Stack

NestJS API REST.
`;
    const ux = "# Guía UX\n\nDesign system completo.\n";
    const out = ensurePostMvpUiSurfaceBanner(mdd, ux);
    assert.match(out, /post-MVP/i);
    assert.match(out, /Guía UX/);
  });

  it("corrige §6 y manifest cuando LDAP es auth principal con Argon2 en §6", () => {
    const draft = `## 2. Arquitectura y Stack

Passport.js (LDAP/AD) + JWT.

## 6. Seguridad

### Autenticación
- Los usuarios humanos se autentican contra LDAP/AD.
- Las contraseñas de los usuarios se almacenan hasheadas con Argon2id (parámetros: memoria 64 MB).
- El hashing de contraseñas usa Argon2id con sales aleatorias de 16 bytes.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "security": {
      "hashing_algorithm": "bcrypt",
      "hashing_rounds": 12,
      "mfa_strategy": "TOTP"
    }
  }
}
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("no almacenan contraseña local"));
    assert.ok(out.includes('"auth_provider": "LDAP/AD"'));
    assert.ok(out.includes('"hashing_algorithm": "Argon2id"'));
    assert.ok(out.includes("bootstrap_and_service_secrets_only"));
    assert.ok(out.includes("MFA obligatorio"));
  });

  it("mantiene bcrypt en manifest cuando LDAP es principal pero §6 documenta bcrypt bootstrap", () => {
    const draft = `## 2. Arquitectura y Stack

Passport.js (LDAP/AD) + JWT.

## 6. Seguridad

- Los usuarios corporativos usan LDAP/AD.
- Las contraseñas de usuarios se almacenan con bcrypt (factor de costo 12) solo para bootstrap.

## 7. Infraestructura

\`\`\`json
{
  "stack": {
    "security": {
      "hashing_algorithm": "Argon2id",
      "hashing_rounds": 12
    }
  }
}
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes('"auth_provider": "LDAP/AD"'));
    assert.ok(out.includes('"hashing_algorithm": "bcrypt"'));
    assert.ok(!/"hashing_algorithm"\s*:\s*"Argon2id"/i.test(out));
  });

  it("antepone /api/v1 a rutas §4 cuando manifest lo declara y rutas son bare", () => {
    const draft = `## 4. Contratos de API

| POST | /auth/login | Login | JWT |
| GET | /keys | Listar | JWT |

## 7. Infraestructura

\`\`\`json
{ "integration_metadata": { "api_prefix": "/api/v1" } }
\`\`\`
`;
    const out = fixDeterministicMddCoherence(draft);
    assert.ok(out.includes("| POST | /api/v1/auth/login |"));
    assert.ok(out.includes("| GET | /api/v1/keys |"));
    assert.ok(out.includes('"api_prefix": "/api/v1"'));
  });
});

describe("normalizeMddFormat §6 heading", () => {
  it("despega subtítulo pegado al H2 de Seguridad", () => {
    const draft = `# Master Design Document

## 6. Seguridad. Autenticación:

- JWT con rotación.

## 7. Infraestructura

K8s.
`;
    const out = normalizeMddFormat(draft);
    assert.ok(out.includes("## 6. Seguridad"));
    assert.ok(out.includes("### Autenticación"));
    assert.ok(!/## 6\. Seguridad\. Autenticación/i.test(out));
  });

  it("despega SeguridadGestión sin espacio (heading pegado del LLM)", () => {
    const draft = `# Master Design Document

## 5. Lógica y Edge Cases

Reglas.

## 6. SeguridadGestión de Identidad y Autenticación:
    - JWT RS256.

## 7. Infraestructura

K8s.
`;
    const out = normalizeMddFormat(draft);
    assert.ok(out.includes("## 6. Seguridad"));
    assert.ok(out.includes("### Gestión de Identidad y Autenticación"));
    assert.ok(!/## 6\. SeguridadGestión/i.test(out));
    assert.ok(getSection6Or7Range(out, 6) != null, "getSection6Or7Range debe localizar §6");
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
  });
});

describe("stripMeshDirectivesFromDraft", () => {
  it("elimina [DIRECTIVE: nodo] del markdown entregable", () => {
    const draft = `## 6. Seguridad

- MFA:
    - [DIRECTIVE: software_architect] Añadir totp_secret BYTEA en users.
    - TOTP obligatorio para admins.
`;
    const out = stripMeshDirectivesFromDraft(draft);
    assert.ok(!out.includes("[DIRECTIVE:"));
    assert.ok(out.includes("totp_secret BYTEA"));
    assert.ok(out.includes("TOTP obligatorio"));
  });
});

describe("finalizeMddDeliverable", () => {
  it("limpia duplicados y directivas mesh preservando UI/UX al final", () => {
    const core = `# Master Design Document

## 5. Lógica y Edge Cases

UAT.

## 6. Seguridad

JWT.

## 7. Infraestructura

K8s.
`;
    const corrupted = `${core}
---
## 5. Lógica y Edge Cases

Duplicado.

## UI/UX Design Intent

Tabla users → DataTable.
`;
    const out = finalizeMddDeliverable(corrupted);
    assert.ok(!out.includes("Duplicado."));
    assert.ok(out.includes("## UI/UX Design Intent"));
    assert.ok(out.includes("DataTable"));
    assert.strictEqual((out.match(/^##\s+5\./gm) ?? []).length, 1);
  });

  it("deduplica §4 repetida aunque §5–§7 sean únicas (cola grande de contratos)", () => {
    const section4 =
      "## 4. Contratos de API\n\n| POST | /api/test | test | JWT |\n\n#### POST /api/test\n\n```json\n{\"ok\": true}\n```\n\n";
    const corrupted = `# Master Design Document

## 1. Contexto

ForgeOps.

## 2. Arquitectura y Stack

NestJS.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE tenants (id UUID PRIMARY KEY);
\`\`\`

${section4.repeat(4)}
## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

JWT.

## 7. Infraestructura

Docker.

## UI/UX Design Intent

Ver pantallas.md.
`;
    assert.ok(mddHasDuplicateSectionHeadings(corrupted));
    const out = finalizeMddDeliverable(corrupted);
    assert.strictEqual((out.match(/^##\s+4\./gm) ?? []).length, 1);
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
    assert.ok(out.includes("## UI/UX Design Intent"));
  });
});

describe("stripTrailingDuplicateMddSections / deduplicate anti-bucle", () => {
  it("elimina cola duplicada §5/§6/§7 tras la primera §7 completa", () => {
    const core = `# Master Design Document

## 1. Contexto

Alcance KMS.

## 5. Lógica y Edge Cases

UAT y edge cases.

## 6. Seguridad

JWT y MFA.

## 7. Infraestructura

### Manifest

\`\`\`json
{"stack": {}}
\`\`\`
`;
    const corrupted =
      core +
      `
---
## 6. Seguridad(Pendiente: Arquitecto de Seguridad)
---
## 7. Infraestructura

(Pendiente: Ingeniero de Integración)

---
## 5. Lógica y Edge Cases

### 5.1 Reglas de negocio

Duplicado.
`;
    assert.ok(mddHasDuplicateSectionHeadings(corrupted));
    const stripped = stripTrailingDuplicateMddSections(corrupted);
    assert.ok(!stripped.includes("Duplicado."), "debe truncar la cola repetida");
    assert.ok(stripped.includes("JWT y MFA."));
    const deduped = deduplicateAndReorderMddSections(corrupted);
    assert.strictEqual(mddHasDuplicateSectionHeadings(deduped), false);
    assert.ok((deduped.match(/^##\s+5\./gm) ?? []).length <= 1);
    assert.ok((deduped.match(/^##\s+6\./gm) ?? []).length <= 1);
    assert.ok((deduped.match(/^##\s+7\./gm) ?? []).length <= 1);
  });

  it("trunca §4–§6 repetidas sin §7 (bucle crítico durante streaming)", () => {
    const block = `## 4. Contratos de API(Pendiente)
## 5. Lógica y Edge Cases

(Pendiente: paso dedicado Lógica y Edge Cases)
## 6. Seguridad(Pendiente)

### Gestión de Secretos

Las credenciales de servicio y secretos de aplicación se almacenan en un almacén de credenciales (secrets manager).`;
    const corrupted = `# Master Design Document

## 1. Contexto

Alcance.

## 2. Arquitectura y Stack

Stack ok.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

${block}

${block}

${block}`;
    assert.ok(mddHasDuplicateSectionHeadings(corrupted));
    const stripped = stripTrailingDuplicateMddSections(corrupted);
    assert.strictEqual((stripped.match(/^##\s+4\./gm) ?? []).length, 1);
    assert.strictEqual((stripped.match(/^##\s+5\./gm) ?? []).length, 1);
    assert.strictEqual((stripped.match(/^##\s+6\./gm) ?? []).length, 1);
    assert.ok(stripped.includes("Gestión de Secretos"));
    assert.strictEqual(mddHasDuplicateSectionHeadings(stripped), false);
  });
});

describe("fixDualApprovalSchemaInDraft", () => {
  it("divide endpoint único export/approve en approve-first y approve-second", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 4. Contratos de API

| POST | \`/api/keys/:keyId/export/approve\` | Aprobar exportación (dual) | JWT (admin_security) |

#### POST /api/keys/:keyId/export/approve

Aprueba solicitud. Primer aprobador → first_approved; segundo → approved.
`;
    const out = fixDualApprovalSchemaInDraft(draft);
    assert.ok(out.includes("approve-first"));
    assert.ok(out.includes("approve-second"));
    assert.ok(out.includes("| POST | `/api/keys/:keyId/export/approve-first` | Primera aprobación"));
    assert.ok(!/\|\s*POST\s*\|[^|\n]*\/export\/approve(?!-first|-second)/i.test(out));
  });

  it("no divide approve cuando el patrón :requestId/approve + execute ya está documentado", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 4. Contratos de API

| POST | /api/v1/keys/:id/export/:requestId/approve | Aprobar (1.ª o 2.ª) | JWT |
| POST | /api/v1/keys/:id/export/:requestId/execute | Ejecutar exportación | JWT |
| POST | /api/v1/keys/:id/export/:requestId/reject | Rechazar | JWT |
`;
    assert.ok(draftHasRequestIdDualApprovalApi(draft));
    const out = fixDualApprovalSchemaInDraft(draft);
    assert.ok(!out.includes("approve-first"));
    assert.ok(out.includes("/:requestId/approve"));
    assert.ok(out.includes("/:requestId/execute"));
  });

  it("convierte approved_by en first_approver_id + second_approver_id", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación de claves.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY,
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);
\`\`\`
`;
    const out = fixDualApprovalSchemaInDraft(draft);
    assert.ok(out.includes("first_approver_id"));
    assert.ok(out.includes("second_approver_id"));
    assert.ok(!/\bapproved_by\b/i.test(out));
    assert.ok(out.includes("first_approved"));
  });
});

describe("applyDeterministicCrossConsistencyFixes", () => {
  it("combina SQL, dual approval y coherencia monolito", () => {
    const draft = `## 1. Contexto

Aprobación dual obligatoria.

## 2. Arquitectura y Stack

Monolito modular con única unidad de despliegue.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY,
  approved_by UUID REFERENCES users(id)
);
\`\`\`

## 7. Infraestructura

TLS entre microservicios.
`;
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.ok(out.includes("second_approver_id"));
    assert.ok(out.includes("módulos internos"));
    assert.ok(!/entre microservicios/i.test(out));
  });
});

describe("ensureOutboxTableInDraft", () => {
  it("añade CREATE TABLE outbox cuando §7 la menciona y falta en §3", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE eventos_auditoria (
  id UUID PRIMARY KEY
);
\`\`\`

## 7. Infraestructura

Un worker lee los eventos no publicados de la tabla outbox y los envía a RabbitMQ.
`;
    const out = ensureOutboxTableInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+outbox\b/i.test(out));
    assert.ok(out.includes("idx_outbox_unpublished"));
  });

  it("no inyecta outbox cuando §3 ya define outbox_events", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
\`\`\`

## 7. Infraestructura

Un worker lee los eventos no publicados de la tabla outbox_events y los envía a RabbitMQ.
`;
    const out = ensureOutboxTableInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+outbox_events\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
  });

  it("no inyecta outbox cuando §3 ya define connector_schema.outbox", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE connector_schema.outbox (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
\`\`\`

## 2. Arquitectura y Stack

Patrón Outbox: worker lee outbox y publica en RabbitMQ.
`;
    const out = ensureOutboxTableInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+connector_schema\.outbox\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
  });

  it("no inyecta outbox cuando §3 ya define eventos outbox-like (procesado/payload)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE eventos (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  procesado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\`\`\`

## 7. Infraestructura

Worker lee eventos no publicados de la tabla eventos.
`;
    const out = ensureOutboxTableInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+eventos\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
  });
});

describe("detectDuplicateOutboxTables", () => {
  it("detecta outbox y outbox_events duplicados en §3", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY
);
CREATE TABLE outbox (
  id UUID PRIMARY KEY
);
\`\`\`
`;
    assert.ok(detectDuplicateOutboxTables(draft));
    const issues = detectCrossConsistencyIssues(draft);
    assert.ok(issues.some((i) => i.includes("outbox-like duplicadas")));
  });

  it("detecta outbox sin schema y connector_schema.outbox duplicados", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE connector_schema.outbox (
  id UUID PRIMARY KEY
);
CREATE TABLE outbox (
  id UUID PRIMARY KEY
);
\`\`\`
`;
    assert.ok(detectDuplicateOutboxTables(draft));
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.ok(/CREATE\s+TABLE\s+connector_schema\.outbox\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
  });

  it("detecta eventos outbox-like y outbox duplicados (Peludo)", () => {
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

## 7. Infraestructura

Lee la tabla eventos pendientes de publicar.
`;
    assert.ok(detectDuplicateOutboxTables(draft));
    const issues = detectCrossConsistencyIssues(draft);
    assert.ok(issues.some((i) => i.includes("outbox-like duplicadas")));
    const out = deduplicateOutboxTablesInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+eventos\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
    assert.strictEqual(detectDuplicateOutboxTables(out), false);
  });
});


describe("deduplicateOutboxTablesInDraft", () => {
  it("elimina CREATE TABLE outbox cuando §3 ya tiene outbox_events y §7 lo nombra", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
CREATE TABLE outbox (
  id UUID PRIMARY KEY
);
\`\`\`

## 7. Infraestructura

El worker publica eventos desde la tabla outbox_events hacia RabbitMQ.
`;
    const out = deduplicateOutboxTablesInDraft(draft);
    assert.ok(/CREATE\s+TABLE\s+outbox_events\b/i.test(out));
    assert.ok(!/CREATE\s+TABLE\s+outbox\s*\(/i.test(out));
    assert.strictEqual(detectDuplicateOutboxTables(out), false);
  });

  it("se aplica en applyDeterministicCrossConsistencyFixes tras inyección errónea", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY
);
CREATE TABLE outbox (
  id UUID PRIMARY KEY
);
\`\`\`

## 7. Infraestructura

Lee eventos de outbox_events.
`;
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.strictEqual(detectDuplicateOutboxTables(out), false);
  });
});

describe("validateMddStructure §6", () => {
  it("marca 6. Seguridad como sección faltante cuando el documento salta de §5 a §7", () => {
    const draft = `## 1. Contexto
Alcance.

## 2. Arquitectura y Stack
Stack.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE t (id UUID PRIMARY KEY);
\`\`\`
TechnicalMetadata [high_security]

## 4. Contratos de API
| GET | /api/v1/health | OK | — |
| POST | /api/v1/items | Crear | JWT |
\`\`\`json
{"ok": true}
\`\`\`
\`\`\`json
{"id": "1"}
\`\`\`

## 5. Lógica y Edge Cases
Reglas.

## 7. Infraestructura
Deploy.
`;
    const structure = validateMddStructure(draft);
    assert.ok(structure.missingSections.includes("6. Seguridad"));
  });
});

describe("detectCrossConsistencyIssues", () => {
  it("no exige approve-first cuando hay patrón :requestId/approve + execute", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación.

## 4. Contratos de API

| POST | /api/v1/keys/:id/export/:requestId/approve | Aprobar | JWT |
| POST | /api/v1/keys/:id/export/:requestId/execute | Ejecutar | JWT |
`;
    const issues = detectCrossConsistencyIssues(draft);
    assert.ok(!issues.some((i) => i.includes("approve-first")));
  });

  it("detecta approved_by sin second_approver cuando hay dual approval", () => {
    const draft = `## 1. Contexto

Aprobación dual para exportación.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY,
  approved_by UUID REFERENCES users(id)
);
\`\`\`
`;
    const issues = detectCrossConsistencyIssues(draft);
    assert.ok(issues.some((i) => i.includes("second_approver_id")));
  });

  it("detecta tablas §6 sin DDL en §3 (security_events, refresh_tokens)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 6. Seguridad

- Los intentos fallidos se registran en security_events.
- Los refresh tokens rotativos se almacenan en refresh_tokens.
`;
    const issues = detectCrossConsistencyIssues(draft);
    assert.ok(issues.some((i) => i.includes("security_events")));
    assert.ok(issues.some((i) => i.includes("refresh_tokens")));
  });

  it("sugiere índice parcial para UNIQUE conversaciones (Peludo)", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE conversaciones (
  id UUID PRIMARY KEY,
  negocio_id UUID NOT NULL,
  cliente_id UUID NOT NULL,
  estado TEXT NOT NULL,
  UNIQUE (negocio_id, cliente_id, estado)
);
\`\`\`
`;
    const issues = detectSuspiciousUniqueConstraints(draft);
    assert.ok(issues.some((i) => i.includes("índice parcial")));
  });

  it("deduplicateUatSections referencia §1 cuando UAT está duplicado", () => {
    const draft = `## 1. Contexto

### Criterios UAT
- Login exitoso con credenciales válidas.
- Exportación rechazada sin aprobación dual.
- Auditoría registra cada intento fallido.

## 5. Lógica y Edge Cases

### Criterios UAT
- Login exitoso con credenciales válidas.
- Exportación rechazada sin aprobación dual.
- Auditoría registra cada intento fallido.
`;
    const out = deduplicateUatSections(draft);
    assert.ok(out.includes("Ver §1"));
    assert.ok(!/## 5[\s\S]*Login exitoso[\s\S]*Exportación rechazada[\s\S]*Auditoría registra/.test(out));
  });
});

describe("applyCrossConsistencyPatches", () => {
  it("aplica parche cuando find es único", () => {
    const draft = "foo UNIQUE_BAR baz";
    const out = applyCrossConsistencyPatches(draft, [
      { find: "UNIQUE_BAR", replace: "UNIQUE_BAZ" },
    ]);
    assert.equal(out, "foo UNIQUE_BAZ baz");
  });

  it("ignora parche cuando find aparece más de una vez", () => {
    const draft = "X foo X";
    const out = applyCrossConsistencyPatches(draft, [{ find: "X", replace: "Y" }]);
    assert.equal(out, "X foo X");
  });
});

describe("parseCrossConsistencyPatches", () => {
  it("extrae JSON de bloque fenced", () => {
    const text = `Corrección:
\`\`\`json
[{"find":"old","replace":"new"}]
\`\`\``;
    const patches = parseCrossConsistencyPatches(text);
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.find, "old");
  });
});

describe("normalizeMddFormat SQL sanitization", () => {
  it("limpia prosa en bloque sql de §3 vía pipeline", () => {
    const draft = `# Master Design Document

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor_id UUID,                           -- user_id,
  application_id o NULL para system
);
\`\`\`

## 4. Contratos de API

Tabla.
`;
    const out = normalizeMddFormat(draft);
    assert.ok(!out.includes("application_id o NULL para system"));
    assert.ok(out.includes("application_id UUID"));
  });
});

describe("stripStrayParenAfterJsonCodeBlocks", () => {
  it("elimina paréntesis suelto tras bloque json", () => {
    const draft = `## 7. Infraestructura

\`\`\`json
{ "manifest": "infra-v1" }
\`\`\`)
`;
    const out = stripStrayParenAfterJsonCodeBlocks(draft);
    assert.ok(!out.includes("```)\n"));
    assert.ok(out.trimEnd().endsWith("```"));
  });
});

describe("repairNestedJsonFencesInDraft", () => {
  it("desanida fences json dentro de body POST /audit-events/export", () => {
    const draft = `## 4. Contratos de API

### POST /audit-events/export

\`\`\`json
{
  "event_types": [
\`\`\`json
["KEY_CREATED", "KEY_ROTATED"]
\`\`\`
  ],
  "format": "json"
}
\`\`\``;
    const out = repairNestedJsonFencesInDraft(draft);
    assert.ok(!out.includes("```json\n["));
    assert.ok(out.includes('"event_types"'));
    assert.ok(out.includes("KEY_CREATED"));
    JSON.parse(out.match(/```json\s*\n([\s\S]*?)```/i)![1]!);
  });

  it("repara permissions anidados en POST /policies", () => {
    const draft = `\`\`\`json
{
  "permissions": [
\`\`\`json
["keys:read", "keys:write"]
\`\`\`
  ]
}
\`\`\``;
    const out = repairNestedJsonFencesInDraft(draft);
    const inner = out.match(/```json\s*\n([\s\S]*?)```/i)![1]!;
    const parsed = JSON.parse(inner) as { permissions: string[] };
    assert.deepEqual(parsed.permissions, ["keys:read", "keys:write"]);
  });
});

describe("stripUiUxSectionForApiOnlyMvp", () => {
  const MDD_API_ONLY = `## 1. Contexto y alcance

MVP: solo APIs REST y CLI; sin panel web.

## 2. Arquitectura y Stack

NestJS API.

## UI/UX Design Intent

Pantallas de administración.
`;

  it("elimina UI/UX cuando §1 declara API+CLI sin web", () => {
    const out = stripUiUxSectionForApiOnlyMvp(MDD_API_ONLY);
    assert.ok(mddExcludesWebUiSurface(MDD_API_ONLY));
    assert.ok(!/##\s*UI\/UX\s+Design\s+Intent/i.test(out));
    assert.ok(out.includes("NestJS API"));
  });

  it("elimina UI/UX cuando §2.5 declara no incluye panel web (KMS)", () => {
    const kms = `## 1. Contexto

Fuera de alcance (MVP): panel web.

## 2. Arquitectura y Stack

### 2.5 Frontend (MVP)

El MVP no incluye un panel web de administración completo.

## UI/UX Design Intent

Bloque generado.
`;
    const out = stripUiUxSectionForApiOnlyMvp(kms);
    assert.ok(mddExcludesWebUiSurface(kms));
    assert.ok(!/##\s*UI\/UX\s+Design\s+Intent/i.test(out));
  });

  it("conserva UI/UX cuando hay frontend en alcance", () => {
    const withWeb = `## 1. Contexto y alcance

Panel web React para administración de claves.

## 2. Arquitectura y Stack

NestJS API + frontend Next.js.

## UI/UX Design Intent

Pantallas de administración.
`;
    const out = stripUiUxSectionForApiOnlyMvp(withWeb);
    assert.ok(/##\s*UI\/UX\s+Design\s+Intent/i.test(out));
  });
});

describe("sanitizeMddAtPersist", () => {
  it("combina heading pegado, JSON §4 y strip UI/UX MVP", () => {
    const draft = `## 1. Contexto

MVP solo API y CLI; sin dashboard.

## 3. Modelo de Datos### SQL

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos

\`\`\`json
{ "items": [
\`\`\`json
[1]
\`\`\`
] }
\`\`\`

## UI/UX Design Intent

Tabla users en grid.
`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /## 3\. Modelo de Datos\n\n### SQL/);
    assert.ok(!/##\s*UI\/UX\s+Design\s+Intent/i.test(out));
    const jsonInner = out.match(/```json\s*\n([\s\S]*?)```/i)![1]!;
    assert.doesNotThrow(() => JSON.parse(jsonInner));
  });

  it("despega cuerpo pegado al H2 de §3 (Modelo de DatosLa base…)", () => {
    const draft = `## 3. Modelo de DatosLa base de datos usa PostgreSQL.

\`\`\`sql
CREATE TABLE tenants (id UUID PRIMARY KEY);
\`\`\`
`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /## 3\. Modelo de Datos\n\nLa base de datos/);
  });

  it("repara Copiloto-style: §1 ### inline, §3```sql pegado, manifest sin cerrar, ) antes de §7", () => {
    const draft = `## 1. Contexto y Alcance ### Propósito del Proyecto
El sistema orquesta MCP. ### Alcance y Fronteras #### Servicios Core
- Item uno.

--- --- --- --- ---

## 3. Modelo de Datos\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
  CREATE INDEX idx_users ON users(id);
\`\`\`

## 6. Seguridad

JWT HS256.

)

---
## 7. Infraestructura

\`\`\`json
{
  "stack": { "backend": { "container": { "base_image": "node:20-alpine" } } }
}


---

## UI/UX Design Intent

Grid.
`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /## 1\. Contexto y Alcance\n\n###\s+Propósito del Proyecto/);
    assert.match(out, /###\s+Alcance y Fronteras\n\n####\s+Servicios Core/);
    assert.match(out, /## 3\. Modelo de Datos\n\n```sql/);
    assert.match(out, /CREATE INDEX idx_users ON users\(id\)/m);
    assert.doesNotMatch(out, /--- --- ---/);
    assert.doesNotMatch(out, /\n\s*\)\s*\n---\n## 7/);
    assert.match(out, /\}\s*\n```\s*\n---\s*\n## UI\/UX Design Intent/);
  });

  it("despega cuerpo en negrita pegado a un encabezado (### UAT **Escenario 1**)", () => {
    const draft = `### Criterios de Aceptación (UAT) **Escenario 1 - Autenticación de usuario no autorizado**`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /### Criterios de Aceptación \(UAT\)\n\n\*\*Escenario 1 - Autenticación de usuario no autorizado\*\*/);
  });

  it("despega lista → encabezado → negrita pegados en una sola línea", () => {
    const draft = `- Implementación de Circuit Breaker y Outbox Pattern ### Criterios de Aceptación (UAT) **Escenario 1 - Autenticación de usuario no autorizado**`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /Outbox Pattern\n\n### Criterios de Aceptación \(UAT\)\n\n\*\*Escenario 1/);
  });

  it("no rompe un encabezado enteramente en negrita (### **Título**)", () => {
    const draft = `### **Título completamente en negrita**`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /^### \*\*Título completamente en negrita\*\*/);
    assert.doesNotMatch(out, /###\s*\n\n/);
  });

  it("corrige multi_tenant_support en manifest §7 cuando MDD exige multi-tenant", () => {
    const draft = `## 2. Arquitectura y Stack
Multi-tenant con tenant_id en todas las tablas.

## 3. Modelo de Datos
\`\`\`TechnicalMetadata
[multi_tenant] [high_security]
\`\`\`

## 7. Infraestructura
\`\`\`json
{
  "integration_metadata": {
    "api_prefix": "/api/v1",
    "multi_tenant_support": false
  }
}
\`\`\`
`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /"multi_tenant_support"\s*:\s*true/i);
  });

  it("corrige multi_tenant_support cuando §3 usa negocio_id en todas las tablas", () => {
    const draft = `## 2. Arquitectura y Stack
Backend Fastify.

## 3. Modelo de Datos
\`\`\`TechnicalMetadata
[high_security]
\`\`\`
CREATE TABLE negocios (id UUID PRIMARY KEY);
CREATE TABLE usuarios (id UUID PRIMARY KEY, negocio_id UUID NOT NULL);
CREATE TABLE clientes (id UUID PRIMARY KEY, negocio_id UUID NOT NULL);
CREATE TABLE citas (id UUID PRIMARY KEY, negocio_id UUID NOT NULL);

## 6. Seguridad
Aislamiento multiinquilino: toda consulta filtra por negocio_id del token.

## 7. Infraestructura
\`\`\`json
{
  "integration_metadata": {
    "api_prefix": "/api/v1",
    "multi_tenant_support": false
  }
}
\`\`\`
`;
    const out = sanitizeMddAtPersist(draft);
    assert.match(out, /"multi_tenant_support"\s*:\s*true/i);
  });
});

describe("repairSqlDetachedCheckConstraints", () => {
  const BETTING_USERS_FRAGMENT = `CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  kyc_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (kyc_status IN ('pending','approved','rejected')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);`;

  const BETTING_WALLET_FRAGMENT = `CREATE TABLE wallets (
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  currency        VARCHAR(3) NOT NULL DEFAULT 'COP'
  CHECK (currency = 'COP')
);`;

  it("añade coma antes de CHECK en línea aparte (users.kyc_status)", () => {
    const out = repairSqlDetachedCheckConstraints(BETTING_USERS_FRAGMENT);
    assert.match(out, /DEFAULT 'pending',\s*\n\s*CHECK \(kyc_status/i);
  });

  it("añade coma antes de CHECK de currency en wallets", () => {
    const out = repairSqlDetachedCheckConstraints(BETTING_WALLET_FRAGMENT);
    assert.match(out, /DEFAULT 'COP',\s*\n\s*CHECK \(currency/i);
  });

  it("repara múltiples CHECK en bloque sql vía sanitizeSqlBrokenCommentsAndProse", () => {
    const sql = `${BETTING_USERS_FRAGMENT}

CREATE TABLE transactions (
  id              UUID PRIMARY KEY,
  type            VARCHAR(20) NOT NULL
  CHECK (type IN ('deposit','withdrawal','bet')),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','completed','failed','cancelled'))
);`;
    const out = sanitizeSqlBrokenCommentsAndProse(sql);
    assert.match(out, /NOT NULL,\s*\n\s*CHECK \(type/i);
    assert.match(out, /DEFAULT 'pending',\s*\n\s*CHECK \(status/i);
  });

  it("aplica en sanitizeAllSqlBlocksInDraft dentro de MDD", () => {
    const draft = `## 3. Modelo de Datos

\`\`\`sql
${BETTING_WALLET_FRAGMENT}
\`\`\``;
    const out = sanitizeAllSqlBlocksInDraft(draft);
    assert.match(out, /DEFAULT 'COP',\s*\n\s*CHECK \(currency/i);
  });

  it("no altera CHECK ya inline en la misma línea", () => {
    const sql = `CREATE TABLE t (
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('a','b'))
);`;
    const out = repairSqlDetachedCheckConstraints(sql);
    assert.equal(out, sql);
  });
});

describe("ensureSecurityLockoutInSection6", () => {
  it("inyecta párrafo OWASP cuando §5 exige bloqueo y §6 no detalla intentos", () => {
    const draft = `# MDD

## 5. Lógica y Edge Cases

Los intentos fallidos de login se registran en security_events.

## 6. Seguridad

JWT RS256 y gestión de secretos en Vault.

## 7. Infraestructura

Docker.
`;
    const out = ensureSecurityLockoutInSection6(draft);
    assert.ok(out.includes(SECURITY_LOCKOUT_DEFAULT_PARAGRAPH));
  });

  it("no duplica si §6 ya define intentos", () => {
    const draft = `# MDD

## 5. Lógica y Edge Cases

Bloqueo de cuenta tras intentos fallidos.

## 6. Seguridad

Lockout tras 5 intentos en 15 minutos.

## 7. Infraestructura

Docker.
`;
    const out = ensureSecurityLockoutInSection6(draft);
    assert.equal(out, draft);
  });
});

describe("ensureSecurityTableStubsFromSection6 totp", () => {
  it("inserta totp_secret sin corromper DDL de usuarios con CHECK", () => {
    const draft = `# MDD

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
\`\`\`

## 6. Seguridad

MFA TOTP obligatorio; totp_secret en usuarios.

## 7. Infraestructura

K8s.
`;
    const out = ensureSecurityTableStubsFromSection6(draft);
    const userBlock = out.match(/CREATE TABLE usuarios[\s\S]*?\n\)/i)?.[0] ?? "";
    assert.ok(/\btotp_secret\s+BYTEA\b/i.test(userBlock));
    assert.ok(!/DEFAULT now\(\)\s*\n\s*,/i.test(userBlock));
    assert.ok(!/totp_secret BYTEA,/i.test(userBlock));
  });
});

describe("stripAlternateBackendFromSection1", () => {
  it("elimina FastAPI alternativo en §1 cuando §2 fija Fastify", () => {
    const draft = `## 1. Contexto

- **Audiencia:** Desarrolladores fullstack con Node.js (Fastify) or Python (FastAPI).

## 2. Arquitectura y Stack

Backend Fastify con TypeScript. Monorepo pnpm.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const out = stripAlternateBackendFromSection1(draft);
    assert.match(out, /Node\.js \(Fastify\)/);
    assert.doesNotMatch(out, /FastAPI/i);
    assert.doesNotMatch(out, /\bor Python\b/i);
  });

  it("se aplica vía sanitizeMddForExport / fixDeterministicMddCoherence", () => {
    const draft = `## 1. Contexto

Audiencia: Node.js (Fastify) o Python (FastAPI).

## 2. Arquitectura y Stack

API REST con Fastify.
`;
    const out = applyDeterministicCrossConsistencyFixes(draft);
    assert.doesNotMatch(out, /FastAPI/i);
  });
});

describe("countMddSection3CreateTables", () => {
  it("cuenta CREATE TABLE en §3", () => {
    const mdd = `## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE sessions (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY);
\`\`\`
`;
    assert.equal(countMddSection3CreateTables(mdd), 3);
  });
});

describe("mdd format sanitizer regressions (patrones genéricos)", () => {
  it("bug1: despega encabezados pegados en §1 y escenarios UAT en negrita", () => {
    const raw = `## 1. Contexto y Alcance ### Propósito del Proyecto
El sistema hace X. ### Alcance y Fronteras #### Servicios Core
- item

### Criterios de Aceptación (UAT) **Escenario 1 - Auth** **Escenario 2 - Permisos**
Dado un usuario
`;
    const out = sanitizeMddAtPersist(raw);
    assert.match(out, /## 1\. Contexto y Alcance\n\n### Propósito del Proyecto/);
    assert.match(out, /### Alcance y Fronteras\n\n#### Servicios Core/);
    assert.match(out, /### Criterios de Aceptación \(UAT\)\n\n\*\*Escenario 1/);
    assert.match(out, /\*\*Escenario 1 - Auth\*\*\n\n\*\*Escenario 2/);
  });

  it("bug2: recupera llaves JSON desplazadas en §4", () => {
    const raw = `### GET /api/v1/health

**Response 200:**
\`\`\`json
{
  "status": "healthy",
  "dependencies": {
    "database": "connected"
  }
\`\`\`

### POST /api/v1/messages/process

Procesa mensaje.
}
\`\`\`
`;
    const out = repairDisplacedJsonBracesInContratos(raw);
    assert.match(out, /"database": "connected"\s*\n\s*\}\s*\n\}\s*\n```/);
    assert.doesNotMatch(out, /Procesa mensaje\.\n\}/);
    assert.match(out, /### POST \/api\/v1\/messages\/process/);
  });

  it("bug3: degrada prosa promovida a ### en §4 y §7", () => {
    const raw = `# MDD

## 4. Contratos de API

### GET /api/v1/health

### Endpoint de verificación de salud para monitoreo del sistema.

## 6. Seguridad

### Bloqueo de cuenta tras 5 intentos fallidos.

## 7. Infraestructura

### NODE_ENV=production
### Stage 1 - Linting: ESLint.
`;
    const out = demoteProseHeadingsInSections(raw);
    assert.match(out, /### GET \/api\/v1\/health/);
    assert.doesNotMatch(out, /### Endpoint de verificación/);
    assert.match(out, /Endpoint de verificación de salud/);
    assert.doesNotMatch(out, /### NODE_ENV/);
    assert.match(out, /NODE_ENV=production/);
    assert.doesNotMatch(out, /### Stage 1/);
  });

  it("bug5: desenvuelve fence suelto que envuelve prosa tras heading", () => {
    const raw = `## 5. Lógica y Edge Cases

### Flujos Maestros
\`\`\`
**Flujo de Procesamiento:**
1. Paso uno
2. Paso dos
\`\`\`

## 6. Seguridad

Texto.
`;
    const out = sanitizeMddAtPersist(raw);
    assert.doesNotMatch(out, /### Flujos Maestros\n\n\`\`\`/);
    assert.match(out, /\*\*Flujo de Procesamiento:\*\*/);
  });

  it("bug6: colapsa reglas horizontales rotas antes de H2", () => {
    const raw = `## 1. Contexto

Fin.

--- --- --- --- --- --- ---

## 2. Arquitectura y Stack

--

## 3. Modelo de Datos

-
`;
    const out = sanitizeMddAtPersist(raw);
    assert.doesNotMatch(out, /--- --- ---/);
    assert.doesNotMatch(out, /\n--\n\n## 2\./);
    assert.doesNotMatch(out, /\n-\n\n## 3\./);
  });

  it("prepareMddMarkdownForPersist deduplica §4 triplicada antes de persistir", () => {
    const section4 =
      "## 4. Contratos de API\n\n| POST | /api/test | test | JWT |\n\n#### POST /api/test\n\n```json\n{\"ok\": true}\n```\n\n";
    const raw = `# Master Design Document

## 1. Contexto

Alcance con suficiente texto para validar estructura canónica del MDD de prueba.

## 2. Arquitectura y Stack

NestJS.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE items (id UUID PRIMARY KEY);
\`\`\`

${section4.repeat(3)}

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

JWT.

## 7. Infraestructura

Docker.
`;
    assert.ok(mddHasDuplicateSectionHeadings(raw));
    const out = prepareMddMarkdownForPersist(raw);
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
    assert.strictEqual((out.match(/^##\s+4\.\s*Contratos\s+de\s+API/im) ?? []).length, 1);
  });

  it("prepareMddMarkdownForPersist: despega §1 y colapsa HR rotas (NEW + LEGACY)", () => {
    const raw = `## 1. Contexto ### Problema
Texto. ### Objetivos
- Meta

--- --- --- --- --- --- ---

## 2. Arquitectura y Stack

Stack.
`;
    const out = prepareMddMarkdownForPersist(raw);
    assert.match(out, /## 1\. Contexto\n\n### Problema/);
    assert.match(out, /### Objetivos\n+- Meta/);
    assert.doesNotMatch(out, /--- --- ---/);
    assert.doesNotMatch(out, /## 1\. Contexto ###/);
    const second = prepareMddMarkdownForPersist(out);
    assert.doesNotMatch(second, /## 1\. Contexto ###/);
  });

  it("prepareMddMarkdownForPersist conserva patrones SSOT - [X] tras peel", () => {
    const base =
      "# Master Design Document\n\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    const id = listGovernancePatternOptions().find((o) => o.label.includes("Singleton"))!.id;
    const md = updateMddGovernancePatterns(base, new Set([id]));
    const out = prepareMddMarkdownForPersist(md);
    assert.equal(selectedPatternIdsFromMdd(out).size, 1);
    assert.doesNotMatch(out, /^# - \[[xX]\]/m);
  });

  it("prepareMddMarkdownForPersist mantiene SSOT aunque peel recorte stamp previo", () => {
    const base =
      "# Master Design Document\n\n## 1. Contexto\n\nCuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba.\n";
    const id = listGovernancePatternOptions().find((o) => o.label.includes("Singleton"))!.id;
    const md = updateMddGovernancePatterns(base, new Set([id]));
    const withStamp = `<!-- theforge-doc:created=2026-01-01T00:00:00.000Z|updated=2026-01-01T00:00:00.000Z -->\n> 📅 Creado: 1 ene 2026\n\n${md}`;
    const out = prepareMddMarkdownForPersist(withStamp);
    assert.equal(selectedPatternIdsFromMdd(out).size, 1);
    assert.match(out, /\[ARQUITECTURA - SECCIÓN INMUTABLE\]/);
  });

  it("prepareMddMarkdownForPersist repara §4 (fence huérfano, JSON sin cierre, Response 204)", () => {
    const raw = `# Master Design Document

## 1. Contexto

Cuerpo §1 con más de ochenta caracteres para el MDD canónico de prueba genérico.

## 4. Contratos de API

### POST /api/v1/chat/message
Recibe el mensaje del webhook de WhatsApp y orquesta la respuesta.
\`\`\`

**Request body:**
\`\`\`json
{ "device_token": "string" }
\`\`\`

**Response 202:**
\`\`\`json
{
  "status": "accepted",
  "task_id": "uuid",
  "message": "El agente está procesando tu solicitud."

### POST /api/v1/chat/switch-company
Cambia la empresa activa.
\`\`\`

**Response 204:**
# _No Content_

## 5. Lógica y Edge Cases

Reglas de negocio con más de ochenta caracteres para cumplir el gate de entrega del MDD canónico.
## 6. Seguridad

Autenticación M2M con JWT RS256 y aislamiento multitenant obligatorio en todas las consultas.
`;
    const out = prepareMddMarkdownForPersist(raw);
    assert.doesNotMatch(out, /respuesta\.\n```\n\n\*\*Request body/);
    assert.match(out, /"message": "El agente está procesando tu solicitud."\n}\n```/);
    assert.match(out, /\*\*Response 204:\*\*\n+_No Content_/);
    assert.match(out, /Edge Cases[\s\S]*---[\s\S]*## 6\. Seguridad/);
  });

  it("prepareMddMarkdownForPersist repara ### ## 6. Seguridad apilado", () => {
    const raw = `# Master Design Document

## 5. Lógica y Edge Cases

Texto de reglas con más de ochenta caracteres para cumplir validaciones mínimas del gate de entrega.

### ## 6. Seguridad

### Aislamiento Multitenant y Autorización
- Aislamiento lógico estricto por tenant_id y company_id.
`;
    const out = prepareMddMarkdownForPersist(raw);
    assert.match(out, /^## 6\. Seguridad/m);
    assert.doesNotMatch(out, /### ## 6\./);
  });

  it("prepareMddMarkdownForPersist: demote H1 falso # _prosa_ y despega ## pegados", () => {
    const raw = `# Master Design Document

## 1. Contexto

Texto §1 con más de ochenta caracteres para cumplir validaciones mínimas del gate de entrega.

- **Riesgo:** item. **Mitigación:** límite de iteraciones.
## 2. Arquitectura y Stack

### Diagrama

\`\`\`mermaid
flowchart TB
  A --> B
\`\`\`

# _Nota derivada de §2–§4: prosa larga que no debe ser heading._

## 5. Lógica y Edge Cases

1. **Paso:** detalle.
   - Sub-item de lista.
## 6. Seguridad

Texto §6 con más de ochenta caracteres para cumplir validaciones mínimas del gate.
## 7. Infraestructura

Texto §7 con más de ochenta caracteres para cumplir validaciones mínimas del gate.
## UI/UX Design Intent

Texto UI con más de ochenta caracteres para cumplir validaciones mínimas del gate.
`;
    const out = prepareMddMarkdownForPersist(raw);
    assert.doesNotMatch(out, /^# _Nota derivada/m);
    assert.match(out, /_Nota derivada de §2–§4/);
    assert.match(out, /Mitigación:[^\n]+\n---\n## 2\. Arquitectura/);
    assert.match(out, /Sub-item de lista\.\n---\n## 6\. Seguridad/);
    assert.match(out, /gate\.\n---\n## 7\. Infraestructura/);
    assert.match(out, /gate\.\n---\n## UI\/UX Design Intent/);
  });

  it("prepareMddMarkdownForPersist mantiene cierre json tras sanitizeMddAtPersist", () => {
    const raw = `# Master Design Document

## 1. Contexto

Cuerpo §1 con más de ochenta caracteres para cumplir validaciones mínimas del gate de entrega.

## 4. Contratos de API

### POST /api/v1/chat/message
Recibe el mensaje.
\`\`\`

**Request body:**
\`\`\`json
{ "x": 1 }
\`\`\`

**Response 202:**
\`\`\`json
{
  "status": "accepted",
  "message": "processing"

### POST /api/v1/chat/switch-company
Cambia empresa.
`;
    const out = prepareMddMarkdownForPersist(raw);
    assert.match(out, /"processing"\n}\n```[\s\S]*?### POST \/api\/v1\/chat\/switch-company/);
    assert.doesNotMatch(out, /Recibe el mensaje\.\n```\n\n\*\*Request body/);
  });

  it("normalizeCanonicalMddSectionHeadings: ## 2. Arquitectura sin y Stack pasa gate tras finalize", () => {
    const raw = `# Master Design Document

## 1. Contexto y alcance

Objetivo comercial del sistema con más de ochenta caracteres para pasar validaciones del gate de entrega MDD.

## 2. Arquitectura

Stack Node.js y PostgreSQL con despliegue en Docker Compose para el MVP del producto.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

### POST /api/users
\`\`\`json
{"path":"/api/users","method":"POST"}
\`\`\`

## 5. Lógica y Edge Cases

Reglas de negocio y casos borde del dominio con viñetas sustantivas.

## 6. Seguridad

JWT RS256 y control de acceso basado en roles para usuarios internos del sistema.

## 7. Infraestructura

Docker Compose con PostgreSQL 16 y Node 20-alpine en producción del sistema.
`;
    const normalized = normalizeCanonicalMddSectionHeadings(raw);
    assert.match(normalized, /## 2\. Arquitectura y Stack/);
    const final = finalizeMddDeliverable(normalized);
    assert.deepEqual(validateMddStructure(final).missingSections, []);
    assert.match(final, /## 2\. Arquitectura y Stack/);
  });

  it("validateMddStructure detecta §7 con headings pegados --- ##", () => {
    const glued =
      "# Master Design Document --- ## 1. Contexto Texto --- ## 2. Arquitectura y Stack Stack --- ## 3. Modelo de Datos SQL --- ## 4. Contratos de API API --- ## 5. Lógica y Edge Cases Logica --- ## 6. Seguridad Sec --- ## 7. Infraestructura ### 7.1 Flujo contenido del manifest";
    assert.deepEqual(validateMddStructure(glued).missingSections, []);
  });

  it("ensureMissingCanonicalSections: restaura §7 desde baseline cuando dedupe la eliminó", () => {
    const baseline = `# Master Design Document

## 6. Seguridad

Políticas JWT RS256 y MFA obligatorio para operadores internos del sistema.

## 7. Infraestructura

### 7.1 Flujo de integración

Webhook Wasender hacia NestJS con autenticación M2M y cola Redis.

\`\`\`json
{"stack":"node:20-alpine","database":"postgresql:16"}
\`\`\`
`;
    const without7 = `# Master Design Document

## 1. Contexto

Alcance del copiloto multiempresa con más de ochenta caracteres de contexto técnico.

## 2. Arquitectura y Stack

NestJS y Redis.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

### GET /api/health

## 5. Lógica y Edge Cases

Reglas.

## 6. Seguridad

JWT.
`;
    const out = ensureMissingCanonicalSections(without7, baseline);
    assert.deepEqual(validateMddStructure(out).missingSections, []);
    assert.match(out, /## 7\. Infraestructura/);
    assert.match(out, /7\.1 Flujo de integración/);
  });

  it("ensureMissingCanonicalSections: restaura §1/§2 desde baseline cuando el Arquitecto emitió §3–§7", () => {
    const baseline = `# Master Design Document

## 1. Contexto

Contexto sustancial del clarificador con más de ochenta caracteres de alcance técnico del producto.

## 2. Arquitectura y Stack

NestJS con PostgreSQL 16 y Redis para colas de mensajería del copiloto.

## 3. Modelo de Datos

(Pendiente)
`;
    const architectOnly = `# Master Design Document

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
\`\`\`

\`\`\`TechnicalMetadata
[high_security]
\`\`\`

## 4. Contratos de API

### POST /api/users
\`\`\`json
{"path":"/api/users","method":"POST"}
\`\`\`

## 5. Lógica y Edge Cases

Reglas de negocio del dominio.

## 6. Seguridad

JWT RS256 y RBAC.

## 7. Infraestructura

Docker Compose con PostgreSQL 16.
`;
    const restored = ensureMissingCanonicalSections(architectOnly, baseline);
    assert.deepEqual(validateMddStructure(restored).missingSections, []);
    assert.match(restored, /## 1\. Contexto/);
    assert.match(restored, /## 2\. Arquitectura y Stack/);
    assert.match(restored, /NestJS con PostgreSQL 16/);
  });
});
