import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { MddEvalCase } from "./mdd-eval.types.js";
import { loadMddEvalCase, loadMddEvalCases, resolveDefaultMddEvalCasesDir } from "./mdd-eval-cases.util.js";

/** Fugas de otros dominios o de prompts: no pueden aparecer en ningún caso ni en su texto. */
const GLOBAL_LEAK_TOKENS = [
  "whatsapp",
  "wasender",
  "bitrix",
  "denue",
  "inegi",
  "datswhy",
  "watchlist",
  "pendiente: arquitecto",
  "pendiente: clarificador",
  "(pendiente)",
  "format_section3_endpoints",
  "lorem ipsum",
];

const SPANISH_MARKERS = ["el", "la", "de", "que", "para", "con"];

function spanishMarkersIn(text: string): number {
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  return SPANISH_MARKERS.filter((marker) => words.has(marker)).length;
}

function textsOf(evalCase: MddEvalCase): string[] {
  return [evalCase.brief, evalCase.dbga, evalCase.brd].filter((text): text is string => typeof text === "string");
}

const casesDir = resolveDefaultMddEvalCasesDir();
const cases = loadMddEvalCases(casesDir);

describe("casos del eval de MDDs (eval/mdd/cases)", () => {
  it("los 12 archivos existen y todos parsean con mddEvalCaseSchema", () => {
    const jsonFiles = readdirSync(casesDir).filter((name) => name.endsWith(".json"));
    assert.equal(jsonFiles.length, 12);
    assert.equal(cases.length, 12);
  });

  it("los ids son únicos y coinciden con el nombre del archivo", () => {
    const ids = cases.map((evalCase) => evalCase.id);
    assert.equal(new Set(ids).size, ids.length, "ids duplicados");
    for (const id of ids) {
      assert.ok(
        readdirSync(casesDir).includes(`${id}.json`),
        `el caso "${id}" no tiene archivo ${id}.json`,
      );
    }
  });

  it("cubre complejidades LOW (>=3), MEDIUM (>=4) y HIGH (>=5)", () => {
    const count = (level: MddEvalCase["complexity"]) =>
      cases.filter((evalCase) => evalCase.complexity === level).length;
    assert.ok(count("LOW") >= 3, `LOW=${count("LOW")}`);
    assert.ok(count("MEDIUM") >= 4, `MEDIUM=${count("MEDIUM")}`);
    assert.ok(count("HIGH") >= 5, `HIGH=${count("HIGH")}`);
  });

  it("cada brief está en español, mide 300-1500 caracteres y no contiene fugas", () => {
    for (const evalCase of cases) {
      const { brief } = evalCase;
      assert.ok(brief.length >= 300 && brief.length <= 1500, `${evalCase.id}: brief de ${brief.length} caracteres`);
      assert.ok(spanishMarkersIn(brief) >= 3, `${evalCase.id}: el brief no parece español`);
      for (const text of textsOf(evalCase)) {
        const lower = text.toLowerCase();
        for (const token of GLOBAL_LEAK_TOKENS) {
          assert.ok(!lower.includes(token), `${evalCase.id}: el texto contiene la fuga "${token}"`);
        }
      }
    }
  });

  it("cada caso declara todas las fugas globales en expect.forbidden", () => {
    for (const evalCase of cases) {
      for (const token of GLOBAL_LEAK_TOKENS) {
        assert.ok(evalCase.expect.forbidden.includes(token), `${evalCase.id}: falta la fuga global "${token}"`);
      }
    }
  });

  it("cada capacidad tiene pistas de endpoint en minúsculas que empiezan por /", () => {
    for (const evalCase of cases) {
      assert.ok(evalCase.expect.capabilities.length >= 3 && evalCase.expect.capabilities.length <= 6, evalCase.id);
      for (const capability of evalCase.expect.capabilities) {
        assert.ok(capability.endpointHints.length >= 1 && capability.endpointHints.length <= 3, `${evalCase.id}: ${capability.name}`);
        for (const hint of capability.endpointHints) {
          assert.ok(hint.startsWith("/"), `${evalCase.id}: la pista "${hint}" no empieza por /`);
          assert.equal(hint, hint.toLowerCase(), `${evalCase.id}: la pista "${hint}" tiene mayúsculas`);
        }
      }
    }
  });

  it("entidades: 4-10 nombres snake_case en plural, con sinónimos solo de entidades declaradas", () => {
    for (const evalCase of cases) {
      const { entities, entitySynonyms } = evalCase.expect;
      assert.ok(entities.length >= 4 && entities.length <= 10, `${evalCase.id}: ${entities.length} entidades`);
      for (const entity of entities) {
        assert.match(entity, /^[a-z]+(_[a-z]+)*$/, `${evalCase.id}: "${entity}" no es snake_case`);
        assert.ok(entity.endsWith("s"), `${evalCase.id}: "${entity}" no parece plural`);
      }
      for (const key of Object.keys(entitySynonyms)) {
        assert.ok(entities.includes(key), `${evalCase.id}: sinónimo de entidad no declarada "${key}"`);
      }
    }
  });

  it("seguridad e infraestructura: tokens en minúsculas y en el rango permitido", () => {
    for (const evalCase of cases) {
      const { security, infra } = evalCase.expect;
      assert.ok(security.length >= 2 && security.length <= 5, `${evalCase.id}: ${security.length} tokens de seguridad`);
      assert.ok(infra.length >= 2 && infra.length <= 4, `${evalCase.id}: ${infra.length} tokens de infraestructura`);
      for (const token of [...security, ...infra]) {
        assert.equal(token, token.toLowerCase(), `${evalCase.id}: token "${token}" con mayúsculas`);
      }
    }
  });

  it("dbga (3 casos, 400-900 caracteres) y brd (2 casos HIGH, 600-1200 caracteres) cuando existen", () => {
    const withDbga = cases.filter((evalCase) => evalCase.dbga !== undefined);
    const withBrd = cases.filter((evalCase) => evalCase.brd !== undefined);
    assert.equal(withDbga.length, 3);
    assert.equal(withBrd.length, 2);
    for (const evalCase of withDbga) {
      assert.ok(evalCase.dbga!.length >= 400 && evalCase.dbga!.length <= 900, `${evalCase.id}: dbga de ${evalCase.dbga!.length}`);
    }
    for (const evalCase of withBrd) {
      assert.equal(evalCase.complexity, "HIGH", `${evalCase.id}: brd solo en casos HIGH`);
      assert.ok(evalCase.brd!.length >= 600 && evalCase.brd!.length <= 1200, `${evalCase.id}: brd de ${evalCase.brd!.length}`);
    }
  });
});

describe("loadMddEvalCases / loadMddEvalCase", () => {
  it("devuelve los casos ordenados por id", () => {
    const ids = cases.map((evalCase) => evalCase.id);
    assert.deepEqual(ids, [...ids].sort());
  });

  it("lanza un error que nombra el archivo cuando el JSON no cumple el contrato", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mdd-eval-cases-"));
    try {
      writeFileSync(path.join(dir, "caso-roto.json"), JSON.stringify({ id: "caso-roto" }));
      assert.throws(() => loadMddEvalCases(dir), /caso-roto\.json/);
      writeFileSync(path.join(dir, "caso-roto.json"), "{ no es json");
      assert.throws(() => loadMddEvalCases(dir), /caso-roto\.json/);
      assert.throws(() => loadMddEvalCase("no-existe", casesDir), /No existe el caso MDD/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
