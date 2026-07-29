import { describe, it } from "node:test";
import assert from "node:assert";
import { deduplicateUatSections } from "./mdd-sanitize/cross-consistency.js";
import { deduplicateAndReorderMddSections, extractSection5Body } from "./mdd-sanitize/section-merge.js";
import {
  canUseSurgicalMergeBaseline,
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  draftHasSubstantialSection4,
  draftHasSubstantialSection5,
  guardTailSectionsForPersist,
  preserveSection2IfSubstantial,
  preserveSection2FromStackSnapshot,
  preserveSection3FromDataModelSnapshot,
  preserveSection4FromApiContractsSnapshot,
  draftHasPersistableSection4,
  preserveSection3IfSubstantial,
  preserveSection4IfSubstantial,
  preserveSection5IfSubstantial,
  preserveSection6IfSubstantial,
  preserveSection7IfSubstantial,
  preserveSection1FromClarifierSnapshot,
  preserveTailSectionsIfSubstantial,
  preserveValidatedSectionsIfSubstantial,
} from "./mdd-section-preserve.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

const S5_BODY = `- **Login**: JWT tras credenciales válidas.
- **Refresh**: rotación de refresh token.
- **Concurrencia**: idempotencia en escrituras.
${"Detalle adicional de reglas de negocio. ".repeat(12)}`;

const S2_BODY = `${"| Componente | Tecnología | Versión | Notas |\n| Backend | NestJS | 10.x | API REST |\n| Base de datos | PostgreSQL | 16 | Persistencia |\n".repeat(3)}${"Detalle de arquitectura y despliegue con Docker. ".repeat(8)}`;

const S3_BODY = `\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
\`\`\`
${"Índices y constraints adicionales del dominio. ".repeat(10)}`;

const S4_BODY = `### POST /api/v1/auth/login

\`\`\`json
{"email":"string","password":"string"}
\`\`\`

| Método | Ruta | Descripción |
| GET | /api/v1/health | Healthcheck |
| POST | /api/v1/auth/login | Login JWT |
${"| GET | /api/v1/recursos | Listado paginado |\n".repeat(12)}`;

const BASE = `# MDD
## 1. Contexto
${"Alcance del sistema. ".repeat(40)}
## 2. Arquitectura y Stack
${S2_BODY}
## 3. Modelo de Datos
${S3_BODY}
## 4. Contratos de API
${S4_BODY}
## 5. Lógica y Edge Cases
${S5_BODY}
## 6. Seguridad
Seguridad RS256.
## 7. Infraestructura
Docker.`;

describe("draftHasSubstantialSection5", () => {
  it("true con cuerpo >= 200 chars", () => {
    assert.equal(draftHasSubstantialSection5(BASE), true);
  });

  it("false con placeholder", () => {
    const placeholder = BASE.replace(S5_BODY, MDD_SECTION5_TAIL_PLACEHOLDER);
    assert.equal(draftHasSubstantialSection5(placeholder), false);
  });
});

describe("draftHasSubstantialSection2/3/4", () => {
  it("true con cuerpos sustanciales", () => {
    assert.equal(draftHasSubstantialSection2(BASE), true);
    assert.equal(draftHasSubstantialSection3(BASE), true);
    assert.equal(draftHasSubstantialSection4(BASE), true);
  });

  it("false con placeholder en baseline", () => {
    const placeholder = BASE.replace(S3_BODY, "(Pendiente: Arquitecto)");
    assert.equal(draftHasSubstantialSection3(placeholder), false);
  });

  it("false con stub Falta en §4 aunque tenga tabla journey", () => {
    const faltaStub = BASE.replace(
      S4_BODY,
      `(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco.)

| Método | Ruta |
| GET | /api/v1/health | health |`,
    );
    assert.equal(draftHasSubstantialSection4(faltaStub), false);
  });

  it("preserve §4: acepta contratos nuevos del Arquitecto sobre stub Falta+tabla", () => {
    const baseline = BASE.replace(
      S4_BODY,
      `(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco.)

| Método | Ruta |
| GET | /api/v1/old | legacy |`,
    );
    const architectS4 = `### POST /api/v1/auth/login

\`\`\`json
{"email":"string","password":"string"}
\`\`\`

### GET /api/v1/portfolios

\`\`\`json
{"items":[]}
\`\`\`

${"| GET | /api/v1/extra | extra |\n".repeat(20)}`;
    const merged = BASE.replace(S4_BODY, architectS4);
    const out = preserveSection4IfSubstantial(baseline, merged);
    assert.match(out, /POST \/api\/v1\/auth\/login/);
    assert.doesNotMatch(out, /Falta: definir endpoints/i);
    assert.doesNotMatch(out, /\/api\/v1\/old/);
  });
});

