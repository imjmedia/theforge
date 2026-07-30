import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeContratosSchemaRatio,
  computeSection6And7Overlap,
  evaluateContratosSchemaRatio,
  evaluateMddContentQuality,
  evaluateSection1Nfr,
  evaluateSection1NfrBlock,
  evaluateSection5Completeness,
  evaluateSection5TailTruncation,
  evaluateSection6And7Overlap,
  evaluateUnanchoredExampleTables,
  findUnanchoredExampleTables,
} from "./mdd-content-quality.util.js";

describe("computeContratosSchemaRatio / evaluateContratosSchemaRatio", () => {
  const withSchemas = (n: number, withJson: number) =>
    Array.from({ length: n }, (_, i) => {
      const heading = `### GET /v1/resource-${i}`;
      const body = i < withJson ? '\n\n```json\n{ "id": "uuid" }\n```' : "\n\nDescripción sin schema.";
      return `${heading}${body}`;
    }).join("\n\n");

  it("no evalúa con pocos endpoints (ruido estadístico)", () => {
    const body = withSchemas(3, 0);
    assert.equal(evaluateContratosSchemaRatio(body), null);
  });

  it("detecta ratio bajo de endpoints con schema (caso KMS: catálogo sin specs)", () => {
    const body = withSchemas(10, 3);
    const result = computeContratosSchemaRatio(body);
    assert.equal(result.totalEndpoints, 10);
    assert.equal(result.endpointsWithSchema, 3);
    const issue = evaluateContratosSchemaRatio(body);
    assert.match(String(issue), /3\/10/);
  });

  it("no marca nada cuando el ratio es alto", () => {
    const body = withSchemas(10, 9);
    assert.equal(evaluateContratosSchemaRatio(body), null);
  });
});

describe("evaluateSection1Nfr", () => {
  it("marca ausencia de bloque NFR", () => {
    const issue = evaluateSection1Nfr("Prosa de contexto sin sección de NFRs.");
    assert.match(String(issue), /no declara un bloque/);
  });

  it("marca bloque NFR presente pero sin cifras (cualitativo)", () => {
    const body = "### Requisitos No Funcionales\n\nDebe ser rápido y altamente disponible.";
    const issue = evaluateSection1Nfr(body);
    assert.match(String(issue), /0 línea/);
  });

  it("acepta bloque NFR con ≥2 líneas cuantificadas", () => {
    const body = [
      "### Requisitos No Funcionales",
      "",
      "- Latencia p99 < 300ms para operaciones criptográficas.",
      "- Disponibilidad 99.9% mensual.",
      "- RPO 15 min / RTO 1h para el clúster HSM.",
    ].join("\n");
    assert.equal(evaluateSection1Nfr(body), null);
    const parsed = evaluateSection1NfrBlock(body);
    assert.equal(parsed.hasNfrSection, true);
    assert.equal(parsed.quantifiedLines, 3);
  });
});

describe("evaluateSection5TailTruncation", () => {
  it("detecta subsección final con heading pero sin desarrollo", () => {
    const body = [
      "### 5.1 Reglas de negocio",
      "",
      "Contenido suficientemente largo para no ser un stub de la subsección uno.",
      "",
      "### 5.2 Edge cases técnicos",
      "",
      "Más contenido real aquí con suficiente longitud para pasar el mínimo exigido.",
      "",
      "### 5.3 Operativa",
      "",
      "Corto.",
    ].join("\n");
    const result = evaluateSection5Completeness(body);
    assert.equal(result.lastDeclaredIndex, 3);
    assert.equal(result.truncatedTail, true);
    assert.match(String(evaluateSection5TailTruncation(body)), /5\.3/);
  });

  it("no marca nada si la última subsección tiene cuerpo suficiente", () => {
    const body = [
      "### 5.1 Reglas",
      "",
      "Contenido suficientemente largo para pasar el mínimo de la subsección uno.",
      "",
      "### 5.2 Operativa",
      "",
      "Contenido también suficientemente largo para pasar el mínimo exigido aquí también.",
    ].join("\n");
    assert.equal(evaluateSection5TailTruncation(body), null);
  });

  it("no aplica si §5 no usa subsecciones numeradas", () => {
    const body = "Prosa libre sin subsecciones 5.N.";
    assert.equal(evaluateSection5Completeness(body).subsections, 0);
    assert.equal(evaluateSection5TailTruncation(body), null);
  });
});

describe("computeSection6And7Overlap / evaluateSection6And7Overlap", () => {
  const S6 = "TLS 1.3 en tránsito, RBAC granular, auditoría completa, rate limiting por IP.";
  const S7 = "Despliegue con TLS 1.3, RBAC por servicio, auditoría en cada nodo, rate limiting en el gateway.";

  it("detecta controles repetidos literalmente entre §6 y §7", () => {
    const result = computeSection6And7Overlap(S6, S7);
    assert.ok(result.overlapCount >= 4);
    assert.match(String(evaluateSection6And7Overlap(S6, S7)), /repiten/);
  });

  it("no marca nada con overlap bajo (controles distintos)", () => {
    const s7Distinct = "Kubernetes con HPA, Helm charts, CI/CD con GitHub Actions, backups nocturnos.";
    assert.equal(evaluateSection6And7Overlap(S6, s7Distinct), null);
  });
});

