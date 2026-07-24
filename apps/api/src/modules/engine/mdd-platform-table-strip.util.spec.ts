import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripUnjustifiedPlatformTablesFromMdd } from "./mdd-platform-table-strip.util.js";

const KMS_MDD = `
## 1. Contexto
KMS interno: claves, secretos, certificados, auditoría. Sin chat ni MCP.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
CREATE TABLE secrets (id UUID PRIMARY KEY);
CREATE TABLE mcp_plugins (id UUID PRIMARY KEY);
CREATE TABLE messages (id UUID PRIMARY KEY);
\`\`\`
`;

const CHAT_BRD = `
## Capacidades
Integración MCP y mensajería en tiempo real.
`;

describe("mdd-platform-table-strip.util", () => {
  it("strip mcp_plugins/messages en dominio KMS sin ancla chat", () => {
    const { markdown, stripped } = stripUnjustifiedPlatformTablesFromMdd(KMS_MDD, {});
    assert.deepEqual(stripped.sort(), ["mcp_plugins", "messages"].sort());
    assert.match(markdown, /CREATE TABLE keys/);
    assert.match(markdown, /CREATE TABLE secrets/);
    assert.doesNotMatch(markdown, /CREATE TABLE mcp_plugins/);
    assert.doesNotMatch(markdown, /CREATE TABLE messages/);
  });

  it("conserva tablas plataforma cuando BRD las ancla", () => {
    const { markdown, stripped } = stripUnjustifiedPlatformTablesFromMdd(KMS_MDD, {
      brdMarkdown: CHAT_BRD,
    });
    assert.equal(stripped.length, 0);
    assert.match(markdown, /CREATE TABLE mcp_plugins/);
  });

  it("strip tenants cuando BRD excluye multi-tenant SaaS", () => {
    const mdd = `
## 1. Contexto
Fuera de alcance: multi-tenant SaaS y billing compartido.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
CREATE TABLE tenants (id UUID PRIMARY KEY);
\`\`\`
`;
    const { markdown, stripped } = stripUnjustifiedPlatformTablesFromMdd(mdd, {});
    assert.deepEqual(stripped, ["tenants"]);
    assert.doesNotMatch(markdown, /CREATE TABLE tenants/);
    assert.match(markdown, /CREATE TABLE keys/);
  });
});
