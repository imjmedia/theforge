import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDocumentMarkdown } from "./format-document-markdown.js";
import { parseMarkdown, findNodes, isCodeBlock } from "./remark-adapter.js";
import { promoteListItemFences } from "./promote-list-item-fences.js";

function countCodeBlocks(markdown: string): Array<{ lang: string | null; value: string }> {
  const ast = parseMarkdown(markdown);
  return findNodes(ast, isCodeBlock).map((n) => ({
    lang: n.lang ?? null,
    value: n.value ?? "",
  }));
}

describe("promoteListItemFences", () => {
  it("promueve TechnicalMetadata anidado en viñeta (esqueleto constitución legacy)", () => {
    const raw = `- Grafo opcional si §2 lo exige.
- \`\`\`TechnicalMetadata
  [high_security]
  \`\`\``;

    const out = promoteListItemFences(raw);
    assert.match(out, /^```TechnicalMetadata\n\[high_security\]\n```/m);
    assert.doesNotMatch(out, /^- ```TechnicalMetadata/m);

    const blocks = countCodeBlocks(out);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.lang, "TechnicalMetadata");
    assert.match(blocks[0]?.value ?? "", /\[high_security\]/);
  });

  it("promueve ```sql en ítem numerado", () => {
    const raw = `1. \`\`\`sql
   CREATE TABLE t (id UUID);
   \`\`\``;

    const out = promoteListItemFences(raw);
    assert.match(out, /```sql\nCREATE TABLE t/);
    assert.equal(countCodeBlocks(out).length, 1);
    assert.equal(countCodeBlocks(out)[0]?.lang, "sql");
  });

  it("no altera fences ya a nivel raíz", () => {
    const raw = `\`\`\`sql
SELECT 1;
\`\`\``;
    assert.equal(promoteListItemFences(raw), raw);
  });

  it("no altera bloques dentro de fences existentes", () => {
    const raw = `\`\`\`text
- \`\`\`sql
  x
  \`\`\`
\`\`\``;
    assert.equal(promoteListItemFences(raw), raw);
  });

  it("formatDocumentMarkdown promueve TechnicalMetadata en §3", () => {
    const raw = `## 3. Modelo de Datos

- \`\`\`TechnicalMetadata
  [high_security]
  \`\`\``;

    const formatted = formatDocumentMarkdown(raw);
    const blocks = countCodeBlocks(formatted);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.lang, "TechnicalMetadata");
  });
});
