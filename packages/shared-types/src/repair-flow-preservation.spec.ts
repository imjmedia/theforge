import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { repairIndentedProseBlocks, repairJsonFenceIntegrity, repairPastedMarkdown } from "./repair-pasted-markdown.js";
import { normalizeMermaidInDocument } from "./mermaid.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const webhookFlowFixture = readFileSync(
  join(fixtureDir, "mermaid-webhook-flow.fixture.txt"),
  "utf8",
);

describe("repairIndentedProseBlocks", () => {
  it("convierte pasos de webhook indentados a bullets", () => {
    const raw = `### Flujo de sincronización vía webhooks

    Evento en sistema origen: Cuando se crea un registro.
    Endpoint receptor: POST /api/v1/webhooks.
    Procesamiento: upsert tabla espejo.
`;
    const out = repairIndentedProseBlocks(raw);
    assert.match(out, /^- Evento en sistema origen:/m);
    assert.doesNotMatch(out, /^    Evento/m);
  });
});

const citasFlowchart = `flowchart TD
  s0("Usuario solicita una cita")
  s1("Sistema valida disponibilidad")
  s0 --> s1
  s2("Se muestran horarios libres")
  s1 --> s2
  s3("Usuario elige horario")
  s2 --> s3
  s4("Sistema reserva el horario")
  s3 --> s4
  s5("Se envia confirmacion por correo")
  s4 --> s5
  s6("Usuario recibe recordatorio")
  s5 --> s6
  s7("Cita atendida")
  s6 --> s7
  s8("Se registra asistencia")
  s7 --> s8`;

describe("flujos: ya no se generan diagramas desde viñetas ni se inventa un webhook", () => {
  it("golden citas s1..s8: flowchart TD válido con nodos sN(...) se conserva byte a byte", () => {
    const raw = `### Flujo de citas

\`\`\`mermaid
${citasFlowchart}
\`\`\`

### Beneficios
`;
    for (const out of [normalizeMermaidInDocument(raw), repairPastedMarkdown(raw)]) {
      assert.ok(out.includes(citasFlowchart), "el flowchart original debe quedar intacto");
      assert.doesNotMatch(out, /recv\["Recibir/);
      assert.doesNotMatch(out, /evt\["Evento en sistema origen/);
      assert.match(out, /### Beneficios/);
    }
  });

  it("las viñetas bajo ### Flujo de… se conservan como viñetas (sin mermaid generado)", () => {
    const raw = `### Flujo de sincronización vía webhooks

- Evento en origen: disparo webhook.
- Endpoint receptor: POST genérico.
- Procesamiento: upsert.
`;
    const out = repairPastedMarkdown(raw);
    assert.doesNotMatch(out, /```mermaid/);
    assert.match(out, /^- Evento en origen: disparo webhook\.$/m);
    assert.match(out, /^- Endpoint receptor: POST genérico\.$/m);
    assert.match(out, /^- Procesamiento: upsert\.$/m);
  });

  it("tres secciones Flujo de consecutivas conservan sus tres encabezados", () => {
    const raw = `### Flujo de alta

- Paso A1
- Paso A2

### Flujo de baja

- Paso B1
- Paso B2

### Flujo de cambio

- Paso C1
- Paso C2
`;
    const out = repairPastedMarkdown(raw);
    assert.match(out, /^### Flujo de alta$/m);
    assert.match(out, /^### Flujo de baja$/m);
    assert.match(out, /^### Flujo de cambio$/m);
    assert.doesNotMatch(out, /```mermaid/);
    for (const paso of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      assert.match(out, new RegExp(`^- Paso ${paso}$`, "m"));
    }
  });

  it("un flowchart TD válido con >=8 nodos sN(...) deja de reemplazarse por el webhook inventado", () => {
    const fixture = `### Flujo de sincronización vía webhooks

\`\`\`mermaid
${citasFlowchart}
\`\`\`
`;
    const out = formatDocumentMarkdown(fixture);
    assert.doesNotMatch(out, /recv\["|upsert --> rsp/);
    assert.match(out, /s8\("Se registra asistencia"\)/);
  });

  it("el volcado JSON aplanado del usuario (s0..s27) no se sustituye por un flujo inventado", () => {
    const out = repairPastedMarkdown(webhookFlowFixture);
    assert.doesNotMatch(out, /recv\["Recibir/);
    assert.doesNotMatch(out, /evt\["Evento en sistema origen/);
    assert.match(out, /### Flujo de sincronización vía webhooks/);
    assert.match(out, /### Beneficios de las tablas espejo/);
  });
});

describe("repairJsonFenceIntegrity", () => {
  it("cierra json antes de **Beneficios**", () => {
    const raw = '```json\n{ "status": "ok" }\n\n**Beneficios de las** tablas';
    const out = repairJsonFenceIntegrity(raw);
    assert.match(out, /```\n\n\*\*Beneficios/);
  });
});

describe("repairPastedMarkdown títulos en negrita pegados", () => {
  it("no promueve a heading un título de cliente (**Flujo de procesamiento** **Odoo genera**): se conserva la entrada", () => {
    const raw =
      "**Flujo de procesamiento** **Odoo genera** una OC.\n    Odoo envía el payload.\n    Si existe:\n        Actualiza actual_amount.\n    Si no existe:\n        Crea registro.\n    Responde con el resultado.\n";
    const out = repairPastedMarkdown(raw);
    assert.match(out, /^\*\*Flujo de procesamiento\*\* \*\*Odoo genera\*\* una OC\.$/m);
    assert.doesNotMatch(out, /^#{1,6}\s+Flujo de procesamiento/m);
    assert.doesNotMatch(out, /```mermaid/);
    assert.match(out, /Odoo envía el payload/);
    assert.match(out, /Si existe:/);
    assert.match(out, /Si no existe:/);
  });

  it("sigue separando `**Seguridad** **API Key** …` (regla genérica)", () => {
    const out = repairPastedMarkdown("**Seguridad** **API Key** en el header X-Api-Key.\n");
    assert.match(out, /^### Seguridad$/m);
    assert.match(out, /^- API Key en el header X-Api-Key\.$/m);
  });
});
