import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPantallasPlan,
  entityMatchTokens,
  extractMddAdminViewLines,
  inferUiHintFromText,
  mddDeclaresChatProduct,
  parseUserStoriesMarkdown,
  storyMatchesEntity,
} from "./ui-screens-plan.util.js";

const SAMPLE_HU = [
  "## Epic: Multi-tenant",
  "",
  "### Historia de usuario: [US-010] Gestionar tenants",
  "",
  "### 🧾 Historia de Usuario",
  "",
  "**Como:** Administrador de plataforma",
  "**Quiero:** crear y administrar tenants",
  "**Para:** aislar datos por cliente",
  "",
  "### Historia de usuario: [US-020] Dashboard ejecutivo",
  "",
  "### 🧾 Historia de Usuario",
  "",
  "**Como:** Director comercial",
  "**Quiero:** ver un panel con métricas de ventas",
  "**Para:** tomar decisiones rápidas",
].join("\n");

const SAMPLE_MDD = [
  "## 3. Modelo de Datos",
  "",
  "CREATE TABLE tenants (id UUID PRIMARY KEY);",
  "CREATE TABLE users (id UUID PRIMARY KEY, tenant_id UUID);",
].join("\n");

const SAMPLE_API = [
  "| GET | /api/v1/tenants | Listar tenants |",
  "| GET | /api/v1/users | Listar usuarios |",
].join("\n");

describe("ui-screens-plan — parseUserStoriesMarkdown", () => {
  it("extrae Como/Quiero/Para de plantilla The Forge", () => {
    const stories = parseUserStoriesMarkdown(SAMPLE_HU);
    assert.equal(stories.length, 2);
    assert.equal(stories[0].id, "US-010");
    assert.match(stories[0].want ?? "", /tenants/i);
    assert.equal(stories[1].id, "US-020");
    assert.match(stories[1].want ?? "", /panel/i);
  });
});

describe("ui-screens-plan — storyMatchesEntity", () => {
  it("vincula HU con nombre de tabla y variantes", () => {
    const story = parseUserStoriesMarkdown(SAMPLE_HU)[0];
    assert.ok(story);
    assert.ok(storyMatchesEntity(story, "tenants"));
    assert.ok(!storyMatchesEntity(story, "invoices"));
  });

  it("genera tokens singular/plural", () => {
    assert.ok(entityMatchTokens("tenants").includes("tenant"));
    assert.ok(entityMatchTokens("orders").includes("order"));
  });
});

describe("ui-screens-plan — inferUiHintFromText", () => {
  it("detecta kanban, form y dashboard", () => {
    assert.equal(inferUiHintFromText("mover tarjetas en el tablero kanban"), "kanban");
    assert.equal(inferUiHintFromText("formulario de alta de cliente"), "form");
    assert.equal(inferUiHintFromText("panel con métricas KPI"), "dashboard");
  });
});

