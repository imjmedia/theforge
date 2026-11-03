import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MddManualAuditService } from "./mdd-manual-audit.service.js";
import { isMddAuditPass } from "./mdd-manual-audit.util.js";
import { validateMddStructure } from "../utils/mdd-sanitize.js";

const DRAFT = "# MDD\n\n## 1. Contexto\n" + "Sistema de inventarios con almacenes. ".repeat(12);

type Captured = { updates: Array<Record<string, unknown>>; snapshots: Array<Record<string, unknown>> };

function makeService(auditorResult: Record<string, unknown>): { svc: MddManualAuditService; cap: Captured } {
  const cap: Captured = { updates: [], snapshots: [] };
  const prisma = {
    project: { findUnique: async () => ({ userId: "u1", complexity: "MEDIUM", dbgaContent: null }) },
    stage: {
      findUnique: async () => ({ id: "s1", brdContent: null, shortTermContext: null }),
      update: async (arg: { data: Record<string, unknown> }) => {
        cap.updates.push(arg.data);
        return {};
      },
    },
  };
  const estimation = {
    setAuditorGaps: () => undefined,
    saveMddAuditSnapshot: async (_p: string, _s: string, snap: Record<string, unknown>) => {
      cap.snapshots.push(snap);
    },
  };
  const svc = new MddManualAuditService({} as never, prisma as never, estimation as never);
  (svc as unknown as { runAuditor: () => Promise<unknown> }).runAuditor = async () => auditorResult;
  return { svc, cap };
}

describe("isMddAuditPass", () => {
  it("sin nota (undefined) no aprueba, aunque no falte nada", () => {
    const validation = { ...validateMddStructure(DRAFT), missingSections: [] };
    assert.equal(isMddAuditPass(undefined, validation, null), false);
    assert.equal(isMddAuditPass(90, validation, null), true);
    assert.equal(isMddAuditPass(60, validation, null), false);
  });
});

describe("MddManualAuditService con Auditor no disponible", () => {
  it("no expone ni persiste score 0: evento y entrevista quedan sin nota", async () => {
    const { svc, cap } = makeService({
      auditorScore: undefined,
      auditorOutcome: "unavailable",
      auditorFeedback: "Auditoría LLM no disponible",
      auditorGaps: { score: null, status: "NO_EVALUADO", critical_gaps: [], syntax_errors: [], infrastructure_ready: false },
    });
    const ev = await svc.audit("p1", "s1", DRAFT);
    assert.ok(ev.type === "audit_started" || ev.type === "audit_complete", ev.type);
    if (ev.type !== "audit_started" && ev.type !== "audit_complete") return;
    assert.equal(ev.auditorScore, undefined);
    assert.equal(ev.auditorOutcome, "unavailable");

    // El snapshot de auditoría no lleva nota y la entrevista persistida tampoco (ni 0).
    for (const snap of cap.snapshots) assert.equal("auditorScore" in snap, false);
    const interviews = cap.updates
      .map((u) => (u.shortTermContext as { mddAuditInterview?: { interview: Record<string, unknown> } } | undefined)?.mddAuditInterview)
      .filter(Boolean);
    for (const env of interviews) {
      assert.equal(env!.interview.auditorScore, undefined);
      assert.equal(env!.interview.auditorOutcome, "unavailable");
    }
  });

  it("con nota válida conserva el score", async () => {
    const { svc } = makeService({
      auditorScore: 70,
      auditorOutcome: "scored",
      auditorFeedback: "ok",
      auditorGaps: { score: 70, status: "OK", critical_gaps: [], syntax_errors: [], infrastructure_ready: true },
    });
    const ev = await svc.audit("p1", "s1", DRAFT);
    assert.ok(ev.type === "audit_started" || ev.type === "audit_complete");
    if (ev.type !== "audit_started" && ev.type !== "audit_complete") return;
    assert.equal(ev.auditorScore, 70);
    assert.equal(ev.auditorOutcome, "scored");
  });
});
