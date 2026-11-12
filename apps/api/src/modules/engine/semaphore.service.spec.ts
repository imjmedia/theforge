import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectApproach } from "@theforge/database";
import {
  evaluateConstitutionBlockersOpen,
  evaluateFigmaGateOk,
  SemaphoreService,
} from "./semaphore.service.js";

const pad50 = "x".repeat(50);

test("evaluateFigmaGateOk: sin equipo UX → true", () => {
  assert.equal(evaluateFigmaGateOk(false, null, undefined, null), true);
});

test("evaluateFigmaGateOk: UX_FIRST sin figma ni pantallas → false", () => {
  assert.equal(evaluateFigmaGateOk(true, null, ProjectApproach.UX_FIRST, null), false);
});

test("evaluateFigmaGateOk: UX con pantallas sustanciales → true", () => {
  assert.equal(
    evaluateFigmaGateOk(
      true,
      null,
      ProjectApproach.UX_FIRST,
      `# Pantallas\n${pad50}`,
    ),
    true,
  );
});

test("evaluateConstitutionBlockersOpen: sin plantilla → false", () => {
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    constitution: { template_detected: false },
  });
  assert.equal(evaluateConstitutionBlockersOpen(mdd), false);
});

test("evaluateConstitutionBlockersOpen: bloqueantes abiertos → true", () => {
  const mdd = JSON.stringify({
    db_entities: [{ name: "users" }],
    constitution: { template_detected: true, has_open_blockers: true },
  });
  assert.equal(evaluateConstitutionBlockersOpen(mdd), true);
});

test("SemaphoreService delega en degradadores", () => {
  const s = new SemaphoreService();
  assert.equal(s.evaluateFigmaGate({ hasUxTeam: false, figmaMapping: null }), true);
  assert.equal(
    s.evaluateConstitutionBlockers(
      JSON.stringify({ constitution: { template_detected: true, has_open_blockers: true } }),
    ),
    true,
  );
});