describe("ui-screens-plan — buildPantallasPlan", () => {
  it("enriquece entidades §3 con HU y añade pantallas hu-only", () => {
    const plan = buildPantallasPlan(SAMPLE_MDD, SAMPLE_HU, SAMPLE_API);
    assert.equal(plan.length, 3);

    const tenants = plan.find((p) => p.name === "tenants");
    assert.ok(tenants);
    assert.equal(tenants.source, "entity+hu");
    assert.deepEqual(tenants.keyFields, ["id"]);
    assert.match(tenants.screenName, /tenants/i);
    assert.match(tenants.purpose, /Como:/);
    assert.equal(tenants.uiHint, "form");
    assert.equal(tenants.route, "/admin/tenants");

    const users = plan.find((p) => p.name === "users");
    assert.ok(users);
    assert.equal(users.source, "entity");
    assert.equal(users.route, "/admin/users");

    const dashboard = plan.find((p) => p.source === "hu-only" && /Dashboard/i.test(p.screenName));
    assert.ok(dashboard);
    assert.deepEqual(dashboard.keyFields, ["id"]);
    assert.match(dashboard.screenName, /Dashboard/i);
    assert.equal(dashboard.uiHint, "dashboard");
  });

  it("funciona sin historias (solo §3 + API)", () => {
    const plan = buildPantallasPlan(SAMPLE_MDD, null, SAMPLE_API);
    assert.equal(plan.length, 2);
    assert.ok(plan.every((p) => p.source === "entity"));
    assert.ok(plan.every((p) => p.v1InScope));
  });

  it("prioriza vistas administrativas §2.2 y reduce CRUD por entidad", () => {
    const mddWithViews = [
      "## 2. Arquitectura y Stack",
      "### 2.2 Frontend",
      "**Vistas administrativas:**",
      "- Dashboard de inquilinos (superadmin)",
      "- Gestión de empresas por inquilino",
      "- Catálogo MCP (superadmin)",
      "- Gestión de skills y agentes",
      "## 3. Modelo de Datos",
      "CREATE TABLE tenants (id UUID PRIMARY KEY);",
      "CREATE TABLE companies (id UUID PRIMARY KEY);",
      "CREATE TABLE agent_skills (id UUID PRIMARY KEY);",
    ].join("\n");

    const api = [
      "| GET | /api/v1/tenants | List |",
      "| GET | /api/v1/companies | List |",
    ].join("\n");

    const plan = buildPantallasPlan(mddWithViews, SAMPLE_HU, api);
    assert.ok(plan.length >= 4);
    assert.ok(plan.some((p) => /Dashboard de inquilinos/i.test(p.screenName)));
    assert.ok(!plan.some((p) => p.name === "agent_skills"));
    const adminFirst = plan.findIndex((p) => /Dashboard de inquilinos/i.test(p.screenName));
    assert.equal(adminFirst, 0);
  });

  it("KMS admin: rutas API, login form y sin /chat copiloto", () => {
    const kmsMdd = [
      "## 2. Arquitectura y Stack",
      "### 2.2 Frontend",
      "React 18 + Vite + Tailwind + Radix UI — panel admin KMS.",
      "## 3. Modelo de Datos",
      "CREATE TABLE users (id UUID PRIMARY KEY);",
      "CREATE TABLE cryptographic_keys (id UUID PRIMARY KEY);",
      "CREATE TABLE sat_certificates (id UUID PRIMARY KEY);",
      "CREATE TABLE pade_tokens (id UUID PRIMARY KEY);",
    ].join("\n");

    const kmsApi = [
      "| POST | /api/v1/auth/login | Login |",
      "| GET | /api/v1/keys | Listar llaves |",
      "| GET | /api/v1/certificates | Certificados SAT |",
      "| GET | /api/v1/tokens | Tokens PADE |",
    ].join("\n");

    const kmsHu = [
      "### Historia de usuario: [US-102] Inicio de sesión",
      "**Como:** Operador KMS",
      "**Quiero:** iniciar sesión con credenciales",
      "**Para:** acceder al panel admin",
    ].join("\n");

    const plan = buildPantallasPlan(kmsMdd, kmsHu, kmsApi);
    const login = plan.find((p) => p.route === "/login");
    assert.ok(login);
    assert.equal(login.uiHint, "form");
    assert.equal(login.pageName, "LoginPage");
    assert.match(login.primaryApi ?? "", /POST.*auth\/login/i);
    assert.ok(!/GET.*users/i.test(login.primaryApi ?? ""));

    const keys = plan.find((p) => p.name === "cryptographic_keys");
    assert.ok(keys);
    assert.equal(keys.route, "/admin/keys");
    assert.equal(keys.pageName, "KeysPage");
    assert.match(keys.primaryApi ?? "", /GET.*\/keys/i);

    assert.ok(plan.some((p) => p.name === "sat_certificates" && p.route === "/admin/certificates"));
    assert.ok(plan.some((p) => p.name === "pade_tokens" && p.route === "/admin/tokens"));
    assert.ok(!plan.some((p) => p.route === "/chat"));
    assert.equal(mddDeclaresChatProduct(kmsMdd), false);
  });

  it("no añade /chat sin producto chat en MDD aunque la HU mencione mensajes", () => {
    const mdd = [
      "## 2. Stack",
      "### 2.2 Frontend",
      "React admin panel.",
      "## 3. Modelo de Datos",
      "CREATE TABLE notifications (id UUID PRIMARY KEY);",
    ].join("\n");
    const hu = [
      "### Historia de usuario: [US-050] Ver mensajes",
      "**Como:** Operador",
      "**Quiero:** ver mensajes del sistema",
      "**Para:** estar informado",
    ].join("\n");
    const plan = buildPantallasPlan(mdd, hu, "| GET | /api/v1/notifications | List |");
    assert.ok(!plan.some((p) => p.route === "/chat"));
  });

  it("export_requests no comparte ruta /admin/keys con cryptographic_keys", () => {
    const mdd = [
      "## 3. Modelo de Datos",
      "CREATE TABLE cryptographic_keys (id UUID PRIMARY KEY);",
      "CREATE TABLE export_requests (id UUID PRIMARY KEY);",
    ].join("\n");
    const api = [
      "| GET | /api/v1/keys | List keys |",
      "| GET | /api/v1/export-requests | List exports |",
    ].join("\n");
    const plan = buildPantallasPlan(mdd, null, api);
    const keys = plan.find((p) => p.name === "cryptographic_keys");
    const exports = plan.find((p) => p.name === "export_requests");
    assert.equal(keys?.route, "/admin/keys");
    assert.equal(exports?.route, "/admin/export-requests");
  });
});
