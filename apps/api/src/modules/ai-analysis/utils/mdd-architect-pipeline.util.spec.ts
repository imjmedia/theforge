import { describe, it } from "node:test";
import assert from "node:assert";
import type { MDDStateType } from "../state/index.js";
import {
  agentsForArchitectSection,
  expandArchitectAgentNames,
  getArchitectNodeSequence,
  isHighSplitArchitectPipeline,
  looksLikeFullMddArchitectResponse,
  normalizeScopedArchitectResponse,
  processScopedArchitectResponse,
  resolveArchitectMergeBaseline,
  resolveLiveDraftForScopedArchitectStream,
  shouldDecoupleSection5FromArchitect,
} from "./mdd-architect-pipeline.util.js";
import { tryMergeSingleArchitectSectionIntoDraft } from "./mdd-sanitize/section-merge.js";

describe("mdd-architect-pipeline.util", () => {
  const baseState = { mddComplexity: "HIGH" } as MDDStateType;

  it("isHighSplitArchitectPipeline solo en HIGH pasada completa", () => {
    assert.equal(isHighSplitArchitectPipeline({ ...baseState, mddComplexity: "MEDIUM" }), false);
    assert.equal(isHighSplitArchitectPipeline(baseState), true);
    assert.equal(
      isHighSplitArchitectPipeline({ ...baseState, delegateTarget: "sections", sectionsToRun: ["data_model"] }),
      false,
    );
  });

  it("getArchitectNodeSequence divide §2–§4 en HIGH", () => {
    assert.deepEqual(getArchitectNodeSequence("HIGH"), [
      "stack_architect",
      "data_model",
      "architect_critic",
      "api_contracts",
    ]);
    assert.deepEqual(getArchitectNodeSequence("MEDIUM"), ["software_architect", "architect_critic"]);
  });

  it("expandArchitectAgentNames sustituye software_architect en HIGH", () => {
    const expanded = expandArchitectAgentNames(["software_architect", "security"], "HIGH");
    assert.ok(expanded.includes("stack_architect"));
    assert.ok(expanded.includes("data_model"));
    assert.ok(expanded.includes("api_contracts"));
    assert.equal(expanded.includes("software_architect"), false);
  });

  it("agentsForArchitectSection mapea sección a agente scoped", () => {
    assert.deepEqual(agentsForArchitectSection(2, "HIGH"), ["stack_architect"]);
    assert.deepEqual(agentsForArchitectSection(3, "HIGH"), ["data_model"]);
    assert.deepEqual(agentsForArchitectSection(4, "HIGH"), ["api_contracts"]);
    assert.deepEqual(agentsForArchitectSection(3, "MEDIUM"), ["software_architect"]);
  });

  it("shouldDecoupleSection5FromArchitect en pasada completa", () => {
    assert.equal(shouldDecoupleSection5FromArchitect(baseState, "full"), true);
    assert.equal(shouldDecoupleSection5FromArchitect(baseState, "stack"), true);
    assert.equal(
      shouldDecoupleSection5FromArchitect({ ...baseState, sectionsToRun: ["software_architect"] }, "full"),
      true,
    );
  });

  it("normalizeScopedArchitectResponse envuelve cuerpo sin heading", () => {
    const sql = "```sql\nCREATE TABLE keys (id UUID PRIMARY KEY);\n```";
    const wrapped = normalizeScopedArchitectResponse(sql, "data_model");
    assert.ok(wrapped.includes("## 3. Modelo de Datos"));
    assert.ok(wrapped.includes("CREATE TABLE keys"));
    const full = normalizeScopedArchitectResponse("# Master Design Document\n\n## 3. Modelo de Datos\n\nx", "data_model");
    assert.ok(full.startsWith("# Master"));
  });

  it("resolveArchitectMergeBaseline usa draftTrimmed en HIGH scoped", () => {
    const state = {
      executorControlled: false,
      delegateTarget: undefined,
      previousMddDraftForMerge: "## 2 stale",
    } as Parameters<typeof resolveArchitectMergeBaseline>[0];
    const { baseline, source } = resolveArchitectMergeBaseline(state, "data_model", "current draft §2 good");
    assert.equal(baseline, "current draft §2 good");
    assert.equal(source, "draftTrimmed");
  });

  it("resolveArchitectMergeBaseline usa previous en executorControlled", () => {
    const state = {
      executorControlled: true,
      delegateTarget: undefined,
      previousMddDraftForMerge: "executor baseline",
    } as Parameters<typeof resolveArchitectMergeBaseline>[0];
    const { baseline, source } = resolveArchitectMergeBaseline(state, "data_model", "current");
    assert.equal(baseline, "executor baseline");
    assert.equal(source, "previousMddDraftForMerge");
  });

  it("looksLikeFullMddArchitectResponse detecta MDD completo en data_model", () => {
    const full = `# Master Design Document\n\n## 1. Contexto\nx\n\n## 2. Arquitectura\n(Pendiente)\n\n## 3. Modelo de Datos\n\`\`\`sql\nCREATE TABLE t (id UUID);\n\`\`\``;
    assert.equal(looksLikeFullMddArchitectResponse(full, "data_model"), true);
    assert.equal(looksLikeFullMddArchitectResponse("## 3. Modelo de Datos\n\n```sql\nCREATE TABLE t (id UUID PRIMARY KEY);\n```", "data_model"), false);
  });

  it("processScopedArchitectResponse extrae §3 de MDD completo", () => {
    const full = `# Master Design Document\n\n## 1. Contexto\nx\n\n## 2. Arquitectura\n(Pendiente)\n\n## 3. Modelo de Datos\n\`\`\`sql\nCREATE TABLE orders (id UUID PRIMARY KEY);\n\`\`\`\n${"detalle modelo. ".repeat(12)}`;
    const { fragment, extractedFromFullMdd } = processScopedArchitectResponse(full, "data_model");
    assert.equal(extractedFromFullMdd, true);
    assert.ok(fragment.includes("CREATE TABLE orders"));
    assert.ok(!fragment.includes("# Master Design Document"));
    assert.ok(!fragment.includes("## 2. Arquitectura"));
  });

  it("extract + tryMerge preserva §2 del baseline tras MDD completo scoped", () => {
    const baseline = `# Master Design Document\n\n## 1. Contexto\nctx\n\n## 2. Arquitectura y Stack\n${"NestJS PostgreSQL stack. ".repeat(12)}\n\n## 3. Modelo de Datos\n(Pendiente)\n\n## 4. Contratos de API\n(Pendiente)\n\n## 5. Lógica\n(Pendiente)\n\n## 6. Seguridad\n(Pendiente)\n\n## 7. Infraestructura\n(Pendiente)`;
    const fullLlm = baseline.replace(
      /## 3\. Modelo de Datos[\s\S]*?(?=\n## 4\.)/,
      `## 3. Modelo de Datos\n\`\`\`sql\nCREATE TABLE kms_keys (id UUID PRIMARY KEY);\n\`\`\`\n${"kms schema. ".repeat(15)}\n\n`,
    ).replace(
      /## 2\. Arquitectura y Stack[\s\S]*?(?=\n## 3\.)/,
      `## 2. Arquitectura y Stack\n(Pendiente: Arquitecto de Software)\n\n`,
    );
    const { fragment } = processScopedArchitectResponse(fullLlm, "data_model");
    const merge = tryMergeSingleArchitectSectionIntoDraft(baseline, fragment, 3);
    assert.equal(merge.merged, true);
    assert.ok(merge.draft.includes("NestJS PostgreSQL stack"));
    assert.ok(merge.draft.includes("CREATE TABLE kms_keys"));
    assert.ok(!merge.draft.includes("(Pendiente: Arquitecto de Software)"));
  });

  it("resolveLiveDraftForScopedArchitectStream conserva draft estable ante MDD completo", () => {
    const stable = "## 2. Arquitectura y Stack\nNestJS ok\n\n## 3. Modelo\n(Pendiente)";
    const frankenstein = `# Master Design Document\n\n## 2. Arquitectura\n(Pendiente)\n\n## 3. Modelo de Datos\n\`\`\`sql\nCREATE TABLE t (id UUID);\n\`\`\``;
    const live = resolveLiveDraftForScopedArchitectStream("data_model", frankenstein, stable);
    assert.equal(live, stable);
  });

  it("resolveLiveDraftForScopedArchitectStream publica §2 sustancial aunque parezca MDD completo", () => {
    const stable = "## 2. Arquitectura y Stack\n(Pendiente: Arquitecto de Software)\n\n## 3. Modelo\n(Pendiente)";
    const s2 = `${"| Backend | NestJS | 10.x |\n".repeat(20)}${"Detalle de arquitectura. ".repeat(15)}`;
    const frankenstein = `# Master Design Document\n\n## 2. Arquitectura y Stack\n${s2}\n\n## 3. Modelo de Datos\n(Pendiente)\n`;
    const live = resolveLiveDraftForScopedArchitectStream("stack_architect", frankenstein, stable);
    assert.ok(live.includes("NestJS"));
    assert.doesNotMatch(live, /\(Pendiente: Arquitecto de Software\)/);
  });
});
