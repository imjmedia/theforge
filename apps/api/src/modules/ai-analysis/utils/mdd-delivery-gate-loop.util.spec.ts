import { describe, it } from "node:test";
import assert from "node:assert";
import {
  fingerprintPlaceholderBlockers,
  guardFixTargetAgainstSection5Blockers,
  hasRepeatedPlaceholderBlockers,
  hasUnresolvedAutoRepairableGateWarnings,
  mapAuditorGapsToFixTarget,
  needsFullArchitectPipelineRegeneration,
  resolveDeliveryGateFixTarget,
  resolveDeliveryGateFixTargetFromGate,
  shouldClarifierRevisionSkipArchitectPipeline,
  shouldContinueDeliveryGateLoop,
  shouldContinueDeliveryGateQualityLoop,
} from "./mdd-delivery-gate-loop.util.js";

describe("resolveDeliveryGateFixTarget (CHANGELOG [Unreleased] → Added → \"Dedicated §5 pass\")", () => {
  it("rutas a 'section5' cuando TODOS los blockers son sólo sobre §5", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 5. Lógica y Edge Cases está en (Pendiente) o tiene contenido insuficiente (0 chars; mínimo 200).",
    ]);
    assert.equal(target, "section5");
  });

  it("rutas a 'section5' con múltiples substance blockers de §5", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 5. Lógica y Edge Cases está en (Pendiente) (0 chars; mínimo 200).",
      "Sección 5. Lógica y Edge Cases es un placeholder del pipeline (ej. \"Pendiente: Arquitecto\").",
    ]);
    assert.equal(target, "section5");
  });

  it("NO rutas a 'section5' si hay blockers de otras secciones también", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 2. Arquitectura y Stack tiene contenido insuficiente (50 chars; mínimo 200).",
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (0 chars; mínimo 200).",
    ]);
    assert.equal(target, "software_architect");
  });

  it("NO rutas a 'section5' si hay blockers de §7 — va a 'integration'", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (0 chars; mínimo 200).",
      "Secciones obligatorias faltantes: 7. Infraestructura",
    ]);
    assert.equal(target, "integration");
  });

  it("NO rutas a 'section5' si hay blocker de §1 — va a 'clarifier'", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 1. Contexto tiene contenido insuficiente (10 chars; mínimo 200).",
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (0 chars; mínimo 200).",
    ]);
    assert.equal(target, "clarifier");
  });

  it("rutas a 'clarifier' cuando §1 carece de subsecciones constitución", () => {
    const target = resolveDeliveryGateFixTarget([
      "Sección 1. Contexto: estructura constitución incompleta (faltan: Mapa de contextos DDD, Glosario de dominio).",
    ]);
    assert.equal(target, "clarifier");
  });

  it("draft cascarón (§1+§2 rotas y §3–§7 faltantes) → software_architect, no clarifier", () => {
    const blockers = [
      "Secciones obligatorias faltantes: 3. Modelo de Datos, 4. Contratos de API, 5. Lógica y Edge Cases, 6. Seguridad, 7. Infraestructura",
      "Sección 1. Contexto tiene contenido insuficiente (64 chars; mínimo 200).",
      'Sección 2. Arquitectura y Stack es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
    ];
    assert.equal(needsFullArchitectPipelineRegeneration(blockers), true);
    assert.equal(resolveDeliveryGateFixTarget(blockers), "software_architect");
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "software_architect",
    );
    assert.equal(resolveDeliveryGateFixTargetFromGate(blockers, []), "software_architect");
  });

  it("comportamiento legacy preservado: blockers sin §5 van a su ruta normal", () => {
    assert.equal(
      resolveDeliveryGateFixTarget(["Secciones obligatorias faltantes: 7. Infraestructura"]),
      "integration",
    );
    assert.equal(
      resolveDeliveryGateFixTarget([
        "Sección 3. Modelo de Datos tiene contenido insuficiente (5 chars; mínimo 100).",
      ]),
      "software_architect",
    );
    assert.equal(resolveDeliveryGateFixTarget([]), "software_architect");
  });

  it("pipeline HIGH: §3 → data_model, §4 → api_contracts, §2 → stack_architect", () => {
    assert.equal(
      resolveDeliveryGateFixTarget(
        ["Sección 3. Modelo de Datos tiene contenido insuficiente (5 chars; mínimo 100)."],
        { splitArchitectPipeline: true },
      ),
      "data_model",
    );
    assert.equal(
      resolveDeliveryGateFixTarget(
        ["§4 Contratos de API no tiene endpoints reales con request/response JSON"],
        { splitArchitectPipeline: true },
      ),
      "api_contracts",
    );
    assert.equal(
      resolveDeliveryGateFixTarget(
        ["Sección 2. Arquitectura y Stack tiene contenido insuficiente (50 chars; mínimo 200)."],
        { splitArchitectPipeline: true },
      ),
      "stack_architect",
    );
  });

  it("circuit breaker: mismos placeholders §2–§4 → scoped (no software_architect)", () => {
    const blockers = [
      'Sección 4. Contratos de API es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
      'Sección 3. Modelo de Datos es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
    ];
    const fp = fingerprintPlaceholderBlockers(blockers);
    assert.equal(hasRepeatedPlaceholderBlockers(fp, blockers), true);
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, {
        splitArchitectPipeline: true,
        previousPlaceholderFingerprint: fp,
        deliveryGateAttempt: 2,
      }),
      "api_contracts",
    );
  });

  it("HIGH: placeholders §2–§4 enrutan a scoped sin esperar circuit breaker", () => {
    const blockers = [
      'Sección 2. Arquitectura y Stack es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
    ];
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "stack_architect",
    );
  });

  it("mapAuditorGapsToFixTarget: gap §5 → section5", () => {
    const target = mapAuditorGapsToFixTarget({
      score: 70,
      status: "RECHAZADO",
      critical_gaps: [
        {
          sections: ["Sección 5"],
          issue: "Lógica y edge cases insuficientes",
          fix: "Ampliar reglas de negocio en §5",
        },
      ],
      syntax_errors: [],
      infrastructure_ready: true,
    });
    assert.equal(target, "section5");
  });

  it("resolveDeliveryGateFixTargetFromGate: blocker §5 + gap contratos en warnings → section5", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (41 chars; mínimo 200).",
    ];
    const warnings = [
      "§4 Contratos de API no tiene endpoints reales con request/response JSON",
    ];
    assert.equal(
      resolveDeliveryGateFixTargetFromGate(blockers, warnings, { splitArchitectPipeline: true }),
      "section5",
    );
  });

  it("guardFixTargetAgainstSection5Blockers: no api_contracts con §5 bloqueado", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases está en (Pendiente) o tiene contenido insuficiente (0 chars; mínimo 200).",
    ];
    assert.equal(
      guardFixTargetAgainstSection5Blockers(blockers, "api_contracts"),
      "section5",
    );
    assert.equal(
      guardFixTargetAgainstSection5Blockers(blockers, "data_model"),
      "section5",
    );
  });

  it("resolveDeliveryGateFixTargetFromGate: sin blockers usa warnings auto-reparables", () => {
    assert.equal(
      resolveDeliveryGateFixTargetFromGate(
        [],
        ['Manifest api_prefix "/api" no coincide con rutas dominantes (/api/v1).'],
        { splitArchitectPipeline: true },
      ),
      "integration",
    );
  });

  it("HIGH: empate §2+§3 placeholder → stack_architect (no data_model)", () => {
    const blockers = [
      'Sección 2. Arquitectura y Stack es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
      'Sección 3. Modelo de Datos es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
    ];
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "stack_architect",
    );
  });

  it("faltantes §6+§7 → integration (nunca data_model)", () => {
    const blockers = ["Secciones obligatorias faltantes: 6. Seguridad, 7. Infraestructura"];
    assert.equal(resolveDeliveryGateFixTarget(blockers), "integration");
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "integration",
    );
  });

  it("headings duplicados → integration (no data_model en HIGH)", () => {
    const blockers = [
      "MDD repite headings canónicos §1–§7 (secciones duplicadas por acumulación del pipeline).",
    ];
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "integration",
    );
  });

  it("§6 placeholder + faltantes §6/§7 → integration (no data_model)", () => {
    const blockers = [
      "Secciones obligatorias faltantes: 6. Seguridad, 7. Infraestructura",
      'Sección 6. Seguridad es un placeholder del pipeline (ej. "Pendiente: Arquitecto"). Regenera antes de persistir.',
    ];
    assert.equal(
      resolveDeliveryGateFixTarget(blockers, { splitArchitectPipeline: true }),
      "integration",
    );
  });
});

