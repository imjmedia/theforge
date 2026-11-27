import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCompositeReadinessGates,
  buildConvergenceFeedbackForDeliverable,
  buildConvergenceRetryPlan,
  classifyGap,
  summarizeClassifiedGaps,
} from "./readiness-audit.util.js";
import { computeMddCascadeDelta } from "./mdd-cascade-delta.util.js";

test("classifyGap: BRD decision log → human", () => {
  const g = classifyGap("[BRD decision log] 2 ítem(s) abiertos — Montos exactos");
  assert.equal(g.kind, "human");
  assert.deepEqual(g.targetDeliverables, ["brd"]);
});

test("buildConvergenceRetryPlan: la brecha humana de BRD no entra al plan", () => {
  const plan = buildConvergenceRetryPlan(["[BRD decision log] 2 ítem(s) abiertos — Montos exactos"]);
  assert.equal(plan.deliverables.includes("brd"), false);
  assert.equal(plan.deliverables.length, 0);
});

test("CL-32: «por validar» a mitad del mensaje → llm", () => {
  const g = classifyGap("[Integración] Campo X por validar con el cliente en la próxima reunión");
  assert.equal(g.kind, "llm");
});

test("classifyGap: API falta → llm api_contracts", () => {
  const g = classifyGap("[API falta] GET /api/v1/widgets");
  assert.equal(g.kind, "llm");
  assert.equal(g.targetDeliverable, "api_contracts");
});

test("applyCompositeReadinessGates: VERDE + 5 cross gaps ≤ tolerancia → VERDE", () => {
  const r = applyCompositeReadinessGates({
    baseStatus: "VERDE",
    basePrecisionScore: 95,
    crossArtifactGapCount: 5,
    conformanceOk: true,
  });
  assert.equal(r.status, "VERDE");
  assert.equal(r.precisionScore, 95);
});

test("applyCompositeReadinessGates: VERDE + 6 cross gaps > tolerancia → AMARILLO cap 82", () => {
  const r = applyCompositeReadinessGates({
    baseStatus: "VERDE",
    basePrecisionScore: 95,
    crossArtifactGapCount: 6,
    conformanceOk: true,
  });
  assert.equal(r.status, "AMARILLO");
  assert.equal(r.precisionScore, 82);
  assert.ok(r.reasons.some((x) => x.includes("6 brecha")));
});

test("applyCompositeReadinessGates: VERDE + 3 human gaps ≤ tolerancia → VERDE", () => {
  const r = applyCompositeReadinessGates({
    baseStatus: "VERDE",
    basePrecisionScore: 95,
    humanRequiredGapCount: 3,
    conformanceOk: true,
  });
  assert.equal(r.status, "VERDE");
});

test("applyCompositeReadinessGates: VERDE + 4 human gaps > tolerancia → AMARILLO", () => {
  const r = applyCompositeReadinessGates({
    baseStatus: "VERDE",
    basePrecisionScore: 95,
    humanRequiredGapCount: 4,
    conformanceOk: true,
  });
  assert.equal(r.status, "AMARILLO");
  assert.equal(r.precisionScore, 78);
});

test("classifyGap: HU↔Tasks → llm tasks", () => {
  const g = classifyGap("[HU↔Tasks] HU_01 sin task trazable");
  assert.equal(g.kind, "llm");
  assert.equal(g.targetDeliverable, "tasks");
});

test("classifyGap: Entregables Spec → spec", () => {
  const g = classifyGap("[Entregables] Spec ausente (< 48 caracteres)");
  assert.equal(g.targetDeliverable, "spec");
});

test("buildConvergenceRetryPlan: LOW/MEDIUM Spec↔API", () => {
  const plan = buildConvergenceRetryPlan([
    "[Spec↔API] «facturación» del Spec sin endpoint trazable",
    "[Entregables] Tasks ausentes (< 48 caracteres)",
  ]);
  assert.ok(plan.deliverables.includes("api_contracts"));
  assert.ok(plan.deliverables.includes("tasks"));
  assert.equal(plan.autoRepairMdd, false);
});

