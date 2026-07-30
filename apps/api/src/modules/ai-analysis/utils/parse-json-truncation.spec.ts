import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { repairTruncatedJsonObject, parseJsonOrThrow } from "./parse-json.js";

/**
 * Job 77 (§6) y job 81 (Clarificador): el modelo agota el tope de salida a mitad del JSON,
 * `JSON.parse` falla y el nodo cae al fallback descartando todo lo ya generado.
 */
describe("repairTruncatedJsonObject", () => {
  it("cierra un objeto cortado y conserva los elementos completos", () => {
    const truncated =
      '{"seguridad":[{"title":"Autenticación","content":["Argon2id"]},{"title":"Cif';
    const repaired = repairTruncatedJsonObject(truncated);
    assert.ok(repaired != null, "debe reparar");
    const parsed = JSON.parse(repaired!) as { seguridad: Array<{ title: string }> };
    assert.equal(parsed.seguridad.length, 1, "descarta el item parcial");
    assert.equal(parsed.seguridad[0]!.title, "Autenticación");
  });

  it("devuelve null si el JSON ya está balanceado (no era truncamiento)", () => {
    assert.equal(repairTruncatedJsonObject('{"a":1}'), null);
  });

  it("no se confunde con llaves dentro de strings", () => {
    const truncated = '{"items":[{"tpl":"usa {var} y [x]"},{"tpl":"otro';
    const repaired = repairTruncatedJsonObject(truncated);
    assert.ok(repaired != null);
    const parsed = JSON.parse(repaired!) as { items: Array<{ tpl: string }> };
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]!.tpl, "usa {var} y [x]");
  });

  it("no rompe con comillas escapadas", () => {
    const truncated = '{"items":[{"t":"dice \\"hola\\" ahi"},{"t":"parc';
    const repaired = repairTruncatedJsonObject(truncated);
    assert.ok(repaired != null);
    const parsed = JSON.parse(repaired!) as { items: Array<{ t: string }> };
    assert.equal(parsed.items[0]!.t, 'dice "hola" ahi');
  });
});

describe("parseJsonOrThrow recupera respuestas truncadas", () => {
  const schema = z.object({
    clarifiedScope: z.string(),
    items: z.array(z.object({ title: z.string() })),
  });

  it("parsea un JSON truncado en vez de lanzar", () => {
    const truncated =
      '{"clarifiedScope":"Alcance del KMS","items":[{"title":"Claves"},{"title":"Certi';
    const parsed = parseJsonOrThrow(truncated, schema);
    assert.equal(parsed.clarifiedScope, "Alcance del KMS");
    assert.equal(parsed.items.length, 1);
  });

  it("sigue lanzando cuando no hay JSON alguno", () => {
    assert.throws(() => parseJsonOrThrow("lo siento, no puedo ayudarte", schema));
  });
});
