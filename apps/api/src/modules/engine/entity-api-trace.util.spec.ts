import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEntityApiTraceReport } from "./entity-api-trace.util.js";
import { evaluateMddCoherenceFromMarkdown } from "./mdd-coherence/mdd-coherence.util.js";

/** Fixture KMS-like: rutas anidadas, auth/infra, outbox. */
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
CREATE TABLE key_assignments (kms_key_id UUID REFERENCES kms_keys(id));
CREATE TABLE key_versions (kms_key_id UUID REFERENCES kms_keys(id));
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

function kmsLikeApiContracts(): string {
  return `
| GET | /health | Health |
| POST | /auth/login | Login |
| GET | /api/v1/users | Users |
| GET | /api/v1/users/{id}/roles | User roles |
| GET | /api/v1/roles | Roles |
| GET | /api/v1/sessions | Sessions |
| GET | /api/v1/audit-logs | Audit logs |
| GET | /api/v1/kms-keys | KMS keys |
| GET | /api/v1/key-rotations | Key rotations |
| GET | /api/v1/encryption-policies | Encryption policies |
| GET | /api/v1/tenant-configs | Tenant configs |
| GET | /api/v1/api-clients | API clients |
| GET | /api/v1/webhook-subscriptions | Webhooks |
`;
}

describe("entity-api-trace.util", () => {
  it("reports entity without API endpoint", () => {
    const mdd = "## 3\n```sql\nCREATE TABLE watchlists (id UUID);\n```";
    const api = "| GET | /api/v1/users | |";
    const report = buildEntityApiTraceReport({
      mddMarkdown: mdd,
      inventory: {
        suggestedEntities: ["watchlists", "users"],
        capabilities: [],
        processes: [],
        crudMatrix: [],
        adminSurfaces: [],
      },
      apiContractsMarkdown: api,
    });
    assert.ok(report.gaps.some((g) => g.includes("watchlists")));
    assert.ok(!report.gaps.some((g) => g.includes("users:")));
  });

  it("KMS-like MDD coherente → sin gaps para user_roles, key_assignments, outbox", () => {
    const mdd = kmsLikeMdd();
    const health = evaluateMddCoherenceFromMarkdown(mdd);
    assert.equal(health.isCoherent, true);

    const report = buildEntityApiTraceReport({
      mddMarkdown: mdd,
      inventory: {
        suggestedEntities: [
          "user_roles",
          "key_assignments",
          "key_versions",
          "outbox",
          "outbox_events",
          "kms_keys",
        ],
        capabilities: [],
        processes: [],
        crudMatrix: [
          { entity: "outbox", ops: ["R"], mvp: false, infraOnly: true, brdCapabilityIds: [] },
        ],
        adminSurfaces: [],
      },
      apiContractsMarkdown: kmsLikeApiContracts(),
    });

    const gapEntities = report.gaps.map((g) => g.split(":")[0]?.trim());
    assert.ok(!gapEntities.includes("user_roles"), `unexpected gap: ${report.gaps.join("; ")}`);
    assert.ok(!gapEntities.includes("key_assignments"), `unexpected gap: ${report.gaps.join("; ")}`);
    assert.ok(!gapEntities.includes("key_versions"), `unexpected gap: ${report.gaps.join("; ")}`);
    assert.ok(!gapEntities.includes("outbox"), `unexpected gap: ${report.gaps.join("; ")}`);
    assert.ok(!gapEntities.includes("outbox_events"), `unexpected gap: ${report.gaps.join("; ")}`);
  });

  it("respects crudMatrix.infraOnly", () => {
    const mdd = "## 3\n```sql\nCREATE TABLE outbox (id UUID);\n```";
    const report = buildEntityApiTraceReport({
      mddMarkdown: mdd,
      inventory: {
        suggestedEntities: ["outbox"],
        capabilities: [],
        processes: [],
        crudMatrix: [
          { entity: "outbox", ops: ["R"], mvp: false, infraOnly: true, brdCapabilityIds: [] },
        ],
        adminSurfaces: [],
      },
      apiContractsMarkdown: "",
    });
    assert.equal(report.gaps.length, 0);
  });
});
