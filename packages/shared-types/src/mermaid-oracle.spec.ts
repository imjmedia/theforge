import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  proposeMermaidRepairs,
  resolveMermaidBlocksInDocument,
  resolveMermaidWithOracle,
  type MermaidParseResult,
  type MermaidParser,
} from "./mermaid-oracle.js";

/** Parser falso: válido si el texto está en `valid`; `unavailableOn` simula parser caído. */
function fakeParser(
  valid: (text: string) => boolean,
  opts: { unavailableOn?: (text: string) => boolean } = {},
): MermaidParser & { calls: string[] } {
  const calls: string[] = [];
  const parser = async (text: string): Promise<MermaidParseResult> => {
    calls.push(text);
    if (opts.unavailableOn?.(text)) return { status: "unavailable", error: "sin entorno" };
    if (valid(text)) return { status: "ok", diagramType: "flowchart" };
    return { status: "invalid", error: `Parse error en: ${text.slice(0, 20)}` };
  };
  return Object.assign(parser, { calls });
}

const FENCED_BAD = "```mermaid\nflowchart TD\n  A --> B\n```";

describe("proposeMermaidRepairs", () => {
  it("devuelve candidatos distintos del original y sin duplicados", () => {
    const candidates = proposeMermaidRepairs(FENCED_BAD);
    assert.ok(candidates.length >= 1);
    assert.equal(new Set(candidates).size, candidates.length);
    assert.ok(!candidates.includes(FENCED_BAD));
    assert.ok(candidates.includes("flowchart TD\n  A --> B"));
  });

  it("incluye candidatos con entidades HTML decodificadas", () => {
    const candidates = proposeMermaidRepairs("flowchart TD\n  A --&gt; B");
    assert.ok(candidates.includes("flowchart TD\n  A --> B"));
    assert.equal(new Set(candidates).size, candidates.length);
  });

  it("no propone nada si no hay cambios posibles", () => {
    assert.deepEqual(proposeMermaidRepairs("flowchart TD\n  A --> B"), []);
  });
});

describe("resolveMermaidWithOracle", () => {
  it("repara entidades HTML (`--&gt;`) cuando el parser solo acepta la versión decodificada", async () => {
    const body = "flowchart TD\n  A --&gt; B";
    const parse = fakeParser((t) => !t.includes("&gt;") && t.includes("-->"));
    const res = await resolveMermaidWithOracle(body, parse);
    assert.equal(res.status, "repaired");
    assert.equal(res.text, "flowchart TD\n  A --> B");
    assert.equal(res.original, body);
  });

  it("un original válido no se toca, byte a byte (ni trim)", async () => {
    const body = "\n\n  flowchart TD\n  A --> B  \n\n";
    const parse = fakeParser(() => true);
    const res = await resolveMermaidWithOracle(body, parse);
    assert.equal(res.status, "original");
    assert.equal(res.text, body);
    assert.equal(res.original, body);
    assert.equal(res.diagramType, "flowchart");
    assert.equal(res.attempts, 1);
    assert.equal(parse.calls.length, 1);
  });

  it("acepta una reparación solo si parsea", async () => {
    const parse = fakeParser((t) => !t.includes("```"));
    const res = await resolveMermaidWithOracle(FENCED_BAD, parse);
    assert.equal(res.status, "repaired");
    assert.equal(res.text, "flowchart TD\n  A --> B");
    assert.equal(res.original, FENCED_BAD);
    assert.equal(typeof res.candidateIndex, "number");
    assert.ok(res.attempts >= 2);
  });

  it("rechaza una reparación que el parser no acepta", async () => {
    const parse = fakeParser((t) => t === "NUNCA");
    const res = await resolveMermaidWithOracle(FENCED_BAD, parse);
    assert.equal(res.status, "invalid");
    assert.equal(res.text, FENCED_BAD);
    assert.match(res.error ?? "", /Parse error/);
  });

  it("invalid conserva el original y el error del parser sobre el original", async () => {
    const body = "flowchart TD\n  A --- ???";
    const parse = fakeParser(() => false);
    const res = await resolveMermaidWithOracle(body, parse, { propose: () => ["x", "y"] });
    assert.equal(res.status, "invalid");
    assert.equal(res.text, body);
    assert.equal(res.original, body);
    assert.equal(res.error, `Parse error en: ${body.slice(0, 20)}`);
    assert.equal(res.candidateIndex, undefined);
  });

  it("unavailable en el original da unverified sin cambios ni candidatos", async () => {
    const parse = fakeParser(() => false, { unavailableOn: () => true });
    const res = await resolveMermaidWithOracle(FENCED_BAD, parse);
    assert.equal(res.status, "unverified");
    assert.equal(res.text, FENCED_BAD);
    assert.equal(res.error, "sin entorno");
    assert.equal(parse.calls.length, 1);
  });

  it("unavailable a mitad de los candidatos da unverified con el original", async () => {
    const parse = fakeParser(() => false, { unavailableOn: (t) => t === "c2" });
    const res = await resolveMermaidWithOracle("mal", parse, {
      propose: () => ["c1", "c2", "c3"],
    });
    assert.equal(res.status, "unverified");
    assert.equal(res.text, "mal");
    assert.deepEqual(parse.calls, ["mal", "c1", "c2"]);
  });

  it("un parser que lanza se trata como unavailable, no como inválido", async () => {
    const res = await resolveMermaidWithOracle("x", async () => {
      throw new Error("boom");
    });
    assert.equal(res.status, "unverified");
    assert.equal(res.error, "boom");
  });

  it("respeta el tope de candidatos (maxAttempts)", async () => {
    const parse = fakeParser((t) => t === "c5");
    const propose = () => ["c1", "c2", "c3", "c4", "c5"];
    const capped = await resolveMermaidWithOracle("mal", parse, { propose, maxAttempts: 3 });
    assert.equal(capped.status, "invalid");
    assert.deepEqual(parse.calls, ["mal", "c1", "c2", "c3"]); // tope explícito (el defecto es 5)

    const wide = fakeParser((t) => t === "c5");
    const ok = await resolveMermaidWithOracle("mal", wide, { propose, maxAttempts: 5 });
    assert.equal(ok.status, "repaired");
    assert.equal(ok.text, "c5");
    assert.equal(ok.candidateIndex, 4);

    const none = fakeParser((t) => t === "c1");
    const zero = await resolveMermaidWithOracle("mal", none, { propose, maxAttempts: 0 });
    assert.equal(zero.status, "invalid");
    assert.deepEqual(none.calls, ["mal"]);
  });

  it("no repite candidatos duplicados ni iguales al original", async () => {
    const parse = fakeParser(() => false);
    await resolveMermaidWithOracle("mal", parse, { propose: () => ["mal", "c1", "c1", "c2"] });
    assert.deepEqual(parse.calls, ["mal", "c1", "c2"]);
  });

  it("deja de probar candidatos si la señal está abortada", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const parse: MermaidParser = async (text) => {
      calls.push(text);
      if (text === "c1") controller.abort();
      return { status: "invalid", error: "e" };
    };
    const res = await resolveMermaidWithOracle("mal", parse, {
      propose: () => ["c1", "c2", "c3"],
      signal: controller.signal,
    });
    assert.equal(res.status, "invalid");
    assert.equal(res.text, "mal");
    assert.deepEqual(calls, ["mal", "c1"]);
  });

  it("es idempotente: resolver el texto resuelto da original", async () => {
    const parse = fakeParser((t) => !t.includes("```"));
    const first = await resolveMermaidWithOracle(FENCED_BAD, parse);
    assert.equal(first.status, "repaired");
    const second = await resolveMermaidWithOracle(first.text, parse);
    assert.equal(second.status, "original");
    assert.equal(second.text, first.text);

    const orig = await resolveMermaidWithOracle("flowchart TD\n A-->B", parse);
    const again = await resolveMermaidWithOracle(orig.text, parse);
    assert.equal(again.status, "original");
    assert.equal(again.text, orig.text);
  });
});

