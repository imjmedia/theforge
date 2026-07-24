import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMddAuditorDeepContext } from "../mdd-auditor-context.util.js";
import type { MDDStateType } from "../state/index.js";

describe("mdd-auditor-context.util", () => {
  it("includes platform table hints when messages lacks BRD anchor", () => {
    const state = {
      mddDraft: `
## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE messages (id UUID PRIMARY KEY, body TEXT);
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`
`.trim(),
      dbgaContent: "",
      brdContent: "## Capacidades\nGestión de portafolio.",
    } as MDDStateType;

    const block = buildMddAuditorDeepContext(state);
    assert.match(block, /Tablas plataforma/);
    assert.match(block, /messages/);
    assert.match(block, /Candidatas a eliminar/);
  });

  it("returns empty when mdd draft is empty", () => {
    assert.equal(buildMddAuditorDeepContext({ mddDraft: "" } as MDDStateType), "");
  });
});