describe("preserveSection2/3/4IfSubstantial", () => {
  it("restaura §2 y §4 si dedupe/diagram las vació", () => {
    const wiped = BASE.replace(S2_BODY, "(Pendiente)").replace(S4_BODY, "(Pendiente)");
    const out = preserveValidatedSectionsIfSubstantial(BASE, wiped);
    assert.ok(out.includes("NestJS"));
    assert.ok(out.includes("/api/v1/auth/login"));
    assert.equal(draftHasSubstantialSection2(out), true);
    assert.equal(draftHasSubstantialSection4(out), true);
  });

  it("restaura §2–§7 aunque §1 sea boilerplate Basado en/stamp (benchmark+BRD)", () => {
    const thinS1 = `# MDD
## 1. Contexto

(Basado en: ## Contexto — BRD (negocio, KPIs, alcance)

<!-- theforge-doc:created=2026-07-17T00:29:17.585Z|updated=2026-07-17T00:29:17.585Z -->
> 📅 Creado: 17 de julio de 2026, 24:29:17 UTC · Última modificación: 17 de julio de 2026, 24:29:17 UTC
`;
    const wiped = `${thinS1}
## 2. Arquitectura y Stack
(Pendiente: Arquitecto de Software — stack y arquitectura.)
## 3. Modelo de Datos
(Pendiente)
## 4. Contratos de API
(Pendiente)
## 5. Lógica y Edge Cases
(Pendiente: paso dedicado Lógica y Edge Cases)
## 6. Seguridad
(Pendiente)
## 7. Infraestructura
(Pendiente)
`;
    const out = preserveValidatedSectionsIfSubstantial(BASE, wiped);
    assert.ok(out.includes("NestJS"));
    assert.ok(out.includes("CREATE TABLE users"));
    assert.ok(out.includes("/api/v1/auth/login"));
    assert.ok(out.includes("JWT tras credenciales"));
  });

  it("no inventa §3 si baseline era placeholder", () => {
    const baseline = BASE.replace(S3_BODY, "(Pendiente: Arquitecto)");
    const wiped = baseline.replace(S2_BODY, "(Pendiente)");
    const out3 = preserveSection3IfSubstantial(baseline, wiped);
    assert.ok(!out3.includes("CREATE TABLE sessions"));
    const out2 = preserveSection2IfSubstantial(baseline, wiped);
    assert.ok(out2.includes("NestJS"));
  });

  it("no toca §3 sustancial si sigue sustancial", () => {
    const tweaked = BASE.replace("sessions", "user_sessions");
    assert.equal(preserveSection3IfSubstantial(BASE, tweaked), tweaked);
  });
});

describe("preserveSection5IfSubstantial", () => {
  it("restaura §5 si el borrador actual la vació", () => {
    const wiped = BASE.replace(S5_BODY, "(Pendiente)");
    const out = preserveSection5IfSubstantial(BASE, wiped);
    assert.ok(out.includes("JWT tras credenciales"));
    assert.ok(out.length > wiped.length);
  });

  it("no toca si §5 sigue sustancial", () => {
    const tweaked = BASE.replace("idempotencia", "idempotencia mejorada");
    assert.equal(preserveSection5IfSubstantial(BASE, tweaked), tweaked);
  });
});

describe("preserveTailSectionsIfSubstantial (simula wipe Cross/Diagram)", () => {
  const S6_BODY = `${"Política RS256 con rotación de claves y rate limiting en login. ".repeat(8)}`;
  const S7_BODY = `${"Docker Compose con healthchecks, réplicas y despliegue en Dokploy. ".repeat(8)}`;
  const TAIL_BASE = BASE
    .replace("## 6. Seguridad\nSeguridad RS256.", `## 6. Seguridad\n${S6_BODY}`)
    .replace("## 7. Infraestructura\nDocker.", `## 7. Infraestructura\n${S7_BODY}`);

  it("restaura §2–§7 tras wipe simultáneo de core+cola", () => {
    const wiped = TAIL_BASE
      .replace(S2_BODY, "(Pendiente)")
      .replace(S5_BODY, "(Pendiente)")
      .replace(S6_BODY, "(Pendiente)")
      .replace(S7_BODY, "(Pendiente)");
    const out = preserveTailSectionsIfSubstantial(TAIL_BASE, wiped);
    assert.ok(out.includes("NestJS"));
    assert.ok(out.includes("JWT tras credenciales"));
    assert.ok(out.includes("rotación de claves"));
    assert.ok(out.includes("Docker Compose"));
  });

  it("preserveSection6/7 individuales", () => {
    const wiped6 = TAIL_BASE.replace(S6_BODY, "(Pendiente)");
    assert.ok(preserveSection6IfSubstantial(TAIL_BASE, wiped6).includes("rotación de claves"));
    const wiped7 = TAIL_BASE.replace(S7_BODY, "(Pendiente)");
    assert.ok(preserveSection7IfSubstantial(TAIL_BASE, wiped7).includes("Docker Compose"));
  });
});

