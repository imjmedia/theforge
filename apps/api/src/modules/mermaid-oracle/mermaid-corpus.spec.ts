/**
 * Spec de corpus contra el parser real de Mermaid (paso 1A.2 del plan
 * "Mermaid que no se rompe").
 *
 * Regla de oro que mide: si el diagrama original parsea, ninguna etapa de
 * reparación/normalización puede dejarlo inválido, perder su fence ni cambiarlo
 * en una segunda pasada.
 *
 * Para cada entrada de `MERMAID_CORPUS` con `expectedValid === true` y cada
 * etapa de `STAGES` se asertan tres cosas con el parser jsdom (`createNodeMermaidParser`):
 *   (a) la salida sigue siendo `ok`;
 *   (b) en las etapas de documento, el fence ```mermaid sigue existiendo (una vez)
 *       y el fence ```sql vecino está intacto;
 *   (c) idempotencia `f(f(x)) === f(x)`.
 *
 * Las combinaciones que HOY fallan están en `KNOWN_FAILURES` y corren como `todo`
 * (no `skip`): el spec entra en verde y cada paso 1A.3–1A.6 quita las suyas.
 * Si un `todo` pasa, se emite un diagnóstico "RESUELTO" para borrarlo de la tabla.
 *
 * Además de la regla de oro, el bloque "preservación" asegura que en las etapas de documento
 * un diagrama válido sale IGUAL al de entrada salvo espacios en blanco: una regla que sustituye
 * un diagrama válido por otro igualmente válido e idempotente (p. ej. el webhook inventado que
 * sustituía cualquier flowchart TD con >=8 nodos `sN(...)`, ya retirado) pasa la regla de oro pero
 * cambia el contenido del usuario.
 * Los cambios que HOY ocurren están registrados en `PRESERVATION_KNOWN_CHANGES` con su motivo.
 *
 * Variables de entorno:
 * - `MERMAID_CORPUS_STRICT=1`: ignora `KNOWN_FAILURES` (los rojos conocidos fallan de verdad).
 * - `MERMAID_PRESERVATION_STRICT=1`: ignora `PRESERVATION_KNOWN_CHANGES` (ver los cambios reales).
 * - `MERMAID_PRESERVATION_DUMP=1`: imprime, agrupados por etapa, los válidos que cambian.
 *
 * Las etapas se importan de `@theforge/shared-types/*` (dist-cjs): tras tocar
 * `packages/shared-types/src` hay que correr `pnpm --filter @theforge/shared-types build`.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeMermaid,
  normalizeMermaidInDocument,
  prepareMermaidDiagramForRender,
  repairMermaidBlockBody,
  resolveMermaidBlockForRender,
} from "@theforge/shared-types/mermaid";
import { formatDocumentMarkdown } from "@theforge/shared-types";
import {
  sanitizeMermaidBlock,
  sanitizeMermaidInDraft,
} from "../engine/mdd-pre-render.js";
import { prepareMddMarkdownForPersist } from "../ai-analysis/utils/mdd-sanitize/persist-pipeline.js";
import { MERMAID_CORPUS } from "./__fixtures__/mermaid-corpus.js";
import { createNodeMermaidParser } from "./node-mermaid-parser.js";

const parse = createNodeMermaidParser();

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

const SQL_BLOCK = "CREATE TABLE usuarios (\n  id INT PRIMARY KEY,\n  nombre TEXT\n);";
const MERMAID_FENCE_RE = /```mermaid[ \t]*\n([\s\S]*?)\n```/g;
const SQL_FENCE_RE = /```sql[ \t]*\n([\s\S]*?)\n```/g;

/** Documento mínimo: heading + fence mermaid + fence sql vecino. */
function wrapInDocument(body: string): string {
  return `## 3. Modelo de datos\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\n\`\`\`sql\n${SQL_BLOCK}\n\`\`\`\n`;
}

function extractFences(doc: string, re: RegExp): string[] {
  return [...doc.matchAll(re)].map((m) => m[1]);
}

type StageKind = "body" | "document";

