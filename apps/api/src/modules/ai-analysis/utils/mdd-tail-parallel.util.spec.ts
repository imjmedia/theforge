import { describe, it } from "node:test";
import assert from "node:assert";
import {
  draftThroughSection4ForTailParallelFirstPass,
  ensureSection5TailParallelPlaceholder,
  extractContratosRoutesTableOnly,
  isTailParallelFirstPassDraft,
  mergePostCriticParallelResults,
  mergeTailParallelResults,
} from "./mdd-tail-parallel.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";
import { applyDeterministicCrossConsistencyFixes } from "./mdd-sanitize.js";
import { draftHasSubstantialSection6, draftHasSubstantialSection7 } from "./mdd-section-preserve.util.js";

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

describe("extractContratosRoutesTableOnly", () => {
  it("elimina bloques json y conserva tabla", () => {
    const body = `| Método | Ruta |\n|--------|------|\n| GET | /health |\n\n### POST /api/login\n\n**Request body:**\n\`\`\`json\n{"x":1}\n\`\`\``;
    const out = extractContratosRoutesTableOnly(body);
    assert.ok(out.includes("| GET | /health |"));
    assert.ok(!out.includes("```json"));
    assert.ok(out.includes("### POST /api/login"));
  });
});

describe("mergePostCriticParallelResults", () => {
  it("combina §4 del api_contracts con slices §6/§7 sin mddDraft de security", () => {
    const apiDraft = BASE_DRAFT.replace(
      /## 4\. Contratos de API[\s\S]*?(?=## 5\.)/,
      `## 4. Contratos de API\n\n| GET | /api/v1/health |\n\n### GET /api/v1/health\n\n\`\`\`json\n{}\n\`\`\`\n\n`,
    );
    const s6 = `${"Política JWT RS256. ".repeat(20)}`;
    const s7 = `${"Docker Compose prod. ".repeat(15)}`;

    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: apiDraft },
      {
        mddStructured: {
          seguridad: [{ title: "Seguridad", content: [s6] }],
        },
      },
      {
        mddStructured: {
          integracion: {
            subsections: [{ title: "Integración", content: [s7] }],
          },
        },
      },
    );

    const out = merged.mddDraft ?? "";
    assert.strictEqual(merged.postCriticParallelDone, true);
    assert.ok(out.includes("/api/v1/health"));
    assert.ok(out.includes("JWT RS256"));
    assert.ok(out.includes("Docker Compose"));
    assert.match(out, /## 5\. Lógica/);
  });

  it("fuerza §6 desde securitySectionMd cuando structured es placeholder", () => {
    const s6 = `${"Política JWT RS256 con rotación. ".repeat(20)}`;
    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT },
      {
        mddStructured: {
          seguridad: [{ title: "Seguridad", content: ["(Pendiente de definir.)"] }],
        },
        securitySectionMd: `## 6. Seguridad\n\n${s6}`,
      },
      { mddStructured: { integracion: { subsections: [{ title: "Infra", content: ["Docker"] }] } } },
    );
    assert.ok(merged.mddDraft?.includes("JWT RS256"));
  });

  it("fuerza §7 cuando integracion OK aunque cuerpo previo era placeholder", () => {
    const s7 = `${"Docker Compose + PostgreSQL + Redis cache. ".repeat(15)}`;
    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT },
      {
        mddStructured: {
          seguridad: [{ title: "Auth", content: [`${"Argon2id. ".repeat(30)}`] }],
        },
      },
      {
        mddStructured: {
          integracion: { subsections: [{ title: "Despliegue", content: [s7] }] },
        },
      },
    );
    const out = merged.mddDraft ?? "";
    assert.ok(out.includes("Docker Compose"));
    assert.ok(out.includes("Argon2id"));
    assert.match(out, /## 7\. Infraestructura/);
  });

  it("guarda snapshots §6/§7 y securitySectionMd tras merge OK", () => {
    const s6 = `${"Política JWT RS256. ".repeat(20)}`;
    const s7 = `${"Docker Compose prod. ".repeat(15)}`;
    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT },
      {
        mddStructured: { seguridad: [{ title: "Seguridad", content: [s6] }] },
        securitySectionMd: `## 6. Seguridad\n\n${s6}`,
      },
      {
        mddStructured: { integracion: { subsections: [{ title: "Integración", content: [s7] }] } },
        integrationSectionMd: `## 7. Infraestructura\n\n${s7}`,
      },
    );
    assert.ok(merged.securityArchitectMddDraftSnapshot);
    assert.ok(merged.integrationArchitectMddDraftSnapshot);
    assert.ok(merged.securitySectionMd?.includes("JWT RS256"));
    assert.ok(merged.integrationSectionMd?.includes("Docker Compose"));
    assert.ok(draftHasSubstantialSection6(merged.mddDraft ?? ""));
    assert.ok(draftHasSubstantialSection7(merged.mddDraft ?? ""));
  });
});