describe("deduplicateUatSections", () => {
  it("no borra §5 entera cuando la sustancia está solo bajo UAT", () => {
    const uatBullets = ["- criterio a", "- criterio b", "- criterio c"].join("\n");
    const longUat = `${uatBullets}\n${"- detalle de regla de negocio. ".repeat(30)}`;
    const draft = `# MDD
## 1. Contexto
### Criterios UAT
${longUat}
## 5. Lógica y Edge Cases
### Criterios UAT
${longUat}
## 6. Seguridad
x
## 7. Infraestructura
y`;
    const out = deduplicateUatSections(draft);
    assert.ok(out.includes("detalle de regla de negocio"));
    assert.ok(!out.includes("Ver §1"));
  });
});

describe("extractSection5Body fence-aware", () => {
  it("no trunca §5 en ## dentro de bloques ```", () => {
    const fenceBody = `- Regla principal de negocio.
\`\`\`gherkin
Scenario: ejemplo
  Given un ## heading falso dentro del fence
\`\`\`
${"- Detalle adicional de la regla. ".repeat(15)}`;
    const draft = `# MDD
## 1. Contexto
x
## 5. Lógica y Edge Cases
${fenceBody}
## 6. Seguridad
y`;
    const body = extractSection5Body(draft);
    assert.ok(body && body.length >= 200);
    assert.ok(body.includes("heading falso dentro del fence"));
    assert.ok(body.includes("Detalle adicional"));
  });
});

describe("preserve tras dedupe/diagram wipe simulado", () => {
  it("restaura §5 sustancial tras deduplicateAndReorderMddSections vacía la cola", () => {
    const s5Extra = `${"- Regla de negocio con idempotencia y concurrencia. ".repeat(18)}`;
    const draft = `# Master Design Document

## 1. Contexto
${"Alcance extenso del producto. ".repeat(30)}

## 2. Arquitectura y Stack
NestJS

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API
| GET | /health |

## 5. Lógica y Edge Cases
${s5Extra}

## 6. Seguridad
RS256

## 7. Infraestructura
Docker
`;
    const wiped = deduplicateAndReorderMddSections(
      draft.replace(s5Extra, "(Pendiente: regenerar §5)"),
    );
    assert.ok(!draftHasSubstantialSection5(wiped));
    const restored = preserveTailSectionsIfSubstantial(draft, wiped);
    assert.ok(draftHasSubstantialSection5(restored));
    assert.ok(restored.includes("idempotencia"));
  });

  it("guardTailSectionsForPersist reintenta restore y reporta fallo si sigue insustancial", () => {
    const good = BASE;
    const wiped = good.replace(S5_BODY, "stub");
    const guard = guardTailSectionsForPersist(good, wiped, "test");
    assert.ok(guard.restored);
    assert.deepEqual(guard.failedSections, []);
    assert.ok(guard.markdown.includes("JWT tras credenciales"));
  });
});

describe("preserveSection1FromClarifierSnapshot", () => {
  const S1 = "Contexto del sistema con alcance detallado. ".repeat(25);

  it("restaura §1 desde snapshot del Clarificador tras vaciado por stack_architect", () => {
    const clarifier = `# MDD\n## 1. Contexto\n${S1}\n## 2. Arquitectura y Stack\n(Pendiente)\n`;
    const afterStack = `# MDD\n## 1. Contexto\n\n---\n\n## 2. Arquitectura y Stack\n${S2_BODY}\n`;
    const out = preserveSection1FromClarifierSnapshot(clarifier, afterStack);
    assert.ok(out.includes(S1.slice(0, 80)));
    assert.ok(out.includes("NestJS"));
  });
});

