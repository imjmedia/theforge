import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCompletenessScore,
  computeIntegralScore,
  derivativesState,
  DOC_PARTIAL_MIN_LENGTH,
  resolveCompletenessPhase,
  scoreDocumentContent,
} from "./completeness-phase.js";
import { normalizeMddForHash } from "./hash-normalize.js";
import { evaluateDeliverablesGate } from "./deliverables-gate.js";
import {
  evaluateMddSemaphore,
  statusFromHeadlineOnly,
  statusRank,
} from "./evaluate.js";
import { PRECISION_GREEN_MIN, PRECISION_RED_MAX, statusFromScore } from "./scale.js";

const gateBase = {
  hasSpec: false,
  hasBootstrap: false,
  legacyHasDoc: false,
  designFirstGateOk: false,
};

const DOC_100 = "x".repeat(DOC_PARTIAL_MIN_LENGTH + 250);
const DOC_80 = "x".repeat(DOC_PARTIAL_MIN_LENGTH);

describe("escala única (RF-01)", () => {
  it("tabla 84→rojo, 85→amarillo, 89→amarillo, 90→verde", () => {
    assert.equal(statusFromScore(84), "red");
    assert.equal(statusFromScore(85), "yellow");
    assert.equal(statusFromScore(89), "yellow");
    assert.equal(statusFromScore(90), "green");
    assert.equal(PRECISION_RED_MAX, 85);
    assert.equal(PRECISION_GREEN_MIN, 90);
  });
});

describe("integral y completitud (RF-02, RF-03)", () => {
  it("MDD+BRD+Spec perfectos pre-cascada → integral 100", () => {
    const docs = {
      mddContent: DOC_100,
      brdContent: DOC_100,
      specContent: DOC_100,
    };
    const C = computeCompletenessScore(docs, "pre_cascade", "HIGH");
    assert.equal(C, 100);
    const { integral } = computeIntegralScore({ completeness: C, consistency: 100, mddQuality: 100 });
    assert.equal(integral, 100);
    assert.equal(statusFromScore(integral), "green");
  });

  it("MDD+BRD sin Spec en HIGH → integral 94", () => {
    const docs = {
      mddContent: DOC_100,
      brdContent: DOC_100,
      specContent: "",
    };
    const C = computeCompletenessScore(docs, "pre_cascade", "HIGH");
    assert.equal(C, 80);
    const { integral } = computeIntegralScore({ completeness: C, consistency: 100, mddQuality: 100 });
    assert.equal(integral, 94);
  });

  it("CL-02: sin BRD → (0.30·70 + 0.45·Q)/0.75 = 88 → amarillo", () => {
    const { integral, consistency } = computeIntegralScore({
      completeness: 70,
      consistency: null,
      mddQuality: 100,
    });
    assert.equal(consistency, null);
    assert.equal(integral, 88);
    assert.equal(statusFromScore(integral), "yellow");
  });
});

describe("CL-33: LOW/MEDIUM pre-cascada renormaliza sin BRD ni Spec", () => {
  it("solo MDD presente no penaliza por ausencia de BRD/Spec", () => {
    const docs = { mddContent: DOC_100 };
    const low = computeCompletenessScore(docs, "pre_cascade", "LOW");
    const medium = computeCompletenessScore(docs, "pre_cascade", "MEDIUM");
    assert.equal(low, 100);
    assert.equal(medium, 100);
  });
});

describe("derivativesState y fase", () => {
  it("post_cascade solo cuando derivados complete", () => {
    assert.equal(resolveCompletenessPhase("none"), "pre_cascade");
    assert.equal(resolveCompletenessPhase("partial"), "pre_cascade");
    assert.equal(resolveCompletenessPhase("complete"), "post_cascade");
    assert.equal(
      derivativesState("HIGH", {
        blueprintContent: DOC_80,
        apiContractsContent: DOC_80,
        logicFlowsContent: DOC_80,
        infraContent: DOC_80,
      }),
      "complete",
    );
  });

  it("CL-21: MEDIUM con 3 de 5 grupos → partial", () => {
    assert.equal(
      derivativesState("MEDIUM", {
        specContent: DOC_80,
        apiContractsContent: DOC_80,
        userStoriesContent: DOC_80,
      }),
      "partial",
    );
  });
});

describe("CL-06: normalizeMddForHash", () => {
  it("override formateado y persistido normalizan igual", () => {
    const base = `<!-- theforge-doc:created=2026-01-01T00:00:00.000Z|updated=2026-01-01T00:00:00.000Z -->\n> 📅 Creado: test\n\n---\n\n## 1. Contexto\n\nHola   mundo.\n`;
    const spaced = `\n\n${base.replace(/\n\n/g, "\n\n\n")}   `;
    assert.equal(normalizeMddForHash(base), normalizeMddForHash(spaced));
  });
});