describe("findUnanchoredExampleTables / evaluateUnanchoredExampleTables", () => {
  const section3WithLeak = [
    "```sql",
    "CREATE TABLE keys (id UUID PRIMARY KEY);",
    "CREATE TABLE llm_configs (id UUID PRIMARY KEY);",
    "CREATE TABLE scheduled_tasks (id UUID PRIMARY KEY);",
    "```",
  ].join("\n");

  it("señala tablas del ejemplo del prompt sin ancla en BRD/DBGA", () => {
    const result = findUnanchoredExampleTables(section3WithLeak, "kms corporativo, rotación de claves");
    assert.deepEqual(result.tables.sort(), ["llm_configs", "scheduled_tasks"]);
    assert.match(String(evaluateUnanchoredExampleTables(section3WithLeak, "kms corporativo")), /llm_configs/);
  });

  it("no señala si el BRD/DBGA sí menciona esos términos (dominio real de orquestación)", () => {
    const result = findUnanchoredExampleTables(
      section3WithLeak,
      "kms corporativo con scheduled_tasks para rotación y llm_configs para el asistente interno",
    );
    assert.deepEqual(result.tables, []);
  });

  it("no señala tablas normales del dominio", () => {
    const clean = "```sql\nCREATE TABLE keys (id UUID PRIMARY KEY);\nCREATE TABLE certificates (id UUID PRIMARY KEY);\n```";
    assert.deepEqual(findUnanchoredExampleTables(clean, "").tables, []);
  });
});

describe("evaluateMddContentQuality (entrada agregada)", () => {
  it("agrega los 4 checks sobre un draft realista con los gaps del caso KMS", () => {
    const draft = [
      "# Master Design Document",
      "",
      "## 1. Contexto",
      "",
      "KMS corporativo para gestión de claves y certificados SAT.",
      "",
      "## 3. Modelo de Datos",
      "",
      "```sql",
      "CREATE TABLE keys (id UUID PRIMARY KEY);",
      "CREATE TABLE llm_configs (id UUID PRIMARY KEY);",
      "```",
      "",
      "## 4. Contratos de API",
      "",
      "### GET /v1/keys",
      "",
      "Descripción sin schema.",
      "",
      "### GET /v1/keys/{id}",
      "",
      "Descripción sin schema.",
      "",
      "### DELETE /v1/keys/{id}/revoke",
      "",
      "Descripción sin schema.",
      "",
      "### PATCH /v1/keys/{id}/rotate",
      "",
      "Descripción sin schema.",
      "",
      "### GET /v1/certificates",
      "",
      "```json",
      '{ "id": "uuid" }',
      "```",
      "",
      "## 5. Lógica y Edge Cases",
      "",
      "### 5.1 Reglas",
      "",
      "Contenido suficientemente largo para pasar el mínimo de esta subsección concreta.",
      "",
      "### 5.2 Operativa",
      "",
      "Corto.",
      "",
      "## 6. Seguridad",
      "",
      "TLS 1.3, RBAC granular, auditoría completa, rate limiting estricto.",
      "",
      "## 7. Infraestructura",
      "",
      "TLS 1.3 en el gateway, RBAC por servicio, auditoría por nodo, rate limiting global.",
    ].join("\n");

    const result = evaluateMddContentQuality({
      draft,
      domainCorpus: "kms corporativo, gestión de claves, certificados sat",
    });
    assert.equal(result.warnings.length, 5);
    assert.ok(result.warnings.some((w) => /NFR/.test(w) || /no declara un bloque/.test(w)));
    assert.ok(result.warnings.some((w) => /Contratos de API: solo/.test(w)));
    assert.ok(result.warnings.some((w) => /5\.2/.test(w)));
    assert.ok(result.warnings.some((w) => /llm_configs/.test(w)));
  });

  it("no genera warnings sobre un MDD limpio", () => {
    const draft = [
      "# Master Design Document",
      "",
      "## 1. Contexto",
      "",
      "### Requisitos No Funcionales",
      "",
      "- Latencia p99 < 200ms.",
      "- Disponibilidad 99.95%.",
      "",
      "## 3. Modelo de Datos",
      "",
      "```sql",
      "CREATE TABLE keys (id UUID PRIMARY KEY);",
      "```",
      "",
      "## 5. Lógica y Edge Cases",
      "",
      "### 5.1 Reglas",
      "",
      "Contenido suficientemente largo para pasar el mínimo exigido en esta subsección.",
      "",
      "## 6. Seguridad",
      "",
      "Controles de acceso granulares por rol de usuario.",
      "",
      "## 7. Infraestructura",
      "",
      "Kubernetes con HPA y despliegue blue/green vía CI/CD.",
    ].join("\n");
    assert.deepEqual(evaluateMddContentQuality({ draft }).warnings, []);
  });
});
