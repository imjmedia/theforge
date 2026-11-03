import { describe, it } from "node:test";
import assert from "node:assert";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { runWithLlmAbortSignal } from "../utils/mdd-llm-retry.util.js";
import type { MDDStateType } from "../state/index.js";
import { createMddAuditorNode } from "./mdd-auditor.node.js";
import { draftIsSubstantialForScopedRepair } from "../utils/mdd-section-preserve.util.js";
import {
  guardFixTargetAgainstSection5Blockers,
  resolveDeliveryGateFixTargetFromGate,
} from "../utils/mdd-delivery-gate-loop.util.js";

const SUBSTANTIAL_DRAFT = `# MDD
## 1. Contexto
${"Alcance detallado del dominio. ".repeat(80)}
## 2. Arquitectura y Stack
${"NestJS + React + PostgreSQL con colas BullMQ. ".repeat(20)}
## 3. Modelo de Datos
CREATE TABLE users (id UUID PRIMARY KEY);
CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
## 4. Contratos de API
| POST | /api/v1/orders | Crear pedido |
${"| detalle endpoint ".repeat(40)}
## 5. Lógica y Edge Cases
${"- regla de negocio con detalle suficiente. ".repeat(30)}
## 6. Seguridad
${"JWT RS256 con rotación y rate limit. ".repeat(15)}
## 7. Infraestructura
${"Docker Compose con healthchecks y despliegue. ".repeat(15)}
${"padding para superar 15k chars en draft sustancial. ".repeat(220)}`;

describe("MDD Auditor score-only (sin re-loop Architect desde gaps)", () => {
  it("draft sustancial cumple umbral scoped repair", () => {
    assert.equal(draftIsSubstantialForScopedRepair(SUBSTANTIAL_DRAFT), true);
  });

  it("gate §5 blocker + warnings contratos → fixTarget section5 (gate > auditor gaps)", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (41 chars; mínimo 200).",
    ];
    const warnings = [
      "§4 Contratos de API no tiene endpoints reales con request/response JSON",
    ];
    const fixTarget = resolveDeliveryGateFixTargetFromGate(blockers, warnings, {
      splitArchitectPipeline: true,
    });
    assert.equal(fixTarget, "section5");
  });

  it("guard evita api_contracts mientras §5 sigue bloqueado", () => {
    const blockers = [
      "Sección 5. Lógica y Edge Cases tiene contenido insuficiente (41 chars; mínimo 200).",
    ];
    assert.equal(
      guardFixTargetAgainstSection5Blockers(blockers, "api_contracts"),
      "section5",
    );
  });

  it("sin blockers §5 no aplica guard aunque warnings mencionen §4", () => {
    const fixTarget = resolveDeliveryGateFixTargetFromGate(
      [],
      ["§4 Contratos de API no tiene endpoints reales con request/response JSON"],
      { splitArchitectPipeline: true },
    );
    assert.equal(fixTarget, "software_architect");
  });
});


/** LLM falso: cada elemento es una respuesta (`{ content }`) o una función que lanza/devuelve. */
class FakeAuditorLlm {
  callCount = 0;
  received: Array<Array<{ content?: unknown }>> = [];
  constructor(private readonly responses: Array<unknown | (() => unknown)>) {}
  async invoke(messages: Array<{ content?: unknown }>): Promise<unknown> {
    this.callCount += 1;
    this.received.push(messages);
    const r = this.responses[Math.min(this.callCount - 1, this.responses.length - 1)];
    return typeof r === "function" ? (r as () => unknown)() : r;
  }
}

const VALID_VERDICT = JSON.stringify({
  auditorScore: 91,
  auditorFeedback: "Documento consistente.",
  status: "APROBADO",
  critical_gaps: [],
  syntax_errors: [],
  infrastructure_ready: true,
});

const FAST_TRANSPORT = { disableStreaming: true, backoffMs: [0, 0, 0] } as const;

function auditorNode(llm: FakeAuditorLlm) {
  return createMddAuditorNode(llm as unknown as BaseChatModel, null, FAST_TRANSPORT);
}

function stateFor(draft: string, mddIteration = 1): MDDStateType {
  return { mddDraft: draft, mddIteration } as unknown as MDDStateType;
}