describe("puntaje por documento", () => {
  it("100/50/10/0 por longitud", () => {
    assert.equal(scoreDocumentContent(""), 0);
    assert.equal(scoreDocumentContent("x"), 10);
    assert.equal(scoreDocumentContent(DOC_80), 50);
    assert.equal(scoreDocumentContent(DOC_100), 100);
  });
});

describe("evaluateMddSemaphore y puerta (P1b)", () => {
  it("CL-01: MDD vacío → rojo, titular 0, HIGH allowed=false", () => {
    const v = evaluateMddSemaphore({
      profile: "HIGH",
      source: "persisted",
      documents: { mddContent: "" },
      mddQuality: 0,
      consistencyScore: null,
      derivatives: {},
      deliverablesGate: { ...gateBase, hasSpec: false },
    });
    assert.equal(v.status, "red");
    assert.equal(v.headline, 0);
    assert.equal(v.deliverablesGate.allowed, false);
  });

  it("CL-03 pre-cascada: verde con nota de derivados", () => {
    const v = evaluateMddSemaphore({
      profile: "HIGH",
      source: "persisted",
      documents: { mddContent: DOC_100, brdContent: DOC_100, specContent: DOC_100 },
      mddQuality: 100,
      consistencyScore: 100,
      derivatives: {},
      deliverablesGate: { ...gateBase, hasSpec: true },
    });
    assert.equal(v.status, "green");
    assert.equal(v.headline, 100);
    assert.ok(v.notes.includes("MDD listo; genera entregables"));
  });

  it("HIGH verde sin Spec → puerta no permitida", () => {
    const v = evaluateMddSemaphore({
      profile: "HIGH",
      source: "persisted",
      documents: { mddContent: DOC_100, brdContent: DOC_100, specContent: DOC_100 },
      mddQuality: 100,
      consistencyScore: 100,
      derivatives: {},
      deliverablesGate: { ...gateBase, hasSpec: false },
    });
    assert.equal(v.status, "green");
    assert.equal(v.deliverablesGate.allowed, false);
    assert.ok(v.deliverablesGate.reasons.some((r) => /spec/i.test(r)));
  });
});

describe("evaluateDeliverablesGate (RF-14)", () => {
  it("CL-20: LOW sin HU/tasks con DBGA → allowed=true", () => {
    const r = evaluateDeliverablesGate({
      profile: "LOW",
      verdict: { status: "red", reasons: [] },
      hasSpec: false,
      hasBootstrap: true,
      legacyHasDoc: false,
      designFirstGateOk: false,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.rule, "low_medium");
  });

  it("CL-26: LEGACY sin MDD con codebaseDoc → allowed=true", () => {
    const r = evaluateDeliverablesGate({
      profile: "LEGACY",
      verdict: { status: "red", reasons: [] },
      hasSpec: false,
      hasBootstrap: false,
      legacyHasDoc: true,
      designFirstGateOk: false,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.rule, "legacy");
  });
});

describe("propiedad: ninguna regla sube el color", () => {
  const samples: Parameters<typeof evaluateMddSemaphore>[0][] = [
    {
      profile: "HIGH",
      source: "draft",
      documents: { mddContent: DOC_100, brdContent: DOC_100, specContent: DOC_100 },
      mddQuality: 100,
      consistencyScore: 100,
      derivatives: {},
      deliverablesGate: gateBase,
    },
    {
      profile: "HIGH",
      source: "draft",
      documents: { mddContent: DOC_100, brdContent: DOC_100, specContent: DOC_100 },
      mddQuality: 100,
      consistencyScore: 50,
      derivatives: {},
      deliverablesGate: gateBase,
    },
    {
      profile: "HIGH",
      source: "draft",
      documents: { mddContent: DOC_100 },
      mddQuality: 95,
      consistencyScore: null,
      derivatives: { blueprintContent: DOC_80 },
      conformanceOk: false,
      crossArtifactGapsDeduplicated: 8,
      deliverablesGate: gateBase,
    },
    {
      profile: "HIGH",
      source: "draft",
      documents: { mddContent: DOC_100 },
      mddQuality: 100,
      consistencyScore: null,
      derivatives: {},
      deliveryGateBlockers: ["Bloqueante de negocio"],
      deliverablesGate: gateBase,
    },
  ];

  for (let i = 0; i < samples.length; i++) {
    it(`muestra ${i + 1}`, () => {
      const v = evaluateMddSemaphore(samples[i]!);
      const fromHeadline = statusFromHeadlineOnly(v.headline);
      assert.ok(
        statusRank(v.status) <= statusRank(fromHeadline),
        `status ${v.status} > headline color ${fromHeadline} (headline=${v.headline})`,
      );
    });
  }
});