describe("resolveMermaidBlocksInDocument", () => {
  const good = "```mermaid\nflowchart TD\n  A --> B\n```";
  const sql = "```sql\nSELECT 1;\n```";

  it("sustituye solo los bloques reparados y respeta un fence ```sql vecino", async () => {
    const doc = ["# Título", "", good, "", FENCED_BAD.replace("```mermaid\n", "```mermaid\n```mermaid\n"), "", sql, "", "fin"].join("\n");
    const parse = fakeParser((t) => !t.includes("```"));
    const res = await resolveMermaidBlocksInDocument(doc, parse);
    assert.deepEqual(
      res.blocks.map((b) => [b.index, b.status]),
      [
        [0, "original"],
        [1, "repaired"],
      ],
    );
    const expected = ["# Título", "", good, "", "```mermaid\nflowchart TD\n  A --> B\n```", "", sql, "", "fin"].join("\n");
    assert.equal(res.markdown, expected);
    assert.ok(res.markdown.includes(sql));
  });

  it("sin reparaciones devuelve el documento idéntico", async () => {
    const doc = `texto\n\n${good}\n\n${sql}\n`;
    const parse = fakeParser(() => true);
    const res = await resolveMermaidBlocksInDocument(doc, parse);
    assert.equal(res.markdown, doc);
    assert.equal(res.blocks.length, 1);
    assert.equal(res.blocks[0]!.status, "original");
  });

  it("no toca bloques inválidos ni sin verificar", async () => {
    const bad = "```mermaid\nflowchart TD\n  A --> ???\n```";
    const doc = `${bad}\n\n${sql}`;
    const invalid = await resolveMermaidBlocksInDocument(doc, fakeParser(() => false), {
      propose: () => ["otro"],
    });
    assert.equal(invalid.markdown, doc);
    assert.equal(invalid.blocks[0]!.status, "invalid");

    const unverified = await resolveMermaidBlocksInDocument(
      doc,
      fakeParser(() => false, { unavailableOn: () => true }),
    );
    assert.equal(unverified.markdown, doc);
    assert.equal(unverified.blocks[0]!.status, "unverified");
  });

  it("ignora ```mermaid dentro de un fence mayor de otro lenguaje y fences sin cerrar", async () => {
    const nested = "````markdown\n```mermaid\nflowchart TD\n  A --> B\n```\n````";
    const unclosed = "```mermaid\nflowchart TD\n  A --> B";
    const parse = fakeParser(() => false);
    const res = await resolveMermaidBlocksInDocument(`${nested}\n\n${unclosed}`, parse, {
      propose: () => ["x"],
    });
    assert.equal(res.blocks.length, 0);
    assert.equal(parse.calls.length, 0);
    assert.equal(res.markdown, `${nested}\n\n${unclosed}`);
  });

  it("conserva saltos de línea CRLF fuera de los bloques reparados", async () => {
    const doc = `a\r\n\`\`\`sql\r\nSELECT 1;\r\n\`\`\`\r\n`;
    const parse = fakeParser(() => true);
    const res = await resolveMermaidBlocksInDocument(doc, parse);
    assert.equal(res.markdown, doc);
  });
});
