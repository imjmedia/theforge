import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncateDraftForAuditorLlm } from "./mdd-auditor-gaps.util.js";

/** Cuenta fences abiertos/cerrados: debe ser par y nunca quedar un fence abierto al final. */
function fencesBalanced(md: string): boolean {
  let open = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) open = !open;
  }
  return !open;
}

function buildBigDraft(opts: { tables: number; endpoints: number }): string {
  const tables = Array.from({ length: opts.tables }, (_, i) => {
    return `CREATE TABLE entidad_${i + 1} (\n  id UUID PRIMARY KEY,\n  nombre VARCHAR(100) NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);`;
  }).join("\n\n");
  const rows = Array.from(
    { length: opts.endpoints },
    (_, i) => `| GET | /api/v1/entidad-${i + 1} | Lista entidad ${i + 1} | JWT |`,
  ).join("\n");
  const jsonExamples = Array.from(
    { length: opts.endpoints },
    (_, i) =>
      `### GET /api/v1/entidad-${i + 1}\n\n\`\`\`json\n${JSON.stringify(
        { data: Array.from({ length: 12 }, (_, k) => ({ id: `uuid-${k}`, nombre: `Nombre ${k}`, extra: "x".repeat(30) })) },
        null,
        2,
      )}\n\`\`\``,
  ).join("\n\n");
  return [
    "# MDD",
    "## 1. Contexto",
    "Texto de contexto largo. ".repeat(400),
    "## 2. Arquitectura y Stack",
    "NestJS + PostgreSQL. ".repeat(300),
    "## 3. Modelo de Datos",
    "```sql",
    tables,
    "```",
    "## 4. Contratos de API",
    "| Método | Ruta | Descripción | Auth |",
    "|---|---|---|---|",
    rows,
    "",
    jsonExamples,
    "## 5. Lógica y Edge Cases",
    "Regla de negocio detallada. ".repeat(400),
    "## 6. Seguridad",
    "JWT con rotación. ".repeat(300),
    "## 7. Infraestructura",
    "Docker Compose con healthchecks.\n\n```json\n" + JSON.stringify({ project_id: "x", stack: { backend: "nest" }, pad: "y".repeat(2000) }, null, 2) + "\n```\n\n" + "Despliegue con Dokploy. ".repeat(400),
  ].join("\n");
}

describe("truncateDraftForAuditorLlm (fence-aware)", () => {
  it("no toca borradores que caben", () => {
    const small = "# MDD\n## 1. Contexto\nhola\n";
    assert.equal(truncateDraftForAuditorLlm(small), small.trim());
  });

  it("conserva todos los CREATE TABLE y las filas de endpoints, y nunca deja fences abiertos", () => {
    const draft = buildBigDraft({ tables: 12, endpoints: 14 });
    assert.ok(draft.length > 28_000);
    const out = truncateDraftForAuditorLlm(draft);
    assert.ok(out.length < draft.length);
    assert.ok(fencesBalanced(out), "fences balanceados");
    for (let i = 1; i <= 12; i += 1) assert.ok(out.includes(`CREATE TABLE entidad_${i} (`), `tabla ${i}`);
    for (let i = 1; i <= 14; i += 1) assert.ok(out.includes(`| GET | /api/v1/entidad-${i} |`), `endpoint ${i}`);
    assert.ok(out.includes("{…}"), "cuerpos JSON sustituidos");
    assert.ok(out.includes("[ejemplo JSON omitido por tamaño]"));
  });

  it("cierra el fence antes del marcador cuando el corte cae dentro de un bloque", () => {
    const longSql = "```sql\n" + Array.from({ length: 400 }, (_, i) => `-- línea ${i} ${"x".repeat(40)}`).join("\n") + "\n```";
    const draft = [
      "# MDD",
      "## 1. Contexto",
      "ok",
      "## 2. Arquitectura y Stack",
      "```bash",
      Array.from({ length: 800 }, (_, i) => `echo ${i} ${"y".repeat(40)}`).join("\n"),
      "```",
      "## 3. Modelo de Datos",
      "```sql\nCREATE TABLE a (id UUID PRIMARY KEY);\n```",
      "## 4. Contratos de API",
      "| GET | /a | desc | JWT |",
      "## 5. Lógica y Edge Cases",
      longSql,
      "## 6. Seguridad",
      "x",
      "## 7. Infraestructura",
      "x",
    ].join("\n");
    const out = truncateDraftForAuditorLlm(draft, 10_000);
    assert.ok(fencesBalanced(out), "fences balanceados tras truncar prosa");
    assert.ok(out.includes("[... sección truncada ...]"));
    // el marcador siempre va fuera de un fence
    const idx = out.indexOf("[... sección truncada ...]");
    const before = out.slice(0, idx).split("\n").filter((l) => /^\s*```/.test(l)).length;
    assert.equal(before % 2, 0, "el marcador no queda dentro de un fence");
    assert.ok(out.includes("CREATE TABLE a (id UUID PRIMARY KEY);"));
    assert.ok(out.includes("| GET | /a | desc | JWT |"));
  });

  it("no confunde headings dentro de fences con secciones", () => {
    const draft = [
      "# MDD",
      "## 1. Contexto",
      "```md",
      "## 3. Falso heading dentro de fence",
      "```",
      "relleno ".repeat(5000),
      "## 3. Modelo de Datos",
      "CREATE TABLE z (id INT);",
    ].join("\n");
    const out = truncateDraftForAuditorLlm(draft, 6_000);
    assert.ok(fencesBalanced(out));
    assert.ok(out.includes("CREATE TABLE z (id INT);"));
  });
});
