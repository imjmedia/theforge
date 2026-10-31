import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDeterministicGapsAsLintFeedback,
  createMddAuditorNode,
  resolveAuditorGapsFromLlm,
} from "./mdd-auditor.node.js";

function draftWithSections(opts: { skip?: number[]; withMetadata?: boolean; bareContracts?: boolean } = {}): string {
  const skip = new Set(opts.skip ?? []);
  const bodies: Record<number, string> = {
    1: "## 1. Contexto\n\n" + "Contexto del sistema de pedidos con alcance definido. ".repeat(12),
    2: "## 2. Arquitectura y Stack\n\n" + "NestJS sobre Node 20 con PostgreSQL y Redis. ".repeat(10),
    3:
      "## 3. Modelo de Datos\n\n```sql\nCREATE TABLE orders (id UUID PRIMARY KEY, total NUMERIC(10,2) NOT NULL);\n```\n\n" +
      (opts.withMetadata ? "TechnicalMetadata: [high_security] [external_api]\n" : ""),
    4: opts.bareContracts
      ? "## 4. Contratos de API\n\nPor definir con el equipo.\n"
      : "## 4. Contratos de API\n\n| Método | Ruta | Descripción | Auth |\n|---|---|---|---|\n| GET | /api/v1/orders | Lista pedidos | JWT |\n\n```json\n{ \"total\": 10 }\n```\n",
    5: "## 5. Lógica y Edge Cases\n\n" + "Regla de negocio con detalle suficiente para el caso. ".repeat(12),
    6: "## 6. Seguridad\n\n" + "JWT RS256 con rotación y rate limiting por IP. ".repeat(12),
    7: "## 7. Infraestructura\n\n" + "Docker Compose con healthchecks y despliegue en Dokploy. ".repeat(12),
  };
  return "# MDD\n\n" + [1, 2, 3, 4, 5, 6, 7].filter((n) => !skip.has(n)).map((n) => bodies[n]).join("\n\n");
}

const llmReturning = (json: unknown) => ({ invoke: async () => ({ content: JSON.stringify(json) }) });

describe("Auditor: los gaps deterministas no deciden el veredicto", () => {
  it("LLM 92 con gap determinista (§4 sin endpoints/payloads) => APROBADO y done", async () => {
    const node = createMddAuditorNode(
      llmReturning({
        auditorScore: 92,
        auditorDecision: "done",
        auditorFeedback: "Buen documento.",
        status: "APROBADO",
        critical_gaps: [],
        syntax_errors: [],
        infrastructure_ready: true,
      }) as never,
    );
    const out = await node({ mddDraft: draftWithSections({ withMetadata: true, bareContracts: true }) } as never);
    assert.equal(out.auditorScore, 92);
    assert.equal(out.auditorGaps?.status, "APROBADO");
    assert.deepEqual(out.auditorGaps?.critical_gaps, []);
    assert.equal(out.auditorDecision, "done");
    assert.match(out.auditorFeedback ?? "", /\[lint\] .*sin payloads JSON ni endpoints/);
  });

  it("LLM 70 => RECHAZADO y clarifier; critical_gaps son solo los del LLM", async () => {
    const node = createMddAuditorNode(
      llmReturning({
        auditorScore: 70,
        auditorDecision: "clarifier",
        critical_gaps: [{ sections: ["Sección 4"], issue: "Falta auth en endpoints", fix: "Definir auth" }],
      }) as never,
    );
    const out = await node({ mddDraft: draftWithSections() } as never);
    assert.equal(out.auditorGaps?.status, "RECHAZADO");
    assert.equal(out.auditorGaps?.critical_gaps.length, 1);
    assert.equal(out.auditorDecision, "clarifier");
  });

  it("LLM 92 pero faltan secciones canónicas => no done (bloqueo estructural conservado), score ≤ 94", async () => {
    const node = createMddAuditorNode(
      llmReturning({ auditorScore: 99, auditorDecision: "done", critical_gaps: [] }) as never,
    );
    const out = await node({ mddDraft: draftWithSections({ skip: [6] }) } as never);
    assert.equal(out.auditorScore, 94);
    assert.notEqual(out.auditorDecision, "done");
    assert.equal(out.auditorGaps?.status, "RECHAZADO");
  });

  it("errores SQL/JSON objetivos del lint van a syntax_errors pero no bajan el veredicto", async () => {
    const bad = draftWithSections({ withMetadata: true }).replace(
      "CREATE TABLE orders (id UUID PRIMARY KEY, total NUMERIC(10,2) NOT NULL);",
      "CREATE TABLE orders (id UUID PRIMARY KEY,, total NUMERIC(10,2) NOT NULL;",
    );
    const node = createMddAuditorNode(
      llmReturning({ auditorScore: 90, auditorDecision: "done", critical_gaps: [] }) as never,
    );
    const out = await node({ mddDraft: bad } as never);
    const syntax = out.auditorGaps?.syntax_errors ?? [];
    assert.ok(syntax.length > 0, "el lint objetivo debe llegar a syntax_errors");
    assert.ok(syntax.every((e) => /^(SQL §3|§4):/.test(e)), "solo errores SQL/JSON objetivos del lint");
    assert.equal(out.auditorGaps?.status, "APROBADO");
    assert.equal(out.auditorDecision, "done");
  });
});

describe("resolveAuditorGapsFromLlm / formatDeterministicGapsAsLintFeedback", () => {
  it("status depende solo del score (y secciones faltantes)", () => {
    assert.equal(resolveAuditorGapsFromLlm(undefined, [], 85).status, "APROBADO");
    assert.equal(resolveAuditorGapsFromLlm(undefined, [], 84).status, "RECHAZADO");
    assert.equal(resolveAuditorGapsFromLlm(undefined, [], 90, ["6. Seguridad"]).status, "RECHAZADO");
  });

  it("omite los gaps de secciones faltantes (ya cubiertos) y prefija [lint]", () => {
    const text = formatDeterministicGapsAsLintFeedback({
      score: 80,
      status: "RECHAZADO",
      critical_gaps: [
        { sections: ["Sección 6"], issue: "Falta la sección obligatoria: 6. Seguridad", fix: "x" },
        { sections: ["Sección 3"], issue: "Falta bloque TechnicalMetadata", fix: "Incluirlo" },
      ],
      syntax_errors: ["Mermaid: algo"],
      infrastructure_ready: false,
    });
    assert.ok(!text.includes("sección obligatoria"));
    assert.ok(text.includes("[lint] [Sección 3] Falta bloque TechnicalMetadata"));
    assert.ok(text.includes("[lint] Mermaid: algo"));
  });
});
