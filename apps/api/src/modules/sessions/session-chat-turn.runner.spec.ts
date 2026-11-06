import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRetryBenchmarkAfterFalseEditClaim } from "./session-chat-turn.runner.js";

const currentDbga = `# Domain Benchmark\n\n${"## Sección\n\nContenido del DBGA.\n\n".repeat(10)}`;

function base(overrides: Partial<Parameters<typeof shouldRetryBenchmarkAfterFalseEditClaim>[0]> = {}) {
  return {
    tab: "benchmark",
    finalDbga: undefined,
    processDbga: false,
    intentAction: "chat_only" as const,
    currentDbgaContent: currentDbga,
    rawChat:
      "He actualizado el documento para reflejar que el SSO corporativo se encuentra en sso.obp.mx.",
    userMessage: "el sso corporativo se encuentra en sso.obp.mx",
    ...overrides,
  };
}

describe("shouldRetryBenchmarkAfterFalseEditClaim", () => {
  it("reintenta cuando el turno fue chat, el asistente afirma editar y nada se persistió", () => {
    assert.ok(shouldRetryBenchmarkAfterFalseEditClaim(base()));
  });

  it("no reintenta si ya se persistió o ya corrió el refinado", () => {
    assert.equal(shouldRetryBenchmarkAfterFalseEditClaim(base({ finalDbga: currentDbga })), false);
    assert.equal(shouldRetryBenchmarkAfterFalseEditClaim(base({ processDbga: true })), false);
  });

  it("no reintenta en otros tabs ni sin documento en el panel", () => {
    assert.equal(shouldRetryBenchmarkAfterFalseEditClaim(base({ tab: "mdd" })), false);
    assert.equal(
      shouldRetryBenchmarkAfterFalseEditClaim(base({ currentDbgaContent: "" })),
      false,
    );
  });

  it("no reintenta cuando el asistente espera confirmación o el usuario solo pregunta", () => {
    assert.equal(
      shouldRetryBenchmarkAfterFalseEditClaim(base({ intentAction: "confirm_then_edit" })),
      false,
    );
    assert.equal(
      shouldRetryBenchmarkAfterFalseEditClaim(
        base({
          rawChat: "¿Quieres que incorpore el SSO corporativo (sso.obp.mx) al DBGA?",
        }),
      ),
      false,
    );
    assert.equal(
      shouldRetryBenchmarkAfterFalseEditClaim(
        base({ userMessage: "¿qué sugieres para el SSO corporativo?" }),
      ),
      false,
    );
  });

  it("no reintenta si el asistente solo conversó sin afirmar cambios", () => {
    assert.equal(
      shouldRetryBenchmarkAfterFalseEditClaim(
        base({ rawChat: "Entendido, el SSO corporativo vive en sso.obp.mx. ¿Algo más?" }),
      ),
      false,
    );
  });
});