describe("shouldContinueDeliveryGateLoop / shouldContinueDeliveryGateQualityLoop", () => {
  it("gate con blockers → loop de blockers hasta MAX intentos", () => {
    const gate = {
      ok: false,
      score: 40,
      blockers: ["Sección 4. Contratos de API tiene contenido insuficiente."],
      warnings: [],
    };
    assert.equal(shouldContinueDeliveryGateLoop(gate, 0), true);
    assert.equal(shouldContinueDeliveryGateLoop(gate, 3), false);
  });

  it("gate ok + 0 blockers + warnings auto-reparables → no quality loop (KMS)", () => {
    const gate = {
      ok: true,
      score: 100,
      blockers: [] as string[],
      warnings: [
        'Manifest api_prefix "/api" no coincide con rutas dominantes (/api/v1).',
      ],
    };
    assert.equal(hasUnresolvedAutoRepairableGateWarnings(gate.warnings), true);
    assert.equal(shouldContinueDeliveryGateLoop(gate, 0), false);
    assert.equal(shouldContinueDeliveryGateQualityLoop(gate, 0), false);
    assert.equal(shouldContinueDeliveryGateQualityLoop(gate, 2), false);
  });

  it("gate fallido + warnings auto-reparables → quality loop permitido", () => {
    const gate = {
      ok: false,
      score: 70,
      blockers: [] as string[],
      warnings: ["Tabla huérfana en §3: orphan_table sin referencia ER."],
    };
    assert.equal(shouldContinueDeliveryGateLoop(gate, 0), true);
    assert.equal(shouldContinueDeliveryGateQualityLoop(gate, 0), true);
  });
});