describe("MDD Auditor: veredicto validado y Auditor caído = sin nota", () => {
  it("JSON inválido, reparación, JSON válido → scored con attempts 2", async () => {
    const llm = new FakeAuditorLlm([{ content: "no es json" }, { content: VALID_VERDICT }]);
    const out = await auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT));
    assert.equal(llm.callCount, 2);
    // La 2ª llamada re-inyecta la salida previa y el error de validación.
    assert.equal(llm.received[1]!.length, 3);
    assert.match(String(llm.received[1]![2]!.content), /SOLO el JSON corregido/);
    assert.equal(out.auditorOutcome, "scored");
    assert.equal(out.auditorScore, 91);
    assert.equal(out.auditorRan, true);
    assert.equal(out.auditorDecision, "done");
    assert.equal(out.auditorGaps?.status, "APROBADO");
  });

  it("JSON válido a la primera → scored sin reparación", async () => {
    const llm = new FakeAuditorLlm([{ content: VALID_VERDICT }]);
    const out = await auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT));
    assert.equal(llm.callCount, 1);
    assert.equal(out.auditorOutcome, "scored");
    assert.equal(out.auditorScore, 91);
  });

  it("dos salidas inválidas → unavailable: sin score, decision done, mddIteration igual, auditorRan true", async () => {
    const llm = new FakeAuditorLlm([{ content: "no es json" }, { content: '{"auditorScore": "alto"}' }]);
    const out = await auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT, 1));
    assert.equal(llm.callCount, 2);
    assert.equal(out.auditorOutcome, "unavailable");
    assert.equal(out.auditorScore, undefined);
    assert.equal(out.auditorDecision, "done");
    assert.equal(out.mddIteration, 1);
    assert.equal(out.auditorRan, true);
    assert.match(out.auditorFeedback ?? "", /Auditoría LLM no disponible/);
    assert.match(out.auditorFeedback ?? "", /gate determinista/);
    assert.equal(out.auditorUnavailableReason, "invalid");
  });

  it("7 secciones presentes y Auditor caído: NUNCA score 0 ni RECHAZADO", async () => {
    const llm = new FakeAuditorLlm([{ content: "basura" }]);
    const out = await auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT));
    assert.equal(out.auditorOutcome, "unavailable");
    assert.notEqual(out.auditorScore, 0);
    assert.equal(out.auditorScore, undefined);
    assert.equal(out.auditorGaps?.score ?? null, null);
    assert.notEqual(out.auditorGaps?.status, "RECHAZADO");
    assert.equal(out.auditorGaps?.status, "NO_EVALUADO");
    assert.deepEqual(out.auditorGaps?.critical_gaps, []);
    assert.notEqual(out.auditorDecision, "clarifier");
  });

  it("fallo de transporte → unavailable, sin score y sin ir a clarifier", async () => {
    const llm = new FakeAuditorLlm([
      () => {
        throw new Error("ECONNRESET");
      },
    ]);
    const out = await auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT, 0));
    assert.equal(out.auditorOutcome, "unavailable");
    assert.equal(out.auditorScore, undefined);
    assert.equal(out.auditorDecision, "done");
    assert.equal(out.mddIteration, 0);
    assert.equal(out.auditorUnavailableReason, "transport");
    assert.equal(out.auditorRan, true);
  });

  it("secciones faltantes + Auditor caído: solo huecos estructurales reales, sin score", async () => {
    const llm = new FakeAuditorLlm([{ content: "basura" }]);
    const draft = "# MDD\n## 1. Contexto\nsolo contexto\n";
    const out = await auditorNode(llm)(stateFor(draft, 1));
    assert.equal(out.auditorOutcome, "unavailable");
    assert.equal(out.auditorScore, undefined);
    assert.equal(out.auditorGaps?.score ?? null, null);
    assert.equal(out.auditorDecision, "done");
    assert.equal(out.mddIteration, 1);
    const gaps = out.auditorGaps?.critical_gaps ?? [];
    assert.ok(gaps.length > 0);
    assert.ok(gaps.every((g) => /^Falta la sección obligatoria:/.test(g.issue)));
  });

  it("cancelación del turno: se propaga el AbortError (no se convierte en Auditor caído)", async () => {
    const llm = new FakeAuditorLlm([{ content: VALID_VERDICT }]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runWithLlmAbortSignal(controller.signal, () => auditorNode(llm)(stateFor(SUBSTANTIAL_DRAFT))),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(llm.callCount, 0);
  });
});

describe("MDD Auditor: presupuesto de tiempo (deadlineMs)", () => {
  it("presupuesto agotado con la llamada en vuelo => unavailable con texto de presupuesto, sin abortar el turno", async () => {
    let fireDeadline: (() => void) | undefined;
    let calls = 0;
    const llm = {
      invoke: (_m: unknown, opts: { signal: AbortSignal }) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
          // El reloj del presupuesto vence mientras la llamada sigue en vuelo.
          fireDeadline?.();
        });
      },
    };
    const node = createMddAuditorNode(llm as unknown as BaseChatModel, null, {
      ...FAST_TRANSPORT,
      deadlineMs: 20_000,
      setTimer: (fn) => {
        fireDeadline = fn;
        return 0;
      },
      clearTimer: () => undefined,
    });
    const out = await node(stateFor(SUBSTANTIAL_DRAFT));
    assert.equal(calls, 1, "sin reparación ni reintento tras agotar el presupuesto");
    assert.equal(out.auditorOutcome, "unavailable");
    assert.equal(out.auditorScore, undefined);
    assert.equal(out.auditorDecision, "done");
    assert.equal(out.auditorRan, true);
    assert.match(out.auditorFeedback ?? "", /presupuesto de tiempo del Auditor agotado/);
  });

  it("cancelación externa en vuelo con presupuesto activo => AbortError (no se convierte en unavailable)", async () => {
    const controller = new AbortController();
    const llm = {
      invoke: (_m: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
          // Cancelación del turno mientras la llamada está en vuelo.
          controller.abort();
        }),
    };
    const node = createMddAuditorNode(llm as unknown as BaseChatModel, null, {
      ...FAST_TRANSPORT,
      deadlineMs: 20_000,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    await assert.rejects(
      runWithLlmAbortSignal(controller.signal, () => node(stateFor(SUBSTANTIAL_DRAFT))),
      (err: Error) => err.name === "AbortError",
    );
  });
});
