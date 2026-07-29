import { describe, it } from "node:test";
import assert from "node:assert";
import {
  deduplicateAndReorderMddSections,
  mergeSingleArchitectSectionIntoDraft,
  tryMergeSingleArchitectSectionIntoDraft,
} from "./section-merge.js";

const BASELINE = `# Master Design Document

## 1. Contexto
Baseline contexto único ALPHA.

## 2. Arquitectura y Stack
${"Baseline stack NestJS PostgreSQL. ".repeat(10)}

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE baseline_tenants (id UUID PRIMARY KEY);
\`\`\`
${"Más modelo baseline. ".repeat(20)}

## 4. Contratos de API
| Método | Ruta |
| GET | /api/v1/baseline-only |
${"Más contratos baseline. ".repeat(20)}

## 5. Lógica y Edge Cases
${"Baseline lógica edge cases. ".repeat(20)}

## 6. Seguridad
${"Baseline seguridad Argon2. ".repeat(20)}

## 7. Infraestructura
${"Baseline infra Docker. ".repeat(20)}
`;

const ARCHITECT = `# Master Design Document

## 1. Contexto
Architect overwrote context — BAD.

## 2. Arquitectura y Stack
${"Architect NEW stack Redis Kafka. ".repeat(10)}

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE architect_orders (id UUID PRIMARY KEY);
\`\`\`
${"Architect NEW modelo. ".repeat(20)}

## 4. Contratos de API
| Método | Ruta |
| POST | /api/v1/architect-only |
${"Architect NEW contratos. ".repeat(20)}

## 5. Lógica y Edge Cases
${"Architect NEW lógica. ".repeat(20)}

## 6. Seguridad
Architect wiped security — BAD.

## 7. Infraestructura
Architect wiped infra — BAD.
`;

describe("mergeSingleArchitectSectionIntoDraft", () => {
  it("§3: solo reemplaza modelo; preserva §2/§4/§5/§6/§7 del baseline", () => {
    const out = mergeSingleArchitectSectionIntoDraft(BASELINE, ARCHITECT, 3);
    assert.ok(out.includes("Baseline contexto único ALPHA"));
    assert.ok(out.includes("Baseline stack NestJS PostgreSQL"));
    assert.ok(out.includes("CREATE TABLE architect_orders"));
    assert.ok(!out.includes("CREATE TABLE baseline_tenants"));
    assert.ok(out.includes("/api/v1/baseline-only"));
    assert.ok(!out.includes("/api/v1/architect-only"));
    assert.ok(out.includes("Baseline lógica edge cases"));
    assert.ok(out.includes("Baseline seguridad Argon2"));
    assert.ok(out.includes("Baseline infra Docker"));
  });

  it("§4: solo reemplaza contratos; preserva §2/§3 del baseline", () => {
    const out = mergeSingleArchitectSectionIntoDraft(BASELINE, ARCHITECT, 4);
    assert.ok(out.includes("Baseline stack NestJS PostgreSQL"));
    assert.ok(out.includes("CREATE TABLE baseline_tenants"));
    assert.ok(out.includes("/api/v1/architect-only"));
    assert.ok(!out.includes("/api/v1/baseline-only"));
    assert.ok(out.includes("Baseline lógica edge cases"));
  });

  it("§2: solo reemplaza arquitectura; preserva §3/§4 del baseline", () => {
    const out = mergeSingleArchitectSectionIntoDraft(BASELINE, ARCHITECT, 2);
    assert.ok(out.includes("Architect NEW stack Redis Kafka"));
    assert.ok(!out.includes("Baseline stack NestJS PostgreSQL"));
    assert.ok(out.includes("CREATE TABLE baseline_tenants"));
    assert.ok(out.includes("/api/v1/baseline-only"));
  });

  it("si el cuerpo del architect es placeholder, conserva el baseline entero", () => {
    const badArchitect = BASELINE.replace(
      /## 3\. Modelo de Datos[\s\S]*?(?=\n## 4\.)/,
      "## 3. Modelo de Datos\n\n(Pendiente)\n\n",
    );
    const out = mergeSingleArchitectSectionIntoDraft(BASELINE, badArchitect, 3);
    assert.ok(out.includes("CREATE TABLE baseline_tenants"));
  });

  it("§4: conserva baseline cuando merge quirúrgico trunca contratos sustanciales", () => {
    const richBody =
      "GET /api/v1/baseline-only-endpoint\n".repeat(50) +
      "\n```json\n{\"ok\":true}\n```\n";
    const richBaseline = BASELINE.replace(
      /## 4\. Contratos de API[\s\S]*?(?=\n## 5\.)/,
      `## 4. Contratos de API\n${richBody}`,
    );
    const thinArchitect = BASELINE.replace(
      /## 4\. Contratos de API[\s\S]*?(?=\n## 5\.)/,
      "## 4. Contratos de API\nGET /api/v1/journey\nPOST /api/v1/journey\n".repeat(8),
    );
    const out = mergeSingleArchitectSectionIntoDraft(richBaseline, thinArchitect, 4);
    assert.ok(out.includes("/api/v1/baseline-only-endpoint"));
    assert.ok(!out.includes("/api/v1/journey"));
  });

  it("tryMerge: rechaza placeholder con merged=false y rejectReason", () => {
    const badArchitect = BASELINE.replace(
      /## 3\. Modelo de Datos[\s\S]*?(?=\n## 4\.)/,
      "## 3. Modelo de Datos\n\n(Pendiente: Arquitecto)\n\n",
    );
    const result = tryMergeSingleArchitectSectionIntoDraft(BASELINE, badArchitect, 3);
    assert.equal(result.merged, false);
    assert.equal(result.rejectReason, "placeholder");
    assert.ok(result.draft.includes("CREATE TABLE baseline_tenants"));
  });

  it("tryMerge: rechaza cuerpo corto", () => {
    const shortArchitect = BASELINE.replace(
      /## 2\. Arquitectura y Stack[\s\S]*?(?=\n## 3\.)/,
      "## 2. Arquitectura y Stack\n\nNestJS.\n\n",
    );
    const result = tryMergeSingleArchitectSectionIntoDraft(BASELINE, shortArchitect, 2);
    assert.equal(result.merged, false);
    assert.equal(result.rejectReason, "short");
  });

  it("tryMerge: merged=true cuando cuerpo sustancial", () => {
    const result = tryMergeSingleArchitectSectionIntoDraft(BASELINE, ARCHITECT, 3);
    assert.equal(result.merged, true);
    assert.ok(result.draft.includes("CREATE TABLE architect_orders"));
  });
});

