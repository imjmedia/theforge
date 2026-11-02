import { describe, it } from "node:test";
import assert from "node:assert";
import { createMddSection5Node } from "./mdd-section5.node.js";

class FakeLlm {
  callCount = 0;
  constructor(public response: string) {}
  async invoke(_messages: unknown[]): Promise<unknown> {
    this.callCount += 1;
    return { content: this.response };
  }
}

const VALID_FULL_DRAFT = `# MDD
## 1. Contexto
${"ForgeOps es una plataforma SaaS. ".repeat(40)}
## 2. Arquitectura y Stack
${"NestJS + PostgreSQL. ".repeat(40)}
## 3. Modelo de Datos
${"CREATE TABLE tenants (id UUID PRIMARY KEY); ".repeat(15)}
\`\`\`TechnicalMetadata
[high_security]
\`\`\`
## 4. Contratos de API
${"| GET | /api/v1/health |\n".repeat(20)}
## 5. Lógica y Edge Cases
(Pendiente: Ingeniero de Lógica)
## 6. Seguridad
${"Argon2id. ".repeat(50)}
## 7. Infraestructura
${"Docker. ".repeat(40)}`;

describe("createMddSection5Node (CHANGELOG [Unreleased] → Added → \"Dedicated §5 pass\")", () => {
  it("regenera SOLO §5 preservando el resto del MDD", async () => {
    const llm = new FakeLlm(`## 5. Lógica y Edge Cases

- **Login**: dado credenciales válidas, cuando el usuario entra, entonces se emite JWT.
- **Refresh**: dado un refresh token, cuando se rota, entonces el viejo queda revocado.
- **Rate limit**: dado >5 intentos fallidos en 15 min, cuando el usuario intenta login, entonces la cuenta se bloquea.
- **Edge case**: la concurrencia en /licenses/:id/report-usage requiere idempotencia por (license_id, operation, period).`);
    const node = createMddSection5Node(llm as never);
    const result = await node({
      mddDraft: VALID_FULL_DRAFT,
      clarifiedScope: "Licenciamiento de plugins comerciales sobre The Forge",
      dbgaContent: "Capacidades: licencias, multi-tenant, aprovisionamiento, billing.",
    } as never);
    assert.notStrictEqual(result.mddDraft, undefined);
    const out = result.mddDraft!;
    // §1, §2, §3, §4, §6, §7 preservadas
    assert.ok(out.includes("ForgeOps es una plataforma SaaS"));
    assert.ok(out.includes("NestJS + PostgreSQL"));
    assert.ok(out.includes("CREATE TABLE tenants"));
    assert.ok(out.includes("Argon2id"));
    assert.ok(out.includes("Docker"));
    // §5 regenerada con el contenido del LLM
    assert.ok(out.includes("JWT"));
    assert.ok(out.includes("Refresh"));
    assert.ok(out.includes("Rate limit"));
    assert.ok(!out.includes("(Pendiente: Ingeniero de Lógica)"));
  });

  it("preserva el draft si el LLM devuelve un placeholder (fallback defensivo)", async () => {
    const llm = new FakeLlm("## 5. Lógica y Edge Cases\n\n(Pendiente: Ingeniero de Lógica)");
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: VALID_FULL_DRAFT } as never);
    // No debe tocar el draft — el (Pendiente) del LLM es peor que el actual
    assert.strictEqual(result.mddDraft, undefined);
  });

  it("preserva el draft si el LLM devuelve respuesta vacía tras retries", { timeout: 15_000 }, async () => {
    const llm = new FakeLlm("");
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: VALID_FULL_DRAFT } as never);
    assert.strictEqual(result.mddDraft, undefined);
  });

  it("preserva el draft si el LLM devuelve body demasiado corto (<100 chars)", async () => {
    const llm = new FakeLlm("## 5. Lógica y Edge Cases\n\ncorto");
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: VALID_FULL_DRAFT } as never);
    assert.strictEqual(result.mddDraft, undefined);
  });

  it("acepta un §5 fresco más corto que el baseline (sin auto-rechazo por ratio)", async () => {
    const richS5 = `${"Regla BDD KMS con rotación y auditoría. ".repeat(350)}`;
    const richDraft = VALID_FULL_DRAFT.replace(
      /## 5\. Lógica y Edge Cases[\s\S]*?(?=## 6\.)/,
      `## 5. Lógica y Edge Cases\n\n${richS5}\n\n`,
    );
    const llm = new FakeLlm(`## 5. Lógica y Edge Cases\n\n${"Resumen corto. ".repeat(20)}`);
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: richDraft } as never);
    assert.notStrictEqual(result.mddDraft, undefined);
    assert.ok(result.mddDraft.includes("Resumen corto."));
    assert.ok(!result.mddDraft.includes("Regla BDD KMS con rotación"));
  });

  it("inserta §5 cuando el heading canónico no existía (salto §4→§6)", async () => {
    const draftWithout5 = `# MDD
## 1. Contexto
${"ForgeOps es una plataforma SaaS. ".repeat(40)}
## 2. Arquitectura y Stack
${"NestJS + PostgreSQL. ".repeat(40)}
## 3. Modelo de Datos
${"CREATE TABLE tenants (id UUID PRIMARY KEY); ".repeat(15)}
## 4. Contratos de API
${"| GET | /api/v1/health |\n".repeat(20)}
## 6. Seguridad
${"Argon2id. ".repeat(50)}
## 7. Infraestructura
${"Docker. ".repeat(40)}`;
    const llm = new FakeLlm(`## 5. Lógica y Edge Cases

- **Login**: dado credenciales válidas, cuando el usuario entra, entonces se emite JWT.
- **Refresh**: dado un refresh token, cuando se rota, entonces el viejo queda revocado.
- **Rate limit**: dado >5 intentos fallidos en 15 min, cuando el usuario intenta login, entonces la cuenta se bloquea.
- **Edge case**: la concurrencia en /licenses/:id/report-usage requiere idempotencia por (license_id, operation, period).`);
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: draftWithout5 } as never);
    const out = result.mddDraft!;
    assert.match(out, /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i);
    assert.ok(out.includes("JWT"));
    assert.ok(out.indexOf("## 4. Contratos de API") < out.indexOf("## 5. Lógica y Edge Cases"));
    assert.ok(out.indexOf("## 5. Lógica y Edge Cases") < out.indexOf("## 6. Seguridad"));
  });

  it("recorta el bloque ## 5 si el LLM devuelve múltiples secciones (defensivo)", async () => {
    const llm = new FakeLlm(`## 5. Lógica y Edge Cases

- Regla BDD 1: cuando el usuario autenticado hace logout, entonces el refresh token queda revocado.
- Regla BDD 2: cuando concurrencia en /licenses/:id/report-usage, entonces idempotencia por (license_id, operation, period).
- Edge case: el rate limit debe contar por IP+usuario, no solo por usuario.
- Edge case: la validación de license features debe ser case-insensitive.

## 6. Seguridad (NO DEBERÍA ESTAR AQUÍ)

- Algo de seguridad.`);
    const node = createMddSection5Node(llm as never);
    const result = await node({ mddDraft: VALID_FULL_DRAFT } as never);
    const out = result.mddDraft!;
    // El §6 original debe preservarse, no ser sobrescrito por el LLM
    assert.ok(out.includes("Argon2id"));
    assert.ok(!out.includes("Algo de seguridad"));
    // §5 debe tener el contenido de las reglas
    assert.ok(out.includes("Regla BDD 1"));
  });
});