describe("canUseSurgicalMergeBaseline", () => {
  const S1_SHORT = "Contexto del sistema con alcance detallado. ".repeat(5);

  it("true con borrador corto pero §1 sustancial (post-Clarificador HIGH)", () => {
    const shortSkeleton = `# MDD\n## 1. Contexto\n${S1_SHORT}\n## 2. Arquitectura y Stack\n(Pendiente: Arquitecto de Software)\n## 3. Modelo de Datos\n(Pendiente)\n`;
    assert.ok(shortSkeleton.length < 600);
    assert.equal(canUseSurgicalMergeBaseline(shortSkeleton), true);
  });

  it("false con borrador vacío o sin §1 sustancial", () => {
    assert.equal(canUseSurgicalMergeBaseline(""), false);
    assert.equal(canUseSurgicalMergeBaseline("## 2. Arquitectura\n(Pendiente)\n"), false);
  });
});

describe("preserveSection2FromStackSnapshot", () => {
  it("restaura §2 desde snapshot de stack_architect tras vaciado por data_model", () => {
    const afterStack = `# MDD\n## 1. Contexto\n${"Alcance. ".repeat(40)}\n## 2. Arquitectura y Stack\n${S2_BODY}\n## 3. Modelo\n(Pendiente)\n`;
    const afterDataModel = afterStack.replace(S2_BODY, "(Pendiente: Arquitecto de Software)");
    const out = preserveSection2FromStackSnapshot(afterStack, afterDataModel);
    assert.ok(out.includes("NestJS"));
    assert.doesNotMatch(out, /\(Pendiente: Arquitecto de Software\)/);
  });
});

describe("preserveSection3FromDataModelSnapshot", () => {
  it("restaura §3 desde snapshot de data_model tras vaciado por api_contracts/format", () => {
    const afterDataModel = `# MDD\n## 1. Contexto\n${"Alcance. ".repeat(40)}\n## 3. Modelo de Datos\n${S3_BODY}\n## 4. Contratos\n(Pendiente)\n`;
    const afterApi = afterDataModel.replace(S3_BODY, "(Pendiente: Arquitecto de Software)");
    const out = preserveSection3FromDataModelSnapshot(afterDataModel, afterApi);
    assert.match(out, /CREATE TABLE users/i);
    assert.doesNotMatch(out, /\(Pendiente: Arquitecto de Software\)/);
  });
});

describe("preserveSection4FromApiContractsSnapshot", () => {
  it("restaura §4 desde snapshot de api_contracts tras vaciado por format", () => {
    const afterApi = `# MDD\n## 1. Contexto\n${"Alcance. ".repeat(40)}\n## 4. Contratos de API\n${S4_BODY}\n## 5. Lógica\n(Pendiente)\n`;
    const stub = `(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco.)

### Endpoints journey core (sincronización determinista)
| GET | /api/v1/credentials | list | Bearer | DBGA/BRD |`;
    const afterFormat = afterApi.replace(S4_BODY, stub);
    const out = preserveSection4FromApiContractsSnapshot(afterApi, afterFormat);
    assert.match(out, /\/api\/v1\/auth\/login/);
    assert.doesNotMatch(out, /Falta: definir endpoints/i);
  });
});

describe("draftHasPersistableSection4", () => {
  it("true con tabla densa sin json (catálogo api_contracts)", () => {
    const tableOnly = `| Método | Ruta | Descripción |
${"| GET | /api/v1/tenants | list |\n".repeat(8)}`;
    const draft = `# MDD\n## 4. Contratos de API\n${tableOnly}\n`;
    assert.equal(draftHasPersistableSection4(draft), true);
    assert.equal(draftHasSubstantialSection4(draft), false);
  });
});

describe("deduplicateAndReorderMddSections §1 duplicada", () => {
  it("prefiere §1 sustancial sobre ocurrencia vacía posterior", () => {
    const s1 = "Alcance completo del producto. ".repeat(30);
    const draft = `# Master Design Document
## 1. Contexto
${s1}

## 2. Arquitectura y Stack
${S2_BODY}

## 1. Contexto

## 3. Modelo de Datos
${S3_BODY}
`;
    const out = deduplicateAndReorderMddSections(draft);
    assert.ok(out.includes(s1.slice(0, 60)));
    assert.equal((out.match(/^##\s+1\.\s*Contexto/gim) ?? []).length, 1);
  });
});