describe("sanitizeArquitecturaStackBody via deduplicateAndReorderMddSections", () => {
  const substantialS2 = `${"NestJS monolito modular con Fastify. ".repeat(15)}
### 2.1 Backend
API REST con Prisma ORM.
### 4.1 Frontend (subsección interna §2)
React 18 con Vite — no es §4 canónica del MDD.
`;

  it("§2 con ### 4.1 interno NO queda Pendiente", () => {
    const draft = `# MDD
## 1. Contexto
${"Alcance KMS. ".repeat(30)}
## 2. Arquitectura y Stack
${substantialS2}
## 3. Modelo de Datos
CREATE TABLE users (id UUID PRIMARY KEY);
`;
    const out = deduplicateAndReorderMddSections(draft);
    assert.ok(!out.includes("(Pendiente: Arquitecto de Software)"));
    assert.ok(out.includes("NestJS monolito modular"));
    assert.ok(out.includes("### 4.1 Frontend"));
  });
});

describe("getSection6Or7Range / replaceSection6Or7InDraft", () => {
  it("no convierte ## 6 en ### 6 al reemplazar §6 en borrador largo", async () => {
    const { getSection6Or7Range, replaceSection6Or7InDraft, extractSection6Body } = await import(
      "./section-merge.js"
    );
    const { MDD_SECTION5_TAIL_PLACEHOLDER } = await import("../mdd-tail-parallel.config.js");
    const draft = `# MDD
## 1. Contexto
${"Alcance. ".repeat(40)}
## 2. Arquitectura y Stack
${"Stack. ".repeat(40)}
## 3. Modelo de Datos
${"CREATE TABLE t (id UUID PRIMARY KEY); ".repeat(8)}
## 4. Contratos de API
${"| GET | /health |\n".repeat(12)}
## 5. Lógica y Edge Cases
${MDD_SECTION5_TAIL_PLACEHOLDER}
## 6. Seguridad
(Pendiente: Arquitecto de Seguridad)
## 7. Infraestructura
(Pendiente: Ingeniero de Integración)`;
    const s6Body = `${"JWT RS256 y Argon2id. ".repeat(25)}`;
    const out = replaceSection6Or7InDraft(draft, 6, `## 6. Seguridad\n\n${s6Body}`);
    assert.ok(getSection6Or7Range(out, 6), "debe localizar ## 6. Seguridad canónico");
    assert.ok(!/\n###\s*6\.\s*Seguridad/i.test(out), "no debe dejar ### 6 pegado a §5");
    assert.ok(extractSection6Body(out)?.includes("Argon2id"));
  });
});