interface Stage {
  /** Nombre estable (clave de KNOWN_FAILURES). */
  name: string;
  kind: StageKind;
  run: (input: string) => string;
}

function stripMermaidFence(fenced: string): string {
  return fenced
    .replace(/^```mermaid\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

const STAGES: Stage[] = [
  { name: "shared.repairMermaidBlockBody", kind: "body", run: (s) => repairMermaidBlockBody(s) },
  {
    name: "shared.normalizeMermaid",
    kind: "body",
    run: (s) => stripMermaidFence(normalizeMermaid("```mermaid\n" + s + "\n```")),
  },
  { name: "shared.resolveMermaidBlockForRender", kind: "body", run: (s) => resolveMermaidBlockForRender(s) },
  { name: "shared.prepareMermaidDiagramForRender", kind: "body", run: (s) => prepareMermaidDiagramForRender(s) },
  { name: "api.sanitizeMermaidBlock", kind: "body", run: (s) => sanitizeMermaidBlock(s) },
  { name: "shared.normalizeMermaidInDocument", kind: "document", run: (d) => normalizeMermaidInDocument(d) },
  { name: "shared.formatDocumentMarkdown", kind: "document", run: (d) => formatDocumentMarkdown(d) },
  {
    name: "shared.formatDocumentMarkdown.preserve",
    kind: "document",
    run: (d) => formatDocumentMarkdown(d, { mermaid: "preserve" }),
  },
  { name: "api.sanitizeMermaidInDraft", kind: "document", run: (d) => sanitizeMermaidInDraft(d) },
  { name: "api.prepareMddMarkdownForPersist", kind: "document", run: (d) => prepareMddMarkdownForPersist(d) },
];

// ---------------------------------------------------------------------------
// Rojos conocidos (clave `etapa|id` → motivo del `todo`). Se quitan al cerrar 1A.3–1A.6.
// "F1 #n" = fila de la tabla "Lista F1" del plan; "NO LISTADA" = causa que la tabla no
// recoge (candidata a regla nueva en 1A.3). Para ver los rojos reales: MERMAID_CORPUS_STRICT=1.
// ---------------------------------------------------------------------------

const KNOWN_FAILURES: Record<string, string> = {
};

const STRICT = process.env.MERMAID_CORPUS_STRICT === "1";

// ---------------------------------------------------------------------------
// Evaluación de un caso
// ---------------------------------------------------------------------------

type FailureMode = "invalido" | "fence-perdido" | "no-idempotente" | "parser-no-disponible";

interface CaseResult {
  modes: FailureMode[];
  detail: string[];
}

/** Aplica la etapa y devuelve el cuerpo mermaid resultante (o null si el fence se perdió). */
function runStage(
  stage: Stage,
  input: string,
): { body: string | null; sqlIntact: boolean; raw: string; threw?: string } {
  if (stage.kind === "body") {
    try {
      const out = stage.run(input);
      return { body: out, sqlIntact: true, raw: out };
    } catch (err) {
      return { body: null, sqlIntact: true, raw: "", threw: String(err) };
    }
  }
  let out: string;
  try {
    out = stage.run(wrapInDocument(input));
  } catch (err) {
    return { body: null, sqlIntact: false, raw: "", threw: String(err) };
  }
  const mermaids = extractFences(out, MERMAID_FENCE_RE);
  const sqls = extractFences(out, SQL_FENCE_RE);
  const sqlIntact = sqls.length === 1 && sqls[0] === SQL_BLOCK;
  return { body: mermaids.length === 1 ? mermaids[0] : null, sqlIntact, raw: out };
}

async function evaluateCase(stage: Stage, body: string): Promise<CaseResult> {
  const modes: FailureMode[] = [];
  const detail: string[] = [];
  const first = runStage(stage, body);

  if (first.threw) {
    modes.push("fence-perdido");
    detail.push(`la etapa lanzó: ${first.threw.slice(0, 120)}`);
    return { modes, detail };
  }

  if (stage.kind === "document") {
    if (first.body === null) {
      modes.push("fence-perdido");
      detail.push(`el fence \`\`\`mermaid no quedó exactamente una vez: ${JSON.stringify(first.raw.slice(0, 160))}`);
    }
    if (!first.sqlIntact) {
      if (!modes.includes("fence-perdido")) modes.push("fence-perdido");
      detail.push("el fence ```sql vecino no quedó intacto");
    }
  }

  if (first.body !== null) {
    const verdict = await parse(first.body);
    if (verdict.status === "unavailable") {
      modes.push("parser-no-disponible");
      detail.push(verdict.error);
    } else if (verdict.status === "invalid") {
      modes.push("invalido");
      detail.push(`salida inválida: ${verdict.error.split("\n")[0].slice(0, 120)}`);
    }

    // (c) Idempotencia: f(f(x)) === f(x), comparado sobre el cuerpo mermaid.
    // En etapas de documento se reaplica la etapa al documento ya procesado.
    let second: string | null = null;
    if (stage.kind === "body") {
      try {
        second = stage.run(first.body);
      } catch {
        second = null;
      }
    } else {
      try {
        const again = stage.run(first.raw);
        const m = extractFences(again, MERMAID_FENCE_RE);
        second = m.length === 1 ? m[0] : null;
      } catch {
        second = null;
      }
    }
    if (second !== first.body) {
      modes.push("no-idempotente");
      detail.push("f(f(x)) distinto de f(x)");
    }
  }

  return { modes, detail };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const validEntries = MERMAID_CORPUS.filter((e) => e.expectedValid === true);