describe("mergeTailParallelResults", () => {
  it("preserva §1–§4 e inyecta §5, §6 y §7 desde resultados paralelos", () => {
    const s5Body = `- **Login**: JWT emitido tras credenciales válidas.
- **Refresh**: rotación de refresh token.
- **Concurrencia**: idempotencia en operaciones de escritura.`.repeat(3);
    const s6Body = `${"Argon2id para passwords. MFA TOTP. ".repeat(20)}`;
    const s7Body = `${"Docker Compose + PostgreSQL + Redis. ".repeat(15)}`;

    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT.replace(MDD_SECTION5_TAIL_PLACEHOLDER, s5Body) },
      { mddDraft: BASE_DRAFT.replace(/## 6\. Seguridad[\s\S]*?(?=## 7\.)/, `## 6. Seguridad\n\n${s6Body}\n\n`) },
      {
        mddDraft: BASE_DRAFT.replace(
          /## 7\. Infraestructura[\s\S]*$/,
          `## 7. Infraestructura\n\n${s7Body}`,
        ),
      },
    );

    const out = merged.mddDraft ?? "";
    assert.ok(out.includes("Alcance ForgeOps SaaS"));
    assert.ok(out.includes("CREATE TABLE tenants"));
    assert.ok(out.includes("JWT emitido"));
    assert.ok(out.includes("Argon2id"));
    assert.ok(out.includes("Docker Compose"));
    assert.ok(!out.includes(MDD_SECTION5_TAIL_PLACEHOLDER));
  });

  it("conserva placeholder §5 si section5 no devolvió contenido sustancial", () => {
    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      {},
      {
        mddDraft: BASE_DRAFT.replace(
          /\(Pendiente: Arquitecto de Seguridad\)/,
          "Política RS256.",
        ),
      },
      {
        mddDraft: BASE_DRAFT.replace(
          /\(Pendiente: Ingeniero de Integración\)/,
          "CI/CD GitHub Actions.",
        ),
      },
    );
    const out = merged.mddDraft ?? "";
    assert.ok(out.includes(MDD_SECTION5_TAIL_PLACEHOLDER));
    assert.ok(out.includes("Política RS256"));
    assert.ok(out.includes("CI/CD GitHub Actions"));
  });

  it("no pierde §6 si integration falla pero security OK", () => {
    const secDraft = BASE_DRAFT.replace(
      /\(Pendiente: Arquitecto de Seguridad\)/,
      `${"Lockout 5 intentos / 15 min. ".repeat(15)}`,
    );
    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      {},
      { mddDraft: secDraft },
      { mddDraft: BASE_DRAFT },
    );
    assert.ok(merged.mddDraft?.includes("Lockout 5 intentos"));
  });
});

describe("ensureSection5TailParallelPlaceholder", () => {
  it("inserta placeholder §5 cuando falta", () => {
    const without5 = BASE_DRAFT.replace(/## 5\.[\s\S]*?(?=## 6\.)/, "");
    const out = ensureSection5TailParallelPlaceholder(without5);
    assert.match(out, /## 5\. Lógica y Edge Cases/);
    assert.ok(out.includes(MDD_SECTION5_TAIL_PLACEHOLDER));
  });

  it("no re-inserta §5 si H2 ya existe (stub)", () => {
    const stub = `# Master Design Document

## 1. Contexto

Alcance.

## 4. Contratos de API

| GET | /health |

## 5. Lógica y Edge Cases

### Reglas de negocio (BDD/AAA)
# ---

## 6. Seguridad

(Pendiente: Arquitecto de Seguridad)
`;
    const out = ensureSection5TailParallelPlaceholder(stub);
    assert.strictEqual((out.match(/## 5\. Lógica y Edge Cases/g) ?? []).length, 1);
    assert.ok(!out.includes(`${MDD_SECTION5_TAIL_PLACEHOLDER}\n\n## 5.`));
  });
});

describe("isTailParallelFirstPassDraft", () => {
  it("detecta borrador pre-merge (§6/§7 pendientes)", () => {
    assert.strictEqual(isTailParallelFirstPassDraft(BASE_DRAFT), true);
  });

  it("false cuando §6 ya es sustancial", () => {
    const withS6 = BASE_DRAFT.replace(
      /\(Pendiente: Arquitecto de Seguridad\)/,
      `${"Argon2id hashing policy. ".repeat(20)}`,
    );
    assert.strictEqual(isTailParallelFirstPassDraft(withS6), false);
  });
});

describe("draftThroughSection4ForTailParallelFirstPass", () => {
  it("trunca después de §4", () => {
    const out = draftThroughSection4ForTailParallelFirstPass(BASE_DRAFT);
    assert.ok(out.includes("Contratos de API"));
    assert.ok(!out.includes("## 6. Seguridad"));
  });
});

describe("cross-consistency tras merge paralelo", () => {
  it("determinista puede alinear §5 lockout con §6 genérica post-merge", () => {
    const s5Body = `- **Login lockout**: tras 5 intentos fallidos en 15 minutos, la cuenta queda bloqueada.
- **Refresh**: rotación de refresh token con revocación del anterior.
- **Idempotencia**: claves idempotencia en POST de escritura.`.repeat(2);
    const s6Body = `${"Transporte TLS 1.3. JWT RS256. ".repeat(15)}`;
    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT.replace(MDD_SECTION5_TAIL_PLACEHOLDER, s5Body) },
      { mddDraft: BASE_DRAFT.replace(/## 6\. Seguridad[\s\S]*?(?=## 7\.)/, `## 6. Seguridad\n\n${s6Body}\n\n`) },
      { mddDraft: BASE_DRAFT },
    );
    const fixed = applyDeterministicCrossConsistencyFixes(merged.mddDraft ?? "");
    assert.ok(fixed.includes("5 intentos"));
    assert.ok(fixed.length > (merged.mddDraft ?? "").length - 500);
  });
});
