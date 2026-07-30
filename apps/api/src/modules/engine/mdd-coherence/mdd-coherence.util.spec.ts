import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMddCoherenceFromMarkdown } from "./mdd-coherence.util.js";
import { repairMddCoherenceSection4Gaps } from "./mdd-coherence-repair.util.js";

/** Fixture KMS-like: §4 tabla (no H3) + auth/infra + entidades hyphen/underscore. */
function kmsLikeMdd(): string {
  return `
## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY);
CREATE TABLE permissions (id UUID PRIMARY KEY);
CREATE TABLE role_permissions (role_id UUID REFERENCES roles(id), permission_id UUID REFERENCES permissions(id));
CREATE TABLE user_roles (user_id UUID REFERENCES users(id), role_id UUID REFERENCES roles(id));
CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
CREATE TABLE security_events (id UUID PRIMARY KEY);
CREATE TABLE outbox_events (id UUID PRIMARY KEY);
CREATE TABLE outbox (id UUID PRIMARY KEY);
CREATE TABLE audit_logs (id UUID PRIMARY KEY);
CREATE TABLE kms_keys (id UUID PRIMARY KEY);
CREATE TABLE key_rotations (id UUID PRIMARY KEY, kms_key_id UUID REFERENCES kms_keys(id));
CREATE TABLE encryption_policies (id UUID PRIMARY KEY);
CREATE TABLE tenant_configs (id UUID PRIMARY KEY);
CREATE TABLE api_clients (id UUID PRIMARY KEY);
CREATE TABLE webhook_subscriptions (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | \`/health\` | Health check |
| POST | \`/auth/login\` | Login |
| POST | \`/auth/refresh\` | Refresh token |
| POST | \`/auth/logout\` | Logout |
| GET | \`/auth/jwks\` | JWKS |
| GET | \`/api/v1/users\` | List users |
| GET | \`/api/v1/users/{id}/roles\` | User roles |
| GET | \`/api/v1/roles\` | List roles |
| GET | \`/api/v1/sessions\` | Sessions |
| GET | \`/api/v1/audit-logs\` | Audit logs |
| GET | \`/api/v1/kms-keys\` | KMS keys |
| GET | \`/api/v1/key-rotations\` | Key rotations |
| GET | \`/api/v1/encryption-policies\` | Encryption policies |
| GET | \`/api/v1/tenant-configs\` | Tenant configs |
| GET | \`/api/v1/api-clients\` | API clients |
| GET | \`/api/v1/webhook-subscriptions\` | Webhooks |
`;
}

describe("evaluateMddCoherenceFromMarkdown", () => {
  it("parsea endpoints desde tabla §4 (no solo H3) y no marca falsos huérfanos KMS-like", () => {
    const health = evaluateMddCoherenceFromMarkdown(kmsLikeMdd());
    assert.equal(health.entityCount, 16);
    assert.equal(health.endpointCount, 16);
    assert.equal(health.orphanEndpointCount, 0, "auth/health no deben contar como huérfanos");
    assert.equal(health.orphanEntityCount, 0, "auth/infra cubiertas o exentas");
    assert.equal(health.isCoherent, true);
  });

  it("cuenta huérfanos cuando falta endpoint para entidad de negocio", () => {
    const mdd = `
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE widgets (id UUID PRIMARY KEY);
CREATE TABLE gadgets (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
### GET /api/v1/widgets
Solo widgets.
`;
    const health = evaluateMddCoherenceFromMarkdown(mdd);
    assert.equal(health.endpointCount, 1);
    assert.equal(health.entityCount, 2);
    assert.equal(health.orphanEntityCount, 1);
  });
});

describe("repairMddCoherenceSection4Gaps", () => {
  it("inyecta GET mínimo para entidad de negocio huérfana", () => {
    const mdd = `
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE widgets (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
| GET | \`/api/v1/users\` | Users |
`;
    const repaired = repairMddCoherenceSection4Gaps(mdd);
    assert.ok(repaired.injected.length >= 1);
    assert.match(repaired.markdown, /\/api\/v1\/widgets/i);
    const after = evaluateMddCoherenceFromMarkdown(repaired.markdown);
    assert.equal(after.orphanEntityCount, 0);
  });
});
