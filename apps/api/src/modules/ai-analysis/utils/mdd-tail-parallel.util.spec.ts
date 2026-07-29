import { describe, expect, it } from "vitest";
import {
  draftThroughSection4ForTailParallelFirstPass,
  ensureSection5TailParallelPlaceholder,
  isTailParallelFirstPassDraft,
  mergeTailParallelResults,
} from "./mdd-tail-parallel.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";
import { applyDeterministicCrossConsistencyFixes } from "./mdd-sanitize.js";

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
    expect(out).toContain("Alcance ForgeOps SaaS");
    expect(out).toContain("CREATE TABLE tenants");
    expect(out).toContain("JWT emitido");
    expect(out).toContain("Argon2id");
    expect(out).toContain("Docker Compose");
    expect(out).not.toContain(MDD_SECTION5_TAIL_PLACEHOLDER);
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
          `${"CI/CD GitHub Actions con Docker Compose y PostgreSQL. ".repeat(4)}`,
        ),
      },
    );
    const out = merged.mddDraft ?? "";
    expect(out).toContain(MDD_SECTION5_TAIL_PLACEHOLDER);
    expect(out).toContain("Política RS256");
    expect(out).toContain("CI/CD GitHub Actions");
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
    expect(merged.mddDraft).toContain("Lockout 5 intentos");
  });

  it("inyecta §7 desde integrationSectionMd aunque intDraft no tenga heading detectable", () => {
    const s7Body = `${"Docker Compose + PostgreSQL + manifest JSON. ".repeat(12)}`;
    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      {},
      {
        mddDraft: BASE_DRAFT,
      },
      {
        mddDraft: BASE_DRAFT,
        integrationSectionMd: `## 7. Infraestructura\n\n${s7Body}`,
      },
    );
    expect(merged.mddDraft).toContain("Docker Compose");
    expect(merged.mddDraft).not.toMatch(/\(Pendiente: Ingeniero de Integración\)/);
  });
});

describe("ensureSection5TailParallelPlaceholder", () => {
  it("inserta placeholder §5 cuando falta", () => {
    const without5 = BASE_DRAFT.replace(/## 5\.[\s\S]*?(?=## 6\.)/, "");
    const out = ensureSection5TailParallelPlaceholder(without5);
    expect(out).toMatch(/## 5\. Lógica y Edge Cases/);
    expect(out).toContain(MDD_SECTION5_TAIL_PLACEHOLDER);
  });
});

describe("isTailParallelFirstPassDraft", () => {
  it("detecta borrador pre-merge (§6/§7 pendientes)", () => {
    expect(isTailParallelFirstPassDraft(BASE_DRAFT)).toBe(true);
  });

  it("false cuando §6 ya es sustancial", () => {
    const withS6 = BASE_DRAFT.replace(
      /\(Pendiente: Arquitecto de Seguridad\)/,
      `${"Argon2id hashing policy. ".repeat(20)}`,
    );
    expect(isTailParallelFirstPassDraft(withS6)).toBe(false);
  });
});

describe("draftThroughSection4ForTailParallelFirstPass", () => {
  it("trunca después de §4", () => {
    const out = draftThroughSection4ForTailParallelFirstPass(BASE_DRAFT);
    expect(out).toContain("Contratos de API");
    expect(out).not.toContain("## 6. Seguridad");
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
    expect(fixed).toContain("5 intentos");
    expect(fixed.length).toBeGreaterThan((merged.mddDraft ?? "").length - 500);
  });
});
