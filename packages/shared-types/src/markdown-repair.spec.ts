import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairMarkdownFences, stripOrphanFenceLineBeforeMermaid, unwrapEmbeddedMermaidFence } from "./markdown-repair.js";
import { normalizeMermaidDiagramBody } from "./mermaid.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

describe("stripOrphanFenceLineBeforeMermaid", () => {
  it("elimina ``` huérfano entre sql y ### Diagrama entidad-relación", () => {
    const broken = `\`\`\`sql
CREATE TABLE t (id int);
\`\`\`

\`\`\`
### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  tenants { uuid id PK }
\`\`\``;
    const out = stripOrphanFenceLineBeforeMermaid(broken);
    assert.doesNotMatch(out, /```sql[\s\S]*```\s*\n```\s*\n### Diagrama entidad-relación/);
    assert.match(out, /### Diagrama entidad-relación[\s\S]*```mermaid[\s\S]*erDiagram/);
  });

  it("conserva ``` que cierra mermaid antes de otro heading + ```mermaid (BRD §4)", () => {
    const brdSection4 = `\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

### 4.2 Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  CANAL ||--o{ MENSAJE : "contiene"
\`\`\`
### 4.3 Flujos críticos

#### Flujo 1

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
\`\`\`

#### Flujo 2

\`\`\`mermaid
stateDiagram-v2
  Idle --> Done
\`\`\`

---

## 5. Límites del Alcance`;

    const out = stripOrphanFenceLineBeforeMermaid(brdSection4);
    assert.equal((out.match(/^```$/gm) ?? []).length, 4);
    assert.equal((out.match(/```mermaid/gi) ?? []).length, 4);

    let inFence = false;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (/^```/.test(t)) {
        if (!inFence) inFence = true;
        else inFence = false;
      }
      if (/^## 5\./.test(line)) {
        assert.equal(inFence, false, "section 5 must not be inside a code fence");
      }
    }
  });
});

describe("repairMarkdownFences — erDiagram tras sql corrupto", () => {
  it("restaura fence mermaid real tras cierre de sql", () => {
    const doc = `\`\`\`sql
CREATE INDEX idx ON t(a);
\`\`\`

\`\`\`
### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  tenants {
    uuid id PK
    string name
  }
  tenants ||--o{ tenant_users : "id"
\`\`\`
### 3.4 TechnicalMetadata`;

    const out = repairMarkdownFences(doc);
    assert.match(out, /```sql[\s\S]*```[\s\S]*### Diagrama entidad-relación/);
    assert.match(out, /```mermaid[\s\S]*erDiagram[\s\S]*```/);
    assert.doesNotMatch(out, /```sql[\s\S]*```\s*\n```\s*\n### Diagrama entidad-relación/);
    const inner = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.match(normalizeMermaidDiagramBody(inner), /tenants \|\|--o\{/);
  });
});

describe("repairMarkdownFences — fence plano con mermaid embebido", () => {
  it("desenvuelve ``` + heading + ```mermaid literal", () => {
    const doc = `\`\`\`
### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  tenants { uuid id PK uuid default string name }
  tenants ||--o{ tenant_users : "id"
\`\`\`
### 3.4 TechnicalMetadata`;

    const out = repairMarkdownFences(doc);
    assert.match(out, /^### Diagrama entidad-relación\n\n```mermaid\n/);
    assert.doesNotMatch(out, /^```\s*\n### Diagrama entidad-relación/);
    const inner = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.ok(inner.trim().startsWith("erDiagram"));
    assert.doesNotMatch(inner, /```mermaid/);
  });
});

describe("unwrapEmbeddedMermaidFence", () => {
  it("extrae mermaid anidado como texto dentro de fence plano", () => {
    const body = `### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  a { uuid id PK }`;
    const out = unwrapEmbeddedMermaidFence(body);
    assert.ok(out);
    assert.match(out!, /^### Diagrama/);
    assert.match(out!, /```mermaid[\s\S]*erDiagram/);
  });
});

describe("repairMarkdownFences — unclosed mermaid erDiagram", () => {
  it("cierra fence y no desenvuelve cuando el resto del MDD quedó colado", () => {
    const doc = `## 3. Modelo de Datos

### Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  tenants {
    uuid id PK
    uuid default
    string name
  }
  tenants ||--o{ tenant_users : "id"

## 4. Contratos de API

| Método | Ruta |
|--------|------|
| GET | /api/x |`;

    const out = repairMarkdownFences(doc);
    assert.match(out, /```mermaid[\s\S]*erDiagram[\s\S]*```/);
    assert.match(out, /## 4\. Contratos de API/);
    const mermaidBody = out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
    assert.doesNotMatch(mermaidBody, /## 4\./);
    const norm = normalizeMermaidDiagramBody(
      out.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "",
    );
    assert.match(norm, /uuid default/);
    assert.match(norm, /tenants \|\|--o\{/);
  });
});

describe("repairMarkdownFences — BRD §4 múltiples diagramas mermaid", () => {
  const brdSection4 = `## 4. Diagramas de referencia (Mermaid)

### 4.1 Arquitectura

\`\`\`mermaid
flowchart LR
  USUARIO --> SSO
\`\`\`

### 4.2 Diagrama entidad-relación

\`\`\`mermaid
erDiagram
  CANAL ||--o{ MENSAJE : "contiene"
\`\`\`
### 4.3 Flujos críticos

#### Flujo 1

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
\`\`\`

#### Flujo 2

\`\`\`mermaid
stateDiagram-v2
  Idle --> Done
\`\`\`

---

## 5. Límites del Alcance (In / Out of Scope)

- Item uno
`;

  it("no traga el §5 dentro de un fence mermaid", () => {
    const out = repairMarkdownFences(brdSection4);
    assert.equal((out.match(/```mermaid/gi) ?? []).length, 4);
    let inFence = false;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (t === "```") inFence = !inFence;
      if (/^## 5\./.test(line)) assert.equal(inFence, false);
    }
    assert.match(out, /## 5\. Límites del Alcance[\s\S]*- Item uno/);
  });

  it("formatDocumentMarkdown preserva fences entre diagramas BRD", () => {
    const out = formatDocumentMarkdown(brdSection4);
    assert.equal((out.match(/```mermaid/gi) ?? []).length, 4);
    let inFence = false;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (t === "```") inFence = !inFence;
      if (/^## 5\./.test(line)) assert.equal(inFence, false);
    }
  });
});
