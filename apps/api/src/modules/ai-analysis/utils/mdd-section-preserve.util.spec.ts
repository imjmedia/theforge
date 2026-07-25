import { describe, it } from "node:test";
import assert from "node:assert";
import { deduplicateUatSections } from "./mdd-sanitize/cross-consistency.js";
import { deduplicateAndReorderMddSections, extractSection5Body } from "./mdd-sanitize/section-merge.js";
import {
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  draftHasSubstantialSection4,
  draftHasSubstantialSection5,
  guardTailSectionsForPersist,
  preserveSection2IfSubstantial,
  preserveSection3IfSubstantial,
  preserveSection4IfSubstantial,
  preserveSection5IfSubstantial,
  preserveSection6IfSubstantial,
  preserveSection7IfSubstantial,
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

const S4_BODY = `| Método | Ruta | Descripción |
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
