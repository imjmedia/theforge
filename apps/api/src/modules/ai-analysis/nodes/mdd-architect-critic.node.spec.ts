import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildArchitectCriticOutline,
  parseCreateTables,
  parseEndpoints,
} from "../utils/mdd-architect-critic-outline.util.js";
import { createMddArchitectCriticNode, parseArchitectCriticOutput } from "./mdd-architect-critic.node.js";

function makeSection3(tableCount: number): string {
  const tables = Array.from({ length: tableCount }, (_, i) => {
    const n = `tabla_${String(i + 1).padStart(2, "0")}`;
    return `CREATE TABLE ${n} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(120) NOT NULL,
  monto NUMERIC(10,2) NOT NULL,
  owner_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_${n} UNIQUE (nombre, owner_id)
);`;
  });
  const er = ["erDiagram", ...Array.from({ length: tableCount }, (_, i) => `  tabla_${String(i + 1).padStart(2, "0")} {\n    uuid id PK\n  }`)];
  return `\`\`\`sql\n${tables.join("\n\n")}\n\`\`\`\n\n\`\`\`mermaid\n${er.join("\n")}\n  tabla_01 ||--o{ tabla_02 : tiene\n\`\`\`\n\nTechnicalMetadata: [high_security] [external_api]`;
}

function makeSection4(endpointCount: number): string {
  const rows = Array.from(
    { length: endpointCount },
    (_, i) => `| GET | /api/v1/recurso-${i + 1} | Lista el recurso número ${i + 1} | JWT |`,
  );
  return `| Método | Ruta | Descripción | Auth |\n|---|---|---|---|\n${rows.join("\n")}\n\n### POST /api/v1/recurso-1 — Crea recurso\n\n\`\`\`json\n{"a":1}\n\`\`\`\n`;
}

describe("buildArchitectCriticOutline", () => {
  it("lista todas las tablas (15+) con solo nombres de columna, sin cortar el slice de 6000 chars", () => {
    const s3 = makeSection3(20);
    assert.ok(s3.length > 6000, "el §3 de prueba supera el antiguo recorte");
    const outline = buildArchitectCriticOutline({ section3: s3, section4: makeSection4(5) });
    for (let i = 1; i <= 20; i += 1) {
      assert.ok(outline.includes(`tabla_${String(i).padStart(2, "0")}(`), `falta tabla_${i}`);
    }
    assert.ok(outline.includes("owner_id→usuarios"));
    assert.ok(!/VARCHAR|NUMERIC|gen_random_uuid/.test(outline), "sin tipos ni defaults");
    assert.ok(!outline.includes("uq_tabla"), "constraints fuera");
    assert.match(outline, /TechnicalMetadata: presente/);
    assert.match(outline, /erDiagram entidades \(20\)/);
    assert.match(outline, /Ejemplos JSON en §4: 1/);
  });

  it("nunca parte una tabla ni un endpoint a la mitad al recortar y anota +N más", () => {
    const outline = buildArchitectCriticOutline({
      section3: makeSection3(30),
      section4: makeSection4(60),
      maxChars: 3_000,
    });
    assert.ok(outline.length <= 3_300, `outline ${outline.length}`);
    const tableLines = outline.split("\n").filter((l) => /^- tabla_\d+/.test(l));
    assert.ok(tableLines.length > 0 && tableLines.length < 30);
    for (const l of tableLines) assert.match(l, /^- tabla_\d+\(id, nombre, monto, owner_id→usuarios, descripcion, created_at\)$/);
    const epLines = outline.split("\n").filter((l) => /^- GET \/api/.test(l));
    assert.ok(epLines.length > 0 && epLines.length < 60);
    for (const l of epLines) assert.match(l, /^- GET \/api\/v1\/recurso-\d+ — Lista el recurso número \d+$/);
    assert.match(outline, /\+\d+ más tablas/);
    assert.match(outline, /\+\d+ más endpoints/);
  });

  it("parsea tablas con tipos con coma y endpoints de tabla y headings", () => {
    const t = parseCreateTables("CREATE TABLE IF NOT EXISTS pagos (id INT, total NUMERIC(10,2), PRIMARY KEY (id));");
    assert.deepEqual(t[0]!.columns, ["id", "total"]);
    const eps = parseEndpoints("| `GET /a` | uno |\n### 4.2 DELETE /b/{id}\n```json\n| GET | /nope | x |\n```");
    assert.deepEqual(eps.map((e) => `${e.method} ${e.path}`), ["GET /a", "DELETE /b/{id}"]);
  });
});

describe("parseArchitectCriticOutput", () => {
  it("devuelve null con texto no parseable", () => {
    assert.equal(parseArchitectCriticOutput("lo siento, no puedo"), null);
  });
});

describe("createMddArchitectCriticNode", () => {
  const draft = `# MDD\n\n## 3. Modelo de Datos\n\n${makeSection3(3)}\n\n## 4. Contratos de API\n\n${makeSection4(3)}\n`;
  const baseState = {
    mddDraft: draft,
    acceptedProposalDirective: "Agregar tabla aplicaciones y endpoint GET /applications",
    architectCriticAttempts: 0,
  };

  it("salida no parseable => ok (sin feedback ni reintento)", async () => {
    const llm = { invoke: async () => ({ content: "no sé qué responder, perdón" }) };
    const out = await createMddArchitectCriticNode(llm as never)(baseState as never);
    assert.equal(out.architectCriticFeedback, undefined);
    assert.equal(out.architectCriticAttempts, 1);
  });

  it("error del proveedor => ok (fail-open)", async () => {
    const llm = {
      invoke: async () => {
        throw new Error("503 upstream");
      },
    };
    const out = await createMddArchitectCriticNode(llm as never)(baseState as never);
    assert.equal(out.architectCriticFeedback, undefined);
  });

  it("gap explícito con gaps concretos => feedback", async () => {
    const llm = {
      invoke: async () => ({
        content: '```json\n{"verdict":"gap","gaps":["Falta tabla aplicaciones en el SQL"]}\n```',
      }),
    };
    const out = await createMddArchitectCriticNode(llm as never)(baseState as never);
    assert.equal(out.architectCriticFeedback, "Falta tabla aplicaciones en el SQL");
  });

  it("gap sin gaps concretos => ok", async () => {
    const llm = { invoke: async () => ({ content: '{"verdict":"gap","gaps":[]}' }) };
    const out = await createMddArchitectCriticNode(llm as never)(baseState as never);
    assert.equal(out.architectCriticFeedback, undefined);
  });

  it("el prompt enviado contiene todas las tablas del outline", async () => {
    let sent = "";
    const llm = {
      invoke: async (msgs: Array<{ content: string }>) => {
        sent = msgs[0]!.content;
        return { content: '{"verdict":"ok"}' };
      },
    };
    const big = `# MDD\n\n## 3. Modelo de Datos\n\n${makeSection3(20)}\n\n## 4. Contratos de API\n\n${makeSection4(3)}\n`;
    await createMddArchitectCriticNode(llm as never)({ ...baseState, mddDraft: big } as never);
    assert.ok(sent.includes("tabla_20("), "la tabla 20 debe llegar al crítico");
  });
});
