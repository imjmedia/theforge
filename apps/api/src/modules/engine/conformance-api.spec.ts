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
    assert.match(out, /MDD §4/i);
    assert.match(out, /\/api\/auth\/login/i);
    const after = checkApiVsMdd(MDD, out);
    assert.equal(after.missingInApi.length, 0, after.missingInApi.join("; "));
    assert.equal(after.extraInApi.length, 0);
  });

  it("repairApiProgrammaticGaps deja conformidad ok", () => {
    const api = "| GET | `/health` | h |\n";
    const out = repairApiProgrammaticGaps(MDD, api);
    assert.equal(checkApiVsMdd(MDD, out).ok, true);
  });

  it("elimina endpoints extra no declarados en MDD §4", () => {
    const api = `# Contratos API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | \`/health\` | ok |
| GET | \`/api/v1/phantom\` | inventado |
| POST | \`/api/auth/login\` | login |
`;
    const out = repairApiProgrammaticGaps(MDD, api);
    const r = checkApiVsMdd(MDD, out);
    assert.equal(r.ok, true, [...r.missingInApi, ...r.extraInApi].join("; "));
    assert.equal(r.extraInApi.length, 0);
    assert.ok(!out.includes("phantom"));
  });
});
