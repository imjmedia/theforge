import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkApiVsMdd,
  extractEndpoints,
  normalizeApiPathForCompare,
  normEp,
} from "./conformance.service.js";
import { injectMissingApiEndpoints, repairApiProgrammaticGaps } from "./api-conformance-repair.util.js";

describe("normalizeApiPathForCompare", () => {
  it("unifica params {id} y :id", () => {
    assert.equal(
      normalizeApiPathForCompare("/api/v1/users/{id}"),
      normalizeApiPathForCompare("/api/v1/users/:id"),
    );
  });
});

describe("checkApiVsMdd", () => {
  const MDD = `# MDD

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /health |
| GET | /api/v1/users/{id} |
| POST | /api/auth/login |
`;

  it("no marca falta si API usa :id en lugar de {id}", () => {
    const api = `# Contratos API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | \`/health\` | Health |
| GET | \`/api/v1/users/:id\` | Usuario |
| POST | \`/api/auth/login\` | Login |
`;
    const r = checkApiVsMdd(MDD, api);
    assert.equal(r.ok, true, r.missingInApi.join("; "));
    assert.equal(r.missingInApi.length, 0);
  });

  it("detecta endpoint faltante", () => {
    const api = `# Contratos API

| Método | Ruta |
|--------|------|
| GET | \`/health\` |
`;
    const r = checkApiVsMdd(MDD, api);
    assert.ok(r.missingInApi.length >= 2);
  });

  it("extrae tabla con columna Ruta antes que Método", () => {
    const md = `| /api/v1/items | GET | list |`;
    const eps = extractEndpoints(md);
    assert.equal(eps.length, 1);
    assert.equal(normEp(eps[0]!), "GET /api/v1/items");
  });

  it("no duplica rutas H3/prosa cuando §4 ya tiene tabla (KMS-like)", () => {
    const mdd = `# MDD

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | \`/api/v1/health\` | Health |
| GET | \`/api/v1/kms-keys\` | KMS keys |
| POST | \`/api/v1/auth/mfa/setup\` | MFA setup |

### POST /auth/mfa/setup

\`\`\`json
{ "secret": "..." }
\`\`\`

### POST /keys

Detalle legacy sin prefijo.

### GET /keys

Otro bloque H3 bare.
`;

    const api = `# Contratos API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | \`/health\` | Health |
| GET | \`/api/v1/kms-keys\` | KMS keys |
| POST | \`/api/v1/auth/mfa/setup\` | MFA |
`;

    const r = checkApiVsMdd(mdd, api);
    assert.equal(r.ok, true, r.missingInApi.join("; "));
    assert.ok(!r.missingInApi.some((ep) => /\/keys$/.test(ep) && !ep.includes("kms")), r.missingInApi.join("; "));
  });

  it("alinea /health y /auth/* con /api/v1 cuando el MDD declara api_prefix", () => {
    const mdd = `# MDD

## 4. Contratos de API

| GET | \`/api/v1/health\` | ok |
| POST | \`/auth/login\` | login |

## 7. Infraestructura

\`\`\`json
{ "integration_metadata": { "api_prefix": "/api/v1" } }
\`\`\`
`;

    const api = `# Contratos API

Documento de contratos alineado al MDD §4.

| GET | \`/health\` | Health check del servicio |
| POST | \`/auth/login\` | Login con credenciales |
`;

    const r = checkApiVsMdd(mdd, api);
    assert.equal(r.ok, true, r.missingInApi.join("; "));
  });

  it("marca faltantes cuando no hay documento API (no es falso positivo de coherencia)", () => {
    const mdd = `# MDD

## 4. Contratos de API

| GET | \`/api/v1/health\` | ok |
| GET | \`/api/v1/users\` | users |
`;
    const r = checkApiVsMdd(mdd, null);
    assert.equal(r.ok, false);
    assert.equal(r.missingInApi.length, 2);
  });
});

describe("api-conformance-repair", () => {
  const MDD = `# MDD

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /health |
| POST | /api/auth/login |
`;

  it("inyecta filas para endpoints §4 faltantes", () => {
    const api = "# Contratos API\n\nSolo health parcial.\n\n| GET | `/health` | ok |\n";
    const out = injectMissingApiEndpoints(MDD, api);
    assert.match(out, /completados automáticamente/i);
    assert.match(out, /\/api\/auth\/login/i);
    const after = checkApiVsMdd(MDD, out);
    assert.equal(after.missingInApi.length, 0, after.missingInApi.join("; "));
  });

  it("repairApiProgrammaticGaps deja conformidad ok", () => {
    const api = "| GET | `/health` | h |\n";
    const out = repairApiProgrammaticGaps(MDD, api);
    assert.equal(checkApiVsMdd(MDD, out).ok, true);
  });
});
