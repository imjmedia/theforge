/**
 * Tests for deterministic §3 inventory composition.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDomainInventory } from "./domain-inventory.util.js";
import {
  composeDomainTableStubsSql,
  mergeDbgaCoreGapsIntoMdd,
  mergeDomainTablesIntoMdd,
  missingDomainEntities,
} from "./compose-section3-from-inventory.util.js";

const BRD = `
## 3. Capacidades
### 3.1 Gestión de conversaciones WhatsApp
Cuerpo con mensajes, canales y tenants.
### 3.2 Plugins MCP Bitrix
Integración mcp y tools.
### 3.3 Bitácora de fallos
Registro de peticiones no cumplidas.
`;

describe("compose-section3-from-inventory", () => {
  it("detects missing domain entities vs auth-only MDD", () => {
    const inv = buildDomainInventory({ brdMarkdown: BRD });
    const mdd = `
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY);
CREATE TABLE sessions (id UUID PRIMARY KEY);
\`\`\`
`;
    const missing = missingDomainEntities(inv, mdd);
    assert.ok(missing.length >= 2, `expected missing domain entities, got ${missing.join(",")}`);
    const sql = composeDomainTableStubsSql(inv, mdd);
    assert.match(sql, /CREATE TABLE/i);
  });

  it("merges stubs into existing sql fence", () => {
    const inv = buildDomainInventory({ brdMarkdown: BRD });
    const mdd = `# MDD
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const { markdown, injected } = mergeDomainTablesIntoMdd(mdd, inv);
    assert.ok(injected.length > 0);
    assert.match(markdown, /Domain inventory stubs/i);
    assert.match(markdown, /CREATE TABLE users/i);
  });

  it("injects missing DBGA core entity credentials", () => {
    const dbga = `
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE operations (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
`;
    const mdd = `# MDD
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE strategies (id UUID PRIMARY KEY);
CREATE TABLE operations (id UUID PRIMARY KEY);
CREATE TABLE dashboard_configs (id UUID PRIMARY KEY);
CREATE TABLE otp_sessions (id UUID PRIMARY KEY);
\`\`\`
`;
    const { markdown, injected } = mergeDbgaCoreGapsIntoMdd(mdd, { dbgaMarkdown: dbga });
    assert.deepEqual(injected, ["credentials"]);
    assert.match(markdown, /CREATE TABLE credentials/i);
  });

  it("no append §3 stub cuando SQL sustancial existe pese a (Pendiente) pegado", () => {
    const dbga = `
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE operations (id UUID PRIMARY KEY);
CREATE TABLE credentials (id UUID PRIMARY KEY);
`;
    const mdd = `# MDD
## 3. Modelo de Datos(Pendiente)
\`\`\`sql
CREATE TABLE operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE
);
\`\`\`
`;
    const { markdown, injected } = mergeDbgaCoreGapsIntoMdd(mdd, { dbgaMarkdown: dbga });
    assert.doesNotMatch(markdown, /## 3\. Modelo de Datos\n\n## 3\. Modelo de Datos/);
    assert.doesNotMatch(markdown, /dbga_core_stubs/);
    assert.match(markdown, /CREATE TABLE operations/);
    assert.ok(!injected.includes("operations"));
  });
});
