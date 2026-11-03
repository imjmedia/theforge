import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import {
  repairApiContractJsonFences,
  repairGluedSqlTokens,
  repairStackedCodeFences,
} from "./repair-pasted-markdown.js";

describe("repairStackedCodeFences", () => {
  it("quita fence vacío antes de json", () => {
    const raw = "**Response 200:**\n\n```\n```json\n{ \"status\": \"ok\" }\n```";
    const out = repairStackedCodeFences(raw);
    assert.doesNotMatch(out, /```\s*\n```json/);
    assert.match(out, /\*\*Response 200:\*\*\s*\n+```json/);
  });

  it("repara REFERENCES regiON estado en SQL", () => {
    const raw =
      "region_estado_id BIGINT NOT NULL REFERENCES regiON estado(id) ON DELETE CASCADE;";
    const glued = repairGluedSqlTokens(raw);
    assert.match(glued, /REFERENCES region_estado/);
    const out = formatDocumentMarkdown(raw);
    assert.match(out, /REFERENCES region_estado/);
  });

  it("quita llave suelta antes de bloques env del SSO", () => {
    const raw =
      "#### Variables de entorno\n}\n\n**Backend (NestJS):**\n\n```\n```env\nSSO_API_URL=x\n```";
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /Variables de entorno\n\}/);
    assert.match(out, /\*\*Backend \(NestJS\):\*\*\s*\n+```env/);
  });

  it("cierra request json y separa Response 200 en webhook ciudad", () => {
    const raw = `**Request body (ejemplo para ciudad desde OBP4MO):**
\`\`\`json
{
  "event": "created",
  "data": { "activo": true }
}

**Response 200:**

\`\`\`
\`\`\`json
{
  "status": "ok",
  "entity": "ciudad_administrativa",
  "action": "upserted"
}

**Beneficios de las tablas espejo**

- **Rendimiento:** test`;
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /```\s*\n```json/);
    assert.match(out, /```json[\s\S]*?"activo": true[\s\S]*?```\s*\n+\*\*Response 200/);
    assert.match(out, /\*\*Response 200:\*\*\s*\n+```json[\s\S]*?"status": "ok"[\s\S]*?```/);
    // Un título en negrita de un cliente concreto ya no se promueve a heading: la entrada se conserva.
    assert.match(out, /^\*\*Beneficios de las tablas espejo\*\*$/m);
    assert.doesNotMatch(out, /^#{1,6}\s+Beneficios de las tablas espejo/m);
  });

  it("repara Responses apilados en PUT costos-reales", () => {
    const raw = `**Request body:**
\`\`\`json
{ "source_system": "odoo", "actual_amount": 1 }

**Response 200:**

\`\`\`
\`\`\`json
{ "status": "ok", "new_margin_status": "GREEN" }

**Response 401:**

\`\`\`
\`\`\`json
{ "status": "error", "code": "UNAUTHORIZED" }`;
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /```\s*\n```json/);
    const blocks = out.match(/```json/g) ?? [];
    assert.equal(blocks.length, 3);
  });

  it("une JWT partido en dos fences json", () => {
    const raw = [
      "```json",
      "{",
      '  "sub": "u1",',
      '  "applications": [',
      "```",
      "```json",
      "    {",
      '      "applicationId": "app1",',
      '      "roles": ["admin"]',
      "    }",
      "  ]",
      "}",
      "```",
    ].join("\n");
    const out = formatDocumentMarkdown(raw);
    assert.doesNotMatch(out, /```\s*\n```json\n\s*\{/);
    assert.match(out, /"applications":\s*\[\s*\{/);
  });
});
