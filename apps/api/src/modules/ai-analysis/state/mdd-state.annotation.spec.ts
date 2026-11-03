import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeFullMdd, reduceMddDraft, reducePreferDefined } from "./mdd-state.annotation.js";

/** Captura los `console.warn` emitidos durante `fn`. */
function captureWarns(fn: () => void): string[] {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return warns;
}

describe("reduceMddDraft", () => {
  it("prefiere el borrador más largo cuando el nuevo es una ampliación", () => {
    const short = "# Master Design Document\n\n## 1. Contexto\n\nBreve.";
    const long = `${short}\n\n## 2. Arquitectura\n\n${"x".repeat(400)}`;
    assert.equal(reduceMddDraft(short, long), long);
  });

  it("prefiere la actualización más reciente aunque sea más corta (MDD reescrito)", () => {
    const prev = `# Master Design Document\n\n## 1. Contexto\n\n${"a".repeat(4000)}\n\n## 2. Arquitectura y Stack\n\n| Contenedores | Docker + Kubernetes |`;
    const next = `# Master Design Document\n\n## 1. Contexto\n\nResumen.\n\n## 2. Arquitectura y Stack\n\n| Contenedores | Docker + Dokploy |`;
    assert.equal(reduceMddDraft(prev, next), next);
  });

  it("conserva el previo si el nuevo parece fragmento sin estructura MDD", () => {
    const prev = `# Master Design Document\n\n## 1. Contexto\n\n${"x".repeat(5000)}`;
    const fragment = "solo un párrafo suelto sin secciones.";
    assert.equal(reduceMddDraft(prev, fragment), prev);
  });

  it("conserva el valor previo si la actualización está vacía", () => {
    const prev = "# Master Design Document\n\nContenido.";
    assert.equal(reduceMddDraft(prev, ""), prev);
    assert.equal(reduceMddDraft(prev, "   "), prev);
  });

  it("acepta el nuevo valor si no había borrador previo", () => {
    const next = "# Master Design Document\n\nNuevo.";
    assert.equal(reduceMddDraft("", next), next);
  });
});

describe("reduceMddDraft — aviso de pérdida", () => {
  const head = "# Master Design Document\n\n## 1. Contexto\n\n";
  it("looksLikeFullMdd distingue MDD completo de un parche de sección", () => {
    assert.equal(looksLikeFullMdd(`${head}Algo.`), true);
    assert.equal(looksLikeFullMdd("## 3. Modelo de datos\n\nSQL"), false);
  });

  it("dos MDD completos distintos sin contención: avisa con los primeros 60 chars de cada uno", () => {
    const a = `${head}Versión A del documento.`;
    const b = `${head}Versión B del documento, distinta.`;
    const warns = captureWarns(() => {
      assert.equal(reduceMddDraft(a, b), b);
    });
    assert.equal(warns.length, 1);
    assert.match(warns[0]!, /dos MDD completos distintos/);
    assert.ok(warns[0]!.includes(a.slice(0, 60).replace(/\s+/g, " ")));
    assert.ok(warns[0]!.includes(b.slice(0, 60).replace(/\s+/g, " ")));
  });

  it("edición normal del formatter (un valor contiene al otro) no avisa", () => {
    const a = `${head}Base.`;
    const b = `${a}\n\n## 2. Arquitectura\n\nParche.`;
    assert.deepEqual(captureWarns(() => void reduceMddDraft(a, b)), []);
  });

  it("parche de sección frente a un MDD completo no avisa", () => {
    const a = `${head}Base completa.`;
    const patch = "## 3. Modelo de datos\n\nTabla nueva.";
    assert.deepEqual(captureWarns(() => void reduceMddDraft(a, patch)), []);
  });

  it("valores idénticos no avisan", () => {
    const a = `${head}Igual.`;
    assert.deepEqual(captureWarns(() => void reduceMddDraft(a, a)), []);
  });
});

describe("reducePreferDefined", () => {
  it("prefiere el valor nuevo cuando está definido", () => {
    assert.equal(reducePreferDefined("a", "b"), "b");
    assert.equal(reducePreferDefined(undefined, "id-1"), "id-1");
  });

  it("conserva el previo si la actualización es undefined", () => {
    assert.equal(reducePreferDefined("id-1", undefined), "id-1");
  });

  it("acepta duplicados idénticos (resume + checkpoint)", () => {
    const id = "8f1d250a-08e4-483f-9eec-6bb4e3d61cb4";
    assert.equal(reducePreferDefined(id, id), id);
  });
});