describe("shouldClarifierRevisionSkipArchitectPipeline", () => {
  const goodTail =
    "## 2. Arquitectura y Stack\n\n" +
    `${"NestJS PostgreSQL Docker despliegue. ".repeat(20)}\n\n` +
    "## 3. Modelo de Datos\n\n" +
    `${"CREATE TABLE users (id uuid primary key); ".repeat(12)}`;

  it("true en revisión gate con §2–§3 sustanciales", () => {
    assert.equal(
      shouldClarifierRevisionSkipArchitectPipeline({
        deliveryGateLoopActive: true,
        deliveryGateFixTarget: "clarifier",
        mddDraft: `## 1. Contexto\n\n(Pendiente)\n\n${goodTail}`,
        previousMddDraftForMerge: undefined,
      } as never),
      true,
    );
  });

  it("false en primera pasada (sin delivery gate)", () => {
    assert.equal(
      shouldClarifierRevisionSkipArchitectPipeline({
        deliveryGateLoopActive: false,
        deliveryGateFixTarget: undefined,
        mddDraft: goodTail,
      } as never),
      false,
    );
  });
});

describe("shouldContinueDeliveryGateLoop", () => {
  it("no continúa cuando gate.ok=true aunque haya warnings auto-reparables", () => {
    assert.equal(
      shouldContinueDeliveryGateLoop(
        {
          ok: true,
          score: 100,
          blockers: [],
          warnings: ["Contratos §4: fences JSON desbalanceados"],
        },
        2,
      ),
      false,
    );
  });

  it("continúa solo cuando gate.ok=false y quedan intentos", () => {
    assert.equal(
      shouldContinueDeliveryGateLoop(
        {
          ok: false,
          score: 84,
          blockers: ["Sección 2 placeholder"],
          warnings: [],
        },
        1,
      ),
      true,
    );
    assert.equal(
      shouldContinueDeliveryGateLoop(
        {
          ok: false,
          score: 84,
          blockers: ["Sección 2 placeholder"],
          warnings: [],
        },
        3,
      ),
      false,
    );
  });
});
