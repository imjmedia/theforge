import { describe, it } from "node:test";
import assert from "node:assert";
import {
  mergeBranchLastStepFailed,
  mergeBranchSection5FormatSkipped,
  mergePostCriticParallelResults,
  mergeTailParallelResults,
} from "./mdd-tail-parallel.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

const BASE_DRAFT = `# MDD
## 1. Contexto
${"Alcance ForgeOps SaaS. ".repeat(30)}
## 2. Arquitectura y Stack
${"NestJS + PostgreSQL. ".repeat(30)}
## 3. Modelo de Datos
${"CREATE TABLE tenants (id UUID PRIMARY KEY); ".repeat(10)}
## 4. Contratos de API
${"| GET | /api/v1/health |\n".repeat(15)}
## 5. Lógica y Edge Cases
${MDD_SECTION5_TAIL_PLACEHOLDER}
## 6. Seguridad
(Pendiente: Arquitecto de Seguridad)
## 7. Infraestructura
(Pendiente: Ingeniero de Integración)`;

describe("mergeBranchLastStepFailed", () => {
  it("devuelve undefined sin fallos", () => {
    assert.strictEqual(mergeBranchLastStepFailed([{}, undefined, {}]), undefined);
  });
  it("devuelve el único fallo", () => {
    const f = { node: "integration", error: "LLM vacío" };
    assert.deepStrictEqual(mergeBranchLastStepFailed([{}, { lastStepFailed: f }]), f);
  });
  it("une nombres de nodo si varias ramas fallan", () => {
    const out = mergeBranchLastStepFailed([
      { lastStepFailed: { node: "security", error: "a" } },
      { lastStepFailed: { node: "integration", error: "b" } },
    ]);
    assert.strictEqual(out?.node, "security+integration");
    assert.ok(out?.error.includes("a") && out?.error.includes("b"));
  });
});

describe("mergeBranchSection5FormatSkipped", () => {
  it("propaga true / false / undefined", () => {
    assert.strictEqual(mergeBranchSection5FormatSkipped([{}, {}]), undefined);
    assert.strictEqual(mergeBranchSection5FormatSkipped([{ section5FormatSkipped: true }, {}]), true);
    assert.strictEqual(mergeBranchSection5FormatSkipped([{ section5FormatSkipped: false }]), false);
  });
});

describe("merges paralelos propagan flags de fallo", () => {
  it("mergeTailParallelResults reenvía lastStepFailed y section5FormatSkipped", () => {
    const merged = mergeTailParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { section5FormatSkipped: true },
      {},
      { lastStepFailed: { node: "integration", error: "LLM vacío" } },
    );
    assert.deepStrictEqual(merged.lastStepFailed, { node: "integration", error: "LLM vacío" });
    assert.strictEqual(merged.section5FormatSkipped, true);
  });

  it("mergeTailParallelResults no añade las claves si no hay fallo", () => {
    const merged = mergeTailParallelResults({ mddDraft: BASE_DRAFT } as never, {}, {}, {});
    assert.ok(!("lastStepFailed" in merged));
    assert.ok(!("section5FormatSkipped" in merged));
  });

  it("mergePostCriticParallelResults reenvía lastStepFailed de security", () => {
    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT },
      { lastStepFailed: { node: "security", error: "placeholder" } },
      {},
    );
    assert.deepStrictEqual(merged.lastStepFailed, { node: "security", error: "placeholder" });
  });

  it("mergePostCriticParallelResults une fallos de varias ramas y propaga section5FormatSkipped", () => {
    const merged = mergePostCriticParallelResults(
      { mddDraft: BASE_DRAFT } as never,
      { mddDraft: BASE_DRAFT, section5FormatSkipped: true },
      { lastStepFailed: { node: "security", error: "x" } },
      { lastStepFailed: { node: "integration", error: "y" } },
    );
    assert.strictEqual(merged.lastStepFailed?.node, "security+integration");
    assert.strictEqual(merged.section5FormatSkipped, true);
  });
});