test("buildConvergenceRetryPlan HIGH: mezcla auto + llm", () => {
  const plan = buildConvergenceRetryPlan([
    "[Inventario] Entidades sugeridas ausentes en §3: foo",
    "[API falta] GET /api/v1/foo",
    "[BRD decision log] item abierto",
  ]);
  assert.equal(plan.autoRepairMdd, true);
  assert.ok(plan.deliverables.includes("api_contracts"));
  assert.ok(plan.feedback.includes("[Inventario]"));
});

test("computeMddCascadeDelta: cambio §3 afecta blueprint y api", () => {
  // Fixtures por encima del mínimo de 80 caracteres (por debajo es "MDD nuevo o vacío").
  const ctx = "## 1. Contexto\n\nSistema de pedidos para una tienda en línea con catálogo, carrito y pagos.\n\n";
  const prev = `${ctx}## 3. Modelo de Datos\n\nusers table\n`;
  const next = `${ctx}## 3. Modelo de Datos\n\nusers and orders tables\n`;
  const delta = computeMddCascadeDelta(prev, next);
  assert.ok(delta.changedSections.includes("3"));
  assert.ok(delta.affectedDeliverables.includes("blueprint"));
  assert.ok(delta.affectedDeliverables.includes("api_contracts"));
});

test("summarizeClassifiedGaps respeta límite", () => {
  const gaps = Array.from({ length: 120 }, (_, i) => `[Tasks] gap ${i}`);
  const s = summarizeClassifiedGaps(gaps, 50);
  assert.equal(s.total, 120);
  assert.equal(s.items.length, 50);
  assert.equal(s.truncated, true);
});

test("classifyGap: [Events] logic-flows → logic_flows (no tasks)", () => {
  const g = classifyGap(
    "[Events] Blueprint menciona RabbitMQ/EDA pero logic-flows no documenta eventos",
  );
  assert.equal(g.kind, "llm");
  assert.equal(g.targetDeliverable, "logic_flows");
  assert.deepEqual(g.targetDeliverables, ["logic_flows"]);
});

test("classifyGap: [Events] tasks.md → tasks", () => {
  const g = classifyGap("[Events] Falta task publisher/consumer RabbitMQ en tasks.md");
  assert.equal(g.kind, "llm");
  assert.equal(g.targetDeliverable, "tasks");
  assert.deepEqual(g.targetDeliverables, ["tasks"]);
});

test("classifyGap + buildConvergenceRetryPlan: [Integración] multi-artefacto", () => {
  const gap =
    "[Integración websocket_gateway] En alcance DBGA/BRD pero falta en: API contracts, Architecture, Infra";
  const g = classifyGap(gap);
  assert.equal(g.kind, "llm");
  assert.deepEqual(g.targetDeliverables, ["api_contracts", "architecture", "infra"]);

  const plan = buildConvergenceRetryPlan([
    gap,
    "[Events] Blueprint menciona RabbitMQ/EDA pero logic-flows no documenta eventos",
    "[BRD decision log] BRD: placeholder sin decision log — Por validar suelto",
  ]);
  assert.deepEqual(plan.deliverables.sort(), [
    "api_contracts",
    "architecture",
    "infra",
    "logic_flows",
  ]);
  assert.equal(plan.autoRepairMdd, false);

  assert.ok(buildConvergenceFeedbackForDeliverable([gap], "architecture").includes("websocket_gateway"));
  assert.ok(buildConvergenceFeedbackForDeliverable([gap], "infra").includes("websocket_gateway"));
  assert.ok(buildConvergenceFeedbackForDeliverable([gap], "api_contracts").includes("websocket_gateway"));
  assert.equal(buildConvergenceFeedbackForDeliverable([gap], "blueprint"), "");
});

test("classifyGap: [Pantallas] con historias incluye ui_screens_sync y user_stories", () => {
  const g = classifyGap("[Pantallas] Watchlist no referenciada en pantallas ni historias");
  assert.deepEqual(g.targetDeliverables, ["ui_screens_sync", "user_stories"]);
});
