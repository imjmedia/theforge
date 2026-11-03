/**
 * Foto del formateador de markdown (lote 2, paso 1): congela lo que HOY producen
 * `formatDocumentMarkdown` (modo por defecto), `repairPastedMarkdown` y, para MDD completos,
 * la secuencia pública de cada persist (`prepareMddMarkdownForPersist`) sobre las fixtures
 * de `eval/mdd` y la fixture local `__fixtures__/flujo-de-pasos.md`.
 *
 * Sirve para que quitar o cambiar una regla del formateador deje a la vista, como diff
 * legible, exactamente qué markdown deja de salir igual.
 *
 * Entradas:
 * - `apps/api/eval/mdd/fixtures/*.md` (MDD completos, uno de ellos deliberadamente malo).
 * - `apps/api/eval/mdd/cases/*.json`: los campos `dbga` y `brd` (markdown/prosa que escribe el
 *   usuario; `brief` es texto de chat y no pasa por el formateador).
 * - `__fixtures__/*.md`: casos sintéticos (p. ej. secciones "Flujo de ..." con >= 8 pasos).
 *
 * Fotos: `__snapshots__/<entrada>.<modo>.md` con modo `format`, `paste` o `persist`.
 *
 * Variables de entorno:
 * - `UPDATE_SNAPSHOTS=1`: (re)genera las fotos en vez de compararlas y elimina las huérfanas.
 *
 * Las etapas se importan de `@theforge/shared-types` (dist-cjs): tras tocar `packages/shared-types/src`
 * hay que correr `pnpm --filter @theforge/shared-types build`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatDocumentMarkdown, repairPastedMarkdown } from "@theforge/shared-types";
import { prepareMddMarkdownForPersist } from "./persist-pipeline.js";

const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";
const MAX_DIFF_LINES = 40;

const SNAPSHOT_DIR = path.resolve(process.cwd(), "src/modules/ai-analysis/utils/mdd-sanitize/__snapshots__");
const LOCAL_FIXTURES_DIR = path.resolve(process.cwd(), "src/modules/ai-analysis/utils/mdd-sanitize/__fixtures__");
const EVAL_DIR = path.resolve(process.cwd(), "eval/mdd");

type Mode = "format" | "paste" | "persist";

interface SnapshotInput {
  /** Nombre estable de la entrada (prefijo del fichero de la foto). */
  name: string;
  text: string;
  modes: Mode[];
}

const MODE_RUNNERS: Record<Mode, (text: string) => string> = {
  format: (text) => formatDocumentMarkdown(text),
  paste: (text) => repairPastedMarkdown(text),
  persist: (text) => prepareMddMarkdownForPersist(text),
};

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();
}

function collectInputs(): SnapshotInput[] {
  const inputs: SnapshotInput[] = [];

  for (const file of listFiles(path.join(EVAL_DIR, "fixtures"), ".md")) {
    inputs.push({
      name: file.replace(/\.md$/, ""),
      text: readFileSync(path.join(EVAL_DIR, "fixtures", file), "utf8"),
      modes: ["format", "paste", "persist"],
    });
  }

  for (const file of listFiles(path.join(EVAL_DIR, "cases"), ".json")) {
    const evalCase = JSON.parse(readFileSync(path.join(EVAL_DIR, "cases", file), "utf8")) as {
      id: string;
      dbga?: string;
      brd?: string;
    };
    for (const field of ["dbga", "brd"] as const) {
      const text = evalCase[field];
      if (typeof text === "string" && text.trim()) {
        inputs.push({ name: `case-${evalCase.id}.${field}`, text, modes: ["format", "paste"] });
      }
    }
  }

  for (const file of listFiles(LOCAL_FIXTURES_DIR, ".md")) {
    inputs.push({
      name: file.replace(/\.md$/, ""),
      text: readFileSync(path.join(LOCAL_FIXTURES_DIR, file), "utf8"),
      modes: ["format", "paste", "persist"],
    });
  }

  return inputs;
}

/** Primeras `MAX_DIFF_LINES` líneas que difieren (esperada `-`, obtenida `+`). */
function describeDiff(expected: string, actual: string): string {
  const exp = expected.split("\n");
  const act = actual.split("\n");
  const differing: number[] = [];
  for (let i = 0; i < Math.max(exp.length, act.length); i++) {
    if (exp[i] !== act[i]) differing.push(i);
  }
  const lines: string[] = [];
  for (const i of differing.slice(0, MAX_DIFF_LINES)) {
    if (exp[i] !== undefined) lines.push(`  L${i + 1} - ${exp[i]}`);
    if (act[i] !== undefined) lines.push(`  L${i + 1} + ${act[i]}`);
  }
  return (
    `${differing.length} línea(s) distintas (esperadas ${exp.length}, obtenidas ${act.length}); ` +
    `primeras ${Math.min(differing.length, MAX_DIFF_LINES)}:\n${lines.join("\n")}`
  );
}

const inputs = collectInputs();
const expectedFiles = new Set<string>();
for (const input of inputs) for (const mode of input.modes) expectedFiles.add(`${input.name}.${mode}.md`);

describe("foto del formateador: precondiciones", () => {
  it("hay entradas y cada una trae texto", () => {
    assert.ok(inputs.length >= 4, `se esperaban >= 4 entradas, hay ${inputs.length}`);
    for (const input of inputs) assert.ok(input.text.trim().length > 0, input.name);
  });
});

describe("foto del formateador (UPDATE_SNAPSHOTS=1 para regenerar)", () => {
  for (const input of inputs) {
    for (const mode of input.modes) {
      const fileName = `${input.name}.${mode}.md`;
      it(fileName, () => {
        const actual = MODE_RUNNERS[mode](input.text);
        const file = path.join(SNAPSHOT_DIR, fileName);
        if (UPDATE) {
          mkdirSync(SNAPSHOT_DIR, { recursive: true });
          writeFileSync(file, actual, "utf8");
          return;
        }
        assert.ok(
          existsSync(file),
          `falta la foto ${fileName}: corre con UPDATE_SNAPSHOTS=1 para generarla`,
        );
        const expected = readFileSync(file, "utf8");
        if (expected !== actual) {
          assert.fail(
            `${fileName} cambió respecto a la foto. Si el cambio es intencional, regenera con UPDATE_SNAPSHOTS=1.\n` +
              describeDiff(expected, actual),
          );
        }
      });
    }
  }

  it("no hay fotos huérfanas (sin entrada que las produzca)", () => {
    const orphans = listFiles(SNAPSHOT_DIR, ".md").filter((f) => !expectedFiles.has(f));
    if (UPDATE) {
      for (const f of orphans) unlinkSync(path.join(SNAPSHOT_DIR, f));
      return;
    }
    assert.deepEqual(orphans, [], "fotos sin entrada: bórralas o corre con UPDATE_SNAPSHOTS=1");
  });

  it("es determinista: dos corridas seguidas dan el mismo resultado", () => {
    for (const input of inputs) {
      for (const mode of input.modes) {
        assert.equal(MODE_RUNNERS[mode](input.text), MODE_RUNNERS[mode](input.text), `${input.name}.${mode}`);
      }
    }
  });
});
