import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMddChatJobMode, validateMddChatJobPayload } from "./mdd-queue-job-payload.util.js";
import { resolveMddChatConfig, resolveMddChatViaQueue } from "./mdd-chat-config.util.js";

describe("mdd-queue job payload (chat)", () => {
  it("isMddChatJobMode solo acepta manager y resume", () => {
    assert.equal(isMddChatJobMode("manager"), true);
    assert.equal(isMddChatJobMode("resume"), true);
    assert.equal(isMddChatJobMode("pipeline"), false);
    assert.equal(isMddChatJobMode(undefined), false);
  });

  it("resume válido: projectId + threadId + userMessage", () => {
    assert.equal(
      validateMddChatJobPayload({ mode: "resume", projectId: "p1", threadId: "t1", userMessage: "sí" }),
      null,
    );
  });

  it("resume válido solo con imágenes", () => {
    assert.equal(
      validateMddChatJobPayload({
        mode: "resume",
        projectId: "p1",
        threadId: "t1",
        imageAttachments: [{ mimeType: "image/png", data: "AAAA" } as never],
      }),
      null,
    );
  });

  it("resume sin threadId, sin mensaje o sin projectId es inválido", () => {
    assert.match(
      validateMddChatJobPayload({ mode: "resume", projectId: "p1", userMessage: "sí" }) ?? "",
      /threadId/,
    );
    assert.match(
      validateMddChatJobPayload({ mode: "resume", projectId: "p1", threadId: "t1", userMessage: "  " }) ?? "",
      /userMessage or images/,
    );
    assert.match(
      validateMddChatJobPayload({ mode: "resume", threadId: "t1", userMessage: "sí" }) ?? "",
      /projectId/,
    );
  });

  it("manager exige projectId; los demás modos no se validan aquí", () => {
    assert.equal(validateMddChatJobPayload({ mode: "manager", projectId: "p1" }), null);
    assert.match(validateMddChatJobPayload({ mode: "manager" }) ?? "", /projectId/);
    assert.equal(validateMddChatJobPayload({ mode: "pipeline" }), null);
  });
});

describe("mdd-chat config", () => {
  it("MDD_CHAT_VIA_QUEUE default activado", () => {
    assert.equal(resolveMddChatViaQueue({}), true);
    assert.deepEqual(resolveMddChatConfig({}), { chatViaQueue: true });
    assert.equal(resolveMddChatViaQueue({ MDD_CHAT_VIA_QUEUE: "1" }), true);
  });

  it("valores 0/false/off/no lo desactivan", () => {
    for (const v of ["0", "false", "OFF", " no "]) {
      assert.equal(resolveMddChatViaQueue({ MDD_CHAT_VIA_QUEUE: v }), false, v);
    }
  });
});
