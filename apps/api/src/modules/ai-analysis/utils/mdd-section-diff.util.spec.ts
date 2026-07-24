import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffMddSectionTouches } from "./mdd-section-diff.util.js";
import { mergeTailParallelResults } from "./mdd-tail-parallel.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

const BASE_DRAFT = `# MDD
## 1. Contexto
${"Alcance ForgeOps SaaS. ".repeat(30)}
## 2. Arquitectura y Stack
${"NestJS + PostgreSQL. ".repeat(30)}
## 3. Modelo de Datos
${"CREATE TABLE tenants (id UUID PRIMARY KEY); ".repeat(10)}
## 4. Contratos de API
${"| GET | /api/v1/health |\n".repeat(15)}
## 5. Lógica y Edge Cases
${MDD_SECTION5_TAIL_PLACEHOLDER}
## 6. Seguridad
(Pendiente: Arquitecto de Seguridad)
## 7. Infraestructura
(Pendiente: Ingeniero de Integración)`;

describe("diffMddSectionTouches", () => {
  it("returns empty sectionsTouched when drafts are identical", () => {
    const diff = diffMddSectionTouches(BASE_DRAFT, BASE_DRAFT);
    assert.deepEqual(diff.sectionsTouched, []);
    assert.equal(Object.keys(diff.sectionLens).length, 0);
    assert.equal(diff.beforeLen, diff.afterLen);
  });

  it("detects only §3 when that section changes", () => {
    const after = BASE_DRAFT.replace(
      "CREATE TABLE tenants",
      "CREATE TABLE orgs",
    );
    const diff = diffMddSectionTouches(BASE_DRAFT, after);
    assert.deepEqual(diff.sectionsTouched, ["3"]);
    assert.ok(diff.sectionLens["3"]);
    assert.ok(diff.sectionLens["3"]!.after !== diff.sectionLens["3"]!.before);
  });

  it("detects §5 and §6 after parallel tail merge", () => {
    const s5Body = `- **Login**: JWT emitido tras credenciales válidas.
- **Refresh**: rotación de refresh token.`.repeat(3);
    const s6Body = `${"Argon2id para passwords. MFA TOTP. ".repeat(20)}`;

    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT.replace(MDD_SECTION5_TAIL_PLACEHOLDER, s5Body) },
      {
        mddDraft: BASE_DRAFT.replace(
          /## 6\. Seguridad[\s\S]*?(?=## 7\.)/,
          `## 6. Seguridad\n\n${s6Body}\n\n`,
        ),
      },
      { mddDraft: BASE_DRAFT },
    );

    const diff = diffMddSectionTouches(BASE_DRAFT, merged.mddDraft ?? "");
    assert.ok(diff.sectionsTouched.includes("5"));
    assert.ok(diff.sectionsTouched.includes("6"));
    assert.ok(diff.sectionLens["5"]);
    assert.ok(diff.sectionLens["6"]);
  });
});
