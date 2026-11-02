import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { runApiContractsArchitectWithChunks } from "./mdd-api-contracts-chunk.runner.js";
import { draftHasPersistableSection4 } from "./mdd-section-preserve.util.js";

/** 8 tablas en §3 → 2 chunks (computeApiContractsChunkCount(8) = 2). */
const TABLAS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
const SQL = TABLAS.map((t) => `CREATE TABLE ${t} (id UUID PRIMARY KEY, nombre TEXT NOT NULL);`).join("\n\n");

const DRAFT = `# MDD Clínica
## 1. Contexto
${"Gestión de citas e historial clínico. ".repeat(12)}
## 2. Arquitectura y Stack
${"NestJS, PostgreSQL y colas BullMQ. ".repeat(12)}
## 3. Modelo de datos
\`\`\`sql
${SQL}
\`\`\`
## 4. Contratos de API
(Pendiente: definir endpoints)
## 5. Lógica y Edge Cases
(Pendiente)
`;

/** Bloque de endpoints con request/response; `variante` controla el nivel del heading. */
function endpointsPara(tablas: string[], variante: "h4" | "canonico"): string {
  const cab = variante === "h4" ? "####" : "###";
  return tablas
    .map((t) =>
      [
        `${cab} GET /api/v1/${t}`,
        "",
        "Request: query `limit` opcional.",
        "",
        "```json",
        `{ "response": { "items": [{ "id": "uuid", "nombre": "${t}" }] } }`,
        "```",
      ].join("\n"),
    )
    .join("\n\n");
}

const seccion4 = (cuerpo: string) => `## 4. Contratos de API\n\n${cuerpo}\n`;
const PROSA = "Análisis de las tablas de citas y pacientes, sin endpoints todavía.";

function silenciarConsola() {
  return {
    warn: mock.method(console, "warn", () => {}),
    log: mock.method(console, "log", () => {}),
  };
}

describe("runApiContractsArchitectWithChunks", () => {
  it("(a) normaliza #### GET de los chunks y devuelve §4 persistible con endpoints de todos", async () => {
    const consola = silenciarConsola();
    let llamadasBase = 0;
    try {
      const baseFn = async () => {
        llamadasBase++;
        return { mddDraft: seccion4(endpointsPara(["t1", "t2", "t3", "t4"], "h4")) };
      };
      const chunkFn = async () => ({
        mddDraft: seccion4(endpointsPara(["t5", "t6", "t7", "t8"], "h4")),
      });

      const out = await runApiContractsArchitectWithChunks(
        { mddDraft: DRAFT } as never,
        baseFn,
        { chunkFn },
      );

      const draft = out.mddDraft ?? "";
      assert.ok(draft.includes("## 4. Contratos de API"));
      assert.strictEqual(draftHasPersistableSection4(draft), true);
      for (const t of TABLAS) {
        assert.ok(draft.includes(`### GET /api/v1/${t}`), `falta el endpoint de ${t}`);
      }
      assert.strictEqual(llamadasBase, 1, "baseFn solo debe ejecutarse como chunk 0");
      const warnFallback = consola.warn.mock.calls.some((c) =>
        String(c.arguments[0]).includes("reintento sin chunking"),
      );
      assert.strictEqual(warnFallback, false);
    } finally {
      consola.warn.mock.restore();
      consola.log.mock.restore();
    }
  });

  it("(b) sin endpoints en ningún chunk reintenta una vez con baseFn y usa su §4", async () => {
    const consola = silenciarConsola();
    let llamadasBase = 0;
    const borradorCompleto = DRAFT.replace(
      /## 4\. Contratos de API[\s\S]*?(?=## 5\.)/,
      seccion4(endpointsPara(TABLAS, "canonico")) + "\n\n",
    );
    try {
      const baseFn = async () => {
        llamadasBase++;
        // Chunk 0 responde prosa; la segunda llamada es el reintento sin chunking.
        return { mddDraft: llamadasBase === 1 ? PROSA : borradorCompleto };
      };
      const chunkFn = async () => ({ mddDraft: PROSA });

      const out = await runApiContractsArchitectWithChunks(
        { mddDraft: DRAFT } as never,
        baseFn,
        { chunkFn },
      );

      assert.strictEqual(llamadasBase, 2, "baseFn debe llamarse exactamente una vez más (fallback)");
      const draft = out.mddDraft ?? "";
      assert.strictEqual(draftHasPersistableSection4(draft), true);
      assert.ok(draft.includes("### GET /api/v1/t3"));
      assert.ok(draft.includes("### GET /api/v1/t8"));
      const warnFallback = consola.warn.mock.calls.some((c) =>
        String(c.arguments[0]).includes("reintento sin chunking"),
      );
      assert.strictEqual(warnFallback, true);
    } finally {
      consola.warn.mock.restore();
      consola.log.mock.restore();
    }
  });

  it("(c) chunks con ### GET canónico: baseFn solo es el chunk 0 y no hay reintento", async () => {
    const consola = silenciarConsola();
    let llamadasBase = 0;
    try {
      const baseFn = async () => {
        llamadasBase++;
        return { mddDraft: seccion4(endpointsPara(["t1", "t2", "t3", "t4"], "canonico")) };
      };
      const chunkFn = async () => ({
        mddDraft: seccion4(endpointsPara(["t5", "t6", "t7", "t8"], "canonico")),
      });

      const out = await runApiContractsArchitectWithChunks(
        { mddDraft: DRAFT } as never,
        baseFn,
        { chunkFn },
      );

      const draft = out.mddDraft ?? "";
      assert.strictEqual(draftHasPersistableSection4(draft), true);
      assert.ok(draft.includes("### GET /api/v1/t1"));
      assert.ok(draft.includes("### GET /api/v1/t5"));
      assert.strictEqual(llamadasBase, 1);
      const warnFallback = consola.warn.mock.calls.some((c) =>
        String(c.arguments[0]).includes("reintento sin chunking"),
      );
      assert.strictEqual(warnFallback, false);
    } finally {
      consola.warn.mock.restore();
      consola.log.mock.restore();
    }
  });
});
