import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDomainInventory,
  detectAuthOnlySkew,
  extractBrdCapabilities,
  isStructuralBrdCapabilityTitle,
} from "./domain-inventory.util.js";
import {
  computeCascadeAccuracy,
  computeDocAccuracy,
  domainDeliveryGateFindings,
} from "./cascade-accuracy.util.js";

const DORIS_BRD_SNIPPET = `
# BRD - Copiloto Corporativo (CC)
## 3. Capacidades Funcionales del Producto
### 3.1 Autenticaci?n y autorizaci?n de usuarios
El copiloto valida la identidad mediante WhatsApp, email o PAT.
### 3.2 Recepci?n y clasificaci?n de solicitudes
Recibe mensajes desde WhatsApp v?a Wasender. Clasifica consulta MCP, general o acci?n.
### 3.3 Procesamiento multi-agente con calidad garantizada
Supervisor, Clarificador, Ejecutores MCP y Control de Calidad.
### 3.4 Memoria persistente y contexto multi-turno
Historial de conversaciones y embeddings.
### 3.5 Gesti?n de tareas programadas
Crear tareas recurrentes ejecutadas con token MCP.
### 3.6 Gesti?n de accesos a sistemas externos (MCP)
Registrar servidores MCP como Bitrix24.
### 3.7 Bit?cora de peticiones no cumplidas
Registrar fallos e HITL.
### 3.8 Panel de administraci?n (interfaz web)
Admin web para usuarios, MCP y bit?cora.
`;

const AUTH_ONLY_MDD = `
# Master Design Document
## 1. Contexto
Copiloto WhatsApp Bitrix
## 2. Arquitectura y Stack
NestJS
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY);
CREATE TABLE sessions (id UUID PRIMARY KEY);
CREATE TABLE security_events (id UUID PRIMARY KEY);
CREATE TABLE outbox_events (id UUID PRIMARY KEY);
\`\`\`
TechnicalMetadata: [high_security]
## 4. Contratos de API
POST /api/auth/login
## 5. L?gica y Edge Cases
Login
## 6. Seguridad
LDAP
## 7. Infraestructura
Docker
`;

