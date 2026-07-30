import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileMddSsotBeforeDeliveryGate } from "./mdd-ssot-repair.util.js";

const BRD = `
## UAT
**Escenario 1 — Fraccionamiento**
**Escenario 2 — Idempotencia**
**Escenario 3 — Límite IA**
**Escenario 4 — Stop-loss**
`;

const MDD = `
## 1. Contexto
Plataforma MCP con memoria de conversación.

### UAT
**Escenario 1 — Fraccionamiento**
**Escenario 2 — Idempotencia**

## 2. Stack
WebSocket gateway en tiempo real.

## 3. Modelo
\`\`\`sql
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE strategies (id UUID PRIMARY KEY);
CREATE TABLE credentials (id UUID PRIMARY KEY);
CREATE TABLE dashboard_configs (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE mcp_plugins (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
| Método | Ruta | Desc | Auth | Notas |
|--------|------|------|------|-------|
| GET | \`/api/v1/health\` | health | — | — |
`;

describe("mdd-ssot-repair.util", () => {
  it("repairs UAT, §4 journeys and platform annotations in one pass", () => {
    const result = reconcileMddSsotBeforeDeliveryGate(MDD, { brdMarkdown: BRD });
    assert.ok(result.uatInjected.length >= 2);
    assert.ok(result.section4Injected.length > 0);
    assert.ok(result.platformAnnotated.includes("mcp_plugins"));
    assert.match(result.markdown, /Escenario 4/i);
    assert.match(result.markdown, /dashboards\/me/);
    assert.match(result.markdown, /\[platform:mcp_plugins\]/);
    assert.equal(result.remainingGaps.length, 0, result.remainingGaps.join("; "));
  });

  it("injects missing credentials stub before gate", () => {
    const dbga = `
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE credentials (id UUID PRIMARY KEY);
`;
    const mdd = `
## 3. Modelo
\`\`\`sql
CREATE TABLE watchlists (id UUID PRIMARY KEY);
CREATE TABLE strategies (id UUID PRIMARY KEY);
CREATE TABLE operations (id UUID PRIMARY KEY);
CREATE TABLE dashboard_configs (id UUID PRIMARY KEY);
CREATE TABLE otp_sessions (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`;
    const result = reconcileMddSsotBeforeDeliveryGate(mdd, { dbgaMarkdown: dbga });
    assert.ok(result.section3Injected.includes("credentials"));
    assert.match(result.markdown, /CREATE TABLE credentials/i);
  });

  it("no re-inyecta tablas plataforma tras merge inventario en KMS", () => {
    const brd = `
## 3. Capacidades
### 3.1 Gestión de claves
Rotación de claves y secretos corporativos. Sin chat ni MCP.
`;
    const mdd = `
## 1. Contexto
KMS interno. Sin chat ni MCP.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE keys (id UUID PRIMARY KEY);
CREATE TABLE secrets (id UUID PRIMARY KEY);
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
| Método | Ruta | Desc |
|--------|------|------|
| GET | \`/api/v1/keys\` | listar |
`;
    const result = reconcileMddSsotBeforeDeliveryGate(mdd, { brdMarkdown: brd });
    assert.doesNotMatch(result.markdown, /CREATE TABLE channels/i);
    assert.doesNotMatch(result.markdown, /CREATE TABLE llm_configs/i);
    assert.doesNotMatch(result.markdown, /CREATE TABLE mcp_plugins/i);
    assert.doesNotMatch(result.markdown, /CREATE TABLE requests/i);
    assert.doesNotMatch(result.markdown, /CREATE TABLE agent_runs/i);
    assert.ok(
      !result.section3Injected.some((e) =>
        ["channels", "llm_configs", "mcp_plugins", "requests", "agent_runs"].includes(e),
      ),
    );
  });
});
