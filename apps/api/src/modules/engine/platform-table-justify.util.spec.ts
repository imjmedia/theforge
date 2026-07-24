import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotateJustifiedPlatformTablesInMdd,
  isPlatformTableJustified,
  listUnjustifiedPlatformTables,
} from "./platform-table-justify.util.js";

const MDD_WORKSHOP_CHAT = `
## 1. Contexto
Plataforma multi-agente con integración MCP y memoria contextual del chat.

## 3. Modelo de Datos
\`\`\`sql
CREATE TABLE mcp_plugins (id UUID PRIMARY KEY);
CREATE TABLE conversation_memory (id UUID PRIMARY KEY);
CREATE TABLE messages (id UUID PRIMARY KEY);
\`\`\`
`;

const BRD_WHATSAPP = `
## 3. Capacidades
### Gestión de conversaciones WhatsApp
Canal de mensajería con historial de mensajes persistidos para clientes.
`;

describe("platform-table-justify.util", () => {
  it("justifies mcp_plugins from MDD §1 MCP context", () => {
    assert.equal(isPlatformTableJustified("mcp_plugins", { mddMarkdown: MDD_WORKSHOP_CHAT }), true);
  });

  it("does not justify messages/conversation_memory from workshop chat alone in §1", () => {
    assert.equal(isPlatformTableJustified("conversation_memory", { mddMarkdown: MDD_WORKSHOP_CHAT }), false);
    assert.equal(isPlatformTableJustified("messages", { mddMarkdown: MDD_WORKSHOP_CHAT }), false);
    assert.deepEqual(
      listUnjustifiedPlatformTables({ mddMarkdown: MDD_WORKSHOP_CHAT }).sort(),
      ["conversation_memory", "messages"].sort(),
    );
  });

  it("justifies messages when BRD describes WhatsApp messaging product", () => {
    assert.equal(
      isPlatformTableJustified("messages", {
        brdMarkdown: BRD_WHATSAPP,
        mddMarkdown: MDD_WORKSHOP_CHAT,
      }),
      true,
    );
  });

  it("annotates justified CREATE TABLE with platform comment", () => {
    const { markdown, annotated } = annotateJustifiedPlatformTablesInMdd(MDD_WORKSHOP_CHAT, {
      mddMarkdown: MDD_WORKSHOP_CHAT,
    });
    assert.ok(annotated.includes("mcp_plugins"));
    assert.match(markdown, /\[platform:mcp_plugins\]/);
  });

  it("still flags orphans when no anchor in corpus", () => {
    const bare = `
## 3. Modelo
\`\`\`sql
CREATE TABLE mcp_plugins (id UUID PRIMARY KEY);
\`\`\`
`;
    assert.deepEqual(listUnjustifiedPlatformTables({ mddMarkdown: bare }), ["mcp_plugins"]);
  });
});