describe("domain-inventory + cascade-accuracy", () => {
  it("extracts BRD capabilities including domain ones", () => {
    const caps = extractBrdCapabilities(DORIS_BRD_SNIPPET);
    assert.ok(caps.length >= 6);
    assert.ok(caps.some((c) => /multi-agente|WhatsApp|MCP|Bit?cora|Panel/i.test(c.title)));
    const domain = caps.filter((c) => !c.isAuthRelated);
    assert.ok(domain.length >= 5);
  });

  it("detects auth-only skew for Doris-like MDD", () => {
    const inv = buildDomainInventory({
      brdMarkdown: DORIS_BRD_SNIPPET,
      mddMarkdown: AUTH_ONLY_MDD,
      mddEntities: new Set(["users", "roles", "sessions", "security_events", "outbox_events"]),
    });
    const skew = detectAuthOnlySkew(
      ["users", "roles", "sessions", "security_events", "outbox_events"],
      inv.capabilities,
    );
    assert.equal(skew.skewed, true);
    assert.ok(skew.domainCapabilityCount >= 3);
  });

  it("domainDeliveryGateFindings blocks auth-only MDD when BRD has domain caps", () => {
    const findings = domainDeliveryGateFindings({
      brdMarkdown: DORIS_BRD_SNIPPET,
      mddMarkdown: AUTH_ONLY_MDD,
    });
    assert.ok(findings.blockers.some((b) => /auth-only|entities-missing/i.test(b)));
  });

  it("DocAccuracy is low for auth-skewed package (Doris baseline shape)", () => {
    const doc = computeDocAccuracy({
      brdMarkdown: DORIS_BRD_SNIPPET,
      mddMarkdown: AUTH_ONLY_MDD,
      apiContractsMarkdown: "# API\nPOST /api/auth/login\nGET /api/users\n",
      logicFlowsMarkdown: "# Flows\n## Login LDAP MFA\n",
      uiScreensMarkdown: "# Pantallas\n| Table |\n/dashboard Table\nfuera de alcance v1\n",
      tasksMarkdown: "# Tasks\n- [ ] Implementar LDAP login\n- [ ] MFA TOTP\n- [ ] Outbox\n",
      specMarkdown: "# Spec\n## 1.\n## 2.\n",
    });
    assert.ok(doc.score < 90, `expected doc score < 90, got ${doc.score}`);
    assert.ok(doc.components.some((c) => c.id === "C6_drift" && c.score < 50));
  });

  it("DocAccuracy no penaliza C4 cuando uiScreensRequired es false", () => {
    const withPenalty = computeDocAccuracy({
      mddMarkdown: "## 1.\n\n" + "x".repeat(200),
      specMarkdown: "# Spec\n\n" + "z".repeat(120),
      apiContractsMarkdown: "# API\n\n" + "a".repeat(120),
      uiScreensMarkdown: "",
      uiScreensRequired: true,
    });
    const neutral = computeDocAccuracy({
      mddMarkdown: "## 1.\n\n" + "x".repeat(200),
      specMarkdown: "# Spec\n\n" + "z".repeat(120),
      apiContractsMarkdown: "# API\n\n" + "a".repeat(120),
      uiScreensMarkdown: "",
      uiScreensRequired: false,
    });
    assert.ok(withPenalty.components.find((c) => c.id === "C4_screens")!.score === 0);
    assert.equal(neutral.components.find((c) => c.id === "C4_screens")!.score, 50);
    assert.ok(neutral.score >= withPenalty.score);
  });

  it("computeCascadeAccuracy hardGateBlocked when env enabled and scores low", () => {
    const report = computeCascadeAccuracy({
      brdMarkdown: DORIS_BRD_SNIPPET,
      mddMarkdown: AUTH_ONLY_MDD,
      tasksMarkdown: "- [ ] LDAP\n",
      hardGateEnabled: true,
    });
    assert.equal(report.hardGateEnabled, true);
    assert.equal(report.codegenReady, false);
    assert.equal(report.hardGateBlocked, true);
  });

  it("suggests domain entities from BRD prose", () => {
    const inv = buildDomainInventory({ brdMarkdown: DORIS_BRD_SNIPPET });
    assert.ok(inv.suggestedEntities.length >= 3);
    assert.ok(inv.crudMatrix.some((r) => !r.infraOnly));
    assert.ok(inv.processes.length >= 5);
  });

  it("suggests explicit snake_case entity bullets from BRD §3", () => {
    const brd = `
## 3. Definición de entidades de negocio
- order_lines
- payment_schedules
- llm_configs
`;
    const inv = buildDomainInventory({ brdMarkdown: brd });
    assert.ok(inv.suggestedEntities.includes("order_lines"));
    assert.ok(inv.suggestedEntities.includes("payment_schedules"));
    assert.ok(inv.suggestedEntities.includes("llm_configs"));
  });

  it("ignores BRD template headings and parses ?3 Capacidades only", () => {
    const brd = `
# BRD
## 1. Contexto
## 1.
## 2.
## 3.
## 4.
Objetivo suelto
## 2. Usuarios y Casos de Uso
### Casos de uso clave
Actor hace algo
## 3. Capacidades Funcionales del Producto
### Gesti?n de inquilinos y empresas
Alta de tenant y empresas asociadas con aislamiento estricto de datos por cliente.
### Cat?logo de capacidades (MCP)
Registro de servidores MCP y traducci?n autom?tica de tools a skills at?micas.
## 4. Diagramas
### F?rmulas y umbrales
No aplica
## 8. Riesgos
### Riesgos
Riesgo operativo
`;
    assert.equal(isStructuralBrdCapabilityTitle("Casos de uso clave"), true);
    const caps = extractBrdCapabilities(brd);
    assert.ok(caps.length >= 2 && caps.length <= 4);
    assert.ok(caps.some((c) => /inquilinos/i.test(c.title)));
    assert.ok(!caps.some((c) => /casos de uso clave|f?rmulas y umbrales|^riesgos$/i.test(c.title)));
  });
});