const invalidEntries = MERMAID_CORPUS.filter((e) => e.expectedValid === false);

describe("oráculo jsdom (precondición)", () => {
  it("distingue válido de inválido y no está 'unavailable'", async () => {
    const ok = await parse("flowchart TD\n  A --> B");
    assert.equal(ok.status, "ok", JSON.stringify(ok));
    const bad = await parse("flowchart TD\n  A --> ");
    assert.equal(bad.status, "invalid", JSON.stringify(bad));
  });

  it("concuerda con Chrome (expectedValid) en todo el corpus medido", async () => {
    const disagreements: string[] = [];
    for (const entry of MERMAID_CORPUS) {
      if (entry.expectedValid === null) continue;
      const verdict = await parse(entry.body);
      const isValid = verdict.status === "ok";
      if (verdict.status === "unavailable" || isValid !== entry.expectedValid) {
        disagreements.push(`${entry.id}: jsdom=${verdict.status}, chrome=${entry.expectedValid}`);
      }
    }
    assert.deepEqual(disagreements, []);
  });
});

describe("corpus válido: ninguna etapa lo rompe (regla de oro)", () => {
  it(`hay entradas válidas (${validEntries.length})`, () => {
    assert.ok(validEntries.length >= 200, `se esperaban >= 200 válidos, hay ${validEntries.length}`);
  });

  for (const stage of STAGES) {
    describe(stage.name, () => {
      for (const entry of validEntries) {
        const key = `${stage.name}|${entry.id}`;
        const todo = STRICT ? undefined : KNOWN_FAILURES[key];
        it(entry.id, todo ? { todo } : {}, async (t) => {
          const result = await evaluateCase(stage, entry.body);
          if (todo && result.modes.length === 0) {
            t.diagnostic(`RESUELTO: ${key} ya pasa; quítalo de KNOWN_FAILURES`);
          }
          assert.deepEqual(
            result.modes,
            [],
            `${stage.name} sobre ${entry.id}: ${result.modes.join(", ")} — ${result.detail.join("; ")}`,
          );
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Preservación: un diagrama válido sale igual (salvo espacios) de las etapas de documento
// ---------------------------------------------------------------------------

/** Trim por línea, colapso de espacios/tabs múltiples y sin líneas vacías. */
function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter((line) => line !== "")
    .join("\n");
}

const DOCUMENT_STAGES = STAGES.filter((s) => s.kind === "document");
const DOCUMENT_STAGE_NAMES = DOCUMENT_STAGES.map((s) => s.name);
const NORMALIZING_STAGE_NAMES = DOCUMENT_STAGE_NAMES.filter(
  (n) => n !== "shared.formatDocumentMarkdown.preserve",
);

/**
 * Válidos que HOY cambian de contenido (clave `etapa|id` → motivo). No se ignoran con
 * `MERMAID_CORPUS_STRICT` (eso es de la regla de oro); sí con `MERMAID_PRESERVATION_STRICT=1`.
 * Cada paso de limpieza (quitar la regla destructiva) borra sus entradas; si una entrada ya no
 * cambia, el spec emite el diagnóstico "RESUELTO" para podarla. Una entrada NUEVA fuera de la
 * lista hace fallar el spec: así se detecta quien reintroduce una regla que reescribe válidos.
 */
const PRESERVATION_KNOWN_CHANGES: Record<string, string> = {};

/** Registra `ids` como cambiados por `reason` en todas las etapas que normalizan (no en `.preserve`). */
function knownChange(
  reason: string,
  ids: string[],
  stages: string[] = NORMALIZING_STAGE_NAMES,
): void {
  for (const stage of stages) {
    for (const id of ids) {
      const key = `${stage}|${id}`;
      assert.equal(PRESERVATION_KNOWN_CHANGES[key], undefined, `${key} registrado dos veces`);
      PRESERVATION_KNOWN_CHANGES[key] = reason;
    }
  }
}

// Medición 2026-11-03 (mermaid 11.15.0 / jsdom; ver ADR 0002, addendum):
// - 1 válido del corpus cambia en el registro: spec-054 (`par ticipant` → `participant`, par-ticipant y
//   block-balance son interdependientes: spec-054 se rompe sin cualquiera de las dos). Cambia en las 4 etapas que normalizan.
// `er-pk-fk-commas` ya no reescribe `PK, FK` válido: solo transforma `PK FK` sin coma.
// `formatDocumentMarkdown.preserve` no cambia ninguno.

// Cambio de `par ticipant` (spec-054): par-ticipant y block-balance se mantienen juntas en el registro.
knownChange(
  "P: `par ticipant ...` (un bloque `par` válido) se reinterpreta como `participant`; par-ticipant y block-balance son interdependientes (spec-054)",
  ["spec-054-mermaid-fix"],
);

const PRESERVATION_STRICT = process.env.MERMAID_PRESERVATION_STRICT === "1";
const PRESERVATION_DUMP = process.env.MERMAID_PRESERVATION_DUMP === "1";
const preservationDump: string[] = [];

describe("corpus válido: la salida se preserva salvo espacios en blanco", () => {
  for (const stage of DOCUMENT_STAGES) {
    describe(stage.name, () => {
      for (const entry of validEntries) {
        const key = `${stage.name}|${entry.id}`;
        const known = PRESERVATION_STRICT ? undefined : PRESERVATION_KNOWN_CHANGES[key];
        it(entry.id, async (t) => {
          const result = runStage(stage, entry.body);
          assert.equal(result.threw, undefined, `${key}: la etapa lanzó ${result.threw}`);
          assert.notEqual(result.body, null, `${key}: el fence mermaid no quedó exactamente una vez`);
          const before = normalizeWhitespace(entry.body);
          const after = normalizeWhitespace(result.body ?? "");
          const changed = before !== after;
          if (changed && PRESERVATION_DUMP) preservationDump.push(key);
          if (known) {
            t.diagnostic(
              changed
                ? `CONOCIDO: ${key} cambia (${known})`
                : `RESUELTO: ${key} ya se preserva; quítalo de PRESERVATION_KNOWN_CHANGES`,
            );
            return;
          }
          assert.equal(
            after,
            before,
            `${key}: un diagrama válido cambió de contenido.\n--- entrada ---\n${entry.body}\n--- salida ---\n${result.body}`,
          );
        });
      }
    });
  }

  it("lista de cambios conocidos: cada clave apunta a una etapa y un id válidos del corpus", () => {
    const validIds = new Set(validEntries.map((e) => e.id));
    const stageNames = new Set(DOCUMENT_STAGE_NAMES);
    const bad = Object.keys(PRESERVATION_KNOWN_CHANGES).filter((key) => {
      const [stage, id] = key.split("|");
      return !stageNames.has(stage) || !validIds.has(id);
    });
    assert.deepEqual(bad, []);
    for (const [key, reason] of Object.entries(PRESERVATION_KNOWN_CHANGES)) {
      assert.ok(reason.trim().length > 0, `${key}: falta el motivo`);
    }
  });

  after(() => {
    if (PRESERVATION_DUMP) console.log(`PRESERVATION_DUMP\n${preservationDump.join("\n")}`);
  });
});

describe("fixtures eval: los bloques ER sobreviven a prepareMddMarkdownForPersist", () => {
  const fixturesDir = path.resolve(process.cwd(), "eval", "mdd", "fixtures");
  const files = [
    "good-ecommerce-tienda-basica.md",
    "good-ecommerce-tienda-basica-subsecciones.md",
  ];
  const mermaidBlocks = (md: string): string[] =>
    [...md.matchAll(/```mermaid[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());

  for (const file of files) {
    const todo = STRICT ? undefined : KNOWN_FAILURES[`fixture|${file}`];
    it(file, todo ? { todo } : {}, async () => {
      const md = readFileSync(path.join(fixturesDir, file), "utf8");
      const before = mermaidBlocks(md);
      assert.ok(before.length > 0, "el fixture debe traer al menos un bloque mermaid");
      for (const block of before) {
        assert.equal((await parse(block)).status, "ok", "el bloque de entrada debe ser válido");
      }
      const after = mermaidBlocks(prepareMddMarkdownForPersist(md));
      assert.equal(after.length, before.length, "no deben perderse bloques mermaid");
      const failures: string[] = [];
      for (const [i, block] of after.entries()) {
        const verdict = await parse(block);
        if (verdict.status !== "ok") {
          failures.push(
            `bloque ${i}: ${verdict.status} ${"error" in verdict ? verdict.error.split("\n")[0].slice(0, 120) : ""}`,
          );
        }
      }
      assert.deepEqual(failures, []);
    });
  }
});

/** Reparados mínimos (de los inválidos del corpus) con `repairMermaidBlockBody`; ver BASELINE impreso. */
// `er-pk-fk-commas` vuelve al registro acotada a `PK FK` sin coma: spec-033 (`uuid id PK FK`) se repara de nuevo.
// Ver ADR 0002, addendum.
// 2026-11-03: baja de 30 a 29. `broken-fc_label_unclosed_bracket` (`A[Inicio --> B[Fin]`) solo se "reparaba"
// fusionando dos nodos y una arista en un único nodo (`A["Inicio --> B[Fin"]`): parseaba, pero cambiaba el
// significado. `quoteFlowchartSpacedLabels` ya no cita etiquetas con operador de arista (ADR 0002, addendum).
const REPAIR_BASELINE_MIN = 29;

describe("corpus inválido: tasa de reparación (baseline como suelo de regresión)", () => {
  it("cuenta cuántos inválidos quedan 'ok' tras repairMermaidBlockBody", async (t) => {
    const bySource = new Map<string, { total: number; repaired: number }>();
    for (const entry of invalidEntries) {
      const slot = bySource.get(entry.source) ?? { total: 0, repaired: 0 };
      slot.total += 1;
      let out = "";
      try {
        out = repairMermaidBlockBody(entry.body);
      } catch {
        out = "";
      }
      if (out && (await parse(out)).status === "ok") slot.repaired += 1;
      bySource.set(entry.source, slot);
    }
    const parts: string[] = [];
    let total = 0;
    let repaired = 0;
    for (const [source, v] of [...bySource.entries()].sort()) {
      parts.push(`${source}: ${v.repaired}/${v.total}`);
      total += v.total;
      repaired += v.repaired;
    }
    const line = `BASELINE reparación repairMermaidBlockBody: ${repaired}/${total} (${parts.join("; ")})`;
    t.diagnostic(line);
    console.log(line);
    assert.ok(total > 0);
    // Suelo de regresión: el baseline medido de repairMermaidBlockBody. Si sube, súbelo aquí.
    assert.ok(repaired >= REPAIR_BASELINE_MIN, `${line}; se esperaban >= ${REPAIR_BASELINE_MIN} reparados`);
  });
});
